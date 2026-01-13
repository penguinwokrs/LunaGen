import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

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
            detail: typeof detail === 'object' ? JSON.stringify(detail).substring(0, 1000) : detail
        }
        const updatedLogs = [newLog, ...logs].slice(0, 100)
        await storage.set("debugLogs", updatedLogs)
    } catch (e) {
        console.error(`[LUNA-LOGGER-ERROR]`, e)
    }
}
