import { describe, expect, it } from "vitest"

import {
    REASONING_HEADROOM_TOKENS,
    cloudflareMaxOutputTokens,
    isReasoningModel
} from "./cloudflare-model"

describe("isReasoningModel", () => {
    it("実測で思考過程を出したモデルを思考型と判定する", () => {
        expect(isReasoningModel("@cf/zai-org/glm-4.7-flash")).toBe(true)
        expect(isReasoningModel("@cf/qwen/qwen3-30b-a3b-fp8")).toBe(true)
        expect(isReasoningModel("@cf/openai/gpt-oss-120b")).toBe(true)
        expect(isReasoningModel("@cf/moonshotai/kimi-k2.6")).toBe(true)
    })

    it("思考しないモデルは通常扱い", () => {
        expect(isReasoningModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe(false)
        expect(isReasoningModel("@cf/mistralai/mistral-small-3.1-24b-instruct")).toBe(false)
    })

    it("未設定でも落ちない", () => {
        expect(isReasoningModel("")).toBe(false)
    })
})

describe("cloudflareMaxOutputTokens", () => {
    // 上限を小さくしすぎると reasoning の途中で打ち切られ、content が空になる（実測）
    it("思考型には思考ぶんの余白を足す", () => {
        const n = cloudflareMaxOutputTokens("@cf/zai-org/glm-4.7-flash", 200)
        expect(n).toBeGreaterThan(REASONING_HEADROOM_TOKENS)
    })

    // 実測で 11,937 トークン使ったので、それを下回ってはいけない
    it("思考型の上限は実測の消費量（約12,000）を上回る", () => {
        expect(cloudflareMaxOutputTokens("@cf/zai-org/glm-4.7-flash", 200)).toBeGreaterThan(12000)
    })

    it("思考しないモデルは本文ぶんだけに絞る", () => {
        const n = cloudflareMaxOutputTokens("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 200)
        expect(n).toBe(800)
        expect(n).toBeLessThan(REASONING_HEADROOM_TOKENS)
    })

    it("プレミアム500字ぶんはより多く取る", () => {
        const normal = cloudflareMaxOutputTokens("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 200)
        const premium = cloudflareMaxOutputTokens("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 500)
        expect(premium).toBeGreaterThan(normal)
        expect(premium).toBe(1400)
    })

    it("文字数上限が0や負でも最低限は確保する", () => {
        expect(cloudflareMaxOutputTokens("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 0)).toBe(600)
        expect(cloudflareMaxOutputTokens("@cf/meta/llama-3.3-70b-instruct-fp8-fast", -10)).toBe(600)
    })
})
