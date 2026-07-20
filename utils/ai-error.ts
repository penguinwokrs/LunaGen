/**
 * AI SDK のエラーを、原因が分かるメッセージと診断用の詳細に変換する。
 *
 * 背景（2026-07-20 実測）:
 * Gemini はプロンプトを安全フィルタでブロックすると HTTP 200 を返すが、
 * ボディは `{"promptFeedback":{"blockReason":"..."}}` だけで `candidates` を含まない。
 * AI SDK のレスポンススキーマは `candidates` を必須にしているため Zod 検証が落ち、
 * `APICallError("Invalid JSON response")` という中身の無いエラーになる。
 * 本当の理由は message ではなく statusCode / responseBody / cause 側にあるので、
 * ここで読み替えてユーザーに見せる。
 */

export interface AiErrorDescription {
    /** ユーザーに表示するメッセージ */
    message: string
    /** 安全フィルタによるブロックか（呼び出し側のリトライ判断に使う） */
    isSafetyBlock: boolean
    /** デバッグログ用の詳細 */
    detail: {
        name?: string
        rawMessage?: string
        statusCode?: number
        responseBody?: string
        cause?: string
        blockReason?: string
    }
}

/** 安全フィルタによる中断を示す finishReason */
const SAFETY_FINISH_REASONS = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "RECITATION"]

/** ブロック理由を応答ボディから取り出す（プロンプト段階・生成途中の両方） */
export function extractBlockReason(responseBody?: string | null): string | null {
    if (!responseBody) return null
    try {
        const json = JSON.parse(responseBody)
        if (json?.promptFeedback?.blockReason) return String(json.promptFeedback.blockReason)
        const finish = json?.candidates?.[0]?.finishReason
        if (finish && SAFETY_FINISH_REASONS.includes(String(finish).toUpperCase())) {
            return String(finish)
        }
    } catch {
        /* JSONでなければ判定不能 */
    }
    return null
}

const MAX_BODY_LOG = 1000

export function describeAiError(e: any): AiErrorDescription {
    const rawMessage = typeof e?.message === "string" ? e.message : String(e)
    const statusCode: number | undefined = typeof e?.statusCode === "number" ? e.statusCode : undefined
    const responseBody: string = typeof e?.responseBody === "string" ? e.responseBody : ""

    const detail: AiErrorDescription["detail"] = {
        name: e?.name,
        rawMessage,
        statusCode,
        responseBody: responseBody ? responseBody.slice(0, MAX_BODY_LOG) : undefined,
        cause: e?.cause ? String(e.cause).slice(0, 500) : undefined
    }

    // 応答が空 + finishReason が安全系のケース。
    // SDK は例外を投げず空文字を返すため、呼び出し側が投げた Error を文面から拾う。
    const finishMatch = rawMessage.match(/FinishReason:\s*([A-Z_]+)/i)
    const finishReason = finishMatch?.[1]?.toUpperCase()
    if (finishReason && SAFETY_FINISH_REASONS.includes(finishReason)) {
        return {
            isSafetyBlock: true,
            detail: { ...detail, blockReason: finishReason },
            message:
                `AIの安全フィルタにより応答が中断されました（理由: ${finishReason}）。` +
                `話題の言い回しを変えるか、設定画面の置換ルールに該当する語を追加してからお試しください。`
        }
    }

    const blockReason = extractBlockReason(responseBody)
    if (blockReason) {
        return {
            isSafetyBlock: true,
            detail: { ...detail, blockReason },
            message:
                `AIの安全フィルタが入力をブロックしました（理由: ${blockReason}）。` +
                `話題の言い回しを変えるか、設定画面の置換ルールに該当する語を追加してからお試しください。`
        }
    }

    if (statusCode === 404 || /is not found|no longer available/i.test(rawMessage)) {
        return {
            isSafetyBlock: false,
            detail,
            message: `指定のAIモデルが利用できません（${rawMessage}）。設定画面でモデルを選び直してください。`
        }
    }

    if (statusCode === 429 || /quota|rate limit|RESOURCE_EXHAUSTED/i.test(rawMessage)) {
        return {
            isSafetyBlock: false,
            detail,
            message: `AIの利用上限に達しました（${rawMessage}）。時間をおくか、別のAPIキー・モデルでお試しください。`
        }
    }

    if (statusCode === 401 || statusCode === 403 || /API Key|api key|unauthorized|forbidden|PERMISSION_DENIED/i.test(rawMessage)) {
        return {
            isSafetyBlock: false,
            detail,
            message: `APIキーの問題でAIに接続できません（${rawMessage}）。設定画面でAPIキーを確認してください。`
        }
    }

    if (statusCode === 503 || /503|Overloaded/i.test(rawMessage)) {
        return {
            isSafetyBlock: false,
            detail,
            message: `AIサーバーが混雑しています（${rawMessage}）。時間をおいてお試しください。`
        }
    }

    // 未知のエラーは握りつぶさず、分かる情報を添えてそのまま伝える
    const suffix = statusCode ? `（HTTP ${statusCode}）` : ""
    return { isSafetyBlock: false, detail, message: `${rawMessage}${suffix}` }
}
