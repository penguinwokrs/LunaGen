// LunaGen 起動確認デバッグ: ビルド済み拡張をロードし、実 luna 上で
// 生成ボタン(AI/クリア)の注入をスクショ確認する。
//
//   node .claude/skills/luna-startup-debug/verify.mjs
//
// 認証情報は bw の出力をプロセス内メモリへ直接取り込み、stdout/ファイルに出さない。
// このファイルはリポジトリ内にあるため、bare import で node_modules を解決できる。
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../..") // .claude/skills/luna-startup-debug -> repo root
const EXT = path.join(REPO, "build/chrome-mv3-prod")
const PROFILE = path.join(REPO, "e2e/.profile")
const SHOT_DIR = process.env.SHOT_DIR || path.join(REPO, "test-results/startup-debug")
const BW_ITEM = process.env.BW_ITEM || "ad73f275-86be-4fec-90dd-afa8013859cb"
const BW_SESSION_FILE = process.env.BW_SESSION_FILE || "/home/owner/.bw_session_key"
const FOCUS = process.env.FOCUS ?? "キャンプと焚き火の話"

const log = (...a) => console.log("[verify]", ...a)
mkdirSync(SHOT_DIR, { recursive: true })

// --- credentials: pulled straight into memory, never printed ---
function bwCred(field) {
  const session = readFileSync(BW_SESSION_FILE, "utf8").trim()
  return execFileSync("bw", ["get", field, BW_ITEM, "--session", session], {
    encoding: "utf8"
  }).trim()
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})

try {
  const page = await ctx.newPage()

  // 1. login if needed (判定は /api/user/get/me が 200 か)
  await page.goto("https://luna-matching.com/", { waitUntil: "domcontentloaded" })
  let me = await page.request.get("https://luna-matching.com/api/user/get/me")
  if (!me.ok()) {
    log("not logged in -> logging in via Bitwarden creds")
    await page.goto("https://luna-matching.com/auth", { waitUntil: "domcontentloaded" })
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(bwCred("username"))
    await page.getByRole("textbox", { name: "パスワード" }).fill(bwCred("password"))
    const remember = page.getByRole("checkbox", { name: /ログイン状態を保存/ })
    if (await remember.count()) await remember.check().catch(() => {})
    await page.getByRole("button", { name: "ログイン", exact: true }).click()
    await page.waitForTimeout(4000)
    me = await page.request.get("https://luna-matching.com/api/user/get/me")
    log("after login, me.ok =", me.ok())
  } else {
    log("already logged in (persisted profile)")
  }
  if (!me.ok()) throw new Error("login failed: /api/user/get/me not ok")

  // 2. open conversation list and click the first thread (rows are onclick routers)
  await page.goto("https://luna-matching.com/congratulation/list", {
    waitUntil: "domcontentloaded"
  })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: path.join(SHOT_DIR, "01-list.png") })

  let opened = false
  for (const y of [100, 175, 250, 325]) {
    await page.mouse.click(640, y)
    await page.waitForTimeout(2500)
    if (/\/user\/message\//.test(page.url())) {
      opened = true
      break
    }
    if (!/\/congratulation\/list/.test(page.url())) {
      await page.goto("https://luna-matching.com/congratulation/list", {
        waitUntil: "domcontentloaded"
      })
      await page.waitForTimeout(2500)
    }
  }
  log("thread url:", page.url(), "opened:", opened)

  // 3. assert injected buttons, screenshot
  const aiBtn = page.getByRole("button", { name: "AI", exact: true }).first()
  const clearBtn = page.getByRole("button", { name: "クリア", exact: true }).first()
  await aiBtn.waitFor({ state: "visible", timeout: 15000 })
  const aiOk = await aiBtn.isVisible()
  const clearOk = await clearBtn.isVisible()
  log("AI visible:", aiOk, "| クリア visible:", clearOk)

  if (FOCUS) {
    const ta = page.locator('textarea[placeholder="メッセージを入力"]').first()
    if (await ta.count()) await ta.fill(FOCUS)
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: path.join(SHOT_DIR, "02-thread-buttons.png") })

  log("screenshots saved to:", SHOT_DIR)
  if (!aiOk || !clearOk) {
    console.error("[verify] FAIL: 生成ボタンが注入されていません")
    process.exitCode = 1
  } else {
    log("OK: 起動確認成功（AI/クリアボタン注入済み）")
  }
} catch (e) {
  console.error("[verify] ERROR:", e.message)
  const p = (await ctx.pages())[0]
  if (p) await p.screenshot({ path: path.join(SHOT_DIR, "99-error.png") }).catch(() => {})
  process.exitCode = 1
} finally {
  await ctx.close()
}
