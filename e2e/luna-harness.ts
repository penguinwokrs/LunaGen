import { type Page } from "@playwright/test"

import { test as extensionTest } from "./fixtures"

/**
 * いいね/メッセージ生成ボタンを「ログイン不要・AI課金ゼロ」で
 * 検証するためのモックハーネス。
 *
 * 仕組み:
 *  - luna-matching.com を context.route で偽プロフィールページに差し替え
 *    (content script は URL マッチで注入されるのでボタンは本物が動く)
 *  - 自分/相手プロフィールは chrome.storage / sessionStorage に直接シード
 *    → 毎回の実プロフィール解析(コスト/ログイン)が不要
 *  - background が叩く Gemini API(generativelanguage.googleapis.com)を
 *    context.route で固定文に差し替え → 実 AI 呼び出し・課金が発生しない
 *
 * これを spec(自動検証)と手動確認(PAUSE)の両用途で使う。
 */

/** プロフィールページのパス。/user/show/{id} で content script のボタン注入対象になる */
const TARGET_USER_ID = "123"
const PROFILE_PATH = `/user/show/${TARGET_USER_ID}`

/** モック AI が返す固定メッセージ(これらと textarea の値が一致するか検証する) */
export const NORMAL_MESSAGE =
  "はじめまして、テスト初回メッセージです。プロフィール拝見しました、よろしくお願いします！"
// プレミアムは 400〜500 文字想定。background のプレミアム再生成
// (400〜500 文字外で1回リトライ)が走らない代表的な長さ(約451文字)にする。
export const PREMIUM_MESSAGE =
  "プレミアム用テストメッセージです。" +
  "プロフィールを拝見して、価値観や好みがとても近いと感じました。".repeat(14)

/** シードする相手プロフィール(extractProfileFromJSON 用テキスト + 需給マッチ用の構造化フィールド) */
const DEFAULT_TARGET = {
  id: TARGET_USER_ID,
  name: "テスト相手",
  age: 28,
  area: "13",
  body_type: "3",
  my_type: "J", // sub-masochist
  q_sex: 4,
  q_pleasure: 4,
  relationship_1: true,
  conditions_age_from: 30,
  conditions_age_to: 40,
  conditions_area: ["13"],
  profile: "よろしくお願いします。アウトドアと料理、映画が好きです。"
}

/** 相手レスポンス全体に含まれる *_list ルックアップ表（地域コード→表示名） */
const TARGET_LOOKUPS = {
  area_list: { "13": "東京都" }
}

/** シードする自分プロフィール(表示用テキスト) */
const MY_PROFILE_TEXT =
  "名前: テスト自分\n年齢: 33歳\n\n【自己紹介】\n映画と旅行が好きです。よろしくお願いします。\n"

/** シードする自分の生JSON(双方向需給マッチ用) */
const MY_RAW = {
  age: 33,
  area: "13",
  body_type: "3",
  my_type: "A", // dom-sadist（相手 sub と相補）
  q_sex: 5,
  q_pleasure: 5,
  relationship_1: true,
  conditions_age_from: 25,
  conditions_age_to: 40,
  conditions_area: ["13"],
  conditions_body: ["3"]
}

/** @plasmohq/storage 互換のシリアライズ(set は JSON.stringify で保存される) */
function plasmoSerialize(obj: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)])
  )
}

/** 偽プロフィールページの HTML。content script の MutationObserver を
 *  発火させるため、textarea はロード後に動的に追加する。 */
function profileHtml() {
  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Luna Mock - User ${TARGET_USER_ID}</title></head>
<body>
  <h1>テスト相手 さんのプロフィール</h1>
  <div id="app"></div>
  <script>
    // content script は DOM 変化で textarea を検知してボタンを注入するため、
    // ロード後に setTimeout で挿入して mutation を起こす。
    setTimeout(function () {
      var form = document.createElement("form");
      var ta = document.createElement("textarea");
      ta.id = "message-input";
      ta.placeholder = "メッセージを入力";
      form.appendChild(ta);
      // ?premium=1 のときはプレミアム判定用テキストを置く
      if (new URLSearchParams(location.search).get("premium")) {
        var p = document.createElement("p");
        p.textContent = "プレミアムメッセージを送る";
        document.body.appendChild(p);
      }
      document.getElementById("app").appendChild(form);
    }, 150);
  </script>
</body>
</html>`
}

export interface Harness {
  /** 通常時に返る固定メッセージ */
  normalMessage: string
  /** プレミアム時に返る固定メッセージ */
  premiumMessage: string
  /** 偽プロフィールページへ遷移し、相手情報をシードする。生成ボタンの locator を返す */
  gotoProfile: (page: Page, opts?: { premium?: boolean }) => Promise<void>
  /** 直近に background → Gemini モックへ送られたプロンプト本文 */
  lastPrompt: () => string | null
}

export const test = extensionTest.extend<{ harness: Harness }>({
  harness: async ({ context, extensionId }, use) => {
    void extensionId // service worker が起動していることを保証する

    let lastPrompt: string | null = null

    // 1. background が叩く Gemini API をモック(実 AI 呼び出し・課金を防ぐ)
    await context.route(
      "https://generativelanguage.googleapis.com/**",
      async (route) => {
        const req = route.request()
        if (req.method() === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: { "access-control-allow-origin": "*" }
          })
          return
        }

        const body = req.postData() ?? ""
        lastPrompt = body
        // プレミアム時はプロンプトに文字数制約 "480〜500" が含まれる
        const isPremium = body.includes("480")
        const text = isPremium ? PREMIUM_MESSAGE : NORMAL_MESSAGE

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text }], role: "model" },
                finishReason: "STOP",
                index: 0
              }
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2
            }
          })
        })
      }
    )

    // 2. luna-matching.com を偽ページに差し替え
    await context.route("https://luna-matching.com/**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith("/user/show/")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: profileHtml()
        })
        return
      }
      // それ以外の luna への通信は空 JSON で握りつぶす(実通信を避ける)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}"
      })
    })

    // 3. ストレージをシード(自分プロフィール + ダミー Gemini キー)
    const [worker] = context.serviceWorkers()
    await worker.evaluate(
      async ({ local, sync }) => {
        await chrome.storage.local.set(local)
        await chrome.storage.sync.set(sync)
      },
      {
        local: plasmoSerialize({
          myProfile: MY_PROFILE_TEXT,
          myProfileRaw: JSON.stringify(MY_RAW),
          aiProvider: "gemini",
          isDebugEnabled: true
        }),
        sync: plasmoSerialize({
          geminiApiKey: "dummy-test-key",
          geminiModel: "gemini-2.5-flash"
        })
      }
    )

    const gotoProfile: Harness["gotoProfile"] = async (page, opts) => {
      const path = opts?.premium ? `${PROFILE_PATH}?premium=1` : PROFILE_PATH
      await page.goto(`https://luna-matching.com${path}`)
      // 相手プロフィール + *_list ルックアップを sessionStorage にシード(ボタンが click 時に読む)
      await page.evaluate(
        ({ target, lookups }) => {
          sessionStorage.setItem(
            "luna_last_viewed_user",
            JSON.stringify({ user: target, ...lookups })
          )
        },
        { target: DEFAULT_TARGET, lookups: TARGET_LOOKUPS }
      )
    }

    await use({
      normalMessage: NORMAL_MESSAGE,
      premiumMessage: PREMIUM_MESSAGE,
      gotoProfile,
      lastPrompt: () => lastPrompt
    })
  }
})

export const expect = test.expect
