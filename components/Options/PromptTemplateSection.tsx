import React from "react"

interface PromptTemplateSectionProps {
    promptTemplate: string
    setPromptTemplate: (val: string) => void
    onReset: () => void
}

export const PromptTemplateSection = ({
    promptTemplate,
    setPromptTemplate,
    onReset
}: PromptTemplateSectionProps) => {
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
            <div style={{ fontSize: "0.85em", color: "#666", marginBottom: "10px" }}>
                以下の変数は自動的に置換されます:<br />
                <code style={{ background: "#eee", padding: "2px 4px" }}>{`{my_info_clean}`}</code> : 自分のプロフィール<br />
                <code style={{ background: "#eee", padding: "2px 4px" }}>{`{target_info_clean}`}</code> : 相手のプロフィール
            </div>
            <textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                rows={12}
                style={{ width: "100%", padding: "10px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: "1.4" }}
            />
        </section>
    )
}
