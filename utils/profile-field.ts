/**
 * プロフィール改善機能の純ロジック
 *
 * /user/mod の編集オーバーレイに現れる textarea の欄判別、
 * 読者性別の判定、400字制約、嗜好名詞の保全チェックを行う。
 * DOM・chrome API に依存しない（Vitest対象）。
 */

import {
    PROFILE_CURRENT_SECTION,
    PROFILE_EMPTY_SECTION,
    PROFILE_FIELD_LABELS,
    PROFILE_GUARDRAILS,
    PROFILE_PRINCIPLES,
    PROFILE_PROMPT_TEMPLATE,
    PROFILE_TASTES
} from "../profile-prompts"
import { extractProfileFromJSON } from "./profile"

export type ProfileFieldType = "intro" | "kink" | "conditions" | "ng"
export type TasteId = "solid" | "story" | "light"
export type Audience = "women" | "men"

// 実機調査 2026-07-20 時点の placeholder / オーバーレイ見出し。
// placeholder優先、変わった場合は見出しでフォールバックし、
// どちらも一致しなければ注入しない（安全側）。
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
    // フォールバック: 自分の性別から推定（APIが文字列で返す場合に備えNumber経由）
    if (Number(myRaw?.sex) === 1) return "men"
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
    const audienceLabel =
        audience === "women"
            ? "女性（あなたのプロフィールを見る女性会員）"
            : "男性（あなたのプロフィールを見る男性会員）"
    const profileContext = extractProfileFromJSON(myRaw) || "（基本データなし）"

    const trimmed = (currentText || "").trim()
    const currentSection =
        trimmed.length < EMPTY_TEXT_THRESHOLD
            ? PROFILE_EMPTY_SECTION.split("{current_text}").join(trimmed)
            : PROFILE_CURRENT_SECTION.split("{current_text}").join(trimmed)

    return PROFILE_PROMPT_TEMPLATE
        .split("{field_label}").join(PROFILE_FIELD_LABELS[fieldType])
        .split("{audience_label}").join(audienceLabel)
        .split("{field_principles}").join(principles)
        .split("{taste_label}").join(tasteDef.label)
        .split("{taste_instruction}").join(tasteDef.instruction)
        .split("{guardrails}").join(PROFILE_GUARDRAILS)
        .split("{profile_context}").join(profileContext)
        .split("{current_section}").join(currentSection)
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
