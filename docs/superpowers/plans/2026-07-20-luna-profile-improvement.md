# プロフィール改善機能（テイスト3択生成）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luna のプロフィール編集画面（`/user/mod`）の4欄に「✨ AIで改善」ボタンを設置し、テイスト3択（堅実/物語/軽快）のモーダル比較UIで改善案を選べるようにする。

**Architecture:** 既存の content script 注入パターン（MutationObserver + createRoot）に `/user/mod` 分岐を追加。プロンプト組み立て・欄判別・検証は純ロジック（`utils/profile-field.ts` + `profile-prompts.ts`）に分離して Vitest でテスト。background に `generate_profile` アクションを追加し、既存のプロバイダ呼び出し（Gemini/OpenAI/Ollama）を関数抽出して共用。選択UIはシャドウDOMモーダル。

**Tech Stack:** Plasmo (MV3) / React 18 / @plasmohq/storage / ai SDK (既存) / Vitest / Playwright（実機検証スクリプト）

**Spec:** `docs/superpowers/specs/2026-07-20-luna-profile-improvement-design.md`

## Global Constraints

- ストレージは必ず `new Storage({ area: "local" })`（APIキーのみ既存どおり sync）
- ログは `utils/logger.ts` の `addLog(level, message, detail, context)`
- textarea への反映は `logic/content-logic.ts` の `insertText`（React/Vueイベント発火のため）
- 4欄すべて上限 **400字**（コード側で検証、プロンプト任せにしない）
- 新しい runtime 依存を追加しない
- パッケージ操作は `pnpm`。ビルドは `pnpm build`（出力 `build/chrome-mv3-prod`）
- ユニットテスト実行: `pnpm exec vitest run <file>`
- **コミットに `Co-Authored-By` 行を付けない**（ユーザーの全体設定）
- 生成ガードレール: 事実捏造禁止／同意・境界線表現の変換／連絡先・外部ID出力禁止／ロマンチック定型句禁止

## 型と主要インターフェース（全タスク共通の前提）

```ts
// utils/profile-field.ts で定義（Task 1〜2）
export type ProfileFieldType = "intro" | "kink" | "conditions" | "ng"
export type TasteId = "solid" | "story" | "light"
export type Audience = "women" | "men"

export function detectProfileField(placeholder?: string | null, headingText?: string | null): ProfileFieldType | null
export function resolveAudience(myRaw: any): Audience
export function enforceLength(candidates: string[], cap?: number): string
export function extractKinkTerms(source: string): string[]
export function checkKinkPreservation(source: string, output: string, rules?: { from: string; to: string }[]): { ok: boolean; missing: string[] }
export function buildProfilePrompt(input: { fieldType: ProfileFieldType; taste: TasteId; currentText: string; myRaw: any; audience: Audience }): string

// profile-prompts.ts で定義（Task 2）
export const PROFILE_TASTES: { id: TasteId; label: string; tagline: string; instruction: string }[]
export const PROFILE_FIELD_LABELS: Record<ProfileFieldType, string>

// logic/content-logic.ts に追加（Task 4）
export async function getMyProfileRaw(): Promise<string | null>

// background.ts の新アクション（Task 3）
// request: { action: "generate_profile", fieldType, taste, currentText, myProfileRaw }
// response: { text: string, warning?: string } | { error: string }
```

---

### Task 1: 欄判別・読者判定・長さ/保全チェックの純ロジック

**Files:**
- Create: `utils/profile-field.ts`
- Test: `utils/profile-field.test.ts`

**Interfaces:**
- Produces: `ProfileFieldType`, `TasteId`, `Audience`, `detectProfileField`, `resolveAudience`, `enforceLength`, `extractKinkTerms`, `checkKinkPreservation`（`buildProfilePrompt` は Task 2 で同ファイルに追加）

- [ ] **Step 1: 失敗するテストを書く**

`utils/profile-field.test.ts` を作成:

```ts
import { describe, expect, it } from "vitest"
import {
    checkKinkPreservation,
    detectProfileField,
    enforceLength,
    extractKinkTerms,
    resolveAudience
} from "./profile-field"

describe("detectProfileField", () => {
    // 実機調査 2026-07-20: /user/mod の各編集オーバーレイの placeholder
    it("placeholderで4欄を判別する", () => {
        expect(detectProfileField("自分について（普段の生活・SM以外の趣味など）")).toBe("intro")
        expect(detectProfileField("性癖・嗜好の詳細")).toBe("kink")
        expect(detectProfileField("相手に求める条件の詳細")).toBe("conditions")
        expect(detectProfileField("例：跡が残ることや、清潔感のないこと")).toBe("ng")
    })

    it("placeholderが変わっても見出しテキストでフォールバック判別する", () => {
        expect(detectProfileField("", "自己紹介")).toBe("intro")
        expect(detectProfileField(null, "性癖・嗜好の詳細")).toBe("kink")
        expect(detectProfileField(undefined, "相手に求める条件")).toBe("conditions")
        expect(detectProfileField("", "探している相手の条件の詳細")).toBe("conditions")
        expect(detectProfileField("", "NGなこと")).toBe("ng")
    })

    it("判別できないtextareaはnull（メッセージ欄等に誤注入しない）", () => {
        expect(detectProfileField("メッセージを入力")).toBeNull()
        expect(detectProfileField("", "")).toBeNull()
        expect(detectProfileField(undefined, undefined)).toBeNull()
    })
})

describe("resolveAudience", () => {
    it("conditions_sex に 1(女性) を含めば読者=women", () => {
        expect(resolveAudience({ conditions_sex: "1" })).toBe("women")
        expect(resolveAudience({ conditions_sex: "1,3" })).toBe("women")
    })

    it("conditions_sex が 2(男性) なら読者=men", () => {
        expect(resolveAudience({ conditions_sex: "2" })).toBe("men")
    })

    it("欠損時は自分の性別から推定（女性→men / 男性→women）", () => {
        expect(resolveAudience({ sex: 1 })).toBe("men")
        expect(resolveAudience({ sex: 2 })).toBe("women")
        expect(resolveAudience({})).toBe("women")
        expect(resolveAudience(null)).toBe("women")
    })
})

describe("enforceLength", () => {
    it("400以内の最長候補を選ぶ", () => {
        expect(enforceLength(["a".repeat(300), "b".repeat(390), "c".repeat(420)])).toBe("b".repeat(390))
    })

    it("全候補が超過なら最短を選ぶ", () => {
        expect(enforceLength(["a".repeat(450), "b".repeat(410)])).toBe("b".repeat(410))
    })

    it("空配列は空文字", () => {
        expect(enforceLength([])).toBe("")
    })
})

describe("extractKinkTerms", () => {
    it("箇条書き行から用語を抽出し、括弧注釈を落とす", () => {
        const src = "サブ寄りの人と気が合います。\n・言葉責め\n・拘束\n・噛みつき（度合いは相手に応じて）\n- 命令"
        expect(extractKinkTerms(src)).toEqual(["言葉責め", "拘束", "噛みつき", "命令"])
    })

    it("箇条書きが無ければ空配列", () => {
        expect(extractKinkTerms("散文だけの嗜好説明です。")).toEqual([])
    })
})

describe("checkKinkPreservation", () => {
    const src = "・言葉責め\n・拘束\n・命令\n・羞恥\n・首絞め"

    it("全用語が出力に残っていればok", () => {
        const out = "言葉責めや命令、拘束が好きです。羞恥や首絞めは相談しながら。"
        expect(checkKinkPreservation(src, out)).toEqual({ ok: true, missing: [] })
    })

    it("2割超が欠落したらng（missingに列挙）", () => {
        const out = "言葉責めが好きです。"
        const res = checkKinkPreservation(src, out)
        expect(res.ok).toBe(false)
        expect(res.missing).toEqual(["拘束", "命令", "羞恥", "首絞め"])
    })

    it("replacementRulesの変換後語が残っていれば保持とみなす", () => {
        const rules = [{ from: "首絞め", to: "ブレスコントロール" }]
        const out = "言葉責め・拘束・命令・羞恥、ブレスコントロールも経験があります。"
        expect(checkKinkPreservation(src, out, rules)).toEqual({ ok: true, missing: [] })
    })

    it("箇条書きの無い元文は常にok", () => {
        expect(checkKinkPreservation("散文のみ", "何でも")).toEqual({ ok: true, missing: [] })
    })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run utils/profile-field.test.ts`
Expected: FAIL — `Cannot find module './profile-field'`（または `Failed to resolve import`）

- [ ] **Step 3: 最小実装を書く**

`utils/profile-field.ts` を作成:

```ts
/**
 * プロフィール改善機能の純ロジック
 *
 * /user/mod の編集オーバーレイに現れる textarea の欄判別、
 * 読者性別の判定、400字制約、嗜好名詞の保全チェックを行う。
 * DOM・chrome API に依存しない（Vitest対象）。
 */

export type ProfileFieldType = "intro" | "kink" | "conditions" | "ng"
export type TasteId = "solid" | "story" | "light"
export type Audience = "women" | "men"

// 実機調査 2026-07-20 時点の placeholder / オーバーレイ見出し。
// placeholder優先、変わった場合は見出しでフォールバックし、
// どちらtoo一致しなければ注入しない（安全側）。
const FIELD_DETECTORS: {
    type: ProfileFieldType
    placeholderKeys: string[]
    headingKeys: string[]
}[] = [
    { type: "intro", placeholderKeys: ["自分について"], headingKeys: ["自己紹介"] },
    { type: "kink", placeholderKeys: ["性癖・嗜好の詳細"], headingKeys: ["性癖・嗜好"] },
    {
        type: "conditions",
        placeholderKeys: ["相手に求める条件"],
        headingKeys: ["相手に求める条件", "探している相手の条件"]
    },
    { type: "ng", placeholderKeys: ["跡が残ること"], headingKeys: ["NGなこと"] }
]

export function detectProfileField(
    placeholder?: string | null,
    headingText?: string | null
): ProfileFieldType | null {
    const ph = (placeholder || "").trim()
    if (ph) {
        for (const d of FIELD_DETECTORS) {
            if (d.placeholderKeys.some((k) => ph.includes(k))) return d.type
        }
    }
    const h = (headingText || "").trim()
    if (h) {
        for (const d of FIELD_DETECTORS) {
            if (d.headingKeys.some((k) => h.includes(k))) return d.type
        }
    }
    return null
}

/**
 * 読者（この文章を読んでいいねを判断する側）の性別を決める。
 * 自分の sex ではなく conditions_sex（求める相手の性別）を正とする。
 * sex_list: 1=女性 2=男性 3=MTF 4=FTM 5=MTX 6=FTX 7=女装子
 */
export function resolveAudience(myRaw: any): Audience {
    const cs = String(myRaw?.conditions_sex ?? "")
        .split(",")
        .map((s) => s.trim())
    if (cs.includes("1")) return "women"
    if (cs.includes("2")) return "men"
    // フォールバック: 自分の性別から推定
    if (myRaw?.sex === 1) return "men"
    return "women"
}

/** 400字上限: 上限内の最長候補を返す。全超過なら最短。 */
export function enforceLength(candidates: string[], cap = 400): string {
    const valid = candidates.filter((c) => typeof c === "string" && c.length > 0)
    if (valid.length === 0) return ""
    const within = valid.filter((c) => c.length <= cap)
    if (within.length > 0) return within.reduce((a, b) => (b.length > a.length ? b : a))
    return valid.reduce((a, b) => (b.length < a.length ? b : a))
}

/** 元文の箇条書き行から嗜好用語を抽出（括弧注釈は除去） */
export function extractKinkTerms(source: string): string[] {
    return (source || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[・\-–—*●○◎•]/.test(l))
        .map((l) => l.replace(/^[・\-–—*●○◎•]\s*/, ""))
        .map((l) => l.replace(/[（(].*$/, "").trim())
        .filter((l) => l.length >= 2 && l.length <= 20)
}

/**
 * 生成出力に元の嗜好名詞が残っているかを確認する（セーフティによる
 * 「無言の希釈」の検知）。replacementRules の変換後語で残っていても保持扱い。
 * 欠落が2割以下なら許容。
 */
export function checkKinkPreservation(
    source: string,
    output: string,
    rules: { from: string; to: string }[] = []
): { ok: boolean; missing: string[] } {
    const terms = extractKinkTerms(source)
    if (terms.length === 0) return { ok: true, missing: [] }
    const missing = terms.filter((t) => {
        if (output.includes(t)) return false
        const mapped = rules.reduce(
            (acc, r) => (r.from ? acc.split(r.from).join(r.to || "") : acc),
            t
        )
        if (mapped !== t && output.includes(mapped)) return false
        return true
    })
    return { ok: missing.length <= Math.floor(terms.length * 0.2), missing }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run utils/profile-field.test.ts`
Expected: PASS（5 describe / 15 it 前後がすべて green）

- [ ] **Step 5: コミット**

```bash
git add utils/profile-field.ts utils/profile-field.test.ts
git commit -m "feat(profile): 欄判別・読者判定・400字制約・嗜好保全の純ロジックを追加"
```

---

### Task 2: プロンプト定数と buildProfilePrompt

**Files:**
- Create: `profile-prompts.ts`（リポジトリルート。`constants.ts` と同格のプロンプト定数モジュール）
- Modify: `utils/profile-field.ts`（`buildProfilePrompt` を追加）
- Test: `utils/profile-field.test.ts`（describe を追加）

**Interfaces:**
- Consumes: Task 1 の型、`utils/profile.ts` の `extractProfileFromJSON`
- Produces: `PROFILE_TASTES`, `PROFILE_FIELD_LABELS`, `buildProfilePrompt`

- [ ] **Step 1: 失敗するテストを書く**

`utils/profile-field.test.ts` に追記:

```ts
import { buildProfilePrompt } from "./profile-field"
import { PROFILE_TASTES } from "../profile-prompts"

describe("PROFILE_TASTES", () => {
    it("3テイスト（堅実/物語/軽快）が定義されている", () => {
        expect(PROFILE_TASTES.map((t) => t.id)).toEqual(["solid", "story", "light"])
        expect(PROFILE_TASTES.map((t) => t.label)).toEqual(["堅実", "物語", "軽快"])
        for (const t of PROFILE_TASTES) {
            expect(t.tagline.length).toBeGreaterThan(0)
            expect(t.instruction.length).toBeGreaterThan(20)
        }
    })
})

describe("buildProfilePrompt", () => {
    const myRaw = {
        sex: 2,
        conditions_sex: "1",
        age: "30代前半",
        my_type: "I,E",
        q_dom: 4,
        profile: "既存の自己紹介",
        text_my_like: "・言葉責め\n・拘束",
        conditions_text: "既存の条件",
        text_my_ng: "既存のNG"
    }
    const base = {
        fieldType: "intro" as const,
        taste: "solid" as const,
        currentText: "はじめまして。関西人でIT関連の仕事をしています。休日は映画とキックボクシング。",
        myRaw,
        audience: "women" as const
    }

    it("欄ラベル・テイスト指示・現在本文・基本データを含む", () => {
        const p = buildProfilePrompt(base)
        expect(p).toContain("自己紹介")
        expect(p).toContain("箇条書き")            // solidの指示
        expect(p).toContain(base.currentText)      // 素材
        expect(p).toContain("30代前半")            // extractProfileFromJSONの出力
        expect(p).toContain("400字以内")
    })

    it("読者=womenとmenで原則セットが切り替わる", () => {
        const w = buildProfilePrompt(base)
        const m = buildProfilePrompt({ ...base, audience: "men" })
        expect(w).toContain("読者は女性")
        expect(m).toContain("読者は男性")
        expect(w).not.toBe(m)
    })

    it("テイストごとに指示が変わる", () => {
        const solid = buildProfilePrompt(base)
        const story = buildProfilePrompt({ ...base, taste: "story" })
        const light = buildProfilePrompt({ ...base, taste: "light" })
        expect(story).toContain("散文")
        expect(story).toContain("エピソードは書かない")
        expect(light).toContain("30字以下")
        expect(new Set([solid, story, light]).size).toBe(3)
    })

    it("30字未満の元文では空欄フォールバック（要記入プレースホルダ指示）に切替", () => {
        const p = buildProfilePrompt({ ...base, currentText: "よろしく" })
        expect(p).toContain("〔要記入")
        expect(p).toContain("骨子")
    })

    it("30字以上ではフォールバック指示を含まない", () => {
        expect(buildProfilePrompt(base)).not.toContain("〔要記入")
    })

    it("ng欄はaudienceに依らず同じ原則（共通セット）", () => {
        const w = buildProfilePrompt({ ...base, fieldType: "ng", audience: "women" })
        const m = buildProfilePrompt({ ...base, fieldType: "ng", audience: "men" })
        expect(w).toContain("境界線")
        // 原則ブロックは同一（読者ラベル行のみ異なる）
        expect(w.replace("読者は女性", "X")).toBe(m.replace("読者は男性", "X"))
    })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run utils/profile-field.test.ts`
Expected: FAIL — `Cannot find module '../profile-prompts'` / `buildProfilePrompt is not a function`

- [ ] **Step 3: `profile-prompts.ts` を作成**

内容は多段議論の最終レポート（`test-results/profile-research/out/discussion-report.md`）§1・§2 の要約。**原文の原則を短縮したもので、勝手に創作しない。**

```ts
/**
 * プロフィール改善機能のプロンプト定数
 *
 * 原則の出典: test-results/profile-research/out/discussion-report.md
 * （Lunaコーパス 女性134名/男性60名 + 公式Tips + 多段議論の最終版）
 */
import type { Audience, ProfileFieldType, TasteId } from "./utils/profile-field"

export const PROFILE_FIELD_LABELS: Record<ProfileFieldType, string> = {
    intro: "自己紹介",
    kink: "性癖・嗜好",
    conditions: "相手に求める条件",
    ng: "NGなこと"
}

export const PROFILE_TASTES: {
    id: TasteId
    label: string
    tagline: string
    instruction: string
}[] = [
    {
        id: "solid",
        label: "堅実",
        tagline: "安心感重視の整理型",
        instruction:
            "箇条書きや短い見出しを使って整理し、敬体で書く。安全・合意・すり合わせのシグナルを各欄の前半に置く。形容詞は検証可能な行動記述に変換する（例:「優しい」→「NGは事前に確認して守ります」）。例外: 性癖・嗜好欄の「なぜ好きか」の1文だけは箇条書きにせず散文のまま残す（興奮の構造を断片化させない）。"
    },
    {
        id: "story",
        label: "物語",
        tagline: "由来を語る散文型",
        instruction:
            "散文で段落2〜3個、一文は40〜60字を目安にする。嗜好や人柄を、性格・生活の文脈とつなげて語る。ただし元の文や基本データにない由来・動機・因果関係を新しく作らない（既にある事実の接続と表現の磨き込みだけを行う）。過去の特定の相手とのエピソードは書かない。性的な描写の解像度は元の文以下に保つ。"
    },
    {
        id: "light",
        label: "軽快",
        tagline: "短文でテンポ良く",
        instruction:
            "一文30字以下を中心に、改行多めでテンポ良く書く。読者が女性の場合は敬体を崩さない（軽さが真剣度不足に読まれるため）。ユーモアや自虐は生活面（趣味・体力など）に限定して1箇所まで。性癖・嗜好欄では合意・加減に触れる一文を前半に置く。絵文字の量は元の文に合わせる（元が使っていなければ使わない）。"
    }
]

// 執筆原則: 読者性別 × 欄。ng は読者に依らず共通。
// 出典: discussion-report.md §1（必須Do/推奨Do/Don't を要約）
const PRINCIPLES: Record<Exclude<ProfileFieldType, "ng">, Record<Audience, string>> & {
    ng: string
} = {
    intro: {
        women: `目的: 最初の3行で「安全に委ねられる、日常のある大人」だと感じさせる。
構成順: ①フック（人からの評価か生活の具体）→②実務情報→③嗜好の方向性→④安全・話し合いの姿勢→⑤ハードルの低い締め。
必須: 職種・エリア・休日や会える頻度は元の文や基本データにある範囲で必ず残す／独身・1対1などの関係スタンスが元の文か基本データにあれば明記（既婚は隠さず先に書く）／締めは「まずはお話から。合わなければ遠慮なく」のようなハードルの低い提案。
推奨: 人柄が伝わる趣味の会話フックを1つ／嗜好の由来1行（元の文に由来がある場合のみ）。
禁止: 冒頭からの性的な話題／根拠を示さないS・ドミ自称／元の文にない清潔感・体型アピールの追加。
字数目安: 150〜250字。`,
        men: `目的: いいねの質を上げる。「マッチ後の姿を想像できる」情報で、望む相手に自己選別させる。
構成（空行区切り）: ①人物像2〜3要素（仕事や生活の雰囲気・性格）→②SMスタンス（役割と、日常とプレイの切り替え方）→③関係目的。
必須: 上記3点セットの構成／役割（サブ/ドミ/スイッチ等）と「日常は対等、プレイでは主従」のような切り替えの明文化（元の文にある範囲で）／関係目的を本文の前半で示す。
推奨: 弱点や事情の先出しは削らず、言い方を磨いて残す。
禁止: 挨拶だけの極端な短文化／警戒文・NGを本文の主役にする（末尾に集約）／金銭条件を冒頭に置く／元の文にない魅力・属性の追加。
字数目安: 150〜300字。`
    },
    kink: {
        women: `目的: 「怖さはあるが危険はない」＝加減と手続きを知っている人だと感じさせる。
構成順: ①役割と経験レベル→②主要な嗜好2〜3個と「なぜ好きか（興奮の構造）」1文→③力加減・跡・衛生・アフターケアへの配慮→④「度合いは相談しながら」で締め。
必須: 「経験あり」と「興味あり（未経験）」を正直に区別する／興奮の構造を言語化した1文（行為名の羅列より効く）／安全への配慮を具体的に書く。
禁止: プレイ名詞の羅列だけで終わる／「何でもできます」の全面受容／同意を不要とするような表現（「合意の範囲で」に変換）／元の文にない嗜好・経験の追加。
字数目安: 150〜300字。`,
        men: `目的: 需給判定の材料を渡す。「この嗜好に自分はどう応えられるか」を読み手が即断できる。
構成順: ①役割と経験レベル→②好きなことの具体名詞（3〜7個）→③なぜ好きか1行→④未経験で興味があることは「興味」として分ける→⑤「度合いは相談で」。
必須: 具体名詞と理由の言語化／受け身の丸投げ（「開発してください」等）は「興味があること」リストに変換／経験レベルの正直な区別／元の文にある嗜好名詞はすべて残す（穏当な言い換えは可）。
禁止: 「何でも大丈夫」の全面受容／空欄同然の丸投げ／元の文にない嗜好名詞・経験の追加。
字数目安: 100〜250字。`
    },
    conditions: {
        women: `目的: 選別ではなく相手を守る約束の欄。「この人となら大切に扱われる」と感じさせる。
構成順: ①「〜が好きな方となら楽しめそう」の歓迎トーンでの噛み合い条件→②生活条件（地域・頻度）→③相手を守る約束（NGの事前確認と厳守・会うことを急がない）→④自分が返せるものを1つ。
必須: 要求は歓迎トーンに変換する／NGを尊重し急がない姿勢の明記／求めるものに対して自分が返せるものを1つ添える。
禁止: 外見・体型・年齢の注文／条件の羅列や命令調／金銭・負担の条件／要求だけで提供がない構成。
字数目安: 100〜250字。`,
        men: `目的: 誠実な相手をすくい上げる選別フィルタと、安全条件の提示。
構成（箇条書き3〜5項目）: ①安全条件（NGの尊重・事前のすり合わせ・急がない）を先頭→②生活条件→③関係の形→④自分が返せるものを1行。
必須: 検証可能な箇条書きにする（「優しい人」だけの抽象条件にしない）／安全条件を先頭に置く／求めるものと返せるものを対で示す。
禁止: 金銭・負担要求を先頭に置く／NGの長い羅列（カテゴリでまとめて要点化）／命令調のままにする（角を丸めて要点化）。
字数目安: 100〜250字。`
    },
    ng: `目的: 境界線が分かっている人だと示す（読み手の安心材料）。
必須: 明確に苦手なことを具体的に書く／「興味はあるが未経験」は正直に区別する／行為だけでなく関係性のNG（例: 既婚の方はNG・依存関係は苦手）も元の文にあれば残す。
禁止: 「NGはありません」「何でもできます」型の全面受容（境界線がない＝危険シグナルと読まれる）／元のNG項目の削除（カテゴリでまとめる圧縮のみ可）／元の文にないNGの追加。
字数目安: 80〜200字。`
}

const GUARDRAILS = `- 元の文・基本データにない経験/実績/スペック/嗜好を書かない（捏造禁止）。追加してよいのは「安全への配慮・すり合わせの意思・アフターケア・まずは会話からの提案」といった姿勢の言語化のみ
- 同意を不要とするような表現は「合意の範囲で」に変換する。「何でもOK」は「NGは相談して決めたい」に変換する。ただし嗜好の方向性・強さそのものは弱めない
- 連絡先・外部SNSのID・撮影に関する記述は出力しない
- ロマンチックな決め台詞（「運命」「特別な存在」等）、卑屈な定型句（「僕なんかで良ければ」等）は使わない
- 全体で400字以内を厳守する
- 出力は欄に入れる本文のみ。前置き・説明・「【自己紹介】」のような欄ラベルは書かない`

export const PROFILE_PROMPT_TEMPLATE = `あなたは、マッチングサイト「Luna」（SM・アブノーマル嗜好に特化した成人向けサービス）のプロフィール文のリライト専門家です。
成人同士の合意に基づく出会いにおいて、書き手の魅力と安全性・信頼性が正しく伝わる文章へ改善することが目的です。

# 対象欄
{field_label}

# 読者
読者は{audience_label}。この文章を読んで、いいねを送る/返すかを判断します。

# 執筆原則
{field_principles}

# 文体・構成の指定（テイスト: {taste_label}）
{taste_instruction}

# 共通ルール（厳守）
{guardrails}

# 書き手の基本データ（事実の根拠。ここに無いことは書かない）
{profile_context}
※基本データ内に対象欄の保存済み内容が含まれる場合、下の「現在の本文」を正とする。

{current_section}`

export const PROFILE_CURRENT_SECTION = `# 対象欄の現在の本文（これが素材。方向性・事実・嗜好を維持したまま改善する）
{current_text}`

export const PROFILE_EMPTY_SECTION = `# 対象欄の現在の本文
ほぼ空欄です（現在: 「{current_text}」）。基本データだけから骨子を作ってください。
基本データに無い事実は書かず、ユーザー本人が埋めるべき箇所は「〔要記入: 職種〕」のような形で本文中に埋め込むこと。`

export const PROFILE_GUARDRAILS = GUARDRAILS
export const PROFILE_PRINCIPLES = PRINCIPLES
```

- [ ] **Step 4: `buildProfilePrompt` を `utils/profile-field.ts` に追加**

```ts
import { extractProfileFromJSON } from "./profile"
import {
    PROFILE_CURRENT_SECTION,
    PROFILE_EMPTY_SECTION,
    PROFILE_FIELD_LABELS,
    PROFILE_GUARDRAILS,
    PROFILE_PRINCIPLES,
    PROFILE_PROMPT_TEMPLATE,
    PROFILE_TASTES
} from "../profile-prompts"

/** 元文がこの長さ未満なら「空欄フォールバック」（骨子生成+要記入プレースホルダ）に切替 */
export const EMPTY_TEXT_THRESHOLD = 30

export function buildProfilePrompt(input: {
    fieldType: ProfileFieldType
    taste: TasteId
    currentText: string
    myRaw: any
    audience: Audience
}): string {
    const { fieldType, taste, currentText, myRaw, audience } = input
    const tasteDef = PROFILE_TASTES.find((t) => t.id === taste) || PROFILE_TASTES[0]
    const principles =
        fieldType === "ng" ? PROFILE_PRINCIPLES.ng : PROFILE_PRINCIPLES[fieldType][audience]
    const audienceLabel = audience === "women" ? "女性会員" : "男性会員"
    const profileContext = extractProfileFromJSON(myRaw) || "（基本データなし）"

    const trimmed = (currentText || "").trim()
    const currentSection =
        trimmed.length < EMPTY_TEXT_THRESHOLD
            ? PROFILE_EMPTY_SECTION.split("{current_text}").join(trimmed)
            : PROFILE_CURRENT_SECTION.split("{current_text}").join(trimmed)

    return PROFILE_PROMPT_TEMPLATE
        .split("{field_label}").join(PROFILE_FIELD_LABELS[fieldType])
        .split("{audience_label}").join(`${audience === "women" ? "女性" : "男性"}（あなたのプロフィールを見る${audienceLabel}）`)
        .split("{field_principles}").join(principles)
        .split("{taste_label}").join(tasteDef.label)
        .split("{taste_instruction}").join(tasteDef.instruction)
        .split("{guardrails}").join(PROFILE_GUARDRAILS)
        .split("{profile_context}").join(profileContext)
        .split("{current_section}").join(currentSection)
}
```

※テスト中の `expect(w).toContain("読者は女性")` はテンプレの「読者は{audience_label}」行で満たされる。

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm exec vitest run utils/profile-field.test.ts`
Expected: PASS（既存分含め全green）

- [ ] **Step 6: 既存テストの回帰確認**

Run: `pnpm exec vitest run`
Expected: 全ファイル PASS

- [ ] **Step 7: コミット**

```bash
git add profile-prompts.ts utils/profile-field.ts utils/profile-field.test.ts
git commit -m "feat(profile): テイスト3種・執筆原則8セットのプロンプト定数とbuildProfilePromptを追加"
```

---

### Task 3: background に generate_profile アクションを追加

**Files:**
- Modify: `background.ts`

**Interfaces:**
- Consumes: `buildProfilePrompt`, `enforceLength`, `checkKinkPreservation`, `resolveAudience`（Task 1-2）
- Produces: message action `generate_profile` — request `{ action, fieldType, taste, currentText, myProfileRaw }` → response `{ text, warning? } | { error }`

- [ ] **Step 1: プロバイダ呼び出しを関数抽出（挙動不変のリファクタ）**

`background.ts` の `handleGenerateMessage` 内 `generateOnce` を、モジュールレベルの共通関数に置き換える:

```ts
/** 設定済みプロバイダで1回生成する（メッセージ/プロフィール共用） */
async function generateWithConfiguredProvider(
    prompt: string,
    opts: { openaiMaxTokens?: number } = {}
) {
    const aiProvider = await storage.get("aiProvider") || "gemini"
    switch (aiProvider) {
        case "ollama": {
            const model = await storage.get("ollamaModel") || OLLAMA_DEFAULT_MODEL
            const host = await storage.get("ollamaHost") || OLLAMA_DEFAULT_HOST
            const port = await storage.get("ollamaPort") || OLLAMA_DEFAULT_PORT
            return await generateWithOllama(prompt, model, `http://${host}:${port}`)
        }
        case "gemini": {
            const model = await storage.get("geminiModel") || "gemini-2.5-flash"
            return await generateWithGemini(prompt, model)
        }
        case "openai": {
            const model = await storage.get("openaiModel") || "gpt-4o"
            return await generateWithOpenAI(prompt, model, opts.openaiMaxTokens ?? 500)
        }
        default:
            throw new Error(`Unknown AI provider: ${aiProvider}`)
    }
}
```

- `generateWithOpenAI(prompt, model, isPremium)` のシグネチャを `(prompt, model, maxOutputTokens = 500)` に変更し、`maxOutputTokens` をそのまま渡す
- `handleGenerateMessage` 内は `const generateOnce = (p: string) => generateWithConfiguredProvider(p, { openaiMaxTokens: isPremium ? 2000 : 500 })` に差し替え（プレミアムリトライのループはそのまま）

- [ ] **Step 2: generate_profile ハンドラを追加**

```ts
import { buildProfilePrompt, checkKinkPreservation, enforceLength, resolveAudience } from "./utils/profile-field"

async function handleGenerateProfile({ fieldType, taste, currentText, myProfileRaw }: any) {
    let myRaw: any = null
    try { myRaw = JSON.parse(myProfileRaw) } catch { /* fallthrough */ }
    if (!myRaw) {
        throw new Error("プロフィールデータの取得に失敗しました。Lunaにログインした状態でページを再読み込みしてください。")
    }

    const audience = resolveAudience(myRaw)
    let prompt = buildProfilePrompt({ fieldType, taste, currentText: currentText || "", myRaw, audience })

    // 置換ルール（セーフティ回避）は既存メッセージ生成と同じ扱い
    const replacementRulesEnabled = await storage.get<boolean>("replacementRulesEnabled") ?? true
    const rules = replacementRulesEnabled
        ? (await storage.get<{ from: string; to: string }[]>("replacementRules")) || defaultReplacementRules
        : []
    rules.forEach((rule) => {
        if (rule.from) prompt = prompt.split(rule.from).join(rule.to || "")
    })

    await logBG("info", `Generating profile: ${fieldType}/${taste} (audience=${audience})`)

    const CAP = 400
    const candidates: string[] = []
    let result = await generateWithConfiguredProvider(prompt, { openaiMaxTokens: 1000 })
    candidates.push(result.text)

    // 400字超過時の短縮リトライ（最大2回）
    let attempt = 0
    while (candidates[candidates.length - 1].length > CAP && attempt < 2) {
        attempt++
        const len = candidates[candidates.length - 1].length
        const retryPrompt = `${prompt}\n\n【再生成指示】前回の出力は${len}文字で上限400を超えています。優先度の低い内容（推奨事項に相当する部分）から削り、400字以内に収めてください。`
        await logBG("info", `Profile retry ${attempt}: ${len} chars > ${CAP}`)
        const next = await generateWithConfiguredProvider(retryPrompt, { openaiMaxTokens: 1000 })
        candidates.push(next.text)
    }

    let text = enforceLength(candidates, CAP)
    let warning: string | undefined
    if (text.length > CAP) {
        warning = "400字に収まりませんでした。採用後に手動で調整してください。"
    }

    // 嗜好欄のみ: 元の嗜好名詞の保全チェック（無言の希釈検知）
    if (fieldType === "kink") {
        const check = checkKinkPreservation(currentText || "", text, rules)
        if (!check.ok) {
            await logBG("warn", "Kink preservation failed; retrying", { missing: check.missing })
            const retryPrompt = `${prompt}\n\n【再生成指示】元の文にある嗜好（${check.missing.join("、")}）が出力から欠落しています。これらを（穏当な言い換えでもよいので）保持したまま書き直してください。400字以内厳守。`
            const next = await generateWithConfiguredProvider(retryPrompt, { openaiMaxTokens: 1000 })
            const recheck = checkKinkPreservation(currentText || "", next.text, rules)
            if (recheck.ok && next.text.length <= CAP) {
                text = next.text
            } else {
                warning = `元の嗜好の一部（${check.missing.slice(0, 5).join("、")}）が反映されていない可能性があります。`
            }
        }
    }

    await logBG("info", `Profile generated: ${fieldType}/${taste} ${text.length} chars`)
    return { text, warning }
}
```

- [ ] **Step 3: onMessage ルータに分岐を追加**

既存の `chrome.runtime.onMessage.addListener` 内、`test_api` 分岐の後に:

```ts
if (request.action === "generate_profile") {
    logBG("info", `Profile generation requested: ${request.fieldType}/${request.taste}`)
    handleGenerateProfile(request)
        .then((res) => sendResponse(res))
        .catch((err) => {
            logBG("error", "Failed to generate profile", { error: err.message })
            sendResponse({ error: err.message })
        })
    return true
}
```

- [ ] **Step 4: 型チェックとユニットテスト回帰**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: エラーなし / 全テスト PASS

- [ ] **Step 5: ビルド確認**

Run: `pnpm build`
Expected: `build/chrome-mv3-prod` が正常生成（エラーなし）

- [ ] **Step 6: コミット**

```bash
git add background.ts
git commit -m "feat(profile): backgroundにgenerate_profileアクションを追加（400字リトライ・嗜好保全チェック付き）"
```

---

### Task 4: 3択モーダルUIと /user/mod への注入

**Files:**
- Create: `components/Content/ProfileImproveButton.tsx`
- Create: `components/Content/ProfileImprovePanel.tsx`
- Modify: `logic/content-logic.ts`（`getMyProfileRaw` を追加）
- Modify: `content.tsx`（`/user/mod` 分岐の注入）

**Interfaces:**
- Consumes: `detectProfileField`, `PROFILE_TASTES`, `PROFILE_FIELD_LABELS`, action `generate_profile`, `insertText`
- Produces: `<ProfileImproveButton textarea fieldType />`、`getMyProfileRaw(): Promise<string | null>`

- [ ] **Step 1: `getMyProfileRaw` を `logic/content-logic.ts` に追加**

```ts
/**
 * 自分のプロフィールraw JSONを取得する（ストレージ優先、フォールバックでAPI）
 * プロフィール改善機能が生成の事実根拠として使う。
 */
export async function getMyProfileRaw(): Promise<string | null> {
    try {
        const stored = await storage.get("myProfileRaw")
        if (stored && (stored as string).length > 2) return stored as string

        await addLog("info", "Fetching myProfileRaw from API fallback", null, "CONTENT")
        const res = await fetch("https://luna-matching.com/api/user/get/me")
        if (!res.ok) return null

        const data = await res.json()
        const profileData = data.profile || data.user || data
        const raw = JSON.stringify(profileData)
        await storage.set("myProfileRaw", raw)
        return raw
    } catch (e: any) {
        await addLog("error", "Failed to fetch myProfileRaw", { error: e.toString() }, "CONTENT")
        return null
    }
}
```

- [ ] **Step 2: `ProfileImprovePanel.tsx` を作成（シャドウDOM内に描画されるモーダル本体）**

```tsx
import React, { useEffect, useRef, useState } from "react"

import { getMyProfileRaw, insertText } from "../../logic/content-logic"
import { PROFILE_FIELD_LABELS, PROFILE_TASTES } from "../../profile-prompts"
import { addLog } from "../../utils/logger"
import type { ProfileFieldType, TasteId } from "../../utils/profile-field"

type CardState =
    | { status: "loading" }
    | { status: "done"; text: string; warning?: string }
    | { status: "error"; message: string }

interface ProfileImprovePanelProps {
    textarea: HTMLTextAreaElement
    fieldType: ProfileFieldType
    onClose: (didAdopt: boolean) => void
}

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog { background: #faf9fc; border-radius: 12px; width: min(1080px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #e5e0ee; }
.title { font-size: 15px; font-weight: 700; color: #333; }
.close { border: none; background: none; font-size: 18px; cursor: pointer; color: #888; padding: 4px 8px; }
.cards { display: flex; gap: 12px; padding: 14px 18px; overflow: auto; flex-wrap: wrap; }
.card { flex: 1 1 280px; min-width: 260px; background: white; border: 1px solid #e5e0ee; border-radius: 10px; display: flex; flex-direction: column; max-height: 62vh; }
.cardHead { padding: 10px 12px 6px; border-bottom: 1px solid #f0edf6; }
.tasteName { font-size: 14px; font-weight: 700; color: #e91e63; }
.tagline { font-size: 11px; color: #888; margin-top: 2px; }
.body { padding: 10px 12px; font-size: 12.5px; line-height: 1.7; color: #333; white-space: pre-wrap; overflow-y: auto; flex: 1; min-height: 120px; }
.foot { padding: 8px 12px 12px; border-top: 1px solid #f0edf6; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.count { font-size: 11px; color: #666; margin-right: auto; }
.count.over { color: #f44336; font-weight: 700; }
.warn { font-size: 11px; color: #ef6c00; padding: 0 12px 8px; }
.err { font-size: 12px; color: #f44336; padding: 12px; }
.btn { border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; padding: 7px 12px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.adopt { background: #e91e63; color: white; }
.regen { background: #f0f0f0; color: #444; }
.cancel { align-self: center; margin: 0 0 14px; background: none; border: none; color: #777; font-size: 12px; cursor: pointer; text-decoration: underline; }
.spinner { padding: 24px 12px; text-align: center; color: #888; font-size: 12px; }
`

export const ProfileImprovePanel = ({ textarea, fieldType, onClose }: ProfileImprovePanelProps) => {
    const [cards, setCards] = useState<Record<TasteId, CardState>>({
        solid: { status: "loading" },
        story: { status: "loading" },
        light: { status: "loading" }
    })
    // モーダルを開いた瞬間の入力値を素材として固定する
    const currentTextRef = useRef(textarea.value)

    const generate = async (tasteId: TasteId) => {
        setCards((prev) => ({ ...prev, [tasteId]: { status: "loading" } }))
        try {
            const myProfileRaw = await getMyProfileRaw()
            if (!myProfileRaw) {
                setCards((prev) => ({
                    ...prev,
                    [tasteId]: {
                        status: "error",
                        message: "プロフィールデータを取得できません。Lunaにログインした状態でページを再読み込みしてください。"
                    }
                }))
                return
            }
            const response = await chrome.runtime.sendMessage({
                action: "generate_profile",
                fieldType,
                taste: tasteId,
                currentText: currentTextRef.current,
                myProfileRaw
            })
            if (response?.text) {
                setCards((prev) => ({
                    ...prev,
                    [tasteId]: { status: "done", text: response.text, warning: response.warning }
                }))
            } else {
                const msg = response?.error || "生成に失敗しました"
                const hint = /API Key/i.test(msg) ? "（拡張機能のオプション画面でAPIキーを設定してください）" : ""
                setCards((prev) => ({ ...prev, [tasteId]: { status: "error", message: msg + hint } }))
            }
        } catch (e: any) {
            setCards((prev) => ({ ...prev, [tasteId]: { status: "error", message: e?.message || String(e) } }))
        }
    }

    useEffect(() => {
        PROFILE_TASTES.forEach((t) => { generate(t.id) })
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose(false)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const adopt = async (tasteId: TasteId) => {
        const card = cards[tasteId]
        if (card.status !== "done") return
        insertText(textarea, card.text)
        await addLog("info", "Profile suggestion adopted", { fieldType, taste: tasteId }, "CONTENT")
        onClose(true)
    }

    return (
        <>
            <style>{PANEL_CSS}</style>
            <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false) }}>
                <div className="dialog" role="dialog" aria-modal="true">
                    <div className="header">
                        <span className="title">✨ {PROFILE_FIELD_LABELS[fieldType]}の改善案（3テイスト）</span>
                        <button className="close" onClick={() => onClose(false)} title="閉じる">✕</button>
                    </div>
                    <div className="cards">
                        {PROFILE_TASTES.map((t) => {
                            const card = cards[t.id]
                            return (
                                <div className="card" key={t.id}>
                                    <div className="cardHead">
                                        <div className="tasteName">{t.label}</div>
                                        <div className="tagline">{t.tagline}</div>
                                    </div>
                                    {card.status === "loading" && <div className="spinner">🪄 生成中...</div>}
                                    {card.status === "error" && <div className="err">⚠️ {card.message}</div>}
                                    {card.status === "done" && <div className="body">{card.text}</div>}
                                    {card.status === "done" && card.warning && <div className="warn">⚠ {card.warning}</div>}
                                    <div className="foot">
                                        {card.status === "done" && (
                                            <span className={`count${card.text.length > 400 ? " over" : ""}`}>
                                                {card.text.length}/400
                                            </span>
                                        )}
                                        <button
                                            className="btn regen"
                                            disabled={card.status === "loading"}
                                            onClick={() => generate(t.id)}
                                        >
                                            ♻ 再生成
                                        </button>
                                        <button
                                            className="btn adopt"
                                            disabled={card.status !== "done"}
                                            onClick={() => adopt(t.id)}
                                        >
                                            この案を使う
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <button className="cancel" onClick={() => onClose(false)}>キャンセル（元の文のまま）</button>
                </div>
            </div>
        </>
    )
}
```

- [ ] **Step 3: `ProfileImproveButton.tsx` を作成（注入されるボタン + シャドウDOMホスト管理）**

```tsx
import React, { useState } from "react"
import { createRoot } from "react-dom/client"

import { addLog } from "../../utils/logger"
import type { ProfileFieldType } from "../../utils/profile-field"
import { ProfileImprovePanel } from "./ProfileImprovePanel"

interface ProfileImproveButtonProps {
    textarea: HTMLTextAreaElement
    fieldType: ProfileFieldType
}

export const ProfileImproveButton = ({ textarea, fieldType }: ProfileImproveButtonProps) => {
    const [open, setOpen] = useState(false)
    const [adopted, setAdopted] = useState(false)

    const openPanel = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (open) return
        setOpen(true)
        setAdopted(false)
        await addLog("info", "Profile improve panel opened", { fieldType }, "CONTENT")

        // サイトCSSから隔離するためシャドウDOMのホストをbody直下に作る
        const host = document.createElement("div")
        host.id = "lunagen-profile-panel-host"
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: "open" })
        const mount = document.createElement("div")
        shadow.appendChild(mount)
        const root = createRoot(mount)

        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"

        const close = (didAdopt: boolean) => {
            document.body.style.overflow = prevOverflow
            // Reactのレンダー中unmountを避けるため次tickで破棄
            setTimeout(() => {
                root.unmount()
                host.remove()
            }, 0)
            setOpen(false)
            if (didAdopt) {
                setAdopted(true)
                setTimeout(() => setAdopted(false), 8000)
            }
        }

        root.render(<ProfileImprovePanel textarea={textarea} fieldType={fieldType} onClose={close} />)
    }

    return (
        <div style={{ marginTop: "8px" }}>
            <button
                onClick={openPanel}
                disabled={open}
                title="保存済みの内容をもとに、テイスト違いの改善案を3つ生成します"
                style={{
                    padding: "6px 12px",
                    backgroundColor: open ? "#ccc" : "#e91e63",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: open ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: "all 0.3s ease"
                }}
            >
                ✨ AIで改善
            </button>
            {adopted && (
                <p style={{ color: "#e91e63", fontSize: "11px", margin: "4px 0 0 2px", fontWeight: "bold" }}>
                    ⚠ サイトの「保存する」を押すと反映されます
                </p>
            )}
        </div>
    )
}
```

- [ ] **Step 4: `content.tsx` に注入分岐を追加**

import追加:

```tsx
import { ProfileImproveButton } from "./components/Content/ProfileImproveButton"
import { detectProfileField } from "./utils/profile-field"
```

`injectButtons()` の下に追加:

```tsx
/**
 * プロフィール編集ページ(/user/mod)の編集オーバーレイに
 * 「AIで改善」ボタンを注入する。欄はplaceholder（フォールバックで
 * オーバーレイ見出し）から判別し、判別不能なら注入しない。
 */
function findOverlayHeading(textarea: HTMLTextAreaElement): string {
    let node: HTMLElement | null = textarea.parentElement
    for (let hops = 0; hops < 12 && node; hops++) {
        const text = node.innerText || ""
        if (text.includes("保存する")) {
            return (text.split("\n")[0] || "").trim()
        }
        node = node.parentElement
    }
    return ""
}

function injectProfileButtons() {
    if (location.pathname !== "/user/mod") return

    const textareas = document.querySelectorAll("textarea")
    textareas.forEach((textarea) => {
        if (textarea.dataset.lunaAiInjected === "true") return
        const fieldType = detectProfileField(textarea.placeholder, findOverlayHeading(textarea))
        if (!fieldType) return
        textarea.dataset.lunaAiInjected = "true"

        const container = document.createElement("div")
        textarea.parentElement?.appendChild(container)
        const root = createRoot(container)
        root.render(<ProfileImproveButton textarea={textarea} fieldType={fieldType} />)
        injectedButtons.set(textarea, { root, container })
    })
}
```

`processDom()` を更新:

```tsx
function processDom() {
    cleanupDetachedButtons()
    injectButtons()
    injectProfileButtons()
}
```

※既存 `injectButtons()` は `isTargetPage` 判定（`/user/show/`・`/message`）のままなので `/user/mod` ではメッセージ用ボタンは出ない。`injectedButtons` Map と `cleanupDetachedButtons` は両ボタン共通で機能する。

- [ ] **Step 5: 型チェック・テスト・ビルド**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`
Expected: すべて成功

- [ ] **Step 6: コミット**

```bash
git add components/Content/ProfileImproveButton.tsx components/Content/ProfileImprovePanel.tsx logic/content-logic.ts content.tsx
git commit -m "feat(profile): /user/modにAI改善ボタンとテイスト3択モーダルを注入"
```

---

### Task 5: 実機E2E検証スクリプト

**Files:**
- Create: `.claude/skills/luna-startup-debug/verify-profile.mjs`

**Interfaces:**
- Consumes: ビルド済み拡張（`build/chrome-mv3-prod`）、`e2e/.profile`（ログイン済みプロファイル）、Task 4 のUI（ボタン文言「✨ AIで改善」、ホストid `lunagen-profile-panel-host`、カードのテイスト名「堅実/物語/軽快」）

- [ ] **Step 1: 検証スクリプトを作成**

`verify.mjs` と同じ構成（Bitwarden認証・persistent context）で `/user/mod` を検証する:

```js
// LunaGen プロフィール改善機能の実機確認:
// /user/mod の編集オーバーレイに「✨ AIで改善」ボタンが注入され、
// クリックで3択モーダルが開くことをスクショ付きで検証する。
//
//   node .claude/skills/luna-startup-debug/verify-profile.mjs
//
// 注意: e2e/.profile にはAPIキーが無いため、カードは「エラー表示」になるのが正常。
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

const log = (...a) => console.log("[verify-profile]", ...a)
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
  const page = await ctx.newPage()

  // 1. ログイン（必要時のみ）
  await page.goto("https://luna-matching.com/", { waitUntil: "domcontentloaded" })
  let me = await page.request.get("https://luna-matching.com/api/user/get/me")
  if (!me.ok()) {
    log("not logged in -> logging in via Bitwarden creds")
    await page.goto("https://luna-matching.com/auth", { waitUntil: "domcontentloaded" })
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(bwCred("username"))
    await page.getByRole("textbox", { name: "パスワード" }).fill(bwCred("password"))
    await page.getByRole("button", { name: "ログイン", exact: true }).click()
    await page.waitForTimeout(4000)
    me = await page.request.get("https://luna-matching.com/api/user/get/me")
  }
  if (!me.ok()) throw new Error("login failed")

  // 2. /user/mod を開き、自己紹介の「編集する」をクリック
  await page.goto("https://luna-matching.com/user/mod", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)

  // メッセージ用ボタン（AI/クリア）が誤注入されていないこと
  const msgBtnCount = await page.getByRole("button", { name: "AI", exact: true }).count()
  log("message-AI-button count on /user/mod:", msgBtnCount, "(expected 0)")

  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"))
    const h = all.find((el) => el.children.length === 0 && (el.textContent || "").trim() === "自己紹介")
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (b) => (b.innerText || "").trim() === "編集する"
    )
    const after = buttons.find((b) => h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    after.click()
  })
  await page.waitForTimeout(2500)

  // 3. 「✨ AIで改善」ボタンの注入を確認
  const improveBtn = page.getByRole("button", { name: /AIで改善/ }).first()
  await improveBtn.waitFor({ state: "visible", timeout: 15000 })
  log("improve button visible:", await improveBtn.isVisible())
  await page.screenshot({ path: path.join(SHOT_DIR, "01-edit-overlay-button.png") })

  // 4. クリック → モーダル（シャドウDOM）を確認
  await improveBtn.click()
  await page.waitForTimeout(2500)
  const host = page.locator("#lunagen-profile-panel-host")
  const hostCount = await host.count()
  log("panel host count:", hostCount, "(expected 1)")

  // Playwrightのlocatorはshadow DOMを貫通する
  for (const taste of ["堅実", "物語", "軽快"]) {
    const visible = await page.getByText(taste, { exact: true }).first().isVisible().catch(() => false)
    log(`taste card "${taste}" visible:`, visible)
  }
  await page.waitForTimeout(4000) // カードの生成/エラー確定を待つ
  await page.screenshot({ path: path.join(SHOT_DIR, "02-panel-cards.png") })

  const failed = msgBtnCount !== 0 || hostCount !== 1 || !(await improveBtn.isVisible().catch(() => false))
  if (failed) {
    console.error("[verify-profile] FAIL")
    process.exitCode = 1
  } else {
    log("OK: ボタン注入 + モーダル表示を確認（スクショ:", SHOT_DIR, ")")
  }
} catch (e) {
  console.error("[verify-profile] ERROR:", e.message)
  const p = (await ctx.pages())[0]
  if (p) await p.screenshot({ path: path.join(SHOT_DIR, "99-error.png") }).catch(() => {})
  process.exitCode = 1
} finally {
  await ctx.close()
}
```

- [ ] **Step 2: ビルドして実機検証を実行**

Run:
```bash
pnpm build && node .claude/skills/luna-startup-debug/verify-profile.mjs
```
Expected: `OK: ボタン注入 + モーダル表示を確認` / スクショ2枚が `test-results/profile-improve-debug/` に保存

- [ ] **Step 3: スクショを目視確認（Readツールで開く）**

- `01-edit-overlay-button.png`: 自己紹介オーバーレイのtextarea下に「✨ AIで改善」
- `02-panel-cards.png`: 3カード（堅実/物語/軽快）が表示され、APIキー無しのためエラー文言＋再生成ボタン

崩れ・重なりがあれば Task 4 のCSSを修正して再実行。

- [ ] **Step 4: コミット**

```bash
git add .claude/skills/luna-startup-debug/verify-profile.mjs
git commit -m "test(profile): /user/modのボタン注入とモーダル表示の実機検証スクリプトを追加"
```

---

### Task 6: ドキュメント更新

**Files:**
- Modify: `AGENT.md`
- Modify: `.claude/skills/luna-startup-debug/SKILL.md`

- [ ] **Step 1: AGENT.md のアーキテクチャ節に追記**

「### アーキテクチャ構成」の Content Script 項の後に:

```markdown
1.5. **プロフィール改善 (`components/Content/ProfileImprovePanel.tsx`)**:
    - `/user/mod`（プロフィール編集）の編集オーバーレイに `ProfileImproveButton` を注入。
    - 欄判別は `utils/profile-field.ts` の `detectProfileField`（placeholder優先、見出しフォールバック）。
    - テイスト3択（堅実/物語/軽快）をシャドウDOMモーダルで比較し、`insertText` で反映。保存はサイト純正ボタン。
    - プロンプト定数は `profile-prompts.ts`（原則の出典: docs/superpowers/specs/2026-07-20-luna-profile-improvement-design.md）。
    - background の `generate_profile` アクションが生成（400字コード検証・嗜好名詞保全チェック付き）。
```

- [ ] **Step 2: SKILL.md の手順に verify-profile.mjs を追記**

「### 2. 起動確認 + スクショ」の後に:

```markdown
### 2.5 プロフィール改善機能の確認
```
node .claude/skills/luna-startup-debug/verify-profile.mjs
```
- `/user/mod` → 自己紹介の「編集する」→「✨ AIで改善」注入 → 3択モーダル表示を検証。
- APIキー無しプロファイルではカードがエラー表示になるのが正常（注入とUIの確認が目的）。
- スクショ: `test-results/profile-improve-debug/01-edit-overlay-button.png`, `02-panel-cards.png`
```

- [ ] **Step 3: コミット**

```bash
git add AGENT.md .claude/skills/luna-startup-debug/SKILL.md
git commit -m "docs: プロフィール改善機能のアーキテクチャと実機検証手順を追記"
```

---

## Self-Review（作成時に実施済み）

- **Spec coverage**: 仕様書§3（content/utils/components/background/フォールバック）→ Task 1-4。§4テイスト・§5プロンプト → Task 2。§5.4保全チェック → Task 1,3。§6エラー処理 → Task 3(handler),4(Panel)。§7.1ユニット → Task 1-2。§7.2実機E2E → Task 5。§2の前提（placeholder値）→ Task 1テストに反映。
- **Placeholder scan**: TBD/TODO/「適切に」等なし。全ステップに実コード・実コマンドあり。
- **Type consistency**: `ProfileFieldType`/`TasteId`/`Audience`/`PROFILE_TASTES`/`buildProfilePrompt`/`getMyProfileRaw`/`generateWithConfiguredProvider` の名前・シグネチャはタスク間で一致。`generateWithOpenAI` の第3引数変更は Task 3 Step 1 で明示。
