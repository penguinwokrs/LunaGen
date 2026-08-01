# 口調プリセット3パターン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面で口調を3パターン登録でき、生成ボタンの隣のボタンから相手ごとに選べるようにする。

**Architecture:** 判断ロジックはすべて `utils/tone.ts` の純粋関数に寄せ、React 側と background は薄く保つ。content は `toneId` だけを background に送り、background が storage からプリセット本文を引いてプロンプト末尾に差し込む。

**Tech Stack:** TypeScript / Plasmo (Chrome MV3) / React / `@plasmohq/storage` / Vitest

## Global Constraints

- 設計の出典は `docs/superpowers/specs/2026-08-02-message-tone-presets-design.md`。仕様の疑義はこのSpecを正とする。
- コミットメッセージは日本語。**`Co-Authored-By` 行を付けない**（ユーザーのグローバル設定で禁止）。
- `pnpm vitest run` 全件通過、`pnpm build` 成功。
- 枠のIDは `tone1` / `tone2` / `tone3` 固定。ラベルを変更してもIDは変わらない。
- 既定の口調は `"none"`（指定なし）。既存ユーザーの生成結果をアップデートで変えないため。
- `DEFAULT_PROMPT` / `CONTINUOUS_CONVERSATION_PROMPT` / `LEGACY_DEFAULT_PROMPT_V1` / `LEGACY_CONTINUOUS_PROMPT_V1` の本文は変更しない。
- 実LLM APIを呼ばない。

---

### Task 1: `utils/tone.ts`（純粋関数）

**Files:**
- Modify: `constants.ts`（末尾に `DEFAULT_TONE_PRESETS` と `TONE_BLOCK_TEMPLATE` を追加）
- Create: `utils/tone.ts`
- Create: `utils/tone.test.ts`

**Interfaces:**
- Consumes: `getThreadIdFromUrl` / `getUserIdFromUrl`（`utils/url.ts`）、`resolveCachedPartner`（`utils/partner.ts`、戻り値は `{ data, raw, userId } | null`）
- Produces:
  - `interface TonePreset { id: string; label: string; instruction: string }`
  - `interface PartnerToneEntry { toneId: string; updatedAt: string }`
  - `type PartnerTones = Record<string, PartnerToneEntry>`
  - `NO_TONE = "none"`
  - `resolvePartnerToneKey(url: string, cachedPartnerJson: string | null): string | null`
  - `selectableTones(presets: TonePreset[]): TonePreset[]`
  - `resolveToneInstruction(toneId: string | null | undefined, presets: TonePreset[]): string | null`
  - `rememberPartnerTone(tones: PartnerTones, key: string | null, toneId: string, now: string): PartnerTones`
  - `lookupPartnerTone(tones: PartnerTones, key: string | null, defaultToneId: string): string`
  - `buildToneBlock(instruction: string): string`
  - `injectToneBlock(prompt: string, instruction: string | null): string`

- [ ] **Step 1: 失敗するテストを書く**

`utils/tone.test.ts` を新規作成する。

```ts
import { describe, expect, it } from "vitest"

import { DEFAULT_TONE_PRESETS } from "../constants"
import {
  NO_TONE,
  buildToneBlock,
  injectToneBlock,
  lookupPartnerTone,
  rememberPartnerTone,
  resolvePartnerToneKey,
  resolveToneInstruction,
  selectableTones,
  type PartnerTones,
  type TonePreset
} from "./tone"

const PRESETS: TonePreset[] = [
  { id: "tone1", label: "丁寧", instruction: "敬体で書く" },
  { id: "tone2", label: "フレンドリー", instruction: "砕けた言い回しで" },
  { id: "tone3", label: "クール", instruction: "" }
]

describe("resolvePartnerToneKey", () => {
  it("プロフィールページはURLのユーザーIDを使う", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/user/show/123", null)).toBe("u:123")
  })

  it("URLで取れなければキャッシュのユーザーIDを使う", () => {
    const cached = JSON.stringify({ user_info: { id: 456 }, threadId: "789" })
    expect(resolvePartnerToneKey("https://luna-matching.com/user/message/789", cached)).toBe("u:456")
  })

  it("ユーザーIDが取れなければスレッドIDを使う", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/user/message/789", null)).toBe("t:789")
  })

  it("どれも取れなければ null", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/search", null)).toBeNull()
  })
})

describe("selectableTones", () => {
  it("指示文が空の枠はメニューに出さない", () => {
    expect(selectableTones(PRESETS).map((t) => t.id)).toEqual(["tone1", "tone2"])
  })

  it("空白だけの指示文も出さない", () => {
    expect(selectableTones([{ id: "tone1", label: "x", instruction: "   " }])).toEqual([])
  })
})

describe("resolveToneInstruction", () => {
  it("IDから指示文を引く", () => {
    expect(resolveToneInstruction("tone2", PRESETS)).toBe("砕けた言い回しで")
  })

  it("ラベルを変えてもIDで引ける", () => {
    const renamed = [{ id: "tone2", label: "別名にした", instruction: "砕けた言い回しで" }]
    expect(resolveToneInstruction("tone2", renamed)).toBe("砕けた言い回しで")
  })

  it("指定なし・未知のID・空・未指定は null", () => {
    expect(resolveToneInstruction(NO_TONE, PRESETS)).toBeNull()
    expect(resolveToneInstruction("tone9", PRESETS)).toBeNull()
    expect(resolveToneInstruction("", PRESETS)).toBeNull()
    expect(resolveToneInstruction(undefined, PRESETS)).toBeNull()
  })

  it("指示文が空の枠を指定されても null", () => {
    expect(resolveToneInstruction("tone3", PRESETS)).toBeNull()
  })
})

describe("rememberPartnerTone", () => {
  it("キーがあれば記録する", () => {
    const out = rememberPartnerTone({}, "u:1", "tone1", "2026-08-02T00:00:00.000Z")
    expect(out["u:1"]).toEqual({ toneId: "tone1", updatedAt: "2026-08-02T00:00:00.000Z" })
  })

  it("キーが null なら何も記録しない", () => {
    expect(rememberPartnerTone({}, null, "tone1", "2026-08-02T00:00:00.000Z")).toEqual({})
  })

  it("上限300件を超えたら updatedAt の古い順に捨てる", () => {
    const tones: PartnerTones = {}
    for (let i = 0; i < 300; i++) {
      tones[`u:${i}`] = { toneId: "tone1", updatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }
    }
    const out = rememberPartnerTone(tones, "u:new", "tone2", "2026-08-02T00:00:00.000Z")
    expect(Object.keys(out)).toHaveLength(300)
    expect(out["u:new"]).toBeTruthy()
    expect(out["u:0"]).toBeUndefined() // 一番古いものが消える
    expect(out["u:299"]).toBeTruthy()
  })

  it("既存キーの更新では件数が増えない", () => {
    const tones: PartnerTones = { "u:1": { toneId: "tone1", updatedAt: "2026-01-01T00:00:00.000Z" } }
    const out = rememberPartnerTone(tones, "u:1", "tone2", "2026-08-02T00:00:00.000Z")
    expect(Object.keys(out)).toHaveLength(1)
    expect(out["u:1"].toneId).toBe("tone2")
  })
})

describe("lookupPartnerTone", () => {
  it("記憶があればそれを返す", () => {
    const tones: PartnerTones = { "u:1": { toneId: "tone2", updatedAt: "2026-01-01T00:00:00.000Z" } }
    expect(lookupPartnerTone(tones, "u:1", NO_TONE)).toBe("tone2")
  })

  it("初めての相手は既定の口調", () => {
    expect(lookupPartnerTone({}, "u:9", "tone1")).toBe("tone1")
  })

  it("キーが null でも既定の口調", () => {
    expect(lookupPartnerTone({}, null, "tone1")).toBe("tone1")
  })
})

describe("buildToneBlock / injectToneBlock", () => {
  it("指示文をブロックに埋め込む", () => {
    const block = buildToneBlock("敬体で書く")
    expect(block).toContain("敬体で書く")
    expect(block).toContain("# 口調の指定")
  })

  it("{tone_instruction} があればその位置に差し込む", () => {
    const out = injectToneBlock("前\n{tone_instruction}\n後", "敬体で書く")
    expect(out).toContain("敬体で書く")
    expect(out).not.toContain("{tone_instruction}")
    expect(out.indexOf("敬体で書く")).toBeLessThan(out.indexOf("後"))
  })

  it("プレースホルダが無ければ末尾に足す", () => {
    const out = injectToneBlock("本文", "敬体で書く")
    expect(out.startsWith("本文")).toBe(true)
    expect(out).toContain("敬体で書く")
  })

  it("指示文が null ならプロンプトを変えない", () => {
    expect(injectToneBlock("本文", null)).toBe("本文")
  })

  it("プレースホルダがあって指示文が null なら、プレースホルダを取り除く", () => {
    expect(injectToneBlock("前\n{tone_instruction}\n後", null)).not.toContain("{tone_instruction}")
  })
})

describe("DEFAULT_TONE_PRESETS", () => {
  it("3枠で、IDは tone1/tone2/tone3", () => {
    expect(DEFAULT_TONE_PRESETS.map((t) => t.id)).toEqual(["tone1", "tone2", "tone3"])
  })

  it("すべて label と instruction が埋まっている", () => {
    for (const t of DEFAULT_TONE_PRESETS) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.instruction.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run utils/tone.test.ts`
Expected: FAIL。`Failed to resolve import "./tone"`

- [ ] **Step 3: `constants.ts` に定数を追加する**

ファイル末尾に追加する。**既存の定数は変更しないこと。**

```ts
// ===== 口調プリセット =====

/** 口調プリセットの初期値。枠のIDは不変（ラベルを変えても相手ごとの記憶が迷子にならない）。 */
export const DEFAULT_TONE_PRESETS = [
    {
        id: "tone1",
        label: "丁寧",
        instruction:
            "敬体（です・ます）で統一し、落ち着いた距離感を保つ。一文はやや長めでも良いが回りくどくしない。絵文字は0〜1個まで。感嘆符は控えめに。"
    },
    {
        id: "tone2",
        label: "フレンドリー",
        instruction:
            "敬体をベースにしつつ砕けた言い回しを混ぜ、テンポ良く。一文は短め。絵文字は2〜3個まで自然に使う。"
    },
    {
        id: "tone3",
        label: "クール",
        instruction:
            "短い言い切りを中心に、淡々と具体的に書く。感嘆符は使わない。絵文字は0〜1個まで。馴れ馴れしくならない。"
    }
]

/**
 * プロンプト末尾に差し込む口調ブロック。
 *
 * 末尾2行が必要な理由: 本体テンプレートには文体に関する指示が複数ある
 * （初回用の「相手の文体を読み取りトーンを合わせる」「絵文字を使用する」、
 * 会話継続用の「ミラーリングは他のすべてのルールより優先」）。これらと衝突するため、
 * 語り口・絵文字の量は口調指定、文章量・テンションはミラーリング、と役割を分ける。
 */
export const TONE_BLOCK_TEMPLATE = `# 口調の指定（文体について最優先）
{tone_instruction_body}
※この指定は、文体・語り口・絵文字の量について、他のすべての指示より優先する。
　相手の文章量やテンションに合わせる指示は維持する（合わせるのは長さと熱量、語り口はこの指定に従う）。`
```

- [ ] **Step 4: `utils/tone.ts` を実装する**

```ts
/**
 * 口調プリセットの判断ロジック（純粋関数）
 *
 * 設定画面・content・background から使う判断をここに集約する。
 * chrome API に触れないためユニットテストできる。
 */
import { TONE_BLOCK_TEMPLATE } from "../constants"
import { resolveCachedPartner } from "./partner"
import { getThreadIdFromUrl, getUserIdFromUrl } from "./url"

/** 「口調を指定しない」を表す ID。既定値でもある。 */
export const NO_TONE = "none"

/** 相手ごとの記憶の上限。超えたら updatedAt の古い順に捨てる。 */
const MAX_PARTNER_TONES = 300

/** プロンプト内で口調ブロックの位置を指定するプレースホルダ */
const TONE_PLACEHOLDER = "{tone_instruction}"

export interface TonePreset {
    id: string
    label: string
    instruction: string
}

export interface PartnerToneEntry {
    toneId: string
    updatedAt: string
}

export type PartnerTones = Record<string, PartnerToneEntry>

/**
 * 相手ごとの記憶に使うキーを決める。
 *
 * URL のユーザーID > キャッシュのユーザーID > スレッドID の順。
 * どれも取れなければ null（＝保存しない）。
 */
export function resolvePartnerToneKey(url: string, cachedPartnerJson: string | null): string | null {
    const urlUserId = getUserIdFromUrl(url)
    if (urlUserId) return `u:${urlUserId}`

    const cached = resolveCachedPartner(cachedPartnerJson, url)
    if (cached?.userId) return `u:${cached.userId}`

    const threadId = getThreadIdFromUrl(url)
    if (threadId) return `t:${threadId}`

    return null
}

/** メニューに出す口調。指示文が空の枠は選べない（選んでも効果が無いため）。 */
export function selectableTones(presets: TonePreset[]): TonePreset[] {
    return presets.filter((t) => t.instruction.trim().length > 0)
}

/** ID から指示文を引く。指定なし・未知のID・空の指示文はすべて null。 */
export function resolveToneInstruction(
    toneId: string | null | undefined,
    presets: TonePreset[]
): string | null {
    if (!toneId || toneId === NO_TONE) return null
    const found = presets.find((t) => t.id === toneId)
    const instruction = found?.instruction.trim()
    return instruction ? instruction : null
}

/** 相手ごとの口調を記録する。キーが無ければ何もしない。上限を超えたら古い順に捨てる。 */
export function rememberPartnerTone(
    tones: PartnerTones,
    key: string | null,
    toneId: string,
    now: string
): PartnerTones {
    if (!key) return tones

    const next: PartnerTones = { ...tones, [key]: { toneId, updatedAt: now } }
    const keys = Object.keys(next)
    if (keys.length <= MAX_PARTNER_TONES) return next

    // 古い順に並べ、上限を超えた分を落とす
    const sorted = keys.sort((a, b) => next[a].updatedAt.localeCompare(next[b].updatedAt))
    for (const k of sorted.slice(0, keys.length - MAX_PARTNER_TONES)) delete next[k]
    return next
}

/** 相手に記憶があればそれを、無ければ既定の口調を返す。 */
export function lookupPartnerTone(
    tones: PartnerTones,
    key: string | null,
    defaultToneId: string
): string {
    if (!key) return defaultToneId
    return tones[key]?.toneId ?? defaultToneId
}

export function buildToneBlock(instruction: string): string {
    return TONE_BLOCK_TEMPLATE.replace("{tone_instruction_body}", instruction)
}

/**
 * プロンプトに口調ブロックを差し込む。
 * プレースホルダがあればその位置、無ければ末尾。指示文が無ければブロックを足さず、
 * プレースホルダだけ取り除く（テンプレートに書いたまま残さないため）。
 */
export function injectToneBlock(prompt: string, instruction: string | null): string {
    if (!instruction) {
        return prompt.includes(TONE_PLACEHOLDER)
            ? prompt.split(TONE_PLACEHOLDER).join("").trimEnd()
            : prompt
    }
    const block = buildToneBlock(instruction)
    return prompt.includes(TONE_PLACEHOLDER)
        ? prompt.split(TONE_PLACEHOLDER).join(block)
        : `${prompt}\n\n${block}`
}
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `pnpm vitest run utils/tone.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: 全テストを実行する**

Run: `pnpm vitest run`
Expected: PASS（全件）

- [ ] **Step 7: コミット**

```bash
git add constants.ts utils/tone.ts utils/tone.test.ts
git commit -m "feat(tone): 口調プリセットの判断ロジックを純粋関数として追加

相手キーの解決、指示文の解決、300件の間引き、プロンプトへの差し込みを
utils/tone.ts に集約する。UI と background はこれを呼ぶだけにする。"
```

---

### Task 2: プロンプトへの差し込み（background）

**Files:**
- Modify: `utils/message-prompt.ts`（`BuildMessagePromptInput` に `toneInstruction` を追加）
- Modify: `utils/message-prompt.test.ts`
- Modify: `background.ts`（`handleGenerateMessage` が `toneId` を受け取る）

**Interfaces:**
- Consumes: `resolveToneInstruction` / `injectToneBlock`（Task 1）、`DEFAULT_TONE_PRESETS`（Task 1）
- Produces: `buildMessagePrompt` が `toneInstruction?: string | null` を受け付ける

- [ ] **Step 1: 失敗するテストを書く**

`utils/message-prompt.test.ts` の末尾に追記する。

```ts
describe("buildMessagePrompt: 口調", () => {
  it("toneInstruction があれば末尾に口調ブロックを足す", () => {
    const out = buildMessagePrompt({ ...base, toneInstruction: "敬体で書く" })
    expect(out).toContain("# 口調の指定")
    expect(out).toContain("敬体で書く")
    expect(out.indexOf("# 口調の指定")).toBeGreaterThan(out.indexOf("# 相手のプロフィール"))
  })

  it("toneInstruction が無ければプロンプトを変えない", () => {
    const withTone = buildMessagePrompt({ ...base, toneInstruction: null })
    const without = buildMessagePrompt(base)
    expect(withTone).toBe(without)
  })

  it("{tone_instruction} があればその位置に差し込む", () => {
    const out = buildMessagePrompt({
      ...base,
      template: `冒頭\n{tone_instruction}\n\n# 自分のプロフィール\n{my_info_clean}\n\n# 相手のプロフィール\n{target_info_clean}`,
      toneInstruction: "敬体で書く"
    })
    expect(out).not.toContain("{tone_instruction}")
    expect(out.indexOf("敬体で書く")).toBeLessThan(out.indexOf("# 自分のプロフィール"))
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run utils/message-prompt.test.ts`
Expected: FAIL。口調ブロックが含まれない。

- [ ] **Step 3: `utils/message-prompt.ts` を変更する**

import に追加する:

```ts
import { injectToneBlock } from "./tone"
```

`BuildMessagePromptInput` に追加する:

```ts
  /** 口調の指示文。null / 未指定なら口調ブロックを足さない */
  toneInstruction?: string | null
```

関数の引数分割代入に `toneInstruction` を足し、**`return prompt` の直前**に以下を挿入する（分析セクションの挿入より後、＝プロンプトの最終形に対して差し込む）:

```ts
  prompt = injectToneBlock(prompt, toneInstruction ?? null)

  return prompt
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run utils/message-prompt.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: `background.ts` を配線する**

import に追加する:

```ts
import { DEFAULT_TONE_PRESETS } from "./constants"
import { resolveToneInstruction, type TonePreset } from "./utils/tone"
```

（`constants` からの import は既存の行にまとめてよい）

`handleGenerateMessage` の引数分割代入に `toneId` を足す:

```ts
async function handleGenerateMessage({ myProfile, targetProfile, targetName, chatHistory, isPremium, demandSupplyHint, focusTopic, toneId }: any) {
```

`buildMessagePrompt` を呼ぶ直前に、プリセットを引いて指示文を解決する:

```ts
  const tonePresets =
    (await storage.get<TonePreset[]>("tonePresets")) || (DEFAULT_TONE_PRESETS as TonePreset[])
  const toneInstruction = resolveToneInstruction(toneId, tonePresets)
  if (toneInstruction) {
    await logBG("info", `Tone applied: ${toneId}`)
  }
```

`buildMessagePrompt({ ... })` の引数に `toneInstruction` を足す。

- [ ] **Step 6: 全テストとビルドを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

Run: `pnpm build`
Expected: 成功

- [ ] **Step 7: コミット**

```bash
git add utils/message-prompt.ts utils/message-prompt.test.ts background.ts
git commit -m "feat(tone): 口調ブロックをプロンプトに差し込む

content からは toneId だけを送り、background が storage から
プリセット本文を引く。プリセットの実体を1箇所に閉じ込めるため。"
```

---

### Task 3: 設定画面の口調プリセット

**Files:**
- Create: `components/Options/TonePresetSection.tsx`
- Modify: `options.tsx`

**Interfaces:**
- Consumes: `DEFAULT_TONE_PRESETS`（Task 1）、`NO_TONE` / `TonePreset`（Task 1）
- Produces: storage キー `tonePresets`（`TonePreset[]`、area=local）、`defaultToneId`（`string`、area=local）

- [ ] **Step 1: `TonePresetSection` を作る**

既存の `components/Options/ReplacementRulesSection.tsx` のスタイル（インラインstyle、`<section>`、`h2` に番号）に合わせること。

```tsx
import React from "react"

import { NO_TONE, type TonePreset } from "../../utils/tone"

interface TonePresetSectionProps {
    presets: TonePreset[]
    setPresets: (val: TonePreset[]) => void
    defaultToneId: string
    setDefaultToneId: (val: string) => void
    onReset: () => void
}

export const TonePresetSection = ({
    presets,
    setPresets,
    defaultToneId,
    setDefaultToneId,
    onReset
}: TonePresetSectionProps) => {
    const [resetKey, setResetKey] = React.useState(0)

    const update = (id: string, patch: Partial<TonePreset>) => {
        setPresets(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    }

    return (
        <section style={{ marginBottom: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "1.2rem" }}>4. 口調プリセット</h2>
                <button
                    onClick={() => {
                        onReset()
                        setResetKey((prev) => prev + 1)
                    }}
                    style={{
                        padding: "4px 8px", backgroundColor: "#f8f9fa", border: "1px solid #ddd",
                        borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "#666"
                    }}
                >
                    デフォルトに戻す
                </button>
            </div>

            <div style={{ fontSize: "0.85em", color: "#666", marginBottom: "10px", lineHeight: 1.6 }}>
                メッセージ生成時に、入力欄の横のボタンから選べる口調です。指定できるのは<strong>文体だけ</strong>で、
                禁止事項・文字数・話題の選び方はプロンプトテンプレート側のルールがそのまま適用されます。<br />
                口調は<strong>相手ごとに記憶</strong>されます。初めての相手には下の「既定の口調」が使われます。<br />
                指示文が空の枠はメニューに出ません。
            </div>

            {presets.map((preset, i) => (
                <div key={preset.id} style={{ marginBottom: "12px", padding: "10px", border: "1px solid #eee", borderRadius: "4px" }}>
                    <input
                        key={`label-${preset.id}-${resetKey}`}
                        defaultValue={preset.label}
                        onChange={(e) => update(preset.id, { label: e.target.value })}
                        placeholder={`口調${i + 1}の名前`}
                        style={{ width: "200px", padding: "6px", marginBottom: "6px", boxSizing: "border-box" }}
                    />
                    <textarea
                        key={`inst-${preset.id}-${resetKey}`}
                        defaultValue={preset.instruction}
                        onChange={(e) => update(preset.id, { instruction: e.target.value })}
                        placeholder="口調の指示文（空にするとこの枠はメニューに出ません）"
                        rows={3}
                        style={{ width: "100%", padding: "8px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: 1.4 }}
                    />
                </div>
            ))}

            <div style={{ marginTop: "10px" }}>
                <label style={{ fontSize: "0.9rem", marginRight: "8px" }}>既定の口調（初めての相手に使う）:</label>
                <select
                    value={defaultToneId}
                    onChange={(e) => setDefaultToneId(e.target.value)}
                    style={{ padding: "6px" }}
                >
                    <option value={NO_TONE}>指定なし</option>
                    {presets
                        .filter((p) => p.instruction.trim().length > 0)
                        .map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label || p.id}
                            </option>
                        ))}
                </select>
            </div>
        </section>
    )
}
```

- [ ] **Step 2: `options.tsx` に組み込む**

import を追加する:

```tsx
import { TonePresetSection } from "./components/Options/TonePresetSection"
import { DEFAULT_TONE_PRESETS } from "./constants"
import { NO_TONE, type TonePreset } from "./utils/tone"
```

（`constants` からの import は既存の行にまとめてよい）

`useStorage` を追加する（他の `useStorage` 行の並びに合わせる）:

```tsx
  const [tonePresets, setTonePresets] = useStorage<TonePreset[]>({ key: "tonePresets", instance: storage }, DEFAULT_TONE_PRESETS as TonePreset[])
  const [defaultToneId, setDefaultToneId] = useStorage({ key: "defaultToneId", instance: storage }, NO_TONE)
```

`<ReplacementRulesSection ... />` の**直前**に差し込む（見出し番号が 3→4→5 の順になるよう、`ReplacementRulesSection` と `DebugLogsSection` の番号も繰り下げること。既存コンポーネント内の `h2` の番号を確認し、重複しないよう修正する）:

```tsx
      <TonePresetSection
        presets={tonePresets}
        setPresets={setTonePresets}
        defaultToneId={defaultToneId}
        setDefaultToneId={setDefaultToneId}
        onReset={() => {
          setTonePresets(DEFAULT_TONE_PRESETS as TonePreset[])
          setDefaultToneId(NO_TONE)
        }}
      />
```

- [ ] **Step 3: 見出し番号の重複を確認する**

Run: `grep -rn "<h2" components/Options/ options.tsx`
Expected: 番号が連番で重複していないこと。重複していたら繰り下げる。

- [ ] **Step 4: テストとビルドを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）。`options.test.tsx` が既存セクションの描画を検査しているので、落ちたら期待値を更新する。

Run: `pnpm build`
Expected: 成功

- [ ] **Step 5: コミット**

```bash
git add components/Options/TonePresetSection.tsx options.tsx
git commit -m "feat(tone): 設定画面に口調プリセット3枠と既定の口調を追加

名前と指示文を自由編集でき、指示文が空の枠はメニューに出ない。
既定は「指定なし」。アップデートで既存ユーザーの生成結果を
変えないため。"
```

---

### Task 4: 生成ボタン横の口調セレクタ

**Files:**
- Create: `components/Content/ToneSelector.tsx`
- Modify: `components/Content/GenerateButton.tsx`

**Interfaces:**
- Consumes: `resolvePartnerToneKey` / `lookupPartnerTone` / `rememberPartnerTone` / `selectableTones` / `NO_TONE` / 型（Task 1）、`DEFAULT_TONE_PRESETS`（Task 1）
- Produces: `GenerateButton` が `chrome.runtime.sendMessage` に `toneId` を含める

- [ ] **Step 1: `ToneSelector` を作る**

```tsx
import React, { useEffect, useRef, useState } from "react"
import { Storage } from "@plasmohq/storage"

import { DEFAULT_TONE_PRESETS } from "../../constants"
import {
    NO_TONE,
    lookupPartnerTone,
    rememberPartnerTone,
    resolvePartnerToneKey,
    selectableTones,
    type PartnerTones,
    type TonePreset
} from "../../utils/tone"

const storage = new Storage({ area: "local" })

interface ToneSelectorProps {
    disabled: boolean
    /** 選択中の口調IDを親に伝える（生成時に送るため） */
    onChange: (toneId: string) => void
}

export const ToneSelector = ({ disabled, onChange }: ToneSelectorProps) => {
    const [presets, setPresets] = useState<TonePreset[]>(DEFAULT_TONE_PRESETS as TonePreset[])
    const [toneId, setToneId] = useState<string>(NO_TONE)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

    /** 現在の相手キーと保存済みの口調を読み直す */
    const refresh = async () => {
        const loadedPresets =
            (await storage.get<TonePreset[]>("tonePresets")) || (DEFAULT_TONE_PRESETS as TonePreset[])
        const defaultToneId = (await storage.get<string>("defaultToneId")) || NO_TONE
        const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
        const key = resolvePartnerToneKey(location.href, sessionStorage.getItem("luna_last_viewed_user"))
        const resolved = lookupPartnerTone(tones, key, defaultToneId)
        setPresets(loadedPresets)
        setToneId(resolved)
        onChange(resolved)
    }

    useEffect(() => {
        refresh()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 外側クリックと Esc で閉じる
    useEffect(() => {
        if (!open) return
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("mousedown", onDocClick)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDocClick)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    const select = async (id: string) => {
        setToneId(id)
        onChange(id)
        setOpen(false)
        // キーが取れない画面では保存しない（その入力欄が生きている間だけ有効）
        const key = resolvePartnerToneKey(location.href, sessionStorage.getItem("luna_last_viewed_user"))
        if (!key) return
        const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
        await storage.set("partnerTones", rememberPartnerTone(tones, key, id, new Date().toISOString()))
    }

    const options = selectableTones(presets)
    const currentLabel =
        toneId === NO_TONE ? "指定なし" : options.find((t) => t.id === toneId)?.label || "指定なし"

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <button
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (disabled) return
                    // 開く直前に読み直す。SPA遷移で相手が変わっている場合があるため
                    refresh()
                    setOpen((v) => !v)
                }}
                disabled={disabled}
                title="この相手に使う口調を選ぶ（相手ごとに記憶されます）"
                style={{
                    padding: "6px 12px", backgroundColor: "#607d8b", color: "white", border: "none",
                    borderRadius: "4px", fontSize: "12px", cursor: disabled ? "not-allowed" : "pointer",
                    fontWeight: "bold", whiteSpace: "nowrap", boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }}
            >
                口調: {currentLabel} ▾
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute", top: "100%", left: 0, marginTop: "4px", zIndex: 2147483647,
                        background: "white", border: "1px solid #ccc", borderRadius: "4px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: "160px", overflow: "hidden"
                    }}
                >
                    {[{ id: NO_TONE, label: "指定なし", instruction: "x" } as TonePreset, ...options].map((t) => (
                        <button
                            key={t.id}
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                select(t.id)
                            }}
                            style={{
                                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                                border: "none", background: t.id === toneId ? "#eceff1" : "white",
                                cursor: "pointer", fontSize: "12px", color: "#333"
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: `GenerateButton` に組み込む**

import を追加する:

```tsx
import { ToneSelector } from "./ToneSelector"
import { NO_TONE } from "../../utils/tone"
```

`useState` を追加する（`const [error, setError] = useState<string | null>(null)` の下）:

```tsx
    const [toneId, setToneId] = useState<string>(NO_TONE)
```

`chrome.runtime.sendMessage` の引数に `toneId` を足す:

```tsx
                focusTopic: focusTopic,
                toneId: toneId
```

`AI` ボタンと `クリア` ボタンの**間**に `ToneSelector` を置く:

```tsx
                <ToneSelector disabled={loading} onChange={setToneId} />
```

- [ ] **Step 3: テストとビルドを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

Run: `pnpm build`
Expected: 成功

- [ ] **Step 4: 実機で確認する**

`luna-startup-debug` スキルの手順で、ビルド済み拡張を実ブラウザにロードし、
プロフィールページで `[ AI ] [ 口調: 指定なし ▾ ] [ クリア ]` の3ボタンが並ぶこと、
ドロップダウンが開いて選択できること、選択後にラベルが変わることをスクリーンショットで確認する。
実行できない環境なら、その旨をレポートに書くこと。

- [ ] **Step 5: コミット**

```bash
git add components/Content/ToneSelector.tsx components/Content/GenerateButton.tsx
git commit -m "feat(tone): 生成ボタンの横に口調セレクタを追加

口調を切り替えるだけで、生成は従来どおりAIボタン。選択は相手ごとに
記憶し、キーが取れない画面では保存しない。SPA遷移で相手が変わって
いる場合に備え、ドロップダウンを開く直前に読み直す。"
```

---

## Self-Review

**1. Spec coverage**

| Spec の要求 | 対応タスク |
|---|---|
| 3枠固定・ID不変・名前と指示文を編集可・初期値あり | Task 1（定数）、Task 3（UI） |
| デフォルトに戻すボタン | Task 3 |
| 指示文が空の枠はメニューに出さない | Task 1（`selectableTones`）、Task 4 |
| 既定の口調セレクタ、初期値は「指定なし」 | Task 3 |
| ボタンは口調切替のみ、生成はAIボタン | Task 4 |
| 外側クリック・Escで閉じる、生成中は無効 | Task 4 |
| 相手キーの解決順、取れなければ保存しない | Task 1（`resolvePartnerToneKey`）、Task 4 |
| `partnerTones` 上限300件・古い順に間引く | Task 1（`rememberPartnerTone`） |
| 口調ブロックを末尾に、`{tone_instruction}` があればその位置 | Task 1（`injectToneBlock`）、Task 2 |
| 語り口・絵文字は口調優先、文章量・テンションはミラーリング維持 | Task 1（`TONE_BLOCK_TEMPLATE`） |
| content は `toneId` だけ送り、background が本文を引く | Task 2、Task 4 |
| 判断ロジックは `utils/tone.ts` の純粋関数、テスト付き | Task 1 |

**2. Placeholder scan**

すべてのステップに実物のコードを記載した。「TBD」「後で実装」の類は無い。

**3. Type consistency**

- `TonePreset` / `PartnerTones` / `NO_TONE`（Task 1 で定義）→ Task 2・3・4 で同名で使用。一致。
- `resolvePartnerToneKey(url, cachedPartnerJson)`（Task 1）→ Task 4 で同シグネチャで使用。一致。
- `rememberPartnerTone(tones, key, toneId, now)` / `lookupPartnerTone(tones, key, defaultToneId)`（Task 1）→ Task 4 で一致。
- `resolveToneInstruction(toneId, presets)`（Task 1）→ Task 2 の background で一致。
- storage キー `tonePresets` / `defaultToneId` / `partnerTones` は Task 2・3・4 で同名。一致。
- `buildMessagePrompt` の `toneInstruction`（Task 2 で追加）→ Task 2 の background 呼び出しで一致。
