import { test as base, chromium, type BrowserContext } from "@playwright/test"
import path from "node:path"

/**
 * ビルド済み拡張(本番ビルド)のパス。
 * 事前に `pnpm build` を実行しておくこと。
 */
const EXTENSION_PATH = path.resolve(__dirname, "../build/chrome-mv3-prod")

/**
 * 拡張をロードした persistent context と、その拡張IDを提供する fixture。
 *
 * MV3 拡張は通常の browser.newContext では読み込めないため、
 * launchPersistentContext + --load-extension を使う。
 * 新ヘッドレス(channel: "chromium")は拡張ロードに対応している。
 */
export const test = base.extend<{
  context: BrowserContext
  extensionId: string
}>({
  context: async ({}, use) => {
    // E2E_USER_DATA_DIR を指定すると Chrome プロファイル(Cookie/ログイン状態)が
    // そのディレクトリに永続化される。一度 headed でログインしておけば
    // 以降のテストはログイン済みの状態で実行できる。
    // 未指定なら毎回使い捨ての一時プロファイル("")。
    const userDataDir = process.env.E2E_USER_DATA_DIR ?? ""
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      // 拡張を確実に動かすため headed が必要な環境では HEADED=1 を指定
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    })
    await use(context)
    await context.close()
  },

  extensionId: async ({ context }, use) => {
    // MV3 の background service worker の URL からIDを取得
    let [worker] = context.serviceWorkers()
    if (!worker) {
      worker = await context.waitForEvent("serviceworker")
    }
    const extensionId = new URL(worker.url()).host
    await use(extensionId)
  }
})

export const expect = test.expect
