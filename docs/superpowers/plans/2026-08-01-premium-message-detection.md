# いいね＋一言プレミアムの500文字生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** いいね＋一言の「プレミアムメッセージ」入力欄で AI 生成したとき、150〜180文字ではなく490〜500文字で生成されるようにする。

**Architecture:** プレミアム判定を「ページ本文の文字列一致」から「生成対象 textarea の `maxLength`」に変更する（実測: プレミアム=500 / メッセージ付きいいね=200 / マッチ後スレッド=-1）。あわせて、プレミアム時のプロンプト加工を純関数 `applyPremiumPrompt` に切り出し、初回プロンプト本体に残っていた「最も噛み合う1〜2点を選ぶ」との矛盾を解消する。

**Tech Stack:** TypeScript / Plasmo (Chrome MV3) / React / Vitest (jsdom) / Playwright

## Global Constraints

- ユニットテストは `pnpm exec vitest run <path>` で実行する（`package.json` に test スクリプトは無い）。
- テストファイルは対象と同じディレクトリに `*.test.ts` として置く（例: `utils/url.ts` ↔ `utils/url.test.ts`）。
- インデントは既存ファイルに合わせる（`utils/*.ts` は4スペース、`background.ts` は2スペース）。
- コミットメッセージに `Co-Authored-By` 行を付けない。
- 判定のしきい値は `maxLength >= 300`（実測値 200 と 500 の中間、属性なしの `-1` を除外できる）。
- 実在しない文字列 `プレミアムメッセージを送る` による判定は残さず削除する。

## File Structure

- `utils/premium.ts` (新規) — プレミアム判定とプレミアム用プロンプト加工の純関数。chrome API に依存しない。
- `utils/premium.test.ts` (新規) — 上記のユニットテスト。
- `components/Content/GenerateButton.tsx` (変更) — 判定を `isPremiumInput(textarea.maxLength)` に差し替え。
- `background.ts` (変更) — プレミアム時のプロンプト加工を `applyPremiumPrompt` に委譲。
- `e2e/luna-harness.ts` (変更) — 偽ページのプレミアム表現を `maxlength=500` に変更。
- `README.md` (変更) — プレミアム自動検知の説明を実態に合わせる。

---

### Task 1: プレミアム判定とプロンプト加工の純関数

**Files:**
- Create: `utils/premium.ts`
- Test: `utils/premium.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_PROMPT` from `constants.ts`（テストでのみ使用）
- Produces:
  - `isPremiumInput(maxLength: number): boolean`
  - `applyPremiumPrompt(prompt: string): string`

- [ ] **Step 1: Write the failing test**

`utils/premium.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest"
import { applyPremiumPrompt, isPremiumInput } from "./premium"
import { DEFAULT_PROMPT } from "../constants"

describe("isPremiumInput", () => {
    // 実測(2026-08-01): プレミアム=500 / メッセージ付きいいね=200 / マッチ後スレッド=-1(属性なし)
    it("プレミアムメッセージ欄(500)はプレミアム", () => {
        expect(isPremiumInput(500)).toBe(true)
    })

    it("メッセージ付きいいね欄(200)はプレミアムではない", () => {
        expect(isPremiumInput(200)).toBe(false)
    })

    it("maxlength属性が無いスレッド欄(-1)はプレミアムではない", () => {
        expect(isPremiumInput(-1)).toBe(false)
    })

    it("しきい値は300", () => {
        expect(isPremiumInput(300)).toBe(true)
        expect(isPremiumInput(299)).toBe(false)
    })
})

describe("applyPremiumPrompt", () => {
    it("初回プロンプトの200文字制約が490〜500に差し替わる", () => {
        const out = applyPremiumPrompt(DEFAULT_PROMPT)
        expect(out).toContain("490〜500文字")
        expect(out).not.toContain("合計200文字以内")
    })

    it("「最も噛み合う1〜2点を選ぶ」が残らない（厚み指示と矛盾するため）", () => {
        const out = applyPremiumPrompt(DEFAULT_PROMPT)
        expect(out).not.toContain("最も噛み合う1〜2点を選ぶ")
        expect(out).toContain("噛み合う点を2〜3点選び")
    })

    it("内容の厚み指示が追記される", () => {
        expect(applyPremiumPrompt(DEFAULT_PROMPT)).toContain("# 内容の厚み（プレミアム）")
    })

    it("置換対象を持たない自作テンプレートでも文字数制約が末尾に追記される", () => {
        const custom = "自作のプロンプトです。\n\n# 自分のプロフィール\n{my_info_clean}"
        const out = applyPremiumPrompt(custom)
        expect(out).toContain("自作のプロンプトです。")
        expect(out).toContain("# 文字数制約（最重要）")
        expect(out).toContain("490〜500文字")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run utils/premium.test.ts`
Expected: FAIL — `Failed to resolve import "./premium"`

- [ ] **Step 3: Write minimal implementation**

`utils/premium.ts` を新規作成:

```ts
/**
 * プレミアムメッセージ（いいね＋一言）関連の純関数。
 * chrome API に依存しないためユニットテストできる。
 */

/** プレミアム入力欄と判定する maxlength のしきい値。 */
const PREMIUM_MAXLENGTH_THRESHOLD = 300

/**
 * 生成対象の入力欄がプレミアムメッセージ用かを maxlength で判定する。
 *
 * 実測(2026-08-01, luna-matching.com):
 * - いいね＋一言 プレミアムメッセージ: 500
 * - いいね＋一言 メッセージ付きいいね: 200
 * - マッチ後スレッド: -1（maxlength 属性なし）
 *
 * ページ本文の文字列で判定していた頃は「プレミアムメッセージを送る」を探していたが、
 * この文字列は実サイトのどの画面にも存在せず、常に false になっていた。
 */
export const isPremiumInput = (maxLength: number): boolean =>
    maxLength >= PREMIUM_MAXLENGTH_THRESHOLD

const NORMAL_LIMIT =
    "文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）"

const PREMIUM_LIMIT =
    "文字数は句読点・記号・空白・改行すべて含めて合計490〜500文字（厳守。500文字を超えたら失格、480文字未満も失格。上限500を超えない範囲で、可能な限り500文字に近づけること）"

const NORMAL_POINTS = "最も噛み合う1〜2点を選ぶ"

const PREMIUM_POINTS = "噛み合う点を2〜3点選び、それぞれを掘り下げる"

const PREMIUM_DEPTH =
    "\n\n# 内容の厚み（プレミアム）\n噛み合う点を2〜3個取り上げ、各点に自分の具体的な体験やエピソードを添えて掘り下げ、文字数が500に届く手前まで厚く書くこと。"

/**
 * プレミアム用にプロンプトを加工する。
 *
 * 文字数制約を490〜500へ差し替え、取り上げる噛み合い点の数も増やす。
 * 後者を直さないと「1〜2点を選ぶ」と「2〜3個取り上げ」が衝突して出力が短くなる。
 *
 * ユーザーがオプション画面でテンプレートを編集している場合があるため、
 * 置換は対象文字列を含むときだけ行い、文字数制約は見つからなければ末尾に追記する。
 */
export const applyPremiumPrompt = (prompt: string): string => {
    let out = prompt.includes(NORMAL_LIMIT)
        ? prompt.replace(NORMAL_LIMIT, PREMIUM_LIMIT)
        : `${prompt}\n\n# 文字数制約（最重要）\n${PREMIUM_LIMIT}`

    if (out.includes(NORMAL_POINTS)) {
        out = out.replace(NORMAL_POINTS, PREMIUM_POINTS)
    }

    return out + PREMIUM_DEPTH
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run utils/premium.test.ts`
Expected: PASS（8テスト）

- [ ] **Step 5: Commit**

```bash
git add utils/premium.ts utils/premium.test.ts
git commit -m "feat(premium): maxlength判定とプレミアムプロンプト加工の純関数を追加"
```

---

### Task 2: content script のプレミアム判定を差し替える

**Files:**
- Modify: `components/Content/GenerateButton.tsx:131`
- Modify: `e2e/luna-harness.ts:100-104`
- Test: `e2e/generate-button.spec.ts`（既存テストを変更なしで通す）

**Interfaces:**
- Consumes: `isPremiumInput(maxLength: number): boolean` from `utils/premium.ts`（Task 1）
- Produces: なし（既存の `chrome.runtime.sendMessage({ action: "generate_message", isPremium })` の値が正しくなるだけ）

- [ ] **Step 1: E2E ハーネスの偽ページをプレミアム表現に合わせて直す**

`e2e/luna-harness.ts` の偽ページ生成スクリプト（`ta.placeholder = "メッセージを入力";` の直後）を、
本文テキストではなく実サイトと同じ maxlength で表現するよう変更する。

変更前:

```js
      ta.placeholder = "メッセージを入力";
      form.appendChild(ta);
      // ?premium=1 のときはプレミアム判定用テキストを置く
      if (new URLSearchParams(location.search).get("premium")) {
        var p = document.createElement("p");
        p.textContent = "プレミアムメッセージを送る";
        document.body.appendChild(p);
      }
```

変更後:

```js
      ta.placeholder = "メッセージを入力";
      // プレミアム判定は maxlength で行う（実サイト実測: プレミアム=500 / 通常=200）
      ta.maxLength = new URLSearchParams(location.search).get("premium") ? 500 : 200;
      form.appendChild(ta);
```

- [ ] **Step 2: Run E2E to verify プレミアムのテストが失敗する**

Run: `pnpm exec playwright test generate-button.spec.ts`
Expected: 「プレミアム時もメッセージが挿入される」が FAIL
（`expect(harness.lastPrompt()).toContain("480")` が通らない。判定文字列が消えたため isPremium=false になる）

- [ ] **Step 3: 判定を maxLength ベースに差し替える**

`components/Content/GenerateButton.tsx` の import に追加:

```ts
import { isPremiumInput } from "../../utils/premium"
```

`// 3. Generate Message` 直下の判定を差し替える。

変更前:

```ts
            const isPremium = document.body.innerText.includes("プレミアムメッセージを送る")
```

変更後:

```ts
            // 生成対象の入力欄そのもので判定する。実測 maxlength は
            // プレミアム=500 / メッセージ付きいいね=200 / マッチ後スレッド=-1(属性なし)。
            const isPremium = isPremiumInput(textarea.maxLength)
```

- [ ] **Step 4: Run E2E to verify it passes**

Run: `pnpm exec playwright test generate-button.spec.ts`
Expected: PASS（手動確認テストは skip）

- [ ] **Step 5: Commit**

```bash
git add components/Content/GenerateButton.tsx e2e/luna-harness.ts
git commit -m "fix(premium): プレミアム判定を入力欄のmaxlengthベースに変更"
```

---

### Task 3: background のプロンプト加工を純関数に委譲する

**Files:**
- Modify: `background.ts:147-158`

**Interfaces:**
- Consumes: `applyPremiumPrompt(prompt: string): string` from `utils/premium.ts`（Task 1）
- Produces: なし

- [ ] **Step 1: import を追加する**

`background.ts` の import 群（`import { describeAiError } from "./utils/ai-error"` などが並ぶ箇所）に追加:

```ts
import { applyPremiumPrompt } from "./utils/premium"
```

- [ ] **Step 2: プレミアム分岐を置き換える**

変更前（`background.ts` の `handleGenerateMessage` 内）:

```ts
  if (isPremium) {
    const premiumLimit = "文字数は句読点・記号・空白・改行すべて含めて合計490〜500文字（厳守。500文字を超えたら失格、480文字未満も失格。上限500を超えない範囲で、可能な限り500文字に近づけること）"
    const normalLimit = "文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）"
    if (prompt.includes(normalLimit)) {
      prompt = prompt.replace(normalLimit, premiumLimit)
    } else {
      prompt += `\n\n# 文字数制約（最重要）\n${premiumLimit}`
    }
    // Expand content: cover more matching points to naturally fill close to 500 chars
    prompt += "\n\n# 内容の厚み（プレミアム）\n噛み合う点を2〜3個取り上げ、各点に自分の具体的な体験やエピソードを添えて掘り下げ、文字数が500に届く手前まで厚く書くこと。"
    await logBG("info", "Premium message: Limit expanded to 500 characters (aim for near-limit)")
  }
```

変更後:

```ts
  if (isPremium) {
    prompt = applyPremiumPrompt(prompt)
    await logBG("info", "Premium message: Limit expanded to 500 characters (aim for near-limit)")
  }
```

- [ ] **Step 3: ユニットテストと E2E を通す**

Run: `pnpm exec vitest run`
Expected: PASS（既存テストを含めて全件）

Run: `pnpm exec playwright test generate-button.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add background.ts
git commit -m "refactor(premium): プレミアムプロンプト加工をutils/premiumへ移動"
```

---

### Task 4: 実機で490〜500文字生成を確認し、READMEを実態に合わせる

**Files:**
- Modify: `README.md:26`

**Interfaces:**
- Consumes: Task 1〜3 の実装（ビルド済み拡張）
- Produces: なし

- [ ] **Step 1: 拡張をビルドする**

Run: `pnpm build`
Expected: `build/chrome-mv3-prod` が更新される

- [ ] **Step 2: 実機生成チェックのスクリプトを作る**

`test-results/premium-generate-check.mjs` を新規作成（`test-results` は gitignore 配下）。
拡張をロードし、sync ストレージへ API キーを入れ、プレミアム欄で AI ボタンを押して文字数を測る。
**キーは環境変数から渡し、stdout にもファイルにも出さない。**

```js
// 実機確認: プレミアム欄で AI 生成 → 文字数が 490〜500 か。送信はしない。
//   GEMINI_API_KEY=... node test-results/premium-generate-check.mjs
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "..")
const EXT = path.join(REPO, "build/chrome-mv3-prod")
const PROFILE = path.join(REPO, "e2e/.profile")
const SHOT_DIR = path.join(REPO, "test-results/premium-generate")
const BW_ITEM = "ad73f275-86be-4fec-90dd-afa8013859cb"
const BW_SESSION_FILE = "/home/owner/.bw_session_key"
const KEY = process.env.GEMINI_API_KEY
if (!KEY) throw new Error("GEMINI_API_KEY is required")

const log = (...a) => console.log("[gen]", ...a)
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
  // 拡張IDを service worker の URL から取る
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 })
  const extId = new URL(sw.url()).host
  log("extension id:", extId)

  // sync ストレージへ API キーを投入（値は出力しない）
  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "domcontentloaded" })
  await opt.evaluate(
    (k) => new Promise((r) => chrome.storage.sync.set({ geminiApiKey: k }, r)),
    KEY
  )
  log("api key set:", await opt.evaluate(
    () => new Promise((r) => chrome.storage.sync.get("geminiApiKey", (v) => r(!!v.geminiApiKey)))))
  await opt.close()

  const page = await ctx.newPage()
  await page.goto("https://luna-matching.com/", { waitUntil: "domcontentloaded" })
  let me = await page.request.get("https://luna-matching.com/api/user/get/me")
  if (!me.ok()) {
    await page.goto("https://luna-matching.com/auth", { waitUntil: "domcontentloaded" })
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(bwCred("username"))
    await page.getByRole("textbox", { name: "パスワード" }).fill(bwCred("password"))
    const remember = page.getByRole("checkbox", { name: /ログイン状態を保存/ })
    if (await remember.count()) await remember.check().catch(() => {})
    await page.getByRole("button", { name: "ログイン", exact: true }).click()
    await page.waitForTimeout(4000)
    me = await page.request.get("https://luna-matching.com/api/user/get/me")
  }
  if (!me.ok()) throw new Error("login failed")

  // 検索一覧 → プロフィール詳細
  await page.goto("https://luna-matching.com/search", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  const href = (await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/user/show/"]')].map((a) => a.getAttribute("href"))[0]))
  if (!href) throw new Error("no profile link on /search")
  await page.goto(new URL(href, "https://luna-matching.com").href, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)

  // いいね → プレミアムメッセージ（button.ey2olr0 はプロモ誘導なので押さない）
  await page.getByRole("button", { name: "いいね", exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.locator("[role=dialog] button.sktuy90").first().click()
  await page.waitForTimeout(2500)

  const ta = page.locator('textarea[placeholder="メッセージを入力"]').first()
  log("maxLength:", await ta.evaluate((el) => el.maxLength))

  // 注入された AI ボタンで生成（送信ボタン「入力内容を確認」は押さない）
  await page.getByRole("button", { name: "AI", exact: true }).first().click()
  await page.waitForFunction(
    () => (document.querySelector('textarea[placeholder="メッセージを入力"]')?.value?.length ?? 0) > 0,
    null,
    { timeout: 120000 }
  )
  const text = await ta.inputValue()
  log(`generated length: ${text.length}`)
  log("text:", JSON.stringify(text))
  await page.screenshot({ path: path.join(SHOT_DIR, "01-premium-generated.png") })
  if (text.length < 490 || text.length > 500) {
    console.error(`[gen] FAIL: ${text.length} chars (expected 490-500)`)
    process.exitCode = 1
  } else {
    log("OK: 490-500 に収まっている")
  }
} catch (e) {
  console.error("[gen] ERROR:", e.message)
  const p = (await ctx.pages())[0]
  if (p) await p.screenshot({ path: path.join(SHOT_DIR, "99-error.png") }).catch(() => {})
  process.exitCode = 1
} finally {
  await ctx.close()
}
```

- [ ] **Step 3: 実機で生成し、文字数を確認する**

Run: `GEMINI_API_KEY="$(cat <キーを書いた一時ファイル>)" node test-results/premium-generate-check.mjs`
Expected: `generated length: 49x` と `OK: 490-500 に収まっている`

生成に失敗する場合は `node .claude/skills/luna-startup-debug/read-logs.mjs` で拡張ログを見る。
**「入力内容を確認」以降は絶対に押さない**（プレミアム残数3通を消費するため）。
確認後、キーを書いた一時ファイルは削除する。

- [ ] **Step 4: README を実態に合わせる**

変更前（`README.md:26`）:

```markdown
- **プレミアム自動検知**: 「プレミアムメッセージ」送信時は、AIに指示する文字数制限を自動的に500文字へ拡張。
```

変更後:

```markdown
- **プレミアム自動検知**: 入力欄の文字数上限（プレミアムメッセージ=500）を見て自動判定し、AIに指示する文字数制限を490〜500文字へ拡張。
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): プレミアム自動検知の説明を実装に合わせる"
```
