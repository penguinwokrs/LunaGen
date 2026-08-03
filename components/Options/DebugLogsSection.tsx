import React from "react"

interface DebugLogsSectionProps {
    isDebugEnabled: boolean
    setIsDebugEnabled: (val: boolean) => void
    debugLogs: any[]
    setDebugLogs: (logs: any[]) => void
}

export const DebugLogsSection = ({
    isDebugEnabled,
    setIsDebugEnabled,
    debugLogs,
    setDebugLogs
}: DebugLogsSectionProps) => {
    return (
        <section id="debug-logs" style={{
            marginTop: "40px",
            padding: "15px",
            backgroundColor: "#f0f0f0",
            borderRadius: "8px",
            border: "1px solid #ccc",
            opacity: isDebugEnabled ? 1 : 0.8
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "15px", borderBottom: "1px solid #ccc", paddingBottom: "10px" }}>
                <h2 style={{ fontSize: "1.2rem", margin: 0 }}>5. デバッグログ設定</h2>
                <div style={{ display: "flex", gap: "15px", alignItems: "center", backgroundColor: "#fff", padding: "5px 15px", borderRadius: "20px", border: "1px solid #ddd" }}>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.9rem" }}>
                        <input
                            type="radio"
                            name="isDebugEnabled"
                            checked={isDebugEnabled === true}
                            onChange={() => setIsDebugEnabled(true)}
                            style={{ marginRight: "5px" }}
                        />
                        有効
                    </label>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.9rem" }}>
                        <input
                            type="radio"
                            name="isDebugEnabled"
                            checked={isDebugEnabled === false}
                            onChange={() => setIsDebugEnabled(false)}
                            style={{ marginRight: "5px" }}
                        />
                        無効
                    </label>
                </div>
            </div>

            {isDebugEnabled && (
                <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <h3 style={{ fontSize: "1rem", margin: 0, color: "#666" }}>保存されたログ</h3>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button
                                onClick={() => {
                                    const blob = new Blob([JSON.stringify(debugLogs, null, 2)], { type: "application/json" })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement("a")
                                    a.href = url
                                    a.download = `luna_logs_${new Date().toISOString()}.json`
                                    a.click()
                                }}
                                style={{ padding: "4px 8px", cursor: "pointer", borderRadius: "4px" }}
                            >
                                📥 ダウンロード
                            </button>
                            <button
                                onClick={() => {
                                    if (confirm("ログを消去しますか？")) {
                                        setDebugLogs([])
                                    }
                                }}
                                style={{ padding: "4px 8px", cursor: "pointer", borderRadius: "4px" }}
                            >
                                🗑️ 消去
                            </button>
                        </div>
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "10px" }}>
                        プロフィールの更新がうまくいかない場合、こちらで取得状況を確認できます。
                    </p>
                    <div style={{
                        backgroundColor: "#fff",
                        padding: "10px",
                        maxHeight: "300px",
                        overflowY: "auto",
                        fontSize: "0.8rem",
                        fontFamily: "monospace",
                        border: "1px solid #ddd",
                        borderRadius: "4px"
                    }}>
                        {debugLogs && debugLogs.length > 0 ? (
                            debugLogs.map((log: any, i: number) => (
                                <div key={i} style={{
                                    marginBottom: "4px",
                                    paddingBottom: "4px",
                                    borderBottom: "1px solid #f0f0f0",
                                    // プロンプトなど長い行が横にはみ出さないようにする
                                    whiteSpace: "pre-wrap",
                                    overflowWrap: "anywhere",
                                    color: log.level === "error" ? "red" : log.level === "warn" ? "orange" : "#333"
                                }}>
                                    <span style={{ color: "#888" }}>[{log.timestamp}]</span> [{log.level.toUpperCase()}] {log.message}
                                    {log.detail !== undefined && log.detail !== null && log.detail !== "" && (
                                        // 生成されたメッセージ本文はここに入る（detail.text）
                                        <div style={{
                                            marginTop: "2px",
                                            paddingLeft: "8px",
                                            borderLeft: "2px solid #ddd",
                                            color: "#666"
                                        }}>
                                            {typeof log.detail === "string" ? log.detail : JSON.stringify(log.detail)}
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div style={{ color: "#888" }}>ログはありません</div>
                        )}
                    </div>
                </>
            )}
        </section>
    )
}
