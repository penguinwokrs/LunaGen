import { expect, test } from "./fixtures"

/**
 * luna-matching.com のログイン状態を前提にしたブラウザ操作テスト。
 *
 * ログインは Chrome プロファイルの永続化で再利用する想定:
 *   1. 一度だけ headed + 永続プロファイルでログインしておく
 *        pnpm e2e:login
 *      (codegen が立ち上がるので画面でログインする。Bitwarden CLI から
 *       認証情報を取り出す場合は `bw get item luna-matching` 等を使う)
 *   2. 以降は同じプロファイルを使うのでログイン済みで実行される
 *        E2E_USER_DATA_DIR=e2e/.profile pnpm e2e
 *
 * 上記プロファイルが無い/未ログインの場合、ログイン依存テストは skip する。
 */

/**
 * ログイン済みか判定する。
 * /api/user/get/me は未ログイン時 401({error_code:401})、
 * ログイン時 200 を返すのでこれを認証シグナルにする。
 * (/api/user/is_auth はキー名が `is_atuh` という実装上のタイポで返るため使わない)
 */
async function fetchMe(page: import("@playwright/test").Page) {
  return page.request.get("https://luna-matching.com/api/user/get/me")
}

test.describe("luna-matching.com (ログイン必須)", () => {
  test("ログイン済みプロファイルで自分の情報を取得できる", async ({
    context
  }) => {
    const page = await context.newPage()
    await page.goto("https://luna-matching.com/")

    const me = await fetchMe(page)
    test.skip(
      !me.ok(),
      "未ログイン。`pnpm e2e:login` でログインし E2E_USER_DATA_DIR を指定して再実行してください"
    )

    // ログイン済みなら自分のプロフィールJSONが返る
    const body = await me.json()
    expect(body?.error_code).toBeUndefined()
    await page.close()
  })
})
