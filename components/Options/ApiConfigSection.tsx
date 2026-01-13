import React from "react"
import { GEMINI_MODELS, OPENAI_MODELS } from "../../constants"

interface ApiConfigSectionProps {
    aiProvider: string
    geminiApiKey: string
    setGeminiApiKey: (val: string) => void
    geminiModel: string
    setGeminiModel: (val: string) => void
    openaiApiKey: string
    setOpenaiApiKey: (val: string) => void
    openaiModel: string
    setOpenaiModel: (val: string) => void
    testResults: any
    onRunApiTest: (provider: "gemini" | "openai") => void
}

export const ApiConfigSection = ({
    aiProvider,
    geminiApiKey,
    setGeminiApiKey,
    geminiModel,
    setGeminiModel,
    openaiApiKey,
    setOpenaiApiKey,
    openaiModel,
    setOpenaiModel,
    testResults,
    onRunApiTest
}: ApiConfigSectionProps) => {
    return (
        <section style={{ marginBottom: "30px" }}>
            <h2 style={{ fontSize: "1.2rem" }}>2. API設定</h2>

            {/* Gemini Settings */}
            <div style={{
                marginBottom: "20px",
                padding: "20px",
                border: `2px solid ${testResults["gemini"]?.error ? "#ff4d4f" : (testResults["gemini"]?.result ? "#52c41a" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "gemini" ? 1 : 0.6,
                pointerEvents: aiProvider === "gemini" ? "auto" : "none",
                backgroundColor: aiProvider === "gemini" ? "#fff" : "#f5f5f5",
                transition: "all 0.3s ease",
                boxShadow: testResults["gemini"]?.error ? "0 0 10px rgba(255, 77, 79, 0.2)" : "none"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#444" }}>Google Gemini 設定</h3>
                    {testResults["gemini"]?.result && <span style={{ color: "#52c41a", fontSize: "0.8rem", fontWeight: "bold" }}>● Connected</span>}
                    {testResults["gemini"]?.error && <span style={{ color: "#ff4d4f", fontSize: "0.8rem", fontWeight: "bold" }}>● API Error</span>}
                </div>

                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>API Key</label>
                    <input
                        type="password"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AIza..."
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                    />
                </div>
                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
                    <select
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#fff" }}
                    >
                        {GEMINI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div>
                    <button
                        onClick={() => onRunApiTest("gemini")}
                        disabled={testResults["gemini"]?.loading}
                        style={{
                            width: "100%", padding: "10px",
                            backgroundColor: testResults["gemini"]?.loading ? "#ccc" : "#007bff",
                            color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem", fontWeight: "bold"
                        }}
                    >
                        {testResults["gemini"]?.loading ? "テスト通信中..." : "接続をテストする"}
                    </button>
                    {testResults["gemini"]?.error && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem", lineHeight: "1.4" }}>
                            <strong>⚠️ 使用不可:</strong> このモデルは使用できません。APIにクォータ制限がかかっているか、キーが無効な可能性があります。
                            <div style={{ fontSize: "0.75rem", marginTop: "4px", opacity: 0.8 }}>({testResults["gemini"].error})</div>
                        </div>
                    )}
                    {testResults["gemini"]?.result && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: "4px", color: "#52c41a", fontSize: "0.85rem" }}>
                            ✨ 正常にレスポンスを受信しました: "{testResults["gemini"].result.slice(0, 30)}..."
                        </div>
                    )}
                </div>
            </div>

            {/* OpenAI Settings */}
            <div style={{
                marginBottom: "20px",
                padding: "20px",
                border: `2px solid ${testResults["openai"]?.error ? "#ff4d4f" : (testResults["openai"]?.result ? "#10a37f" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "openai" ? 1 : 0.6,
                pointerEvents: aiProvider === "openai" ? "auto" : "none",
                backgroundColor: aiProvider === "openai" ? "#fff" : "#f5f5f5",
                transition: "all 0.3s ease",
                boxShadow: testResults["openai"]?.error ? "0 0 10px rgba(255, 77, 79, 0.2)" : "none"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#444" }}>OpenAI 設定</h3>
                    {testResults["openai"]?.result && <span style={{ color: "#10a37f", fontSize: "0.8rem", fontWeight: "bold" }}>● Connected</span>}
                    {testResults["openai"]?.error && <span style={{ color: "#ff4d4f", fontSize: "0.8rem", fontWeight: "bold" }}>● API Error</span>}
                </div>

                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>API Key</label>
                    <input
                        type="password"
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-..."
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                    />
                </div>
                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
                    <select
                        value={openaiModel}
                        onChange={(e) => setOpenaiModel(e.target.value)}
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#fff" }}
                    >
                        {OPENAI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div>
                    <button
                        onClick={() => onRunApiTest("openai")}
                        disabled={testResults["openai"]?.loading}
                        style={{
                            width: "100%", padding: "10px",
                            backgroundColor: testResults["openai"]?.loading ? "#ccc" : "#10a37f",
                            color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem", fontWeight: "bold"
                        }}
                    >
                        {testResults["openai"]?.loading ? "テスト通信中..." : "接続をテストする"}
                    </button>
                    {testResults["openai"]?.error && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem", lineHeight: "1.4" }}>
                            <strong>⚠️ 使用不可:</strong> このモデルは使用できません。APIにクォータ制限がかかっているか、キーが無効な可能性があります。
                            <div style={{ fontSize: "0.75rem", marginTop: "4px", opacity: 0.8 }}>({testResults["openai"].error})</div>
                        </div>
                    )}
                    {testResults["openai"]?.result && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: "4px", color: "#10a37f", fontSize: "0.85rem" }}>
                            ✨ 正常にレスポンスを受信しました: "{testResults["openai"].result.slice(0, 30)}..."
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
