/**
 * 相手プロフィールのコーパス収集（評価用）
 *
 * ログイン済み Playwright プロファイル（e2e/.profile）でブラウザを開き、
 * 操作者が検索一覧・足あと・いいね一覧などを眺めている間に流れる
 * /api/user/ 系レスポンスからユーザーオブジェクトを拾って匿名化保存する。
 * Luna の一覧APIのURLは未確認のため、URLを決め打ちせずレスポンスを広く拾う。
 *
 * 実行:
 *   node evals/collect-partner-corpus.mjs
 *   → ブラウザが開くので、検索結果やいいね一覧をスクロールして相手を眺める
 *   → ターミナルに層別の件数が出る。目標に達したら Ctrl+C で保存終了
 *   → 収集中も一定件数・一定間隔ごとに自動保存されるので、途中で
 *     落ちても Ctrl+C 前の分がある程度は残る
 *
 * 【重要】出力は他人の実プロフィールです。test-results/ 配下（gitignore）に
 * のみ置き、評価が完了したら削除してください:
 *   rm -rf test-results/message-research
 */
import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const OUT_DIR = "test-results/message-research"
const OUT_FILE = `${OUT_DIR}/corpus.json`
const PROFILE_DIR = "e2e/.profile"

/**
 * 保持するフィールドの allowlist。
 *
 * 以前は「個人を特定しうる接頭辞」を除外する denylist 方式だったが、
 * `user_name` や `partner_image` のように接頭辞に一致しないキーを
 * 取りこぼす（実フィールド名は未検証で、この空白域が安全である保証がない）。
 * ここでは逆に「消費側が実際に読むフィールドだけ」を明示的に許可し、
 * それ以外は何であれ落とす。
 *
 * 消費側で参照しているフィールドから列挙した:
 *   - utils/profile.ts の extractProfileFromJSON
 *     （name/nickname は表示用に読むが個人特定リスクが高いため意図的に allowlist から外す。
 *      自己紹介=profile/introduction/intro/body、嗜好=text_my_like等、
 *      求める条件=conditions_text等、NG=text_my_ng等）
 *   - utils/demand-supply.ts の computeDemandSupply
 *     （relationship*、my_type、q_*、age・conditions_age_from/to、
 *      area・conditions_area*、body_type・conditions_body*、
 *      is_smoking・conditions_is_smoking*、
 *      is_private_partner・conditions_is_private_partner*）
 *   - utils/kink-analysis.ts の analyzeKinkType（my_type、q_*）
 */
const ALLOW_EXACT = new Set([
  "age", "sex", "area", "area_text",
  "work", "work_text",
  "occupation", // 実APIの職業フィールド（数値コード）。utils/occupation.ts で表示名に解決される

  "profile", "introduction", "intro", "body", // 自己紹介（4通りのフィールド名に対応）
  "preference", "preferences", "style", "play_style", // 嗜好・プレイスタイル
  "requirement", "requirements", "condition", "target_condition", // 求める条件
  "ng", "not_good", "dislike", "bad_point", // NG・拒否
  "my_type", // 性癖タイプコード（S/M象限）
  "body_type",
  "is_smoking",
  "is_private_partner",
])

/** 前方一致で許可するプレフィックス（q_*スコア、conditions_*条件、relationship*、text_*） */
const ALLOW_PREFIXES = ["q_", "conditions_", "relationship", "text_"]

/** 目標: 各層10件以上かつ合計50件以上 */
const TARGET_PER_STRATUM = Number(process.env.CORPUS_PER_STRATUM || 10)
const TARGET_TOTAL = Number(process.env.CORPUS_TARGET || 50)

/**
 * WITH_CARDS=1 で「好みのカード」も一緒に集める。
 * 相手ごとに追加リクエストが要る（相手のカード最大3ページ＋共通カード）ので既定は無効。
 * 収集したカードは `_cards` / `_commonCards` として匿名化レコードに付ける。
 */
const WITH_CARDS = process.env.WITH_CARDS === "1"
// 本番（logic/content-logic.ts）と揃える。評価が本番と違う枚数を見ては意味がない
const MAX_OWN_CARD_PAGES = 1
const MAX_COMMON_CARD_PAGES = 1

/** 新規ユーザーがこの件数増えるごとに自動保存する */
const AUTOSAVE_EVERY_N = 5
/** 自動保存の最大間隔（ミリ秒）。新規0件でも変化があれば定期的に保存する */
const AUTOSAVE_INTERVAL_MS = 60_000

/** 自己紹介として扱うフィールド名（4通り）。extractProfileFromJSON と同じ優先順位。 */
const INTRO_FIELDS = ["profile", "introduction", "intro", "body"]

const users = new Map() // hashedId -> anonymized user
/**
 * ログイン中の自分のユーザーID。
 * /api/user/get/me も /api/user/ 配下なので、素通しにすると自分のプロフィールが
 * コーパスに混ざる（2026-08-02 の実収集で実際に混入していた）。自分宛のメッセージを
 * 生成して評価してしまうので必ず除外する。
 */
let selfUserId = null
let lastSavedSize = 0
/** id相当の値がプリミティブでなかったためスキップしたレコード数（ハッシュ衝突回避） */
let skippedNonPrimitiveId = 0

// 実行ごとにランダムな salt を生成し、HMAC でハッシュ化する。
// 単純な sha256(id).slice(0,12) は、Luna のユーザーIDが小さい連番整数である以上
// 総当たりで即座に逆引きできてしまう。salt は出力ファイルに一切含めない
// （メモリ上にのみ存在し、プロセス終了とともに消える）。
// 同一プロセス内では同じ入力IDに対して同じハッシュを返す（重複排除に使うため）。
const SALT = randomBytes(32)
const hash = (v) => createHmac("sha256", SALT).update(String(v)).digest("hex").slice(0, 12)

/** 文字列・数値・真偽値だけの配列かどうか（conditions_area: ["13","14"] 等） */
function isPrimitiveArray(v) {
  return Array.isArray(v) && v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))
}

/**
 * id相当の値が安定した一意性を持つプリミティブ（文字列・数値）かどうか。
 * `hash()` は `String(v)` を経由するため、id がオブジェクトだと `"[object Object]"` という
 * 定数文字列がハッシュされ、異なる実ユーザーが同一ハッシュIDに衝突しうる（衝突すると
 * users.set の後勝ちで前のレコードが静かに消える）。安定した一意性が得られない場合は
 * そのレコードを収集対象から外す。
 */
function isPrimitiveId(v) {
  return typeof v === "string" || typeof v === "number"
}

function anonymize(u) {
  const out = {}
  for (const [k, v] of Object.entries(u)) {
    const lower = k.toLowerCase()
    // allowlist を通ったあとの最終ガード。前方一致の許可（conditions_ 等）は想定外の
    // フィールドを通しうる。2026-08-02 の実収集で conditions_type_img_url が実際にすり抜け、
    // ファイル名に個体別ID（.../conditions_type_img_url_149587.png）を含んでいた。
    // これはIDをHMACで潰した意味を無効化する再識別の穴なので、URL・画像系は常に落とす。
    if (/url|image|img|icon|photo|thumb/.test(lower)) continue
    const allowed = ALLOW_EXACT.has(lower) || ALLOW_PREFIXES.some((p) => lower.startsWith(p))
    if (!allowed) continue
    // allowlist を通過したキーでも、値がオブジェクト（配列含む）のネストなら中身は
    // 未検証。文字列/数値/真偽値だけの配列（conditions_area等）は消費側が使うため保持し、
    // それ以外のオブジェクトのネストは特定リスク回避のため捨てる。
    if (v !== null && typeof v === "object" && !isPrimitiveArray(v)) continue
    out[k] = v
  }
  // id/user_id はここで初めて生の値を読み、必ずハッシュ化した値だけを書き込む。
  // allowlist に "id"/"user_id" を含めていないので、上のループで生の値が
  // コピーされることはない。
  out.id = hash(u.id ?? u.user_id ?? JSON.stringify(u).slice(0, 64))
  return out
}

function introOf(u) {
  for (const f of INTRO_FIELDS) {
    const v = u?.[f]
    if (typeof v === "string" && v.trim()) return v
  }
  return ""
}

/** ユーザーオブジェクトらしさの判定。自己紹介か嗜好スコアを持つものを拾う。 */
function looksLikeUser(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false
  const keys = Object.keys(o)
  const hasId = keys.includes("id") || keys.includes("user_id")
  const hasProfileish = keys.some(
    (k) => INTRO_FIELDS.includes(k) || k.startsWith("text_") || k.startsWith("q_")
  )
  return hasId && hasProfileish
}

/**
 * `utils/profile.ts` の `extractProfileFromJSON` は
 * `asObject(u.user) || asObject(u.profile) || asObject(u.member) || u` という形で、
 * 実データが `user`/`profile`/`member` キーの下にネストしている形状を明示的に想定している
 * （`profile` はネスト用ラッパーのキー名でもあり、自己紹介文そのもののフィールド名でもあるため、
 * オブジェクトの場合のみラッパーとして扱う、という判定も含めて同一の優先順位で揃えている）。
 *
 * ここではその形状を harvest 側でも認識できるよう、外側と内側を1件のユーザーとして統合する。
 * 「外側に id、内側に自己紹介本文や q_* がある」ケースが実際にあり得るため、id はできれば
 * 外側にも残しつつ、実データ（内側）を優先してマージする。ラッパーキー自体は展開後の混乱を
 * 避けるため出力に含めない。統合後のオブジェクトは harvest の中でしか使わず、最終的な出力は
 * 必ず anonymize() の allowlist を通す（ここでは allowlist を迂回しない）。
 */
function unwrapNested(u) {
  if (!u || typeof u !== "object" || Array.isArray(u)) return { value: u, wrapperKey: null }
  const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null)
  let wrapperKey = null
  let inner = null
  if ((inner = asObject(u.user))) wrapperKey = "user"
  else if ((inner = asObject(u.profile))) wrapperKey = "profile"
  else if ((inner = asObject(u.member))) wrapperKey = "member"
  if (!inner) return { value: u, wrapperKey: null }
  const outerRest = { ...u }
  delete outerRest[wrapperKey]
  // 内側（実データ）を優先してマージ。外側にしか無いキー（例: 外側だけのid）は残る。
  return { value: { ...outerRest, ...inner }, wrapperKey }
}

/** レスポンスJSONを再帰的に走査してユーザーオブジェクトを集める。
 *  JSONにサイクルは無いため深さを広げるコストはほぼ無い。暴走防止のためだけに
 *  上限を高く残す（実データがここまで深くネストすることは通常ない）。 */
function harvest(node, found, depth = 0) {
  if (depth > 50 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, found, depth + 1)
    return
  }
  const { value: merged, wrapperKey } = unwrapNested(node)
  const captured = looksLikeUser(merged)
  if (captured) found.push(merged)
  for (const [k, v] of Object.entries(node)) {
    // 統合済みのラッパーキー（user/profile/member）の中身は既に found に取り込んでいるので、
    // 二重に走査して同じユーザーを found に重複投入しない（`user: {id, profile, ...}` のように
    // 内側自身が id を持つ形状だと、統合前の生の内側オブジェクトも単独で looksLikeUser を満たし
    // うるため）。統合できなかった場合（captured=false）は通常通り中身も探索する。
    if (captured && k === wrapperKey) continue
    harvest(v, found, depth + 1)
  }
}

/** 自己紹介の長さで層を決める */
function stratumOf(u) {
  const intro = introOf(u).trim()
  if (intro.length >= 100) return "rich"
  if (intro.length >= 30) return "thin"
  return "empty"
}

function counts() {
  const c = { rich: 0, thin: 0, empty: 0 }
  for (const u of users.values()) c[stratumOf(u)]++
  return c
}

function save() {
  mkdirSync(OUT_DIR, { recursive: true })
  const payload = { collectedAt: new Date().toISOString(), users: [...users.values()] }
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2))
  lastSavedSize = users.size
  const c = counts()
  console.log(`\n[corpus] 保存: ${OUT_FILE}`)
  console.log(`[corpus] 合計 ${users.size} 件 (rich=${c.rich} thin=${c.thin} empty=${c.empty})`)
  console.log(`[corpus] 評価が終わったら削除してください: rm -rf ${OUT_DIR}`)
}

/** 新規追加が一定件数を超えたら即座に自動保存する */
function autosaveIfNeeded() {
  if (users.size - lastSavedSize >= AUTOSAVE_EVERY_N) save()
}

// 長時間ブラウジングしていて新規追加が細かい場合でも、一定間隔で保存しておく
// （unhandled rejection 等でプロセスが落ちても、それまでの収集が全損しないように）。
// save() 内の mkdirSync/writeFileSync が例外（ディスク不足等）を投げると、setInterval の
// コールバックは他のどこにも try/catch で保護されていないため未捕捉例外となりプロセス全体が
// 落ちてしまう。「全損防止」という自動保存の目的そのものを裏切るため、ここで確実に保護する。
const autosaveTimer = setInterval(() => {
  if (users.size > lastSavedSize) {
    try {
      save()
    } catch (err) {
      console.error("[corpus] 自動保存に失敗しました（収集は継続します）:", err)
    }
  }
}, AUTOSAVE_INTERVAL_MS)


/**
 * 相手の好みのカードを、ログイン済みのページ内から取得する。
 * 同一オリジンで叩く必要があるので page.evaluate 経由。
 */
async function fetchCards(page, rawId) {
  if (rawId === undefined || rawId === null) return { own: [], common: [] }
  try {
    return await page.evaluate(
      async ([id, maxOwn, maxCommon]) => {
        const parse = (j) => {
          const l = j?.user_card_list ?? j?.card_list
          if (!l || !Array.isArray(l.data)) return null
          return {
            names: l.data.map((c) => (typeof c?.name === "string" ? c.name.trim() : "")).filter(Boolean),
            last: Number(l.last_page) > 0 ? Number(l.last_page) : 1
          }
        }
        const collect = async (kind, max) => {
          const seen = new Set()
          const out = []
          const get = async (p) => {
            try {
              const r = await fetch(`/api/user/${kind}/card/get/${id}?page=${p}`)
              return r.ok ? parse(await r.json()) : null
            } catch { return null }
          }
          const first = await get(1)
          if (!first) return out
          for (const n of first.names) if (!seen.has(n)) { seen.add(n); out.push(n) }
          for (let p = 2; p <= Math.min(first.last, max); p++) {
            const x = await get(p)
            if (!x) break
            for (const n of x.names) if (!seen.has(n)) { seen.add(n); out.push(n) }
          }
          return out
        }
        return { own: await collect("your", maxOwn), common: await collect("common", maxCommon) }
      },
      [String(rawId), MAX_OWN_CARD_PAGES, MAX_COMMON_CARD_PAGES]
    )
  } catch {
    return { own: [], common: [] }
  }
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chromium",
  // 手動モードでは人がスクロールするので表示が要る。自動巡回モードは表示不要。
  headless: process.env.AUTO_SCROLL === "1",
  viewport: { width: 1280, height: 900 }
})

context.on("response", async (res) => {
  // レスポンスハンドラ全体を try/catch で囲む。harvest/anonymize/users.set の
  // どこかで例外が出ると、ここまでtry/catchが無かった場合 unhandled rejection で
  // プロセスが落ち、保存はSIGINT時のみなのでそれまでの収集が全部消えてしまう。
  try {
    const url = res.url()
    // 2026-08-02 実測: ユーザー一覧は /api/user/ ではなく /api/v1/search から返る
    // （1リクエスト20件、自己紹介・text_my_*・q_*・conditions_* を含む完全な形）。
    // 一覧APIのパスを決め打ちできないので、Lunaのホスト配下の /api/ を広く拾う。
    // ホストで絞るのは、Sentry や Datadog RUM など第三者の /api/ を拾わないため。
    if (!url.includes("luna-matching.com/api/")) return
    let json
    try {
      json = await res.json()
    } catch {
      return
    }
    // 自分のIDを覚えて、以降のハーベストから除外する
    if (url.includes("/api/user/get/me")) {
      const me = json?.user ?? json
      const id = me?.id ?? me?.user_id
      if (id !== undefined && id !== null) selfUserId = String(id)
    }

    const found = []
    harvest(json, found)
    let added = 0
    for (const u of found) {
      // id相当の値が非プリミティブ（オブジェクト等）だと hash() が "[object Object]" という
      // 定数文字列をハッシュしてしまい、異なる実ユーザーが同一ハッシュIDに衝突する
      // （後勝ちで前のレコードが静かに消える）。安定した一意性が得られないので、
      // anonymize() に渡す前にここで弾く。
      const rawId = u.id ?? u.user_id
      if (selfUserId !== null && String(rawId) === selfUserId) continue // 自分は入れない
      if (rawId !== undefined && rawId !== null && !isPrimitiveId(rawId)) {
        skippedNonPrimitiveId++
        console.warn(
          `[corpus] idが非プリミティブのためスキップ（累計${skippedNonPrimitiveId}件）:`,
          typeof rawId
        )
        continue
      }
      const a = anonymize(u)
      if (WITH_CARDS && !users.has(a.id)) {
        const rawId = u.id ?? u.user_id
        const cards = await fetchCards(page, rawId)
        a._cards = cards.own
        a._commonCards = cards.common
      }
      if (!users.has(a.id)) {
        users.set(a.id, a)
        added++
      }
    }
    if (added > 0) {
      const c = counts()
      const done = c.rich >= TARGET_PER_STRATUM && c.thin >= TARGET_PER_STRATUM &&
        c.empty >= TARGET_PER_STRATUM && users.size >= TARGET_TOTAL
      console.log(
        `[corpus] +${added} → 合計 ${users.size} (rich=${c.rich} thin=${c.thin} empty=${c.empty})` +
        (done ? "  ★目標達成。Ctrl+C で保存終了" : "")
      )
      autosaveIfNeeded()
    }
  } catch (err) {
    console.error("[corpus] レスポンス処理でエラー（収集は継続します）:", err)
  }
})

let shuttingDown = false // 素早い連続 Ctrl+C で save()/context.close() が二重に走るのを防ぐ
process.on("SIGINT", async () => {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(autosaveTimer)
  // 終了時保存も自動保存タイマーと同様に保護する。ここで例外が飛ぶと、収集済みデータが
  // 最後まで一切保存されないまま終了してしまう（そのために備えたSIGINTハンドラの意味が無い）。
  try {
    save()
  } catch (err) {
    console.error("[corpus] 終了時の保存に失敗しました:", err)
  }
  await context.close()
  process.exit(0)
})

const page = await context.newPage()

/** 目標到達判定 */
function reachedTarget() {
  const c = counts()
  return c.rich >= TARGET_PER_STRATUM && c.thin >= TARGET_PER_STRATUM &&
    c.empty >= TARGET_PER_STRATUM && users.size >= TARGET_TOTAL
}

if (process.env.AUTO_SCROLL === "1") {
  // 自動巡回モード。/search を開いて最下部までスクロールし続け、
  // 目標に達するか上限回数に届いたら保存して終了する。
  // 2026-08-02 実測: /api/v{n}/search が1リクエストあたり20件返し、
  // 自己紹介・text_my_like・text_my_ng・q_*・conditions_* を含む完全な形で来る。
  const MAX_SCROLLS = Number(process.env.AUTO_SCROLL_MAX || 60)
  console.log("[corpus] 自動巡回モードで開始します（AUTO_SCROLL=1）")
  await page.goto("https://luna-matching.com/search", { waitUntil: "networkidle", timeout: 60_000 })

  let idle = 0
  let prevSize = 0
  for (let i = 0; i < MAX_SCROLLS && !reachedTarget(); i++) {
    await page.mouse.wheel(0, 5000)
    await page.waitForTimeout(2000)
    if (users.size === prevSize) {
      idle++
      // 新規が増えなくなったら一度ページ末尾へ飛ばして追加読み込みを促す
      if (idle >= 3) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(2500)
      }
      if (idle >= 8) {
        console.log("[corpus] 新規が増えなくなったため打ち切ります")
        break
      }
    } else {
      idle = 0
      prevSize = users.size
    }
  }

  clearInterval(autosaveTimer)
  try {
    save()
  } catch (err) {
    console.error("[corpus] 保存に失敗しました:", err)
  }
  await context.close()
  process.exit(0)
} else {
  await page.goto("https://luna-matching.com/")
  console.log("[corpus] ブラウザで検索一覧・いいね一覧などをスクロールしてください。")
  console.log("[corpus] 目標に達したら Ctrl+C で保存します。")
}
