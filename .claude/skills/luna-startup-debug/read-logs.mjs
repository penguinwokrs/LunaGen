// LunaGen デバッグログ確認: e2e/.profile の chrome.storage.local から
// debugLogs / aiProvider を読み出して表示する。
//
//   node .claude/skills/luna-startup-debug/read-logs.mjs
//
// このファイルはリポジトリ内にあるため、bare import で node_modules を解決できる。
import { chromium } from "@playwright/test"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../..")
const EXT = path.join(REPO, "build/chrome-mv3-prod")
const PROFILE = path.join(REPO, "e2e/.profile")
const LIMIT = Number(process.env.LIMIT || 20)

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})
try {
  let [worker] = ctx.serviceWorkers()
  if (!worker) worker = await ctx.waitForEvent("serviceworker")

  // @plasmohq/storage は値を JSON.stringify して保存するのでパースする
  const raw = await worker.evaluate(async () =>
    chrome.storage.local.get(["debugLogs", "aiProvider"])
  )
  const provider = raw.aiProvider ? JSON.parse(raw.aiProvider) : "(unset)"
  const logs = raw.debugLogs ? JSON.parse(raw.debugLogs) : []
  console.log("aiProvider:", provider)
  console.log("log count:", logs.length)
  for (const l of logs.slice(0, LIMIT)) {
    console.log(`${l.timestamp} [${l.level}] ${l.message}${l.detail ? " | " + l.detail : ""}`)
  }
} catch (e) {
  console.error("ERROR:", e.message)
  process.exitCode = 1
} finally {
  await ctx.close()
}
