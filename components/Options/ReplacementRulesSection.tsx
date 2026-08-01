import React from "react"
import { Section } from "../Common/Section"
import { replacementRules as defaultRules } from "../../assets/replacement_rules"

export type ReplacementRule = { from: string; to: string }

interface ReplacementRulesSectionProps {
    enabled: boolean
    setEnabled: (val: boolean) => void
    rules: ReplacementRule[]
    setRules: (rules: ReplacementRule[]) => void
}

export const ReplacementRulesSection = ({ enabled, setEnabled, rules, setRules }: ReplacementRulesSectionProps) => {
    const handleChange = (index: number, field: "from" | "to", value: string) => {
        const updated = rules.map((rule, i) =>
            i === index ? { ...rule, [field]: value } : rule
        )
        setRules(updated)
    }

    const handleAdd = () => {
        setRules([...rules, { from: "", to: "" }])
    }

    const handleRemove = (index: number) => {
        setRules(rules.filter((_, i) => i !== index))
    }

    const handleReset = () => {
        if (window.confirm("現在の設定した禁止ワードが消えますがよろしいでしょうか？")) {
            setRules([...defaultRules])
        }
    }

    return (
        <Section title="">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ fontSize: "1.2rem", margin: 0 }}>4. 辞書（文字の置き換え）</h2>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <span style={{ fontSize: "0.85rem", color: "#666" }}>{enabled ? "有効" : "無効"}</span>
                    <div
                        onClick={() => setEnabled(!enabled)}
                        style={{
                            width: "44px", height: "24px", borderRadius: "12px",
                            backgroundColor: enabled ? "#007bff" : "#ccc",
                            position: "relative", transition: "background-color 0.2s", cursor: "pointer",
                        }}
                    >
                        <div style={{
                            width: "20px", height: "20px", borderRadius: "50%",
                            backgroundColor: "#fff", position: "absolute", top: "2px",
                            left: enabled ? "22px" : "2px", transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }} />
                    </div>
                </label>
            </div>
            {enabled ? (
                <>
                    <p style={{ fontSize: "0.85rem", color: "#666", margin: "0 0 12px" }}>
                        AIに送信するプロンプト内の対象ワードを置き換えワードに自動変換します。置き換えワードを空にすると削除されます。
                    </p>
                    <p style={{ fontSize: "0.8rem", color: "#e67e22", margin: "0 0 12px", padding: "8px 10px", backgroundColor: "#fff8e1", border: "1px solid #ffe0b2", borderRadius: "4px", lineHeight: "1.5" }}>
                        ※ 相手または自身のプロフィールに露骨な単語が含まれていると、AIの安全フィルターによりメッセージが生成できない場合があります。該当する単語をここに登録して別の表現に置き換えることで回避できます。
                    </p>

                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "0.8rem", color: "#999", fontWeight: "bold" }}>
                        <div style={{ flex: 1 }}>対象ワード</div>
                        <div style={{ width: "16px" }} />
                        <div style={{ flex: 1 }}>置き換えワード</div>
                        <div style={{ width: "32px" }} />
                    </div>

                    <div style={{ maxHeight: "400px", overflowY: "auto", marginBottom: "12px" }}>
                        {rules.map((rule, index) => (
                            <div key={index} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                                <input
                                    type="text"
                                    value={rule.from}
                                    onChange={(e) => handleChange(index, "from", e.target.value)}
                                    placeholder="対象ワード"
                                    style={{
                                        flex: 1, padding: "8px", borderRadius: "4px",
                                        border: "1px solid #ccc", outline: "none", fontSize: "0.9rem",
                                    }}
                                />
                                <span style={{ color: "#999", fontSize: "0.9rem" }}>/</span>
                                <input
                                    type="text"
                                    value={rule.to}
                                    onChange={(e) => handleChange(index, "to", e.target.value)}
                                    placeholder="置き換えワード"
                                    style={{
                                        flex: 1, padding: "8px", borderRadius: "4px",
                                        border: "1px solid #ccc", outline: "none", fontSize: "0.9rem",
                                    }}
                                />
                                <button
                                    onClick={() => handleRemove(index)}
                                    title="削除"
                                    style={{
                                        width: "32px", height: "32px", padding: 0,
                                        backgroundColor: "transparent", border: "1px solid #ddd",
                                        borderRadius: "4px", cursor: "pointer", fontSize: "1rem",
                                        color: "#999", lineHeight: "32px", textAlign: "center",
                                    }}
                                >
                                    x
                                </button>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={handleAdd}
                            style={{
                                flex: 1, padding: "8px", backgroundColor: "#007bff", color: "#fff",
                                border: "none", borderRadius: "4px", cursor: "pointer",
                                fontSize: "0.9rem", fontWeight: "bold",
                            }}
                        >
                            + ルールを追加
                        </button>
                        <button
                            onClick={handleReset}
                            style={{
                                padding: "8px 16px", backgroundColor: "#fff", color: "#ff4d4f",
                                border: "1px solid #ff4d4f", borderRadius: "4px", cursor: "pointer",
                                fontSize: "0.9rem", fontWeight: "bold",
                            }}
                        >
                            初期化
                        </button>
                    </div>
                </>
            ) : (
                <p style={{ margin: "0", fontSize: "0.85rem", color: "#999" }}>
                    無効時は置き換えルールを適用せず、プロンプトをそのままAIに送信します。
                </p>
            )}
        </Section>
    )
}
