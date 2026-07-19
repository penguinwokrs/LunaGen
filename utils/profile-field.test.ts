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
