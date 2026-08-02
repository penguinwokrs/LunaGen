import { describe, expect, it } from "vitest"

import { TYPE_GROUP, analyzeKinkType, expandTypeCodes } from "./kink-analysis"

describe("expandTypeCodes / TYPE_GROUP", () => {
    it("集約値 S は S型のセル全体に展開される", () => {
        const s = expandTypeCodes("S")
        expect(s.has("A")).toBe(true)
        expect(s.has("U")).toBe(true)
        expect(s.has("K")).toBe(false)
    })

    it("集約値 M は M型のセル全体に展開される", () => {
        const s = expandTypeCodes("M")
        expect(s.has("J")).toBe(true)
        expect(s.has("V")).toBe(true)
        expect(s.has("A")).toBe(false)
    })

    it("個別コードと集約値の混在を扱える", () => {
        const s = expandTypeCodes("M,Q,T")
        expect(s.has("Q")).toBe(true)
        expect(s.has("J")).toBe(true) // M の展開分
    })

    it("未知のコードは無視する", () => {
        expect(expandTypeCodes("Z,X").size).toBe(0)
    })

    it("未設定は空集合", () => {
        expect(expandTypeCodes(null).size).toBe(0)
        expect(expandTypeCodes(undefined).size).toBe(0)
        expect(expandTypeCodes("").size).toBe(0)
    })

    it("U は S型、V は M型に属する", () => {
        expect(TYPE_GROUP["U"]).toBe("S")
        expect(TYPE_GROUP["V"]).toBe("M")
    })
})

// 2026-08-02、実サイトのバンドルから確定した定義に基づく修正の回帰テスト
describe("象限分類の修正", () => {
    it("U は switch ではなく サド×サブ", () => {
        const a = analyzeKinkType({ my_type: "U" })
        expect(a.quadrantLabels).toContain("加虐的・従属的")
        expect(a.quadrantLabels).not.toContain("スイッチャー")
    })

    it("S（S型全体）は サド×ドミ", () => {
        expect(analyzeKinkType({ my_type: "S" }).quadrantLabels).toContain("支配的・加虐的")
    })

    it("M（M型全体）は マゾ×サブ（従来は未定義で分類されなかった）", () => {
        expect(analyzeKinkType({ my_type: "M" }).quadrantLabels).toContain("従順・被虐的")
    })
})
