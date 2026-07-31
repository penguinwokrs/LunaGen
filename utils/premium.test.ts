import { describe, expect, it } from "vitest"
import { applyPremiumPrompt, isPremiumInput } from "./premium"
import { DEFAULT_PROMPT } from "../constants"

// 実機実測(2026-08-01)のダイアログ文言
const PREMIUM_DIALOG =
    "いいね\nいいねを送信します\nプレミアムメッセージはあなたの想いをしっかり伝えるために100文字以上必要です。\n0/500\n入力内容を確認"
const NORMAL_DIALOG =
    "いいね\nいいねを送信します\nメッセージ付きいいね\n共通点や、「素敵だな」と感じた部分に触れることで、マッチ率アップにつながります\n0/200\n入力内容を確認"

describe("isPremiumInput", () => {
    // 実測: プレミアム=500 / メッセージ付きいいね=200 / マッチ後スレッド=-1(属性なし)
    it("プレミアムメッセージ欄(500)はプレミアム", () => {
        expect(isPremiumInput(500, PREMIUM_DIALOG)).toBe(true)
    })

    it("メッセージ付きいいね欄(200)はプレミアムではない", () => {
        expect(isPremiumInput(200, NORMAL_DIALOG)).toBe(false)
    })

    it("maxlength属性が無いスレッド欄(-1)はプレミアムではない", () => {
        expect(isPremiumInput(-1, "")).toBe(false)
    })

    it("しきい値は300", () => {
        expect(isPremiumInput(300, "")).toBe(true)
        expect(isPremiumInput(299, "")).toBe(false)
    })

    it("上限が明示されていない欄は「プレミアムメッセージ」の文言で判定する", () => {
        expect(isPremiumInput(-1, PREMIUM_DIALOG)).toBe(true)
        expect(isPremiumInput(0, PREMIUM_DIALOG)).toBe(true)
        expect(isPremiumInput(-1, NORMAL_DIALOG)).toBe(false)
    })

    it("上限が明示されている欄では文言よりmaxlengthを優先する（超過して切り詰められるのを防ぐ）", () => {
        expect(isPremiumInput(200, PREMIUM_DIALOG)).toBe(false)
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
