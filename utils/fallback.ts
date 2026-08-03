/**
 * 安全フィルタでブロックされたときのフォールバック先の判定
 *
 * Gemini は BLOCK_NONE を指定しても、設定で無効化できない PROHIBITED_CONTENT で
 * 生成を拒むことがある（実プロフィール50件の評価で約4〜6%、好みのカードを
 * 素材に入れるとさらに増えた）。そのとき、より緩いオープンモデルへ切り替えて
 * 生成し直すための判定をここに集約する。
 *
 * 発動は安全ブロックのときだけ。通信エラー・レート制限・課金上限で切り替えると、
 * 本来直すべき問題が見えなくなる。
 */

/** フォールバック先。"none" は無効 */
export type FallbackProvider = "none" | "cloudflare" | "ollama"

export const NO_FALLBACK: FallbackProvider = "none"

export interface FallbackDecision {
    /** 切り替えるか */
    use: boolean
    /** 切り替え先。use が false なら null */
    provider: Exclude<FallbackProvider, "none"> | null
    /** 切り替えない場合の理由（ログ用） */
    reason: string
}

/**
 * フォールバックすべきかを決める。
 *
 * @param isSafetyBlock 安全フィルタによるブロックだったか
 * @param fallback 設定されたフォールバック先
 * @param primaryProvider いま使っているプロバイダー
 */
export function decideFallback(
    isSafetyBlock: boolean,
    fallback: string | null | undefined,
    primaryProvider: string
): FallbackDecision {
    if (!isSafetyBlock) {
        return { use: false, provider: null, reason: "安全ブロック以外の失敗" }
    }
    if (!fallback || fallback === NO_FALLBACK) {
        return { use: false, provider: null, reason: "フォールバック先が未設定" }
    }
    if (fallback !== "cloudflare" && fallback !== "ollama") {
        return { use: false, provider: null, reason: `未知のフォールバック先: ${fallback}` }
    }
    if (fallback === primaryProvider) {
        // 同じプロバイダーへ切り替えても同じ結果になる
        return { use: false, provider: null, reason: "フォールバック先が現在のプロバイダーと同じ" }
    }
    return { use: true, provider: fallback, reason: "" }
}
