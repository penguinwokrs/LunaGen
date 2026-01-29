import React from "react"

interface PromptTemplateSectionProps {
    promptTemplate: string
    setPromptTemplate: (val: string) => void
    continuousPromptTemplate: string
    setContinuousPromptTemplate: (val: string) => void
    onReset: () => void
}

export const PromptTemplateSection = ({
    promptTemplate,
    setPromptTemplate,
    continuousPromptTemplate,
    setContinuousPromptTemplate,
    onReset
}: PromptTemplateSectionProps) => {
    const [activeTab, setActiveTab] = React.useState<"initial" | "continuous">("initial")
    return (
        <section style={{ marginBottom: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "1.2rem" }}>3. プロンプトテンプレート</h2>
                <button
                    onClick={onReset}
                    style={{
                        padding: "4px 8px",
                        backgroundColor: "#f8f9fa",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        color: "#666"
                    }}
                >
                    デフォルトに戻す
                </button>
            </div>
            
            <div style={{ marginBottom: "10px", display: "flex", gap: "10px" }}>
                <button
                    onClick={() => setActiveTab("initial")}
                    style={{
                        padding: "8px 16px",
                        backgroundColor: activeTab === "initial" ? "#e91e63" : "#f0f0f0",
                        color: activeTab === "initial" ? "white" : "#333",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontWeight: "bold"
                    }}
                >
                    初回メッセージ用
                </button>
                <button
                    onClick={() => setActiveTab("continuous")}
                    style={{
                        padding: "8px 16px",
                        backgroundColor: activeTab === "continuous" ? "#e91e63" : "#f0f0f0",
                        color: activeTab === "continuous" ? "white" : "#333",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontWeight: "bold"
                    }}
                >
                    会話継続用 (2通目以降)
                </button>
            </div>

            <div style={{ fontSize: "0.85em", color: "#666", marginBottom: "10px" }}>
                以下の変数は自動的に置換されます:<br />
                <code style={{ background: "#eee", padding: "2px 4px" }}>{`{my_info_clean}`}</code> : 自分のプロフィール<br />
                <code style={{ background: "#eee", padding: "2px 4px" }}>{`{target_info_clean}`}</code> : 相手のプロフィール
                {activeTab === "continuous" && (
                    <>
                        <br /><code style={{ background: "#eee", padding: "2px 4px" }}>{`{chat_history}`}</code> : 会話履歴
                    </>
                )}
            </div>

            {activeTab === "initial" ? (
                <textarea
                    value={promptTemplate}
                    onChange={(e) => setPromptTemplate(e.target.value)}
                    rows={12}
                    style={{ width: "100%", padding: "10px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: "1.4" }}
                />
            ) : (
                <textarea
                    value={continuousPromptTemplate}
                    onChange={(e) => setContinuousPromptTemplate(e.target.value)}
                    rows={12}
                    style={{ width: "100%", padding: "10px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: "1.4" }}
                />
            )}
        </section>
    )
}
