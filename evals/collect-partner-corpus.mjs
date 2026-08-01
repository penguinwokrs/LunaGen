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
 *
 * 【重要】出力は他人の実プロフィールです。test-results/ 配下（gitignore）に
 * のみ置き、評価が完了したら削除してください:
 *   rm -rf test-results/message-research
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const OUT_DIR = "test-results/message-research"
const OUT_FILE = `${OUT_DIR}/corpus.json`
const PROFILE_DIR = "e2e/.profile"

/** 個人を特定しうるフィールドは落とす。前方一致で判定する。 */
const DROP_PREFIXES = [
  "name", "nickname", "handle", "image", "img", "photo", "picture", "thumb",
  "mail", "email", "tel", "phone", "twitter", "line", "url", "link", "ip"
]

/** 目標: 各層10件以上かつ合計50件以上 */
const TARGET_PER_STRATUM = 10
const TARGET_TOTAL = 50

const users = new Map() // hashedId -> anonymized user

const hash = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12)

function anonymize(u) {
  const out = {}
  for (const [k, v] of Object.entries(u)) {
    const lower = k.toLowerCase()
    if (DROP_PREFIXES.some((p) => lower.startsWith(p))) continue
    if (typeof v === "object" && v !== null) continue // ネストは捨てる（不要かつ特定リスク）
    out[k] = v
  }
  out.id = hash(u.id ?? u.user_id ?? JSON.stringify(u).slice(0, 64))
  return out
}

/** ユーザーオブジェクトらしさの判定。自己紹介か嗜好スコアを持つものを拾う。 */
function looksLikeUser(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false
  const keys = Object.keys(o)
  const hasId = keys.includes("id") || keys.includes("user_id")
  const hasProfileish = keys.some((k) => k === "profile" || k.startsWith("text_") || k.startsWith("q_"))
  return hasId && hasProfileish
}

/** レスポンスJSONを再帰的に走査してユーザーオブジェクトを集める */
function harvest(node, found, depth = 0) {
  if (depth > 4 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, found, depth + 1)
    return
  }
  if (looksLikeUser(node)) found.push(node)
  for (const v of Object.values(node)) harvest(v, found, depth + 1)
}

/** 自己紹介の長さで層を決める */
function stratumOf(u) {
  const intro = String(u.profile ?? "").trim()
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
  const c = counts()
  console.log(`\n[corpus] 保存: ${OUT_FILE}`)
  console.log(`[corpus] 合計 ${users.size} 件 (rich=${c.rich} thin=${c.thin} empty=${c.empty})`)
  console.log(`[corpus] 評価が終わったら削除してください: rm -rf ${OUT_DIR}`)
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chromium",
  headless: false,
  viewport: { width: 1280, height: 900 }
})

context.on("response", async (res) => {
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
  }
})

process.on("SIGINT", async () => {
  save()
  await context.close()
  process.exit(0)
})

const page = await context.newPage()
await page.goto("https://luna-matching.com/")
console.log("[corpus] ブラウザで検索一覧・いいね一覧などをスクロールしてください。")
console.log("[corpus] 目標に達したら Ctrl+C で保存します。")
