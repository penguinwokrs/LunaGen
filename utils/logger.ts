import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

/**
 * detail に保存する最大文字数。
 *
 * 生成メッセージ（プレミアム上限500字）やプロフィール改善案（400字）を
 * 丸ごと残せる余裕を持たせている。ログは100件までなので、
 * 最悪でも数百KB程度に収まる。
 */
export const DETAIL_MAX_LENGTH = 4000

/**
 * detail を保存用の文字列にする。
 *
 * 長すぎる detail でストレージを埋めないよう切り詰めるが、切り詰めたことが
 * 分からないと「ログが途中で切れている」のか「AIの出力自体が短い」のかを
 * 区別できないため、必ず省略した文字数を添える。
 */
export function formatLogDetail(detail: any): any {
    const truncate = (s: string) =>
        s.length > DETAIL_MAX_LENGTH
            ? `${s.slice(0, DETAIL_MAX_LENGTH)}…（残り${s.length - DETAIL_MAX_LENGTH}文字を省略）`
            : s

    if (typeof detail === "string") return truncate(detail)
    if (typeof detail !== "object" || detail === null) return detail
    try {
        return truncate(JSON.stringify(detail))
    } catch {
        // 循環参照など。ここで例外を投げるとログ自体が消えてしまう
        return "[detailを文字列化できませんでした]"
    }
}

/**
 * デバッグログを記録する
 * 
 * @param level ログレベル (info, warn, error)
 * @param message ログメッセージ
 * @param detail 詳細データ
 * @param context 呼び出し元のコンテキスト (BG, CONTENT, OPTIONS)
 */
export async function addLog(level: string, message: string, detail?: any, context = "APP") {
    try {
        const isDebugEnabled = await storage.get<boolean>("isDebugEnabled") ?? (process.env.NODE_ENV === "development")

        // 開発者コンソールには常に表示
        const consoleMsg = `[LUNA-${context}-${level.toUpperCase()}] ${message}`
        if (level === "error") {
            console.error(consoleMsg, detail || "")
        } else if (level === "warn") {
            console.warn(consoleMsg, detail || "")
        } else {
            console.log(consoleMsg, detail || "")
        }

        if (!isDebugEnabled && level !== "error") return

        const logs = await storage.get<any[]>("debugLogs") || []
        const newLog = {
            timestamp: new Date().toISOString(),
            level,
            message: `[${context}] ${message}`,
            detail: formatLogDetail(detail)
        }
        const updatedLogs = [newLog, ...logs].slice(0, 100)
        await storage.set("debugLogs", updatedLogs)
    } catch (e) {
        console.error(`[LUNA-LOGGER-ERROR]`, e)
    }
}
