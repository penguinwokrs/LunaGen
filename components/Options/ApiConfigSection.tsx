import React, { useState, useEffect, useRef } from "react"
import { GEMINI_MODELS, OPENAI_MODELS, OLLAMA_DEFAULT_HOST, OLLAMA_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../../constants"

interface ApiConfigSectionProps {
    aiProvider: string
    setAiProvider: (val: string) => void
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
    ollamaHost: string
    setOllamaHost: (val: string) => void
    ollamaPort: string
    setOllamaPort: (val: string) => void
    ollamaModel: string
    setOllamaModel: (val: string) => void
    ollamaModelList: string[]
    setOllamaModelList: (val: string[]) => void
    testResults: any
    onRunApiTest: (provider: "gemini" | "openai" | "ollama", apiKey?: string) => void
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

async function fetchOllamaModels(host: string, port: string): Promise<string[]> {
    const res = await fetch(`http://${host}:${port}/v1/models`)
    if (!res.ok) {
        throw new Error(`Ollama接続エラー (${res.status})。Ollamaが起動しているか確認してください。`)
    }
    const data = await res.json()
    return (data.data || []).map((m: any) => m.id).sort()
}

const ActiveBadge = () => (
    <span style={{
        padding: "3px 10px", fontSize: "0.75rem", fontWeight: "bold",
        color: "#fff", backgroundColor: "#e91e63", borderRadius: "12px",
    }}>
        使用中
    </span>
)

const UseButton = ({ onClick }: { onClick: () => void }) => (
    <button
        onClick={onClick}
        style={{
            padding: "3px 10px", fontSize: "0.75rem", fontWeight: "bold",
            color: "#e91e63", backgroundColor: "transparent",
            border: "1.5px solid #e91e63", borderRadius: "12px",
            cursor: "pointer",
        }}
    >
        使用する
    </button>
)

export const ApiConfigSection = ({
    aiProvider,
    setAiProvider,
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
    ollamaHost,
    setOllamaHost,
    ollamaPort,
    setOllamaPort,
    ollamaModel,
    setOllamaModel,
    ollamaModelList,
    setOllamaModelList,
    testResults,
    onRunApiTest
}: ApiConfigSectionProps) => {
    const [geminiKeyInput, setGeminiKeyInput] = useState(geminiApiKey)
    const [openaiKeyInput, setOpenaiKeyInput] = useState(openaiApiKey)
    const [ollamaHostInput, setOllamaHostInput] = useState(ollamaHost || OLLAMA_DEFAULT_HOST)
    const [ollamaPortInput, setOllamaPortInput] = useState(ollamaPort || OLLAMA_DEFAULT_PORT)
    const [saveStatus, setSaveStatus] = useState<Record<string, { loading: boolean; error?: string; success?: boolean }>>({})
    const prevAiProvider = useRef(aiProvider)

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

    const refreshOllamaModels = async () => {
        const h = ollamaHostInput || OLLAMA_DEFAULT_HOST
        const p = ollamaPortInput || OLLAMA_DEFAULT_PORT
        setSaveStatus(prev => ({ ...prev, ollama: { loading: true } }))
        try {
            const models = await fetchOllamaModels(h, p)
            if (models.length === 0) {
                throw new Error("モデルが見つかりません。Ollamaにモデルをpullしてください。")
            }
            setOllamaHost(h)
            setOllamaPort(p)
            setOllamaModelList(models)
            if (!ollamaModel || !models.includes(ollamaModel)) {
                setOllamaModel(models.includes(OLLAMA_DEFAULT_MODEL) ? OLLAMA_DEFAULT_MODEL : models[0])
            }
            setSaveStatus(prev => ({ ...prev, ollama: { loading: false, success: true } }))
            setTimeout(() => {
                setSaveStatus(prev => {
                    const current = prev.ollama
                    if (current?.success) return { ...prev, ollama: { loading: false } }
                    return prev
                })
            }, 3000)
        } catch (e: any) {
            setSaveStatus(prev => ({ ...prev, ollama: { loading: false, error: e.message } }))
        }
    }

    useEffect(() => { setGeminiKeyInput(geminiApiKey) }, [geminiApiKey])
    useEffect(() => { setOpenaiKeyInput(openaiApiKey) }, [openaiApiKey])
    useEffect(() => { setOllamaHostInput(ollamaHost || OLLAMA_DEFAULT_HOST) }, [ollamaHost])
    useEffect(() => { setOllamaPortInput(ollamaPort || OLLAMA_DEFAULT_PORT) }, [ollamaPort])

    // ollama選択時に自動でモデル一覧を取得
    useEffect(() => {
        if (aiProvider === "ollama" && prevAiProvider.current !== "ollama") {
            refreshOllamaModels()
        }
        prevAiProvider.current = aiProvider
    }, [aiProvider])

    const geminiModels = geminiModelList?.length > 0 ? geminiModelList : GEMINI_MODELS
    const openaiModels = openaiModelList?.length > 0 ? openaiModelList : OPENAI_MODELS
    const ollamaModels = ollamaModelList?.length > 0 ? ollamaModelList : []

    return (
        <section style={{ marginBottom: "30px" }}>
            <h2 style={{ fontSize: "1.2rem" }}>1. AIプロバイダー設定</h2>

            {/* Gemini Settings */}
            <div style={{
                marginBottom: "20px",
                padding: "20px",
                border: `2px solid ${aiProvider === "gemini" ? "#e91e63" : (testResults["gemini"]?.error ? "#ff4d4f" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "gemini" ? 1 : 0.6,
                backgroundColor: aiProvider === "gemini" ? "#fff" : "#fafafa",
                transition: "all 0.3s ease",
                boxShadow: aiProvider === "gemini" ? "0 0 8px rgba(233, 30, 99, 0.15)" : "none"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#444" }}>Google Gemini</h3>
                        {testResults["gemini"]?.result && <span style={{ color: "#52c41a", fontSize: "0.8rem", fontWeight: "bold" }}>● Connected</span>}
                        {testResults["gemini"]?.error && <span style={{ color: "#ff4d4f", fontSize: "0.8rem", fontWeight: "bold" }}>● Error</span>}
                    </div>
                    {aiProvider === "gemini" ? <ActiveBadge /> : <UseButton onClick={() => setAiProvider("gemini")} />}
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
                border: `2px solid ${aiProvider === "openai" ? "#e91e63" : (testResults["openai"]?.error ? "#ff4d4f" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "openai" ? 1 : 0.6,
                backgroundColor: aiProvider === "openai" ? "#fff" : "#fafafa",
                transition: "all 0.3s ease",
                boxShadow: aiProvider === "openai" ? "0 0 8px rgba(233, 30, 99, 0.15)" : "none"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#444" }}>OpenAI</h3>
                        {testResults["openai"]?.result && <span style={{ color: "#10a37f", fontSize: "0.8rem", fontWeight: "bold" }}>● Connected</span>}
                        {testResults["openai"]?.error && <span style={{ color: "#ff4d4f", fontSize: "0.8rem", fontWeight: "bold" }}>● Error</span>}
                    </div>
                    {aiProvider === "openai" ? <ActiveBadge /> : <UseButton onClick={() => setAiProvider("openai")} />}
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

            {/* Ollama Settings */}
            <div style={{
                marginBottom: "20px",
                padding: "20px",
                border: `2px solid ${aiProvider === "ollama" ? "#e91e63" : (testResults["ollama"]?.error ? "#ff4d4f" : "#ddd")}`,
                borderRadius: "12px",
                opacity: aiProvider === "ollama" ? 1 : 0.6,
                backgroundColor: aiProvider === "ollama" ? "#fff" : "#fafafa",
                transition: "all 0.3s ease",
                boxShadow: aiProvider === "ollama" ? "0 0 8px rgba(233, 30, 99, 0.15)" : "none"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#444" }}>Ollama (ローカルLLM)</h3>
                        {testResults["ollama"]?.result && <span style={{ color: "#ff6b00", fontSize: "0.8rem", fontWeight: "bold" }}>● Connected</span>}
                        {testResults["ollama"]?.error && <span style={{ color: "#ff4d4f", fontSize: "0.8rem", fontWeight: "bold" }}>● Error</span>}
                    </div>
                    {aiProvider === "ollama" ? <ActiveBadge /> : <UseButton onClick={() => setAiProvider("ollama")} />}
                </div>

                <div style={{ marginBottom: "15px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>接続先</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ fontSize: "0.9rem", color: "#888", whiteSpace: "nowrap" }}>http://</span>
                        <input
                            type="text"
                            value={ollamaHostInput}
                            onChange={(e) => setOllamaHostInput(e.target.value)}
                            placeholder={OLLAMA_DEFAULT_HOST}
                            style={{ flex: 1, padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                        />
                        <span style={{ fontSize: "0.9rem", color: "#888" }}>:</span>
                        <input
                            type="text"
                            value={ollamaPortInput}
                            onChange={(e) => setOllamaPortInput(e.target.value.replace(/\D/g, ""))}
                            placeholder={OLLAMA_DEFAULT_PORT}
                            style={{ width: "80px", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", outline: "none", textAlign: "center" }}
                        />
                    </div>
                    {saveStatus["ollama"]?.error && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem" }}>
                            ⚠️ {saveStatus["ollama"].error}
                        </div>
                    )}
                    {saveStatus["ollama"]?.success && (
                        <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#fff7e6", border: "1px solid #ffd591", borderRadius: "4px", color: "#ff6b00", fontSize: "0.85rem" }}>
                            ✨ 接続成功！モデル一覧を取得しました ({ollamaModels.length}件)
                        </div>
                    )}
                </div>
                <div style={{ marginBottom: "15px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                        <label style={{ fontSize: "0.9rem", color: "#666" }}>モデル</label>
                        <button
                            onClick={refreshOllamaModels}
                            disabled={saveStatus["ollama"]?.loading}
                            style={{
                                padding: "4px 12px", fontSize: "0.8rem",
                                backgroundColor: "transparent", color: "#ff6b00",
                                border: "1px solid #ff6b00", borderRadius: "4px",
                                cursor: saveStatus["ollama"]?.loading ? "not-allowed" : "pointer",
                                opacity: saveStatus["ollama"]?.loading ? 0.5 : 1,
                            }}
                        >
                            {saveStatus["ollama"]?.loading ? "取得中..." : "モデル一覧を更新"}
                        </button>
                    </div>
                    {ollamaModels.length > 0 ? (
                        <select
                            value={ollamaModel}
                            onChange={(e) => setOllamaModel(e.target.value)}
                            style={{ width: "100%", padding: "10px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#fff" }}
                        >
                            {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    ) : (
                        <div style={{ padding: "10px", borderRadius: "6px", border: "1px dashed #ccc", backgroundColor: "#fafafa", color: "#999", fontSize: "0.85rem", textAlign: "center" }}>
                            {saveStatus["ollama"]?.loading ? "モデル一覧を取得中..." : "モデル一覧なし — 「モデル一覧を更新」ボタンで取得してください"}
                        </div>
                    )}
                </div>

                <div>
                    <button
                        onClick={() => onRunApiTest("ollama")}
                        disabled={testResults["ollama"]?.loading || ollamaModels.length === 0}
                        style={{
                            width: "100%", padding: "10px",
                            backgroundColor: (testResults["ollama"]?.loading || ollamaModels.length === 0) ? "#ccc" : "#ff6b00",
                            color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem", fontWeight: "bold"
                        }}
                    >
                        {testResults["ollama"]?.loading ? "テスト通信中..." : "接続をテストする"}
                    </button>
                    {testResults["ollama"]?.error && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#fff2f0", border: "1px solid #ffccc7", borderRadius: "4px", color: "#ff4d4f", fontSize: "0.85rem", lineHeight: "1.4" }}>
                            <strong>⚠️ 使用不可:</strong> Ollamaに接続できません。サーバーが起動しているか確認してください。
                            <div style={{ fontSize: "0.75rem", marginTop: "4px", opacity: 0.8 }}>({testResults["ollama"].error})</div>
                        </div>
                    )}
                    {testResults["ollama"]?.result && (
                        <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#fff7e6", border: "1px solid #ffd591", borderRadius: "4px", color: "#ff6b00", fontSize: "0.85rem" }}>
                            ✨ 正常にレスポンスを受信しました: "{testResults["ollama"].result.slice(0, 30)}..."
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
