import { describe, expect, it } from "vitest"
import { describeAiError, extractBlockReason } from "./ai-error"

describe("extractBlockReason", () => {
    it("プロンプトブロック(promptFeedback.blockReason)を取り出す", () => {
        const body = JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT", safetyRatings: [] } })
        expect(extractBlockReason(body)).toBe("PROHIBITED_CONTENT")
    })

    it("応答途中のブロック(finishReason=SAFETY)も検出する", () => {
        const body = JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })
        expect(extractBlockReason(body)).toBe("SAFETY")
    })

    it("正常応答ではnull", () => {
        const body = JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }] })
        expect(extractBlockReason(body)).toBeNull()
    })

    it("JSONでない・空文字ではnull", () => {
        expect(extractBlockReason("<html>error</html>")).toBeNull()
        expect(extractBlockReason("")).toBeNull()
        expect(extractBlockReason(undefined as any)).toBeNull()
    })
})

describe("describeAiError", () => {
    it("安全ブロックは原因と対処が分かる日本語にする（Invalid JSON responseのままにしない）", () => {
        // 実際にGeminiがプロンプトをブロックしたときの形（2026-07-20 実測）
        const e: any = {
            name: "AI_APICallError",
            message: "Invalid JSON response",
            statusCode: 200,
            responseBody: JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })
        }
        const r = describeAiError(e)
        expect(r.message).toContain("安全フィルタ")
        expect(r.message).toContain("PROHIBITED_CONTENT")
        expect(r.message).not.toContain("Invalid JSON response")
        expect(r.isSafetyBlock).toBe(true)
        expect(r.detail.blockReason).toBe("PROHIBITED_CONTENT")
    })

    it("モデル404はモデル変更を促す", () => {
        const e: any = {
            name: "AI_APICallError",
            message: "models/gemini-1.5-flash is not found for API version v1beta",
            statusCode: 404,
            responseBody: JSON.stringify({ error: { code: 404, message: "not found", status: "NOT_FOUND" } })
        }
        const r = describeAiError(e)
        expect(r.message).toContain("モデル")
        expect(r.message).toContain("設定画面")
        expect(r.isSafetyBlock).toBe(false)
    })

    it("レート制限(429)はそれと分かる", () => {
        const e: any = { message: "Quota exceeded", statusCode: 429 }
        expect(describeAiError(e).message).toContain("上限")
    })

    it("認証エラー(401/403)はAPIキーの確認を促す", () => {
        expect(describeAiError({ message: "unauthorized", statusCode: 401 } as any).message).toContain("APIキー")
        expect(describeAiError({ message: "forbidden", statusCode: 403 } as any).message).toContain("APIキー")
    })

    it("APIキー未設定はそのまま伝える", () => {
        const r = describeAiError(new Error("Gemini API Key is not set"))
        expect(r.message).toContain("APIキー")
    })

    it("空応答+finishReason=SAFETY も安全ブロックとして扱う（SDKは例外を投げず空文字を返すため）", () => {
        const r = describeAiError(new Error("Gemini generated no text. (FinishReason: SAFETY)"))
        expect(r.isSafetyBlock).toBe(true)
        expect(r.message).toContain("安全フィルタ")
    })

    it("空応答でも安全以外の理由(MAX_TOKENS)は安全ブロックにしない", () => {
        const r = describeAiError(new Error("Gemini generated no text. (FinishReason: MAX_TOKENS)"))
        expect(r.isSafetyBlock).toBe(false)
    })

    it("未知のエラーは元のメッセージを保持する（握りつぶさない）", () => {
        const r = describeAiError(new Error("something unexpected happened"))
        expect(r.message).toContain("something unexpected happened")
    })

    it("診断用の詳細(statusCode/responseBody/cause)を必ず含める", () => {
        const e: any = {
            name: "AI_APICallError",
            message: "Invalid JSON response",
            statusCode: 200,
            responseBody: '{"promptFeedback":{"blockReason":"OTHER"}}',
            cause: "AI_TypeValidationError: ..."
        }
        const r = describeAiError(e)
        expect(r.detail.statusCode).toBe(200)
        expect(r.detail.responseBody).toContain("blockReason")
        expect(r.detail.cause).toContain("TypeValidationError")
        expect(r.detail.rawMessage).toBe("Invalid JSON response")
    })

    it("responseBodyが巨大でもログ用に切り詰める", () => {
        const e: any = { message: "x", responseBody: "a".repeat(5000) }
        expect(describeAiError(e).detail.responseBody!.length).toBeLessThanOrEqual(1000)
    })
})
