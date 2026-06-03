import { expect, test } from "./luna-harness"

/**
 * いいね/メッセージ生成ボタンの表示と、押下後のメッセージ挿入を検証する。
 *
 * ログイン不要・AI課金ゼロ(luna ページと Gemini API をモック)。
 * 手動で動きを見たいときは PAUSE=1 HEADED=1 で最後のテストを使う(e2e:harness)。
 */

const BUTTON = "✨ AIでメッセージ生成"

test.describe("メッセージ生成ボタン", () => {
  test("プロフィールページにボタンが表示される", async ({ context, harness }) => {
    const page = await context.newPage()
    await harness.gotoProfile(page)

    const button = page.getByRole("button", { name: BUTTON })
    await expect(button).toBeVisible()
    await page.close()
  })

  test("ボタン押下で生成メッセージが textarea に挿入される(通常)", async ({
    context,
    harness
  }) => {
    const page = await context.newPage()
    await harness.gotoProfile(page)

    const button = page.getByRole("button", { name: BUTTON })
    await button.click()

    // 生成完了後、モックの固定文が textarea に入る
    const textarea = page.locator("textarea#message-input")
    await expect(textarea).toHaveValue(harness.normalMessage, { timeout: 15_000 })

    // background → AI に、自分/相手プロフィールを含むプロンプトが渡っている
    const prompt = harness.lastPrompt()
    expect(prompt).toContain("テスト相手")
    expect(prompt).toContain("映画と旅行")
    // 双方向の需給マッチ分析が注入され、噛み合う軸が含まれている
    expect(prompt).toContain("# 需給マッチ分析")
    expect(prompt).toContain("年齢")
    await page.close()
  })

  test("プレミアム時もメッセージが挿入される", async ({ context, harness }) => {
    const page = await context.newPage()
    await harness.gotoProfile(page, { premium: true })

    const button = page.getByRole("button", { name: BUTTON })
    await button.click()

    const textarea = page.locator("textarea#message-input")
    await expect(textarea).toHaveValue(harness.premiumMessage, {
      timeout: 15_000
    })

    // プレミアム判定が効いてプロンプトに 480〜500 文字制約が入っている
    expect(harness.lastPrompt()).toContain("480")
    await page.close()
  })

  // 手動確認用。PAUSE=1(+ HEADED=1)のときだけ実行され、ブラウザを開いたまま止める。
  test("手動確認(PAUSE時のみ)", async ({ context, harness }) => {
    test.skip(!process.env.PAUSE, "PAUSE=1 のときだけ実行する手動ハーネス")

    const page = await context.newPage()
    await harness.gotoProfile(page)
    // Playwright Inspector で止まる。ボタンを押すとモック文が挿入されるのを目視確認できる。
    await page.pause()
  })
})
