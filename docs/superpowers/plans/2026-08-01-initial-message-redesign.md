# 初回メッセージ設計の刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初回メッセージ生成が、相手のプロフィールに書かれていない話題（特に食べ物）へ逃げるのをやめ、相手の自由記述から拾った固有の具体を主役にした、返信したくなるメッセージを出すようにする。

**Architecture:** 需給マッチ分析の出力を「話題になりうる噛み合い / 前提条件 / 避ける点」の3ブロックに分け、生活条件（年齢・エリア・喫煙等）が話題の主役に据えられる構造をコード側で断つ。`DEFAULT_PROMPT` は自由記述を主役にする3ステップ手順と、素材外の話題の禁止、素材が薄いときは短く書く指示を持つ新版に差し替える。プロンプト組み立ては `background.ts` から純粋関数 `utils/message-prompt.ts` に抽出し、ユニットテストと評価ハーネスが本番と同一の組み立てを通せるようにする。

**Tech Stack:** TypeScript / Plasmo (Chrome MV3) / React / Vitest / Playwright / Vercel AI SDK (`ai`, `@ai-sdk/google`)

## Global Constraints

- 設計の出典は `docs/superpowers/specs/2026-08-01-initial-message-redesign-design.md`。仕様の疑義はこのSpecを正とする。
- コミットメッセージは日本語。**`Co-Authored-By` 行を付けない**（ユーザーのグローバル設定で禁止）。
- テストは `pnpm vitest run` で全件通ること。既存テストを壊さないこと。
- `CONTINUOUS_CONVERSATION_PROMPT` の内容は変更しない。見出し名への参照1箇所のみ追随させる。
- 実LLMを呼ぶのは Task 6 のみ。Task 1〜5 は API 課金ゼロで完結させること。
- APIキーは `~/.gemini_api_key` から読む。**キーの中身をログ・成果物・コミットに出さないこと。**
- 収集した実プロフィールは `test-results/` 配下（gitignore）にのみ置く。コミットしない。

---

### Task 1: 需給マッチ分析を3ブロックに分割する

生活条件軸（年齢・地域・体型・喫煙・パートナー状況）が「主役にする噛み合う点」として提示される構造をやめる。

**Files:**
- Modify: `utils/demand-supply.ts:290-315`（`MAX_MATCHES` と `formatDemandSupplyHint`）
- Test: `utils/demand-supply.test.ts`

**Interfaces:**
- Consumes: なし（既存の `DemandSupplyResult` / `Axis` 型をそのまま使う）
- Produces: `formatDemandSupplyHint(result: DemandSupplyResult): string` — シグネチャは不変。出力文字列の構造のみ変わる。`generateDemandSupplyHint(myData, targetData, lookups): string` も不変。

- [ ] **Step 1: 失敗するテストを書く**

`utils/demand-supply.test.ts` の末尾に追記する。

```ts
describe("formatDemandSupplyHint: 3ブロック分割", () => {
  const topicMatch = {
    axis: "嗜好" as const,
    direction: "相互" as const,
    strength: 3,
    label: "「拘束」への関心が共通（自分4/相手5）",
    talkingPoint: "拘束の指向が共通。相手の表現に合わせる。"
  }
  const premiseMatch = {
    axis: "生活条件" as const,
    direction: "相互" as const,
    strength: 2.5,
    label: "年齢がお互いの希望条件に合致",
    talkingPoint: "年齢条件が噛み合っている。前提として扱う。"
  }

  it("生活条件だけなら前提条件ブロックのみ出力し、話題ブロックを出さない", () => {
    const out = formatDemandSupplyHint({ matches: [premiseMatch], avoid: [] })
    expect(out).toContain("前提条件")
    expect(out).not.toContain("話題になりうる噛み合い")
  })

  it("前提条件ブロックには talkingPoint を出力しない", () => {
    const out = formatDemandSupplyHint({ matches: [premiseMatch], avoid: [] })
    expect(out).toContain("年齢がお互いの希望条件に合致")
    expect(out).not.toContain("前提として扱う")
  })

  it("嗜好軸は話題になりうる噛み合いブロックに入る", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch, premiseMatch], avoid: [] })
    expect(out).toContain("話題になりうる噛み合い")
    const topicIdx = out.indexOf("「拘束」への関心が共通")
    const premiseIdx = out.indexOf("年齢がお互いの希望条件に合致")
    expect(topicIdx).toBeGreaterThanOrEqual(0)
    expect(premiseIdx).toBeGreaterThan(topicIdx)
  })

  it("話題ブロックには talkingPoint を出力する", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch], avoid: [] })
    expect(out).toContain("拘束の指向が共通")
  })

  it("避ける点は独立したブロックとして維持される", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch], avoid: ["相手はNGを明記している。"] })
    expect(out).toContain("避ける点:")
    expect(out).toContain("相手はNGを明記している。")
  })

  it("マッチも避ける点も無ければ空文字", () => {
    expect(formatDemandSupplyHint({ matches: [], avoid: [] })).toBe("")
  })

  it("旧見出し『最も噛み合う1〜2点を主役にする』は出力しない", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch, premiseMatch], avoid: [] })
    expect(out).not.toContain("主役にする")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run utils/demand-supply.test.ts`
Expected: FAIL。`前提条件` を含まない・`話題になりうる噛み合い` を含まない等のアサーション失敗が7件中5件程度出る。

- [ ] **Step 3: 実装する**

`utils/demand-supply.ts` の `// ===== 整形 =====` 以降を、以下で置き換える。

```ts
// ===== 整形 =====

const MAX_TOPIC_MATCHES = 3
const MAX_PREMISE_MATCHES = 3

/** 話題の主役になりうる軸。生活条件は会話の土台であって話題ではない。 */
const TOPIC_AXES: Axis[] = ["嗜好", "目的", "役割"]

export function formatDemandSupplyHint(result: DemandSupplyResult): string {
  const sorted = [...result.matches].sort((a, b) => b.strength - a.strength)
  const topics = sorted.filter((m) => TOPIC_AXES.includes(m.axis)).slice(0, MAX_TOPIC_MATCHES)
  const premises = sorted.filter((m) => m.axis === "生活条件").slice(0, MAX_PREMISE_MATCHES)

  if (topics.length === 0 && premises.length === 0 && result.avoid.length === 0) return ""

  const blocks: string[] = []

  if (topics.length > 0) {
    const lines = ["話題になりうる噛み合い（相手の自由記述に手がかりが無いときだけ使う）:"]
    for (const m of topics) lines.push(`- [${m.axis}/${m.direction}] ${m.label} — ${m.talkingPoint}`)
    blocks.push(lines.join("\n"))
  }

  if (premises.length > 0) {
    // 前提条件は talkingPoint を出さない。出すと「エリアが噛み合う。会いやすさに
    // 触れられる」等の文面が話題化を誘い、生活条件が主役に据えられてしまう。
    const lines = ["前提条件（会話の土台。話題の主役にはしない）:"]
    for (const m of premises) lines.push(`- [${m.direction}] ${m.label}`)
    blocks.push(lines.join("\n"))
  }

  if (result.avoid.length > 0) {
    const lines = ["避ける点:"]
    for (const a of result.avoid) lines.push(`- ${a}`)
    blocks.push(lines.join("\n"))
  }

  return blocks.join("\n\n")
}
```

`generateDemandSupplyHint` と `extractLookups` はそのまま残す（変更しない）。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run utils/demand-supply.test.ts`
Expected: PASS（新規7件を含む全件）

- [ ] **Step 5: 全テストを実行する**

Run: `pnpm vitest run`
Expected: PASS。既存の `demand-supply.test.ts` に `formatDemandSupplyHint` の出力文字列を検査するテストがあれば、新しい見出しに合わせて期待値を更新すること。旧見出し `噛み合う点（強い順` を期待しているアサーションが残っていたら、上記 Step 1 の観点（どのブロックに入るか）に置き換える。

- [ ] **Step 6: コミット**

```bash
git add utils/demand-supply.ts utils/demand-supply.test.ts
git commit -m "feat(demand-supply): 分析出力を話題/前提条件/避ける点の3ブロックに分割

生活条件（年齢・エリア・喫煙等）が「主役にする噛み合う点」として
提示されるため、初回メッセージの主役が没個性になっていた。生活条件は
前提条件ブロックに分離し、talkingPoint を出力しないことで話題化を防ぐ。"
```

---

### Task 2: プロンプト組み立てを `utils/message-prompt.ts` に抽出する（挙動不変）

`background.ts` の `handleGenerateMessage` に埋まっている組み立てロジックを純粋関数に出す。**このタスクでは挙動を一切変えない。** テストで現在の挙動を固定してから、Task 3 で中身を変える。

**Files:**
- Create: `utils/message-prompt.ts`
- Create: `utils/message-prompt.test.ts`
- Modify: `background.ts:136-219`（`handleGenerateMessage` の組み立て部）

**Interfaces:**
- Consumes: `FOCUS_TOPIC_INSTRUCTION`（`constants.ts`）、`applyPremiumPrompt`（`utils/premium.ts`）
- Produces:
  - `ANALYSIS_SECTION_HEADING: string` — 分析セクションの見出し。Task 3 で値を変える
  - `TARGET_PROFILE_MARKER: string` — 挿入位置マーカー `"# 相手のプロフィール"`
  - `interface BuildMessagePromptInput { template: string; myProfile: string; targetProfile: string; targetName?: string; chatHistory?: string; demandSupplyHint?: string; focusTopic?: string; isPremium?: boolean }`
  - `buildMessagePrompt(input: BuildMessagePromptInput): string`
  - `applyReplacementRules(prompt: string, rules: { from: string; to: string }[]): string`

- [ ] **Step 1: 失敗するテストを書く**

`utils/message-prompt.test.ts` を新規作成する。

```ts
import { describe, expect, it } from "vitest"

import { applyReplacementRules, buildMessagePrompt } from "./message-prompt"

const TEMPLATE = `テンプレ本文

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}`

const CONTINUOUS_TEMPLATE = `${TEMPLATE}

# 会話履歴
{chat_history}`

const base = { template: TEMPLATE, myProfile: "私のプロフ", targetProfile: "相手のプロフ" }

describe("buildMessagePrompt: 変数の置換", () => {
  it("自分と相手のプロフィールを差し込む", () => {
    const out = buildMessagePrompt(base)
    expect(out).toContain("私のプロフ")
    expect(out).toContain("相手のプロフ")
    expect(out).not.toContain("{my_info_clean}")
    expect(out).not.toContain("{target_info_clean}")
  })

  it("[相手の名前] を実名に置換する", () => {
    const out = buildMessagePrompt({ ...base, template: "[相手の名前]さん、[相手の名前]さん", targetName: "ハナ" })
    expect(out).toBe("ハナさん、ハナさん")
  })

  it("名前が空なら「ゲスト」にする", () => {
    const out = buildMessagePrompt({ ...base, template: "[相手の名前]さん", targetName: "   " })
    expect(out).toBe("ゲストさん")
  })

  it("会話履歴があれば差し込む", () => {
    const out = buildMessagePrompt({ ...base, template: CONTINUOUS_TEMPLATE, chatHistory: "Me: やあ" })
    expect(out).toContain("Me: やあ")
    expect(out).not.toContain("{chat_history}")
  })
})

describe("buildMessagePrompt: 分析セクションの挿入", () => {
  it("需給マッチヒントを相手のプロフィール見出しの前に入れる", () => {
    const out = buildMessagePrompt({ ...base, demandSupplyHint: "噛み合いメモ" })
    expect(out).toContain("噛み合いメモ")
    expect(out.indexOf("噛み合いメモ")).toBeLessThan(out.indexOf("# 相手のプロフィール"))
  })

  it("優先話題は分析セクションの先頭に置く", () => {
    const out = buildMessagePrompt({ ...base, demandSupplyHint: "噛み合いメモ", focusTopic: "旅行" })
    expect(out).toContain("旅行")
    expect(out.indexOf("旅行")).toBeLessThan(out.indexOf("噛み合いメモ"))
  })

  it("空白だけの優先話題は無視する", () => {
    const out = buildMessagePrompt({ ...base, focusTopic: "   " })
    expect(out).not.toContain("優先話題")
  })

  it("初回メッセージでは相手の【求める条件】を補足として添える", () => {
    const out = buildMessagePrompt({
      ...base,
      targetProfile: "【求める条件】\n優しい人\n【NG】\nなし"
    })
    expect(out).toContain("補足: 相手が自由記述した求める条件")
    expect(out).toContain("優しい人")
  })

  it("会話継続では【求める条件】の補足を添えない", () => {
    const out = buildMessagePrompt({
      ...base,
      template: CONTINUOUS_TEMPLATE,
      targetProfile: "【求める条件】\n優しい人",
      chatHistory: "Me: やあ"
    })
    expect(out).not.toContain("補足: 相手が自由記述した求める条件")
  })

  it("マーカーが無いテンプレートでは末尾に追記する", () => {
    const out = buildMessagePrompt({ ...base, template: "マーカー無し", demandSupplyHint: "噛み合いメモ" })
    expect(out.endsWith("噛み合いメモ")).toBe(true)
  })
})

describe("buildMessagePrompt: プレミアム", () => {
  it("isPremium のとき文字数指定が拡張される", () => {
    const template = "文字数は合計200文字以内（厳守。200文字を1文字でも超えたら失格）"
    const out = buildMessagePrompt({ ...base, template, isPremium: true })
    expect(out).toContain("500")
    expect(out).not.toBe(template)
  })
})

describe("applyReplacementRules", () => {
  it("すべての出現箇所を置換する", () => {
    expect(applyReplacementRules("蝋燭と蝋燭", [{ from: "蝋燭", to: "温感" }])).toBe("温感と温感")
  })

  it("to が空なら削除する", () => {
    expect(applyReplacementRules("あ薬い", [{ from: "薬", to: "" }])).toBe("あい")
  })

  it("from が空のルールは無視する", () => {
    expect(applyReplacementRules("そのまま", [{ from: "", to: "X" }])).toBe("そのまま")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run utils/message-prompt.test.ts`
Expected: FAIL。`Failed to resolve import "./message-prompt"`

- [ ] **Step 3: `utils/message-prompt.ts` を実装する**

`background.ts:147-219` のロジックをそのまま移す。**挙動を変えないこと。**

```ts
/**
 * メッセージ生成プロンプトの組み立て（純粋関数）
 *
 * background.ts から抽出した。ユニットテストと評価ハーネス
 * （evals/test-message-quality.ts）が本番と同一の組み立てを通せるようにするため。
 * ここではログを出さない。ログは呼び出し側（background.ts）の責務。
 */
import { FOCUS_TOPIC_INSTRUCTION } from "../constants"
import { applyPremiumPrompt } from "./premium"

/** 分析セクションの見出し */
export const ANALYSIS_SECTION_HEADING = "# 需給マッチ分析"

/** 分析セクションを差し込む位置のマーカー */
export const TARGET_PROFILE_MARKER = "# 相手のプロフィール"

export interface BuildMessagePromptInput {
  template: string
  myProfile: string
  targetProfile: string
  targetName?: string
  chatHistory?: string
  demandSupplyHint?: string
  focusTopic?: string
  isPremium?: boolean
}

export function buildMessagePrompt({
  template,
  myProfile,
  targetProfile,
  targetName,
  chatHistory,
  demandSupplyHint,
  focusTopic,
  isPremium
}: BuildMessagePromptInput): string {
  let prompt = template

  if (isPremium) prompt = applyPremiumPrompt(prompt)

  prompt = prompt.replace("{my_info_clean}", myProfile).replace("{target_info_clean}", targetProfile)

  const nameToUse = targetName && targetName.trim() ? targetName.trim() : "ゲスト"
  prompt = prompt.split("[相手の名前]").join(nameToUse)

  if (chatHistory) prompt = prompt.replace("{chat_history}", chatHistory)

  const analysisSections: string[] = []

  // 0. ユーザーがメッセージ入力欄に書いた優先話題（最優先で先頭に置く）
  if (focusTopic && focusTopic.trim()) {
    analysisSections.push(FOCUS_TOPIC_INSTRUCTION.replace("{focus_topic}", focusTopic.trim()))
  }

  // 1. プロフィール項目の突き合わせ
  if (demandSupplyHint) {
    analysisSections.push(`${ANALYSIS_SECTION_HEADING}\n${demandSupplyHint}`)
  }

  // 2. 相手が自由記述した求める条件（補足。初回メッセージのみ）
  if (!chatHistory && targetProfile.includes("【求める条件】")) {
    const reqMatch = targetProfile.match(/【求める条件】\n([\s\S]*?)(?=\n【|$)/)
    if (reqMatch) {
      analysisSections.push(
        `# 補足: 相手が自由記述した求める条件\n以下は相手が自ら書いた「求める条件」です。需給マッチ分析と併せて参考にすること。\n\n${reqMatch[1].trim()}`
      )
    }
  }

  if (analysisSections.length > 0) {
    const analysisBlock = analysisSections.join("\n\n")
    prompt = prompt.includes(TARGET_PROFILE_MARKER)
      ? prompt.replace(TARGET_PROFILE_MARKER, `${analysisBlock}\n\n${TARGET_PROFILE_MARKER}`)
      : `${prompt}\n\n${analysisBlock}`
  }

  return prompt
}

export function applyReplacementRules(
  prompt: string,
  rules: { from: string; to: string }[]
): string {
  let out = prompt
  for (const rule of rules) {
    if (rule.from) out = out.split(rule.from).join(rule.to || "")
  }
  return out
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run utils/message-prompt.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: `background.ts` を新関数に差し替える**

`background.ts:147-219` を以下で置き換える。`let promptTemplate = ...` の取得部（139-145行）と、`if (!prompt)` の空チェック以降はそのまま残す。

```ts
  let prompt = buildMessagePrompt({
    template: promptTemplate,
    myProfile,
    targetProfile,
    targetName,
    chatHistory,
    demandSupplyHint,
    focusTopic,
    isPremium
  })

  if (isPremium) {
    await logBG("info", "Premium message: Limit expanded to 500 characters (aim for near-limit)")
  }
  if (focusTopic && String(focusTopic).trim()) {
    await logBG("info", "Focus topic supplied from message box", { focusTopic: String(focusTopic).trim() })
  }

  // Sanitize prompt to avoid Safety/Prohibited Content errors
  // IMPORTANT: This must be done AFTER replacing variables like {my_info_clean}
  if (!prompt) {
    await logBG("error", "Prompt became empty before sanitization", { promptTemplate })
    throw new Error("プロンプトの作成に失敗しました。設定画面でプロンプトテンプレートを確認してください。")
  }

  const replacementRulesEnabled = await storage.get<boolean>("replacementRulesEnabled") ?? true
  if (replacementRulesEnabled) {
    const rules = await storage.get<{ from: string; to: string }[]>("replacementRules") || defaultReplacementRules
    prompt = applyReplacementRules(prompt, rules)
  }
```

import 文に追加する（`background.ts:8` の下あたり）:

```ts
import { applyReplacementRules, buildMessagePrompt } from "./utils/message-prompt"
```

`applyPremiumPrompt` の import（8行目）は `handleGenerateMessage` から使わなくなる。他に使用箇所が無ければ import を削除すること。`grep -n "applyPremiumPrompt" background.ts` で確認する。

- [ ] **Step 6: 全テストとビルドを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

Run: `pnpm build`
Expected: ビルド成功（型エラーが無いこと）

- [ ] **Step 7: コミット**

```bash
git add utils/message-prompt.ts utils/message-prompt.test.ts background.ts
git commit -m "refactor(prompt): メッセージプロンプト組み立てをutils/message-promptへ抽出

挙動は変えていない。評価ハーネスが本番と同一の組み立てを通せるようにし、
ユニットテストで組み立てを固定するための準備。"
```

---

### Task 3: 新しい `DEFAULT_PROMPT` に差し替える

**Files:**
- Modify: `constants.ts:1-40`（`DEFAULT_PROMPT`）、`constants.ts:56`（継続用の参照1行）
- Modify: `utils/message-prompt.ts`（`ANALYSIS_SECTION_HEADING`）
- Modify: `utils/message-prompt.test.ts`（見出しの期待値）
- Create: `constants.test.ts`

**Interfaces:**
- Consumes: `ANALYSIS_SECTION_HEADING`（Task 2 で定義）
- Produces: `DEFAULT_PROMPT`（差し替え）、`LEGACY_DEFAULT_PROMPT_V1: string`、`LEGACY_CONTINUOUS_PROMPT_V1: string`（Task 4 が使う）

- [ ] **Step 1: 失敗するガードテストを書く**

`constants.test.ts` を新規作成する。このバグは「プロンプトに食べ物という具体名詞が書かれていた」ことが原因なので、再発をテストで縛る。

```ts
import { describe, expect, it } from "vitest"

import {
  CONTINUOUS_CONVERSATION_PROMPT,
  DEFAULT_PROMPT,
  LEGACY_CONTINUOUS_PROMPT_V1,
  LEGACY_DEFAULT_PROMPT_V1
} from "./constants"

// プロンプトが具体トピックを名指しすると、LLMは素材が無くてもその話題へ逃げる。
// 食べ物の混入はこれが原因だったので、具体名詞の再混入をテストで縛る。
const CONCRETE_TOPIC_WORDS = [
  "食事", "ご飯", "ごはん", "飲みに", "グルメ", "料理", "レストラン",
  "カフェ", "ランチ", "ディナー", "お酒", "居酒屋"
]

describe("DEFAULT_PROMPT", () => {
  it("具体的な話題を名指ししない", () => {
    for (const word of CONCRETE_TOPIC_WORDS) {
      expect(DEFAULT_PROMPT, `「${word}」が含まれている`).not.toContain(word)
    }
  })

  it("素材外の話題を禁止する行を持つ", () => {
    expect(DEFAULT_PROMPT).toContain("相手のプロフィールに無い話題を持ち出すこと")
  })

  it("3ステップの手順を持つ", () => {
    expect(DEFAULT_PROMPT).toContain("# ステップ1: 主役にする一節を選ぶ")
    expect(DEFAULT_PROMPT).toContain("# ステップ2: 自分の側の具体を1つ添える")
    expect(DEFAULT_PROMPT).toContain("# ステップ3: 答えやすい問いで締める")
  })

  it("自由記述が少ない相手のフォールバックを持つ", () => {
    expect(DEFAULT_PROMPT).toContain("# 相手の自由記述が少ない場合")
    expect(DEFAULT_PROMPT).toContain("100文字程度で短く書く")
  })

  it("プレースホルダを両方持つ", () => {
    expect(DEFAULT_PROMPT).toContain("{my_info_clean}")
    expect(DEFAULT_PROMPT).toContain("{target_info_clean}")
  })

  it("プレミアム加工が効く文字数指定の文面を持つ", () => {
    // utils/premium.ts の applyPremiumPrompt が置換対象にする文面
    expect(DEFAULT_PROMPT).toContain("200文字以内")
  })
})

describe("LEGACY プロンプト定数", () => {
  it("旧デフォルトは新デフォルトと異なる", () => {
    expect(LEGACY_DEFAULT_PROMPT_V1).not.toBe(DEFAULT_PROMPT)
  })

  it("旧デフォルトは食に関する行を持つ（移行判定の対象そのもの）", () => {
    expect(LEGACY_DEFAULT_PROMPT_V1).toContain("食事・飲みの誘いは禁止")
  })

  it("旧継続プロンプトは新継続プロンプトと異なる", () => {
    expect(LEGACY_CONTINUOUS_PROMPT_V1).not.toBe(CONTINUOUS_CONVERSATION_PROMPT)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run constants.test.ts`
Expected: FAIL。`LEGACY_DEFAULT_PROMPT_V1` が export されていないエラー、および「具体的な話題を名指ししない」が `食事` で失敗。

- [ ] **Step 3: `constants.ts` を書き換える**

まず既存の `DEFAULT_PROMPT`（1〜40行）の**中身をそのままコピー**して `LEGACY_DEFAULT_PROMPT_V1` という名前の定数を作り、ファイル末尾に置く。1文字も変えないこと（移行の完全一致判定に使う）。同様に既存の `CONTINUOUS_CONVERSATION_PROMPT`（42〜80行）の中身をコピーして `LEGACY_CONTINUOUS_PROMPT_V1` を作る。

```ts
// ===== 移行用の旧プロンプト =====
// utils/prompt-migration.ts が「ユーザーが編集していない」判定に使う。
// 完全一致で比較するため、1文字も変更しないこと。新プロンプトを更新するときは
// 直前の内容をここへ V2, V3 … として追加する。

export const LEGACY_DEFAULT_PROMPT_V1 = `（ここに変更前の DEFAULT_PROMPT の中身をそのまま貼る）`

export const LEGACY_CONTINUOUS_PROMPT_V1 = `（ここに変更前の CONTINUOUS_CONVERSATION_PROMPT の中身をそのまま貼る）`
```

次に `DEFAULT_PROMPT` を以下で置き換える。

```ts
export const DEFAULT_PROMPT = `あなたはマッチングサイト「Luna」で、いいねに添える初回メッセージを送るユーザーです。
相手のプロフィールを読み込み、「この人は自分のことをちゃんと読んだ」と伝わり、かつ返事を書きたくなるメッセージを作成してください。

# 基本姿勢
- 「分析しました」「条件に合っていますね」のような採点・評価する物言いは一切しない。気づいたら自然に触れている、という体で書く
- ロマンチックな決め台詞（「特別な存在」「運命」「あなただけ」等）や過度に情緒的な表現は使わない。具体的で実務的に

# 最重要ルール: 触れてよい素材の範囲
このメッセージで触れてよい話題は、相手のプロフィール本文（自己紹介・嗜好・求める条件）に書かれていることだけです。
- 相手が書いていない話題を自分から持ち出さない。一般論で埋めるくらいなら短く終わらせること
- 「前提条件」に挙がった項目（年齢・エリア・喫煙・体型等）は話題の主役にしない。これらは会話の土台であって話題ではない

# ステップ1: 主役にする一節を選ぶ
相手の自由記述（自己紹介・嗜好・求める条件の本文）から、その人しか書いていない一節を1つ選ぶ。
- 選ぶ基準: 具体的な名詞・状況・理由が入っている / 相手が自分から語っている（＝語りたいこと）
- 却下する例: 他の人のプロフィールにも書いてありそうな一般的な表現、テンプレ的な挨拶文
- 「避ける点」に挙がった事項（相手のNG等）は選ばない
- 自由記述に手がかりが無い場合に限り、「話題になりうる噛み合い」の嗜好・目的・役割を代わりに使ってよい

# ステップ2: 自分の側の具体を1つ添える
選んだ一節に対して、自分のプロフィールから対応する具体を1つ出す。
- 「僕も〇〇が好きで」で終わらせず、自分がどうなのかを具体で示す
- 相手を読むだけでなく、自分を差し出すこと。これが無いと相手は返す動機を持てない

# ステップ3: 答えやすい問いで締める
- 選んだ一節の「隣」を聞く（相手が書いていることの、もう一歩先や理由）
- はい/いいえで終わる問いにしない。かといって考え込ませない。答えの選択肢を2つ示す形にしてもよい
- 問いは1つだけ。複数質問は尋問になる

# 相手の自由記述が少ない場合
- 薄い（自己紹介が30字未満程度）: 嗜好や役割の方向性に触れ、自分の具体を先に開示してから、答えやすい問いを1つ置く
- ほぼ無い: 100文字程度で短く書く。自分の開示1つと問い1つだけ。書くことが無いなら短くてよく、長文で埋めようとしない

# 禁止事項（厳守）
- 相手のプロフィールに無い話題を持ち出すこと（最重要）
- 「プロフィール拝見しました」「プロフィールを見て」等のテンプレ表現。いきなり本題に入ること
- 相手のNG・拒否事項への言及（「〇〇はしません」と引用して安心させようとするのも逆効果）
- 初回で相手の容姿・表情・身体について具体的に言及すること
- 「ちゃん」「くん」等の馴れ馴れしい呼び方（名前には「さん」を付ける）
- 「そそられる」「興奮する」「ムラムラ」等の直接的な性的興奮を示す表現
- 初回で会う約束・日程・場所の話を出すこと
- 相手が使っていない過激な表現・卑猥な単語を使うこと（相手が使っている用語はそのまま使ってよい）

# 制約事項
- 冒頭の挨拶は相手のトーンに合わせて自然に。「[相手の名前]さん、はじめまして！」の定型でなくてよい
- 相手の文体（カジュアル/丁寧、絵文字の多少）を読み取り、トーンを合わせる
- 最後は必ず疑問符（？）を使った問いかけで締める。「〜ですね」「〜ください」等の平叙文で終わらない
- 対等な目線を保つ。初対面で「受け止めます」「リードします」等の役割宣言はしない
- 文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）
- 感情表現には記号の顔文字（(^^), m(_ _)m等）を使わず、絵文字（\u{1F60A}, \u{2728}等）を使用する
- メッセージ本文のみを出力すること。分析過程や補足説明は不要

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}`
```

`CONTINUOUS_CONVERSATION_PROMPT` の以下の1行だけを書き換える（他は触らない）。

変更前:
```
- 「需給マッチ分析」がある場合、会話の流れに合わせて噛み合う点を自然に織り込む
```
変更後:
```
- 「プロフィール項目の突き合わせ」がある場合、会話の流れに合わせて噛み合う点を自然に織り込む
```

- [ ] **Step 4: 分析セクション見出しと補足文を変更する**

`utils/message-prompt.ts` の見出し定数を変更する。

```ts
export const ANALYSIS_SECTION_HEADING = "# プロフィール項目の突き合わせ"
```

同じファイルの「補足: 相手が自由記述した求める条件」の本文にある `需給マッチ分析` の参照も
新見出しに追随させる（`buildMessagePrompt` 内の1箇所）。

変更前:
```
以下は相手が自ら書いた「求める条件」です。需給マッチ分析と併せて参考にすること。
```
変更後:
```
以下は相手が自ら書いた「求める条件」です。上の突き合わせと併せて参考にすること。
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `pnpm vitest run`
Expected: PASS。`utils/message-prompt.test.ts` が旧見出し `# 需給マッチ分析` を期待している箇所があれば新見出しに更新する。`utils/premium.test.ts` が `DEFAULT_PROMPT` の文面に依存していたら、`200文字以内` の文面は維持しているので通るはずだが、失敗したら期待値を新プロンプトに合わせて更新すること。

- [ ] **Step 6: 実際のプロンプト全文を目視する**

Run:
```bash
pnpm exec vitest run --reporter=basic constants.test.ts && node -e "
const s=require('fs').readFileSync('constants.ts','utf8');
const m=s.match(/export const DEFAULT_PROMPT = \`([\s\S]*?)\`\n/);
console.log(m[1]);
"
```
Expected: 新プロンプトが全文表示され、食に関する語が1つも無いこと、ステップ1〜3とフォールバックが入っていることを目視で確認する。

- [ ] **Step 7: コミット**

```bash
git add constants.ts constants.test.ts utils/message-prompt.ts utils/message-prompt.test.ts
git commit -m "feat(prompt): 初回メッセージを自由記述主役の設計に差し替え

相手の自由記述から固有の一節を選ぶ3ステップ手順、素材外の話題の禁止、
自由記述が薄い相手は短く書くフォールバックを追加。食を名指しする行を
削除し「会う約束・日程・場所の話をしない」に一般化した。具体トピックの
再混入は constants.test.ts のガードテストで縛る。"
```

---

### Task 4: 未編集ユーザーのプロンプトを自動追従させる

保存済みのプロンプトが旧デフォルトと完全一致する場合のみ、新デフォルトへ更新する。ユーザーが編集した内容は上書きしない。

**Files:**
- Create: `utils/prompt-migration.ts`
- Create: `utils/prompt-migration.test.ts`
- Modify: `background.ts`（末尾に `onInstalled` リスナーを追加）
- Modify: `README.md`

**Interfaces:**
- Consumes: `DEFAULT_PROMPT`, `CONTINUOUS_CONVERSATION_PROMPT`, `LEGACY_DEFAULT_PROMPT_V1`, `LEGACY_CONTINUOUS_PROMPT_V1`（Task 3）
- Produces: `migratePrompt(stored: string | undefined | null, legacy: string, next: string): string | null` — 更新すべき値、更新不要なら `null`

- [ ] **Step 1: 失敗するテストを書く**

`utils/prompt-migration.test.ts` を新規作成する。

```ts
import { describe, expect, it } from "vitest"

import { migratePrompt } from "./prompt-migration"

const LEGACY = "旧プロンプト本文"
const NEXT = "新プロンプト本文"

describe("migratePrompt", () => {
  it("未保存（undefined）なら新プロンプトを返す", () => {
    expect(migratePrompt(undefined, LEGACY, NEXT)).toBe(NEXT)
  })

  it("null なら新プロンプトを返す", () => {
    expect(migratePrompt(null, LEGACY, NEXT)).toBe(NEXT)
  })

  it("空文字なら新プロンプトを返す", () => {
    expect(migratePrompt("", LEGACY, NEXT)).toBe(NEXT)
  })

  it("旧プロンプトと完全一致なら新プロンプトを返す", () => {
    expect(migratePrompt(LEGACY, LEGACY, NEXT)).toBe(NEXT)
  })

  it("ユーザーが編集していれば null を返す（上書きしない）", () => {
    expect(migratePrompt("旧プロンプト本文に一言足した", LEGACY, NEXT)).toBeNull()
  })

  it("末尾の空白1つでも違えば編集済みとみなす", () => {
    expect(migratePrompt(LEGACY + " ", LEGACY, NEXT)).toBeNull()
  })

  it("すでに新プロンプトなら null を返す（無駄な書き込みをしない）", () => {
    expect(migratePrompt(NEXT, LEGACY, NEXT)).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run utils/prompt-migration.test.ts`
Expected: FAIL。`Failed to resolve import "./prompt-migration"`

- [ ] **Step 3: 実装する**

`utils/prompt-migration.ts` を新規作成する。

```ts
/**
 * プロンプトテンプレートの移行判定
 *
 * 拡張を更新したとき、保存済みプロンプトが旧デフォルトのままの
 * ユーザー（＝一度も編集していない）だけを新デフォルトへ追従させる。
 * 自分で編集した人の内容は絶対に上書きしない。
 */

/**
 * 更新すべき値を返す。更新不要なら null。
 *
 * @param stored 現在 storage に入っている値
 * @param legacy 直前のデフォルト（完全一致で「未編集」と判定する）
 * @param next 新しいデフォルト
 */
export function migratePrompt(
  stored: string | undefined | null,
  legacy: string,
  next: string
): string | null {
  if (stored === undefined || stored === null || stored === "") return next
  if (stored === legacy) return next
  return null
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run utils/prompt-migration.test.ts`
Expected: PASS（7件）

- [ ] **Step 5: `background.ts` に移行処理を配線する**

import を追加する。

```ts
import { LEGACY_CONTINUOUS_PROMPT_V1, LEGACY_DEFAULT_PROMPT_V1 } from "./constants"
import { migratePrompt } from "./utils/prompt-migration"
```

（`constants` からの import は既存の1行にまとめてよい）

`background.ts` の末尾に追加する。

```ts
/**
 * 拡張のインストール・更新時に、未編集のプロンプトを新デフォルトへ追従させる。
 * ユーザーが編集済みなら何もしない（migratePrompt が null を返す）。
 */
chrome.runtime.onInstalled.addListener(async () => {
  const targets: { key: string; legacy: string; next: string }[] = [
    { key: "promptTemplate", legacy: LEGACY_DEFAULT_PROMPT_V1, next: DEFAULT_PROMPT },
    { key: "continuousPromptTemplate", legacy: LEGACY_CONTINUOUS_PROMPT_V1, next: CONTINUOUS_CONVERSATION_PROMPT }
  ]

  for (const { key, legacy, next } of targets) {
    const stored = await storage.get<string>(key)
    const migrated = migratePrompt(stored, legacy, next)
    if (migrated !== null) {
      await storage.set(key, migrated)
      await logBG("info", `Prompt migrated to new default: ${key}`)
    } else {
      await logBG("info", `Prompt kept (user-edited): ${key}`)
    }
  }
})
```

- [ ] **Step 6: `README.md` に注記を追加する**

README の「主な機能」または「セットアップ」節の末尾に追記する。

```markdown
> **プロンプトを自分で編集している場合**: 拡張の更新時、プロンプトテンプレートを
> 一度も編集していなければ自動で最新版に更新されます。自分で編集した場合は
> 内容を保護するため自動更新されません。最新のデフォルトを取り込みたいときは、
> 設定画面の「3. プロンプトテンプレート」にある **「デフォルトに戻す」** を押してください。
```

- [ ] **Step 7: 全テストとビルドを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

Run: `pnpm build`
Expected: ビルド成功

- [ ] **Step 8: コミット**

```bash
git add utils/prompt-migration.ts utils/prompt-migration.test.ts background.ts README.md
git commit -m "feat(prompt): 未編集のプロンプトを更新時に新デフォルトへ追従させる

保存済みの値が旧デフォルトと完全一致する場合のみ差し替える。ユーザーが
編集した内容は上書きしない。編集済みの場合は設定画面の「デフォルトに戻す」で
取り込める旨をREADMEに追記した。"
```

---

### Task 5: 相手プロフィールのコーパスを収集する

評価に使う実プロフィールを集める。**Luna の検索・一覧APIのエンドポイント名は未確認なので、URLを決め打ちせず、ログイン済みブラウザで操作者が一覧を眺めている間に流れる `/api/user/` 系レスポンスを全部拾う**方式にする。

**Files:**
- Create: `evals/collect-partner-corpus.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `test-results/message-research/corpus.json` — 形は `{ collectedAt: string, users: AnonymizedUser[] }`。`AnonymizedUser` は Luna の user オブジェクトから個人特定情報を除き `id` をハッシュ化したもの。`extractProfileFromJSON` / `computeDemandSupply` にそのまま渡せるフィールド構成を保つ。

- [ ] **Step 1: ログイン済みプロファイルがあることを確認する**

Run: `ls -d e2e/.profile`
Expected: ディレクトリが存在する。無ければ以下でログインしてから閉じる。

Run: `pnpm e2e:login`
（開いたブラウザで luna-matching.com にログインし、ウィンドウを閉じる。Cookie が `e2e/.profile` に永続化される）

- [ ] **Step 2: 収集スクリプトを書く**

`evals/collect-partner-corpus.mjs` を新規作成する。

```js
/**
 * 相手プロフィールのコーパス収集（評価用）
 *
 * ログイン済み Playwright プロファイル（e2e/.profile）でブラウザを開き、
 * 操作者が検索一覧・足あと・いいね一覧などを眺めている間に流れる
 * /api/user/ 系レスポンスからユーザーオブジェクトを拾って匿名化保存する。
 * Luna の一覧APIのURLは未確認のため、URLを決め打ちせずレスポンスを広く拾う。
 *
 * 実行:
 *   node evals/collect-partner-corpus.mjs
 *   → ブラウザが開くので、検索結果やいいね一覧をスクロールして相手を眺める
 *   → ターミナルに層別の件数が出る。目標に達したら Ctrl+C で保存終了
 *
 * 【重要】出力は他人の実プロフィールです。test-results/ 配下（gitignore）に
 * のみ置き、評価が完了したら削除してください:
 *   rm -rf test-results/message-research
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const OUT_DIR = "test-results/message-research"
const OUT_FILE = `${OUT_DIR}/corpus.json`
const PROFILE_DIR = "e2e/.profile"

/** 個人を特定しうるフィールドは落とす。前方一致で判定する。 */
const DROP_PREFIXES = [
  "name", "nickname", "handle", "image", "img", "photo", "picture", "thumb",
  "mail", "email", "tel", "phone", "twitter", "line", "url", "link", "ip"
]

/** 目標: 各層10件以上かつ合計50件以上 */
const TARGET_PER_STRATUM = 10
const TARGET_TOTAL = 50

const users = new Map() // hashedId -> anonymized user

const hash = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12)

function anonymize(u) {
  const out = {}
  for (const [k, v] of Object.entries(u)) {
    const lower = k.toLowerCase()
    if (DROP_PREFIXES.some((p) => lower.startsWith(p))) continue
    if (typeof v === "object" && v !== null) continue // ネストは捨てる（不要かつ特定リスク）
    out[k] = v
  }
  out.id = hash(u.id ?? u.user_id ?? JSON.stringify(u).slice(0, 64))
  return out
}

/** ユーザーオブジェクトらしさの判定。自己紹介か嗜好スコアを持つものを拾う。 */
function looksLikeUser(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false
  const keys = Object.keys(o)
  const hasId = keys.includes("id") || keys.includes("user_id")
  const hasProfileish = keys.some((k) => k === "profile" || k.startsWith("text_") || k.startsWith("q_"))
  return hasId && hasProfileish
}

/** レスポンスJSONを再帰的に走査してユーザーオブジェクトを集める */
function harvest(node, found, depth = 0) {
  if (depth > 4 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, found, depth + 1)
    return
  }
  if (looksLikeUser(node)) found.push(node)
  for (const v of Object.values(node)) harvest(v, found, depth + 1)
}

/** 自己紹介の長さで層を決める */
function stratumOf(u) {
  const intro = String(u.profile ?? "").trim()
  if (intro.length >= 100) return "rich"
  if (intro.length >= 30) return "thin"
  return "empty"
}

function counts() {
  const c = { rich: 0, thin: 0, empty: 0 }
  for (const u of users.values()) c[stratumOf(u)]++
  return c
}

function save() {
  mkdirSync(OUT_DIR, { recursive: true })
  const payload = { collectedAt: new Date().toISOString(), users: [...users.values()] }
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2))
  const c = counts()
  console.log(`\n[corpus] 保存: ${OUT_FILE}`)
  console.log(`[corpus] 合計 ${users.size} 件 (rich=${c.rich} thin=${c.thin} empty=${c.empty})`)
  console.log(`[corpus] 評価が終わったら削除してください: rm -rf ${OUT_DIR}`)
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chromium",
  headless: false,
  viewport: { width: 1280, height: 900 }
})

context.on("response", async (res) => {
  const url = res.url()
  if (!url.includes("/api/user/")) return
  let json
  try {
    json = await res.json()
  } catch {
    return
  }
  const found = []
  harvest(json, found)
  let added = 0
  for (const u of found) {
    const a = anonymize(u)
    if (!users.has(a.id)) {
      users.set(a.id, a)
      added++
    }
  }
  if (added > 0) {
    const c = counts()
    const done = c.rich >= TARGET_PER_STRATUM && c.thin >= TARGET_PER_STRATUM &&
      c.empty >= TARGET_PER_STRATUM && users.size >= TARGET_TOTAL
    console.log(
      `[corpus] +${added} → 合計 ${users.size} (rich=${c.rich} thin=${c.thin} empty=${c.empty})` +
      (done ? "  ★目標達成。Ctrl+C で保存終了" : "")
    )
  }
})

process.on("SIGINT", async () => {
  save()
  await context.close()
  process.exit(0)
})

const page = await context.newPage()
await page.goto("https://luna-matching.com/")
console.log("[corpus] ブラウザで検索一覧・いいね一覧などをスクロールしてください。")
console.log("[corpus] 目標に達したら Ctrl+C で保存します。")
```

- [ ] **Step 3: 実行して収集する**

Run: `node evals/collect-partner-corpus.mjs`

ブラウザが開いたら、検索結果・いいね一覧・足あとなどをスクロールする。ターミナルに層別件数が出る。
Expected: `rich`/`thin`/`empty` それぞれ10件以上、合計50件以上になったら `★目標達成` が出る。Ctrl+C で保存。

`+0` のまま件数が増えない場合は `looksLikeUser` の判定が実際のレスポンス形と合っていない。
一時的に `console.log(url, Object.keys(json))` を足して実際のキー名を確認し、`looksLikeUser` を実データに合わせて調整すること。

- [ ] **Step 4: 収集結果を検査する**

Run:
```bash
node -e "
const c=require('./test-results/message-research/corpus.json');
console.log('件数', c.users.length);
console.log('キー例', Object.keys(c.users[0]).join(','));
const leak=c.users.filter(u=>JSON.stringify(u).match(/name|mail|image/i));
console.log('個人情報の残留候補', leak.length);
"
```
Expected: 件数が50以上。`個人情報の残留候補` が 0。0でなければ `DROP_PREFIXES` に該当キーを追加して収集をやり直す。

- [ ] **Step 5: コミット（スクリプトのみ）**

```bash
git add evals/collect-partner-corpus.mjs
git status --short   # test-results/ が出ていないことを確認する
git commit -m "feat(evals): 相手プロフィールのコーパス収集スクリプトを追加

ログイン済みプロファイルでブラウザを開き、操作者が一覧を眺めている間に
流れる /api/user/ 系レスポンスからユーザーを拾って匿名化保存する。
一覧APIのURLが未確認のためURL決め打ちを避けた。自己紹介の長さで
rich/thin/empty に層化し、各層10件以上を目標にする。"
```

---

### Task 6: 生成品質の評価ハーネスを作り、旧新を比較する

**Files:**
- Create: `evals/test-message-quality.ts`

**Interfaces:**
- Consumes: `buildMessagePrompt` / `applyReplacementRules`（Task 2）、`DEFAULT_PROMPT` / `LEGACY_DEFAULT_PROMPT_V1`（Task 3）、`generateDemandSupplyHint`（Task 1）、`extractProfileFromJSON`（`utils/profile.ts`）、`replacementRules`（`assets/replacement_rules.ts`）、`test-results/message-research/corpus.json`（Task 5）
- Produces: `test-results/message-eval/report.md`、`test-results/message-eval/results.json`

- [ ] **Step 1: ハーネスを書く**

`evals/test-message-quality.ts` を新規作成する。

```ts
/**
 * 初回メッセージ生成の実LLM評価ハーネス
 *
 * 本番と同じ buildMessagePrompt / 需給マッチ注入 / 置換ルール / safetySettings で
 * 旧プロンプト(LEGACY_DEFAULT_PROMPT_V1)と新プロンプト(DEFAULT_PROMPT)を
 * 同一コーパスに対して走らせ、差分を比較する。
 *
 * 前提:
 *   - ~/.gemini_api_key にAPIキー（コミットしないこと。中身を出力しないこと）
 *   - test-results/message-research/corpus.json（evals/collect-partner-corpus.mjs で収集）
 *
 * 実行: リポジトリルートから
 *   pnpm exec esbuild evals/test-message-quality.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/message-eval/eval.bundle.mjs
 *   node test-results/message-eval/eval.bundle.mjs
 * モデル変更: EVAL_MODEL=gemini-2.5-flash node test-results/message-eval/eval.bundle.mjs
 *
 * 【重要】コーパスは他人の実プロフィールです。評価が完了したら削除してください:
 *   rm -rf test-results/message-research test-results/message-eval
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { replacementRules } from "../assets/replacement_rules"
import { DEFAULT_PROMPT, LEGACY_DEFAULT_PROMPT_V1 } from "../constants"
import { generateDemandSupplyHint } from "../utils/demand-supply"
import { applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { extractProfileFromJSON } from "../utils/profile"

const OUT_DIR = "test-results/message-eval"
const CORPUS = "test-results/message-research/corpus.json"
mkdirSync(OUT_DIR, { recursive: true })

const apiKey = readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim()
const google = createGoogleGenerativeAI({ apiKey })
const MODEL = process.env.EVAL_MODEL || "gemini-3.5-flash"
const log = (...a: any[]) => console.log("[eval]", ...a)

const SAFETY = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
] as const

async function gen(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: google(MODEL),
    prompt,
    providerOptions: { google: { safetySettings: SAFETY } }
  })
  return (text || "").trim()
}

// ===== 自動チェック（決定論） =====

/** 素材外の逃げ先として実際に混入した語。見つけ次第ここに追加する。 */
const OFF_TOPIC_WORDS = [
  "食事", "ご飯", "ごはん", "グルメ", "料理", "レストラン", "カフェ",
  "ランチ", "ディナー", "お酒", "居酒屋", "飲みに"
]

const BANNED_EXPRESSIONS = [
  "プロフィール拝見", "プロフィールを見て", "そそられ", "興奮", "ムラムラ"
]

interface Checks {
  offTopic: string[]
  overLength: boolean
  length: number
  endsWithQuestion: boolean
  bannedFound: string[]
  ngMentioned: string[]
  specificityRatio: number
}

function checkMessage(message: string, targetProfileText: string, ngText: string): Checks {
  const offTopic = OFF_TOPIC_WORDS.filter(
    (w) => message.includes(w) && !targetProfileText.includes(w)
  )
  const ngTerms = ngText.split(/[、。,\s]+/).map((s) => s.trim()).filter((s) => s.length >= 2)
  // 内容語の近似: 2文字以上の漢字/カタカナ連続を content word とみなす
  const contentWords = [...message.matchAll(/[一-龠々]{2,}|[ァ-ヶー]{2,}/g)].map((m) => m[0])
  const hit = contentWords.filter((w) => targetProfileText.includes(w))
  return {
    offTopic,
    length: message.length,
    overLength: message.length > 200,
    endsWithQuestion: /？\s*$/.test(message),
    bannedFound: BANNED_EXPRESSIONS.filter((w) => message.includes(w)),
    ngMentioned: ngTerms.filter((t) => message.includes(t)),
    specificityRatio: contentWords.length === 0 ? 0 : hit.length / contentWords.length
  }
}

// ===== LLM審査 =====

async function judgeAsRecipient(message: string, profileText: string) {
  const prompt = `あなたは以下のプロフィールの人物です。マッチングサイトでこのメッセージを受け取りました。

# あなたのプロフィール
${profileText}

# 受け取ったメッセージ
${message}

以下のJSONのみを出力してください（説明不要）:
{"replyIntent": 1〜5の整数（5=すぐ返信したい, 1=返信しない）, "feltRead": 1〜5の整数（5=自分のプロフィールを読んで書かれたと強く感じる）, "reason": "50字以内の理由"}`
  const raw = await gen(prompt)
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    return { replyIntent: null, feltRead: null, reason: `parse failed: ${raw.slice(0, 80)}` }
  }
}

/** 汎用性テスト: 別人のプロフィールに当てても成立してしまうか */
async function judgeGenericity(message: string, otherProfileText: string): Promise<boolean> {
  const prompt = `以下のメッセージは、下のプロフィールの人物に宛てて書かれたものとして成立しますか。
「その人固有の内容に触れている」場合のみ成立しないと判断してください。

# プロフィール
${otherProfileText}

# メッセージ
${message}

JSONのみ出力: {"fitsThisPerson": true または false}`
  const raw = await gen(prompt)
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()).fitsThisPerson === true
  } catch {
    return false
  }
}

// ===== メイン =====

const corpus = JSON.parse(readFileSync(CORPUS, "utf8")).users as any[]
log(`corpus: ${corpus.length} 件, model=${MODEL}`)

// 自分のプロフィールは固定。実データがあれば使う
let myRaw: any = { age: 35, area: "13", my_type: "A", q_sex: 4, profile: "評価用の自分プロフィール" }
try {
  myRaw = JSON.parse(readFileSync("test-results/message-research/me.json", "utf8"))
  log("me.json を使用")
} catch {
  log("me.json が無いので合成プロフィールを使用")
}
const myProfileText = extractProfileFromJSON(myRaw)

const VARIANTS = [
  { name: "legacy", template: LEGACY_DEFAULT_PROMPT_V1 },
  { name: "new", template: DEFAULT_PROMPT }
]

const results: any[] = []

for (const target of corpus) {
  const targetProfileText = extractProfileFromJSON(target)
  if (!targetProfileText || targetProfileText.length < 5) continue
  const ngText = String(target.text_my_ng ?? target.ng ?? "")
  const hint = generateDemandSupplyHint(myRaw, target, {})
  const others = corpus.filter((u) => u.id !== target.id).slice(0, 3).map((u) => extractProfileFromJSON(u))

  for (const variant of VARIANTS) {
    let prompt = buildMessagePrompt({
      template: variant.template,
      myProfile: myProfileText,
      targetProfile: targetProfileText,
      targetName: "テスト",
      demandSupplyHint: hint
    })
    prompt = applyReplacementRules(prompt, replacementRules)

    let message = ""
    let error: string | null = null
    try {
      message = await gen(prompt)
    } catch (e: any) {
      error = e?.message ?? String(e)
    }

    if (error || !message) {
      results.push({ id: target.id, variant: variant.name, error: error ?? "empty" })
      log(`${target.id} / ${variant.name}: ERROR ${error ?? "empty"}`)
      continue
    }

    const checks = checkMessage(message, targetProfileText, ngText)
    const judge = await judgeAsRecipient(message, targetProfileText)
    const fitsOthers: boolean[] = []
    for (const other of others) fitsOthers.push(await judgeGenericity(message, other))

    results.push({
      id: target.id,
      variant: variant.name,
      stratum: String(target.profile ?? "").trim().length >= 100 ? "rich"
        : String(target.profile ?? "").trim().length >= 30 ? "thin" : "empty",
      message,
      checks,
      judge,
      genericityRate: fitsOthers.length === 0 ? 0 : fitsOthers.filter(Boolean).length / fitsOthers.length
    })
    log(`${target.id} / ${variant.name}: ${checks.length}字 offTopic=${checks.offTopic.length} reply=${judge.replyIntent}`)
  }
}

// ===== 集計 =====

function summarize(variant: string) {
  const rows = results.filter((r) => r.variant === variant && !r.error)
  const n = rows.length || 1
  const avg = (f: (r: any) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0) / n
  return {
    n: rows.length,
    errors: results.filter((r) => r.variant === variant && r.error).length,
    offTopicMessages: rows.filter((r) => r.checks.offTopic.length > 0).length,
    overLength: rows.filter((r) => r.checks.overLength).length,
    notQuestion: rows.filter((r) => !r.checks.endsWithQuestion).length,
    bannedHits: rows.filter((r) => r.checks.bannedFound.length > 0).length,
    ngMentions: rows.filter((r) => r.checks.ngMentioned.length > 0).length,
    avgSpecificity: avg((r) => r.checks.specificityRatio),
    avgReplyIntent: avg((r) => r.judge.replyIntent),
    avgFeltRead: avg((r) => r.judge.feltRead),
    lowReplyIntentRate: rows.filter((r) => (r.judge.replyIntent ?? 5) <= 2).length / n,
    avgGenericity: avg((r) => r.genericityRate)
  }
}

const legacy = summarize("legacy")
const fresh = summarize("new")

const row = (k: string, a: any, b: any) => `| ${k} | ${typeof a === "number" ? a.toFixed(2) : a} | ${typeof b === "number" ? b.toFixed(2) : b} |`
const report = `# 初回メッセージ生成 評価レポート

model: ${MODEL} / corpus: ${corpus.length} 件 / 生成日時: ${new Date().toISOString()}

| 指標 | 旧プロンプト | 新プロンプト |
|---|---|---|
${row("評価件数", legacy.n, fresh.n)}
${row("生成エラー", legacy.errors, fresh.errors)}
${row("素材外話題が出た件数", legacy.offTopicMessages, fresh.offTopicMessages)}
${row("200字超過", legacy.overLength, fresh.overLength)}
${row("？で終わっていない", legacy.notQuestion, fresh.notQuestion)}
${row("禁止表現あり", legacy.bannedHits, fresh.bannedHits)}
${row("NG言及あり", legacy.ngMentions, fresh.ngMentions)}
${row("固有度（参考）", legacy.avgSpecificity, fresh.avgSpecificity)}
${row("返信意欲 平均", legacy.avgReplyIntent, fresh.avgReplyIntent)}
${row("読まれた感 平均", legacy.avgFeltRead, fresh.avgFeltRead)}
${row("返信意欲2以下の割合", legacy.lowReplyIntentRate, fresh.lowReplyIntentRate)}
${row("汎用性（他人成立率）", legacy.avgGenericity, fresh.avgGenericity)}

## 合格基準（新プロンプト）

- 素材外話題 0件 → ${fresh.offTopicMessages === 0 ? "PASS" : `FAIL (${fresh.offTopicMessages}件)`}
- 汎用性 20%以下 → ${fresh.avgGenericity <= 0.2 ? "PASS" : `FAIL (${(fresh.avgGenericity * 100).toFixed(0)}%)`}
- 返信意欲 平均4.0以上 → ${fresh.avgReplyIntent >= 4 ? "PASS" : `FAIL (${fresh.avgReplyIntent.toFixed(2)})`}
- 返信意欲2以下が10%以下 → ${fresh.lowReplyIntentRate <= 0.1 ? "PASS" : `FAIL (${(fresh.lowReplyIntentRate * 100).toFixed(0)}%)`}
- 機械項目（超過/？/禁止表現/NG言及）全件pass → ${fresh.overLength + fresh.notQuestion + fresh.bannedHits + fresh.ngMentions === 0 ? "PASS" : "FAIL"}
`

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2))
writeFileSync(`${OUT_DIR}/report.md`, report)
log(`\n${report}`)
log(`保存: ${OUT_DIR}/report.md`)
```

- [ ] **Step 2: バンドルして実行する**

Run:
```bash
pnpm exec esbuild evals/test-message-quality.ts --bundle --packages=external \
  --platform=node --format=esm --outfile=test-results/message-eval/eval.bundle.mjs && \
node test-results/message-eval/eval.bundle.mjs
```
Expected: 1件ずつログが流れ、最後に比較表が出る。

- [ ] **Step 3: 結果を読んで判断する**

`test-results/message-eval/report.md` を読む。

- **旧プロンプトの「素材外話題が出た件数」が 0 の場合はハーネスを疑う。** 報告されている不具合が再現していないので、`OFF_TOPIC_WORDS` の語や、コーパスの自由記述が実際に食に触れていないかを確認すること。再現しないまま新プロンプトを「改善した」と判断してはいけない。
- 新プロンプトが合格基準を満たさない項目があれば、どの指標がどれだけ足りないかを記録し、ユーザーに報告して次の手を相談する（Spec の「やらないこと」に挙げた2段LLM呼び出しが次の候補）。
- `offTopic` に引っかかった実際のメッセージを `results.json` から2〜3件読み、`OFF_TOPIC_WORDS` に無い逃げ先の語があれば辞書に追加して再実行する。

- [ ] **Step 4: コーパスを削除する**

Run:
```bash
rm -rf test-results/message-research
```
Expected: 削除される。`test-results/message-eval/report.md` は結果報告のため残してよい（gitignore 配下）。

- [ ] **Step 5: コミット（ハーネスのみ）**

```bash
git add evals/test-message-quality.ts
git status --short   # test-results/ が出ていないことを確認する
git commit -m "feat(evals): 初回メッセージ生成の実LLM評価ハーネスを追加

本番と同じ buildMessagePrompt / 需給マッチ注入 / 置換ルール / safetySettings で
旧新プロンプトを同一コーパスに走らせて比較する。素材外話題の検出、
別人のプロフィールに当てて成立するかを見る汎用性テスト、相手役に
なりきらせた返信意欲の審査を行う。"
```

---

## Self-Review

**1. Spec coverage**

| Spec の要求 | 対応タスク |
|---|---|
| 柱1: 素材の優先順位を逆転（3ブロック分割・生活条件の降格） | Task 1 |
| 柱1: 見出しを `# プロフィール項目の突き合わせ` に変更、継続テンプレの参照追随 | Task 3 |
| 柱2: 3ステップ手順 | Task 3（`DEFAULT_PROMPT`） |
| 柱3: 返したくなる問いの条件 | Task 3（ステップ3） |
| 柱4: 禁止事項から具体名詞を消す／素材外話題の禁止 | Task 3 + `constants.test.ts` のガード |
| 柱5: 薄いプロフィールのフォールバック | Task 3（`# 相手の自由記述が少ない場合`） |
| 既存ユーザーの移行（未編集なら自動追従） | Task 4 |
| README 追記 | Task 4 Step 6 |
| コーパス再収集（層化・匿名化・評価後削除） | Task 5 + Task 6 Step 4 |
| 評価ハーネス（自動チェック・汎用性・LLM審査・合格基準） | Task 6 |
| `utils/demand-supply.test.ts` のユニットテスト | Task 1 |

**Spec からの意図的な逸脱が1点ある。** Spec は「生活条件軸の `talkingPoint` を前提向けに書き換える」としているが、計画では**前提条件ブロックで `talkingPoint` を出力しない**方式にした。データ側の文言を書き換えるより出力しない方が単純で、目的（生活条件が話題化されるのを防ぐ）を確実に達成できるため。Spec 側もこの記述に合わせて更新済み。

Spec に無いが計画で追加したものが1点ある。**Task 2 の `utils/message-prompt.ts` への抽出**。Spec の評価要件「本番と同じ `DEFAULT_PROMPT` / 需給マッチ注入 / 置換ルール適用を通す」を満たすには、`background.ts`（`chrome.*` に依存し Node から import できない）の外に組み立てを出す必要があるため。

**2. Placeholder scan**

`DEFAULT_PROMPT` 全文・テストコード・実装コード・スクリプトはすべて実物を記載した。Task 3 Step 3 の `LEGACY_DEFAULT_PROMPT_V1` / `LEGACY_CONTINUOUS_PROMPT_V1` だけは「変更前の中身をそのまま貼る」という指示にしてある。これは**現行ファイルからのコピーが唯一の正解**であり、ここに全文を再掲すると転記ミスで完全一致判定が壊れるため、意図的にコピー指示にしている。

**3. Type consistency**

- `buildMessagePrompt` / `applyReplacementRules` / `ANALYSIS_SECTION_HEADING` / `TARGET_PROFILE_MARKER`（Task 2 で定義）→ Task 3 と Task 6 で同名で使用。一致。
- `migratePrompt(stored, legacy, next)`（Task 4 で定義）→ 同 Task の `background.ts` で同シグネチャで使用。一致。
- `LEGACY_DEFAULT_PROMPT_V1` / `LEGACY_CONTINUOUS_PROMPT_V1`（Task 3 で定義）→ Task 4・Task 6 で使用。一致。
- `formatDemandSupplyHint` / `generateDemandSupplyHint`（Task 1）→ シグネチャ不変。Task 6 で `generateDemandSupplyHint(myRaw, target, {})` として使用。既存定義 `(myData, targetData, lookups = {})` と一致。
- コーパスの形 `{ collectedAt, users }`（Task 5）→ Task 6 が `JSON.parse(...).users` で読む。一致。
