import React from "react"
import { Section } from "../Common/Section"

interface AiProviderSectionProps {
    aiProvider: string
    setAiProvider: (value: string) => void
    testResults: any
    isGeminiReady: boolean
    isOpenAIReady: boolean
}

export const AiProviderSection = ({
    aiProvider,
    setAiProvider,
    testResults,
    isGeminiReady,
    isOpenAIReady
}: AiProviderSectionProps) => {
    return (
        <Section title="1. 使用するAIを選択">
            <div style={{ display: "flex", gap: "20px" }}>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                    <input
                        type="radio"
                        name="provider"
                        value="gemini"
                        checked={aiProvider === "gemini"}
                        onChange={(e) => setAiProvider(e.target.value)}
                        style={{ marginRight: "8px" }}
                    />
                    <span style={{ fontWeight: aiProvider === "gemini" ? "bold" : "normal" }}>Google Gemini</span>
                    {testResults["gemini"]?.result && (
                        <span style={{ marginLeft: "8px", color: "#52c41a", fontSize: "1.1rem", border: "1.5px solid #52c41a", borderRadius: "50%", width: "16px", height: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
                            ✓
                        </span>
                    )}
                    {isGeminiReady && !testResults["gemini"]?.result && <span style={{ marginLeft: "5px", color: "green", fontSize: "0.8em" }}>● 設定済</span>}
                </label>

                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                    <input
                        type="radio"
                        name="provider"
                        value="openai"
                        checked={aiProvider === "openai"}
                        onChange={(e) => setAiProvider(e.target.value)}
                        style={{ marginRight: "8px" }}
                    />
                    <span style={{ fontWeight: aiProvider === "openai" ? "bold" : "normal" }}>OpenAI (GPT-4)</span>
                    {testResults["openai"]?.result && (
                        <span style={{ marginLeft: "8px", color: "#10a37f", fontSize: "1.1rem", border: "1.5px solid #10a37f", borderRadius: "50%", width: "16px", height: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
                            ✓
                        </span>
                    )}
                    {isOpenAIReady && !testResults["openai"]?.result && <span style={{ marginLeft: "5px", color: "green", fontSize: "0.8em" }}>● 設定済</span>}
                </label>
            </div>
        </Section>
    )
}
