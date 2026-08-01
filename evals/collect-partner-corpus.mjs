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
const TARGET_PER_STRATUM = 10
const TARGET_TOTAL = 50

/** 新規ユーザーがこの件数増えるごとに自動保存する */
const AUTOSAVE_EVERY_N = 5
/** 自動保存の最大間隔（ミリ秒）。新規0件でも変化があれば定期的に保存する */
const AUTOSAVE_INTERVAL_MS = 60_000

/** 自己紹介として扱うフィールド名（4通り）。extractProfileFromJSON と同じ優先順位。 */
const INTRO_FIELDS = ["profile", "introduction", "intro", "body"]

const users = new Map() // hashedId -> anonymized user
let lastSavedSize = 0

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

function anonymize(u) {
  const out = {}
  for (const [k, v] of Object.entries(u)) {
    const lower = k.toLowerCase()
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

/** レスポンスJSONを再帰的に走査してユーザーオブジェクトを集める。
 *  JSONにサイクルは無いため深さを広げるコストはほぼ無い。暴走防止のためだけに
 *  上限を高く残す（実データがここまで深くネストすることは通常ない）。 */
function harvest(node, found, depth = 0) {
  if (depth > 50 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, found, depth + 1)
    return
  }
  if (looksLikeUser(node)) found.push(node)
  for (const v of Object.values(node)) harvest(v, found, depth + 1)
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
const autosaveTimer = setInterval(() => {
  if (users.size > lastSavedSize) save()
}, AUTOSAVE_INTERVAL_MS)

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chromium",
  headless: false,
  viewport: { width: 1280, height: 900 }
})

context.on("response", async (res) => {
  // レスポンスハンドラ全体を try/catch で囲む。harvest/anonymize/users.set の
  // どこかで例外が出ると、ここまでtry/catchが無かった場合 unhandled rejection で
  // プロセスが落ち、保存はSIGINT時のみなのでそれまでの収集が全部消えてしまう。
  try {
    const url = res.url()
    if (!url.includes("/api/user/")) return
    let json
    try {
      json = await res.json()
    } catch {
      return
    }
    const found = []
    harvest(json, found)
    let added = 0
    for (const u of found) {
      const a = anonymize(u)
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
  save()
  await context.close()
  process.exit(0)
})

const page = await context.newPage()
await page.goto("https://luna-matching.com/")
console.log("[corpus] ブラウザで検索一覧・いいね一覧などをスクロールしてください。")
console.log("[corpus] 目標に達したら Ctrl+C で保存します。")
