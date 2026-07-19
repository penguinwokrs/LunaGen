// LunaGen プロフィール改善機能の実機確認:
// /user/mod の編集オーバーレイに「✨ AIで改善」ボタンが注入され、
// クリックで3択モーダルが開くことをスクショ付きで検証する。
//
//   node .claude/skills/luna-startup-debug/verify-profile.mjs
//
// 注意: e2e/.profile にはAPIキーが無いため、カードは「エラー表示」になるのが正常。
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../..")
const EXT = path.join(REPO, "build/chrome-mv3-prod")
const PROFILE = path.join(REPO, "e2e/.profile")
const SHOT_DIR = process.env.SHOT_DIR || path.join(REPO, "test-results/profile-improve-debug")
const BW_ITEM = process.env.BW_ITEM || "ad73f275-86be-4fec-90dd-afa8013859cb"
const BW_SESSION_FILE = process.env.BW_SESSION_FILE || "/home/owner/.bw_session_key"

const log = (...a) => console.log("[verify-profile]", ...a)
mkdirSync(SHOT_DIR, { recursive: true })

function bwCred(field) {
  const session = readFileSync(BW_SESSION_FILE, "utf8").trim()
  return execFileSync("bw", ["get", field, BW_ITEM, "--session", session], { encoding: "utf8" }).trim()
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})

try {
  const page = await ctx.newPage()

  // 1. ログイン（必要時のみ）
  await page.goto("https://luna-matching.com/", { waitUntil: "domcontentloaded" })
  let me = await page.request.get("https://luna-matching.com/api/user/get/me")
  if (!me.ok()) {
    log("not logged in -> logging in via Bitwarden creds")
    await page.goto("https://luna-matching.com/auth", { waitUntil: "domcontentloaded" })
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(bwCred("username"))
    await page.getByRole("textbox", { name: "パスワード" }).fill(bwCred("password"))
    await page.getByRole("button", { name: "ログイン", exact: true }).click()
    await page.waitForTimeout(4000)
    me = await page.request.get("https://luna-matching.com/api/user/get/me")
  }
  if (!me.ok()) throw new Error("login failed")

  // 2. /user/mod を開き、自己紹介の「編集する」をクリック
  await page.goto("https://luna-matching.com/user/mod", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)

  // メッセージ用ボタン（AI/クリア）が誤注入されていないこと
  const msgBtnCount = await page.getByRole("button", { name: "AI", exact: true }).count()
  log("message-AI-button count on /user/mod:", msgBtnCount, "(expected 0)")

  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"))
    const h = all.find((el) => el.children.length === 0 && (el.textContent || "").trim() === "自己紹介")
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (b) => (b.innerText || "").trim() === "編集する"
    )
    const after = buttons.find((b) => h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    after.click()
  })
  await page.waitForTimeout(2500)

  // 3. 「✨ AIで改善」ボタンの注入を確認
  const improveBtn = page.getByRole("button", { name: /AIで改善/ }).first()
  await improveBtn.waitFor({ state: "visible", timeout: 15000 })
  log("improve button visible:", await improveBtn.isVisible())
  await page.screenshot({ path: path.join(SHOT_DIR, "01-edit-overlay-button.png") })

  // 4. クリック → モーダル（シャドウDOM）を確認
  await improveBtn.click()
  await page.waitForTimeout(2500)
  const host = page.locator("#lunagen-profile-panel-host")
  const hostCount = await host.count()
  log("panel host count:", hostCount, "(expected 1)")

  // Playwrightのlocatorはshadow DOMを貫通する
  for (const taste of ["堅実", "物語", "軽快"]) {
    const visible = await page.getByText(taste, { exact: true }).first().isVisible().catch(() => false)
    log(`taste card "${taste}" visible:`, visible)
  }
  await page.waitForTimeout(4000) // カードの生成/エラー確定を待つ
  await page.screenshot({ path: path.join(SHOT_DIR, "02-panel-cards.png") })

  const failed = msgBtnCount !== 0 || hostCount !== 1 || !(await improveBtn.isVisible().catch(() => false))
  if (failed) {
    console.error("[verify-profile] FAIL")
    process.exitCode = 1
  } else {
    log("OK: ボタン注入 + モーダル表示を確認（スクショ:", SHOT_DIR, ")")
  }
} catch (e) {
  console.error("[verify-profile] ERROR:", e.message)
  const p = (await ctx.pages())[0]
  if (p) await p.screenshot({ path: path.join(SHOT_DIR, "99-error.png") }).catch(() => {})
  process.exitCode = 1
} finally {
  await ctx.close()
}
