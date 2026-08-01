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

    it("「最も噛み合う1〜2点を選ぶ」があれば「噛み合う点を2〜3点選び」に差し替える（厚み指示と矛盾するため）", () => {
        // DEFAULT_PROMPT自体はこの文言をもう含まないが、ユーザーが自作テンプレートに
        // 旧来の言い回しを残していた場合でも矛盾を解消できることを検証する。
        const template = "テンプレ本文\n最も噛み合う1〜2点を選ぶ\n続き"
        const out = applyPremiumPrompt(template)
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

    describe("DEFAULT_PROMPT との組み合わせ（本番プロンプトでの検証）", () => {
        // 合成テンプレート文字列だけでなく、実際に本番で使われる DEFAULT_PROMPT を
        // そのまま入力して検証する。新プロンプトの最重要ルール「相手が書いていない話題を
        // 自分から持ち出さない」と、プレミアム加工の追記内容が矛盾しないことを保証するため。
        const out = applyPremiumPrompt(DEFAULT_PROMPT)

        it("490〜500文字の文字数指定を含む", () => {
            expect(out).toContain("490〜500文字")
        })

        it("話題の数を2〜3個に増やす指示を含まない（矛盾するため）", () => {
            expect(out).not.toContain("2〜3個取り上げ")
            expect(out).not.toContain("噛み合う点を2〜3点選び")
        })

        it("素材外の話題を持ち出さない制約が残っている", () => {
            expect(out).toContain("相手が書いていない話題を自分から持ち出さない")
            expect(out).toContain("相手のプロフィールに無い話題を持ち出すこと（最重要）")
        })

        it("内容の厚みは一節の掘り下げと自己開示で埋める指示になっている（新しい話題を足す指示ではない）", () => {
            expect(out).toContain("選んだ一節の掘り下げと自分の開示を厚くして埋める")
            expect(out).not.toContain("エピソードを添えて掘り下げ")
        })
    })
})
