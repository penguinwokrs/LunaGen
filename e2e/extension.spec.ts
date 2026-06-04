import { expect, test } from "./fixtures"

/**
 * 拡張機能そのものの動作確認(ネットワーク不要・ログイン不要)。
 * `pnpm build` 済みであれば常に実行できる。
 */
test.describe("拡張のロード", () => {
  test("background service worker が起動し拡張IDが取れる", async ({
    extensionId
  }) => {
    // 拡張IDは a-p の32文字
    expect(extensionId).toMatch(/^[a-p]{32}$/)
  })

  test("オプションページが描画される", async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await expect(page.locator("body")).toBeVisible()
    // 何らかのコントロール(input/button等)が存在する
    await expect(page.locator("input, button, textarea").first()).toBeVisible()
    await page.close()
  })

  test("ポップアップが描画される", async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(page.locator("body")).toBeVisible()
    await page.close()
  })

  test("ポップアップの「設定画面を開く」でオプションページが開く", async ({
    context,
    extensionId
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/popup.html`)

    // openOptionsPage に依存せず tabs.create フォールバックで新規タブが開くこと
    const opened = context.waitForEvent("page")
    await page.getByRole("button", { name: "設定画面を開く" }).click()
    const optionsPage = await opened
    await optionsPage.waitForLoadState()
    expect(optionsPage.url()).toContain("options.html")

    await optionsPage.close()
    await page.close()
  })
})
