import { describe, expect, it } from "vitest"

import { OCCUPATION_LABELS, resolveOccupation } from "./occupation"

describe("resolveOccupation", () => {
    it("数値コードを表示名に解決する", () => {
        expect(resolveOccupation(20)).toBe("IT関連")
        expect(resolveOccupation(49)).toBe("会社員")
    })

    it("文字列のコードでも解決する", () => {
        expect(resolveOccupation("3")).toBe("公務員")
    })

    it("APIが表を返した場合はそちらを優先する", () => {
        expect(resolveOccupation(20, { "20": "情報通信" })).toBe("情報通信")
    })

    it("表に無い数値コードは null を返す（番号をそのまま出さない）", () => {
        expect(resolveOccupation(999)).toBeNull()
    })

    it("未設定は null を返す", () => {
        expect(resolveOccupation(null)).toBeNull()
        expect(resolveOccupation(undefined)).toBeNull()
        expect(resolveOccupation("")).toBeNull()
    })

    it("表示名の文字列がそのまま来た場合はそれを使う", () => {
        expect(resolveOccupation("フリーランス")).toBe("フリーランス")
    })

    it("空白だけの文字列は null を返す", () => {
        expect(resolveOccupation("   ")).toBeNull()
    })

    it("中間のコードもずれていない（両端だけではオフバイワンを検出できない）", () => {
        expect(OCCUPATION_LABELS["10"]).toBe("医師")
        expect(OCCUPATION_LABELS["19"]).toBe("教育関連")
        expect(OCCUPATION_LABELS["30"]).toBe("ブライダル")
        expect(OCCUPATION_LABELS["49"]).toBe("会社員")
        expect(OCCUPATION_LABELS["53"]).toBe("エンジニア")
    })

    it("対応表は58件で、1と58が端", () => {
        expect(Object.keys(OCCUPATION_LABELS)).toHaveLength(58)
        expect(OCCUPATION_LABELS["1"]).toBe("上場企業")
        expect(OCCUPATION_LABELS["58"]).toBe("その他")
    })
})
