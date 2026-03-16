import React, { useState, useEffect } from "react"
import { GEMINI_MODELS, OPENAI_MODELS } from "../../constants"

interface ApiConfigSectionProps {
    aiProvider: string
    geminiApiKey: string
    setGeminiApiKey: (val: string) => void
    geminiModel: string
    setGeminiModel: (val: string) => void
    geminiModelList: string[]
    setGeminiModelList: (val: string[]) => void
    openaiApiKey: string
    setOpenaiApiKey: (val: string) => void
    openaiModel: string
    setOpenaiModel: (val: string) => void
    openaiModelList: string[]
    setOpenaiModelList: (val: string[]) => void
    testResults: any
    onRunApiTest: (provider: "gemini" | "openai", apiKey: string) => void
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    )
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `API Error (${res.status})`)
    }
    const data = await res.json()
    return data.models
        .filter((m: any) =>
            m.supportedGenerationMethods?.includes("generateContent") &&
            m.name.startsWith("models/gemini-")
        )
        .map((m: any) => m.name.replace("models/", ""))
        .sort()
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
    const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `API Error (${res.status})`)
    }
    const data = await res.json()
    return data.data
        .map((m: any) => m.id)
        .filter((id: string) => /^(gpt-|o[1-9]|chatgpt-)/.test(id))
        .sort()
}

export const ApiConfigSection = ({
    aiProvider,
    geminiApiKey,
    setGeminiApiKey,
    geminiModel,
    setGeminiModel,
    geminiModelList,
    setGeminiModelList,
    openaiApiKey,
    setOpenaiApiKey,
    openaiModel,
    setOpenaiModel,
    openaiModelList,
    setOpenaiModelList,
    testResults,
    onRunApiTest
}: ApiConfigSectionProps) => {
    const [geminiKeyInput, setGeminiKeyInput] = useState(geminiApiKey)
    const [openaiKeyInput, setOpenaiKeyInput] = useState(openaiApiKey)
    const [saveStatus, setSaveStatus] = useState<Record<string, { loading: boolean; error?: string; success?: boolean }>>({})

    useEffect(() => { setGeminiKeyInput(geminiApiKey) }, [geminiApiKey])
    useEffect(() => { setOpenaiKeyInput(openaiApiKey) }, [openaiApiKey])

    const handleSaveKey = async (provider: "gemini" | "openai") => {
        const key = provider === "gemini" ? geminiKeyInput : openaiKeyInput
        if (!key) {
            setSaveStatus(prev => ({ ...prev, [provider]: { loading: false, error: "APIキーを入力してください" } }))
            return
        }

        setSaveStatus(prev => ({ ...prev, [provider]: { loading: true } }))
        try {
            const models = provider === "gemini"
                ? await fetchGeminiModels(key)
                : await fetchOpenAIModels(key)

            if (provider === "gemini") {
                setGeminiApiKey(key)
                setGeminiModelList(models)
            } else {
                setOpenaiApiKey(key)
                setOpenaiModelList(models)
            }
            setSaveStatus(prev => ({ ...prev, [provider]: { loading: false, success: true } }))
            setTimeout(() => {
                setSaveStatus(prev => {
                    const current = prev[provider]
                    if (current?.success) return { ...prev, [provider]: { loading: false } }
                    return prev
                })
            }, 3000)
        } catch (e: any) {
            setSaveStatus(prev => ({ ...prev, [provider]: { loading: false, error: e.message } }))
        }
    }

    const geminiModels = geminiModelList?.length > 0 ? geminiModelList : GEMINI_MODELS
    const openaiModels = openaiModelList?.length > 0 ? openaiModelList : OPENAI_MODELS

    return (
        <section style={{ marginBottom: "30px" }}>
            <h2 style={{ fontSize: "1.2rem" }}>2. API設定</h2>

            {/* Gemini Settings */}
            <div style={{
                marginBottom: "20px",
                padding: "20px",
                border: `2px solid ${testResults["gemini"]?.error ? "#ff4d4f" : (testResults["gemini"]?.result ? "#52c41a" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "gemini" ? 1 : 0.7,
                backgroundColor: aiProvider === "gemini" ? "#fff" : "#fafafa",
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
                    <div style={{ display: "flex", gap: "8px" }}>
                        <input
                            type="password"
                            value={geminiKeyInput}
                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                            placeholder="AIza..."
                            style={{ flex: 1, padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                        />
                        <button
                            onClick={() => handleSaveKey("gemini")}
                            disabled={saveStatus["gemini"]?.loading}
                            style={{
                                padding: "10px 20px",
                                backgroundColor: saveStatus["gemini"]?.loading ? "#ccc" : "#007bff",
                                color: "#fff", border: "none", borderRadius: "6px",
                                cursor: saveStatus["gemini"]?.loading ? "not-allowed" : "pointer",
                                fontSize: "0.9rem", fontWeight: "bold", whiteSpace: "nowrap",
                            }}
                        >
                            {saveStatus["gemini"]?.loading ? "検証中..." : (geminiApiKey ? "更新" : "保存")}
                        </button>
                    </div>
                    {saveStatus["gemini"]?.error && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem" }}>
                            ⚠️ {saveStatus["gemini"].error}
                        </div>
                    )}
                    {saveStatus["gemini"]?.success && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: "4px", color: "#52c41a", fontSize: "0.85rem" }}>
                            ✨ APIキーを保存し、モデル一覧を更新しました ({geminiModels.length}件)
                        </div>
                    )}
                </div>
                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
                    <select
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#fff" }}
                    >
                        {geminiModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div>
                    <button
                        onClick={() => onRunApiTest("gemini", geminiKeyInput)}
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
                opacity: aiProvider === "openai" ? 1 : 0.7,
                backgroundColor: aiProvider === "openai" ? "#fff" : "#fafafa",
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
                    <div style={{ display: "flex", gap: "8px" }}>
                        <input
                            type="password"
                            value={openaiKeyInput}
                            onChange={(e) => setOpenaiKeyInput(e.target.value)}
                            placeholder="sk-..."
                            style={{ flex: 1, padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                        />
                        <button
                            onClick={() => handleSaveKey("openai")}
                            disabled={saveStatus["openai"]?.loading}
                            style={{
                                padding: "10px 20px",
                                backgroundColor: saveStatus["openai"]?.loading ? "#ccc" : "#10a37f",
                                color: "#fff", border: "none", borderRadius: "6px",
                                cursor: saveStatus["openai"]?.loading ? "not-allowed" : "pointer",
                                fontSize: "0.9rem", fontWeight: "bold", whiteSpace: "nowrap",
                            }}
                        >
                            {saveStatus["openai"]?.loading ? "検証中..." : (openaiApiKey ? "更新" : "保存")}
                        </button>
                    </div>
                    {saveStatus["openai"]?.error && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem" }}>
                            ⚠️ {saveStatus["openai"].error}
                        </div>
                    )}
                    {saveStatus["openai"]?.success && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: "4px", color: "#10a37f", fontSize: "0.85rem" }}>
                            ✨ APIキーを保存し、モデル一覧を更新しました ({openaiModels.length}件)
                        </div>
                    )}
                </div>
                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
                    <select
                        value={openaiModel}
                        onChange={(e) => setOpenaiModel(e.target.value)}
                        style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#fff" }}
                    >
                        {openaiModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div>
                    <button
                        onClick={() => onRunApiTest("openai", openaiKeyInput)}
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
