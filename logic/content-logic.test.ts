import { describe, expect, it, vi } from "vitest"

vi.mock("@plasmohq/storage", () => ({ Storage: class {} }))

import { insertText } from "./content-logic"

describe("insertText", () => {
    it("maxlength超えの文は属性を外して挿入し、元の上限を退避する", () => {
        const ta = document.createElement("textarea")
        ta.maxLength = 200
        insertText(ta, "あ".repeat(250))
        expect(ta.value.length).toBe(250)
        expect(ta.hasAttribute("maxlength")).toBe(false)
        expect(ta.dataset.lunagenMaxlength).toBe("200")
    })

    it("上限内の文ならmaxlengthはそのまま", () => {
        const ta = document.createElement("textarea")
        ta.maxLength = 200
        insertText(ta, "こんにちは")
        expect(ta.maxLength).toBe(200)
    })
})
