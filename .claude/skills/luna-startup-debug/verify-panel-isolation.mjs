// パネル操作がLunaの編集オーバーレイを閉じてしまわないことの回帰テスト
//
//   node .claude/skills/luna-startup-debug/verify-panel-isolation.mjs
//
// 判定基準:
//   編集オーバーレイが開いている = textarea が存在する（トップ画面は textarea 0個）
//   ※「自己紹介」等の見出しテキストはトップ画面にも存在するため判定に使えない
//
// 検証項目:
//   1. パネル内クリックでパネルが維持される
//   2. パネル内クリックで背後の編集オーバーレイも維持される（本テストの主目的）
//   3. キャンセル/背景クリックでパネルだけ閉じ、編集オーバーレイは維持される
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

const log = (...a) => console.log("[panel-isolation]", ...a)
mkdirSync(SHOT_DIR, { recursive: true })

function bwCred(field) {
  const session = readFileSync(BW_SESSION_FILE, "utf8").trim()
  return execFileSync("bw", ["get", field, BW_ITEM, "--session", session], { encoding: "utf8" }).trim()
}

const failures = []
const check = (name, actual, expected) => {
  const ok = actual === expected
  log(`${ok ? "PASS" : "FAIL"}: ${name} (actual=${actual}, expected=${expected})`)
  if (!ok) failures.push(name)
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})

try {
  const page = await ctx.newPage()
  const state = () =>
    page.evaluate(() => ({
      editorOpen: document.querySelectorAll("textarea").length > 0,
      panelOpen: document.querySelectorAll("#lunagen-profile-panel-host").length > 0
    }))

  // ログイン
  await page.goto("https://luna-matching.com/", { waitUntil: "domcontentloaded" })
  let me = await page.request.get("https://luna-matching.com/api/user/get/me")
  if (!me.ok()) {
    log("logging in via Bitwarden creds")
    await page.goto("https://luna-matching.com/auth", { waitUntil: "domcontentloaded" })
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(bwCred("username"))
    await page.getByRole("textbox", { name: "パスワード" }).fill(bwCred("password"))
    await page.getByRole("button", { name: "ログイン", exact: true }).click()
    await page.waitForTimeout(4000)
    me = await page.request.get("https://luna-matching.com/api/user/get/me")
  }
  if (!me.ok()) throw new Error("login failed")

  // 編集オーバーレイを開く
  const openEditor = async () => {
    await page.goto("https://luna-matching.com/user/mod", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(3500)
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"))
      const h = all.find((el) => el.children.length === 0 && (el.textContent || "").trim() === "自己紹介")
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        (b) => (b.innerText || "").trim() === "編集する"
      )
      const after = buttons.find((b) => h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      after.click()
    })
    await page.waitForTimeout(2000)
  }

  const openPanel = async () => {
    const btn = page.getByRole("button", { name: /AIで改善/ }).first()
    await btn.waitFor({ state: "visible", timeout: 15000 })
    await btn.click()
    await page.waitForTimeout(3500) // カードの生成/エラー確定を待つ
  }

  await openEditor()
  check("編集オーバーレイが開いている", (await state()).editorOpen, true)

  await openPanel()
  let s = await state()
  check("パネルが開いた", s.panelOpen, true)
  check("パネルを開いても編集オーバーレイは維持", s.editorOpen, true)

  // --- 主目的: パネル内クリックで編集オーバーレイが閉じないこと ---
  const titleBox = await page.getByText("堅実", { exact: true }).first().boundingBox()
  await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)
  await page.waitForTimeout(800)
  s = await state()
  check("カード内クリック後もパネルが維持", s.panelOpen, true)
  check("カード内クリック後も編集オーバーレイが維持", s.editorOpen, true)
  await page.screenshot({ path: path.join(SHOT_DIR, "isolation-01-after-card-click.png") })

  // 再生成ボタン
  await page.getByRole("button", { name: "♻ 再生成" }).first().click()
  await page.waitForTimeout(1000)
  s = await state()
  check("再生成クリック後もパネルが維持", s.panelOpen, true)
  check("再生成クリック後も編集オーバーレイが維持", s.editorOpen, true)

  // キャンセル -> パネルだけ閉じる
  await page.getByRole("button", { name: /キャンセル/ }).click()
  await page.waitForTimeout(800)
  s = await state()
  check("キャンセルでパネルが閉じる", s.panelOpen, false)
  check("キャンセル後も編集オーバーレイが維持", s.editorOpen, true)
  await page.screenshot({ path: path.join(SHOT_DIR, "isolation-02-after-cancel.png") })

  // 背景クリック -> パネルだけ閉じる
  await openPanel()
  check("パネルを再度開けた", (await state()).panelOpen, true)
  await page.mouse.click(20, 20)
  await page.waitForTimeout(800)
  s = await state()
  check("背景クリックでパネルが閉じる", s.panelOpen, false)
  check("背景クリック後も編集オーバーレイが維持", s.editorOpen, true)
  await page.screenshot({ path: path.join(SHOT_DIR, "isolation-03-after-backdrop.png") })

  if (failures.length) {
    console.error(`[panel-isolation] FAILED (${failures.length}): ${failures.join(", ")}`)
    process.exitCode = 1
  } else {
    log("ALL PASS")
  }
} catch (e) {
  console.error("[panel-isolation] ERROR:", e.message)
  process.exitCode = 1
} finally {
  await ctx.close()
}
