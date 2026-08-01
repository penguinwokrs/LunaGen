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
    const [resetKey, setResetKey] = React.useState(0)
    return (
        <section style={{ marginBottom: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "1.2rem" }}>3. プロンプトテンプレート</h2>
                <button
                    onClick={() => {
                        onReset()
                        setResetKey(prev => prev + 1)
                    }}
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
            <details style={{ fontSize: "0.8em", color: "#888", marginBottom: "10px" }}>
                <summary style={{ cursor: "pointer", color: "#e91e63" }}>
                    プロフィール変数に含まれる情報
                </summary>
                <div style={{ marginTop: "6px", padding: "8px 12px", background: "#f9f9f9", borderRadius: "4px", lineHeight: "1.6" }}>
                    自分・相手のプロフィールには、APIから取得した以下の情報が含まれます:
                    <ul style={{ margin: "6px 0", paddingLeft: "20px" }}>
                        <li><strong>基本情報</strong> — 名前、年齢、性別、居住地、目的、職業</li>
                        <li><strong>自己紹介</strong> — プロフィール本文</li>
                        <li><strong>嗜好・プレイスタイル</strong> — 好みやスタイルのフリーテキスト</li>
                        <li><strong>求める条件</strong> — 相手に求める条件</li>
                        <li><strong>NGなこと・拒否</strong> — 拒否事項</li>
                        <li><strong>嗜好分析</strong> — タイプ傾向・嗜好スコア・強い傾向（q_*値から自動算出）</li>
                    </ul>
                    さらに自分と相手のプロフィールから、<strong>「プロフィール項目の突き合わせ」（関係目的・役割・生活条件・嗜好の4軸で、双方向に噛み合う点を強い順に抽出し、「話題になりうる噛み合い」と「前提条件（話題にしない土台）」に分けて整理）</strong>がプロンプトに自動注入されます。
                </div>
            </details>

            {activeTab === "initial" ? (
                <textarea
                    key={`initial-${resetKey}`}
                    defaultValue={promptTemplate}
                    onChange={(e) => setPromptTemplate(e.target.value)}
                    rows={12}
                    style={{ width: "100%", padding: "10px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: "1.4" }}
                />
            ) : (
                <textarea
                    key={`continuous-${resetKey}`}
                    defaultValue={continuousPromptTemplate}
                    onChange={(e) => setContinuousPromptTemplate(e.target.value)}
                    rows={12}
                    style={{ width: "100%", padding: "10px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: "1.4" }}
                />
            )}
        </section>
    )
}
