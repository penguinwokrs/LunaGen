import { describe, expect, it } from "vitest"

import { NO_FALLBACK, decideFallback } from "./fallback"

describe("decideFallback", () => {
    it("安全ブロックかつフォールバック先が設定されていれば切り替える", () => {
        const d = decideFallback(true, "cloudflare", "gemini")
        expect(d.use).toBe(true)
        expect(d.provider).toBe("cloudflare")
    })

    it("Ollamaも切り替え先にできる", () => {
        expect(decideFallback(true, "ollama", "gemini").provider).toBe("ollama")
    })

    // 通信エラーや課金上限で切り替えると、本来直すべき問題が見えなくなる
    it("安全ブロック以外では切り替えない", () => {
        const d = decideFallback(false, "cloudflare", "gemini")
        expect(d.use).toBe(false)
        expect(d.reason).toContain("安全ブロック以外")
    })

    it("フォールバック先が未設定なら切り替えない", () => {
        expect(decideFallback(true, NO_FALLBACK, "gemini").use).toBe(false)
        expect(decideFallback(true, null, "gemini").use).toBe(false)
        expect(decideFallback(true, undefined, "gemini").use).toBe(false)
        expect(decideFallback(true, "", "gemini").use).toBe(false)
    })

    it("現在のプロバイダーと同じなら切り替えない（同じ結果にしかならない）", () => {
        const d = decideFallback(true, "cloudflare", "cloudflare")
        expect(d.use).toBe(false)
        expect(d.reason).toContain("同じ")
    })

    it("未知の値は切り替えない", () => {
        const d = decideFallback(true, "anthropic", "gemini")
        expect(d.use).toBe(false)
        expect(d.reason).toContain("未知")
    })

    it("切り替えない場合は理由が必ず入る（ログで追えるように）", () => {
        for (const d of [
            decideFallback(false, "cloudflare", "gemini"),
            decideFallback(true, NO_FALLBACK, "gemini"),
            decideFallback(true, "cloudflare", "cloudflare"),
            decideFallback(true, "unknown", "gemini")
        ]) {
            expect(d.use).toBe(false)
            expect(d.reason.length).toBeGreaterThan(0)
        }
    })
})
