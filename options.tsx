import { useState } from "react"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"

import { ApiConfigSection } from "./components/Options/ApiConfigSection"
import { DebugLogsSection } from "./components/Options/DebugLogsSection"
import { MyProfileSection } from "./components/Options/MyProfileSection"
import { PromptTemplateSection } from "./components/Options/PromptTemplateSection"
import { ReplacementRulesSection, type ReplacementRule } from "./components/Options/ReplacementRulesSection"
import { TonePresetSection } from "./components/Options/TonePresetSection"
import { replacementRules as defaultReplacementRules } from "./assets/replacement_rules"
import { DEFAULT_PROMPT, CONTINUOUS_CONVERSATION_PROMPT, OLLAMA_DEFAULT_HOST, OLLAMA_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL, DEFAULT_TONE_PRESETS } from "./constants"
import { extractProfileFromJSON } from "./utils/profile"
import { NO_TONE, type TonePreset } from "./utils/tone"

const storage = new Storage({ area: "local" })
const syncStorage = new Storage({ area: "sync" })

export default function Options() {
  const [aiProvider, setAiProvider] = useStorage({ key: "aiProvider", instance: storage }, "gemini")
  const [geminiApiKey, setGeminiApiKey] = useStorage({ key: "geminiApiKey", instance: syncStorage }, "")
  // background.ts の既定値と揃える。gemini-1.5-flash は提供終了(404)のため既定にしない。
  // 2026-08-02: 2.5-flash から 3.5-flash へ変更。2.5-flash は置換ルールの実API検証で
  // BLOCK_NONE 下では陽性対照すらブロックしないなど挙動が読めず、評価も 3.5-flash で行うため。
  const [geminiModel, setGeminiModel] = useStorage({ key: "geminiModel", instance: storage }, "gemini-3.5-flash")
  const [openaiApiKey, setOpenaiApiKey] = useStorage({ key: "openaiApiKey", instance: syncStorage }, "")
  const [openaiModel, setOpenaiModel] = useStorage({ key: "openaiModel", instance: storage }, "gpt-4o")
  const [geminiModelList, setGeminiModelList] = useStorage<string[]>({ key: "geminiModelList", instance: storage }, [])
  const [openaiModelList, setOpenaiModelList] = useStorage<string[]>({ key: "openaiModelList", instance: storage }, [])
  const [ollamaHost, setOllamaHost] = useStorage({ key: "ollamaHost", instance: storage }, OLLAMA_DEFAULT_HOST)
  const [ollamaPort, setOllamaPort] = useStorage({ key: "ollamaPort", instance: storage }, OLLAMA_DEFAULT_PORT)
  const [ollamaModel, setOllamaModel] = useStorage({ key: "ollamaModel", instance: storage }, OLLAMA_DEFAULT_MODEL)
  const [ollamaModelList, setOllamaModelList] = useStorage<string[]>({ key: "ollamaModelList", instance: storage }, [])
  const [promptTemplate, setPromptTemplate] = useStorage({ key: "promptTemplate", instance: storage }, DEFAULT_PROMPT)
  const [continuousPromptTemplate, setContinuousPromptTemplate] = useStorage({ key: "continuousPromptTemplate", instance: storage }, CONTINUOUS_CONVERSATION_PROMPT)
  const [myProfile, setMyProfile] = useStorage({ key: "myProfile", instance: storage }, "")
  const [myProfileUpdatedAt, setMyProfileUpdatedAt] = useStorage({ key: "myProfileUpdatedAt", instance: storage }, "")
  const [replacementRulesEnabled, setReplacementRulesEnabled] = useStorage({ key: "replacementRulesEnabled", instance: storage }, true)
  const [replacementRules, setReplacementRules] = useStorage<ReplacementRule[]>({ key: "replacementRules", instance: storage }, defaultReplacementRules as ReplacementRule[])
  const [tonePresets, setTonePresets] = useStorage<TonePreset[]>({ key: "tonePresets", instance: storage }, DEFAULT_TONE_PRESETS as TonePreset[])
  const [defaultToneId, setDefaultToneId] = useStorage({ key: "defaultToneId", instance: storage }, NO_TONE)
  const [isDebugEnabled, setIsDebugEnabled] = useStorage({ key: "isDebugEnabled", instance: storage }, process.env.NODE_ENV === "development")
  const [debugLogs, setDebugLogs] = useStorage<any[]>({ key: "debugLogs", instance: storage }, [])

  const [status, setStatus] = useState<{ message: string, type: "success" | "error" } | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)
  const [testResults, setTestResults] = useState<{ [key: string]: { loading: boolean, result?: string, error?: string } }>({})

  const addLocalLog = (level: string, message: string, detail?: any) => {
    if (!isDebugEnabled) return
    const newLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail: typeof detail === 'object' ? JSON.stringify(detail).substring(0, 1000) : detail
    }
    setDebugLogs((prev) => [newLog, ...(prev || [])].slice(0, 100))
  }

  const fetchMyProfile = async () => {
    setIsLoadingProfile(true)
    try {
      addLocalLog("info", "Checking auth status before profile update")
      const authRes = await fetch("https://luna-matching.com/api/user/is_auth")
      if (authRes.ok) {
        const authData = await authRes.json()
        if (authData.is_atuh === false) {
          throw new Error("Lunaにログインしていないようです。ログインしてから再度お試しください。")
        }
      }

      addLocalLog("info", "Manual profile update started from Options")
      const res = await fetch("https://luna-matching.com/api/user/get/me")
      if (!res.ok) throw new Error(`通信エラーが発生しました (Status: ${res.status})`)

      const data = await res.json()
      const userData = data.user || data
      const cleanText = extractProfileFromJSON(userData)

      if (!cleanText || cleanText.length < 10) throw new Error("プロフィール情報をうまく取得できませんでした。")

      setMyProfile(cleanText)
      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      setMyProfileUpdatedAt(dateStr)

      setStatus({ message: "プロフィールを更新しました！", type: "success" })
      setTimeout(() => setStatus(null), 2000)
    } catch (e: any) {
      setStatus({ message: e.message, type: "error" })
      setTimeout(() => setStatus(null), 3000)
    } finally {
      setIsLoadingProfile(false)
    }
  }

  const runApiTest = async (provider: "gemini" | "openai" | "ollama", apiKey?: string) => {
    if (provider === "ollama") {
      setTestResults(prev => ({ ...prev, ollama: { loading: true } }))
      try {
        const response: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "test_api", provider: "ollama", model: ollamaModel, baseURL: `http://${ollamaHost}:${ollamaPort}` }, resolve)
        })
        if (response.success) {
          setTestResults(prev => ({ ...prev, ollama: { loading: false, result: response.text } }))
        } else {
          setTestResults(prev => ({ ...prev, ollama: { loading: false, error: response.error } }))
        }
      } catch (e: any) {
        setTestResults(prev => ({ ...prev, ollama: { loading: false, error: e.message } }))
      }
      return
    }

    const key = apiKey || (provider === "gemini" ? geminiApiKey : openaiApiKey)
    const model = provider === "gemini" ? geminiModel : openaiModel

    if (!key) {
      alert("APIキーを入力してください")
      return
    }

    setTestResults(prev => ({ ...prev, [provider]: { loading: true } }))
    try {
      const response: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "test_api", provider, apiKey: key, model }, resolve)
      })
      if (response.success) {
        setTestResults(prev => ({ ...prev, [provider]: { loading: false, result: response.text } }))
      } else {
        setTestResults(prev => ({ ...prev, [provider]: { loading: false, error: response.error } }))
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [provider]: { loading: false, error: e.message } }))
    }
  }

  return (
    <div style={{ padding: "40px 20px 20px", maxWidth: "700px", margin: "0 auto", fontFamily: "sans-serif", color: "#333", position: "relative" }}>
      {status && (
        <div style={{
          position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
          padding: "12px 24px", backgroundColor: status.type === "error" ? "#ff4d4f" : "#28a745",
          color: "white", borderRadius: "30px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 10000, textAlign: "center", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px"
        }}>
          {status.type === "error" ? "⚠️" : "✨"} {status.message}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #e91e63", marginBottom: "20px" }}>
        <h1 style={{ paddingBottom: "10px", color: "#e91e63", margin: 0 }}>LunaGen 設定</h1>
        <a href="#debug-logs" style={{ fontSize: "0.9rem", color: "#666", textDecoration: "none", border: "1px solid #ccc", padding: "4px 8px", borderRadius: "4px" }}>
          🔍 ログを確認
        </a>
      </div>

      <MyProfileSection
        myProfile={myProfile}
        myProfileUpdatedAt={myProfileUpdatedAt}
        isLoadingProfile={isLoadingProfile}
        onFetchProfile={fetchMyProfile}
      />

      <ApiConfigSection
        aiProvider={aiProvider}
        setAiProvider={setAiProvider}
        geminiApiKey={geminiApiKey}
        setGeminiApiKey={setGeminiApiKey}
        geminiModel={geminiModel}
        setGeminiModel={setGeminiModel}
        geminiModelList={geminiModelList}
        setGeminiModelList={setGeminiModelList}
        openaiApiKey={openaiApiKey}
        setOpenaiApiKey={setOpenaiApiKey}
        openaiModel={openaiModel}
        setOpenaiModel={setOpenaiModel}
        openaiModelList={openaiModelList}
        setOpenaiModelList={setOpenaiModelList}
        ollamaHost={ollamaHost}
        setOllamaHost={setOllamaHost}
        ollamaPort={ollamaPort}
        setOllamaPort={setOllamaPort}
        ollamaModel={ollamaModel}
        setOllamaModel={setOllamaModel}
        ollamaModelList={ollamaModelList}
        setOllamaModelList={setOllamaModelList}
        testResults={testResults}
        onRunApiTest={runApiTest}
      />

      <PromptTemplateSection
        promptTemplate={promptTemplate}
        setPromptTemplate={setPromptTemplate}
        continuousPromptTemplate={continuousPromptTemplate}
        setContinuousPromptTemplate={setContinuousPromptTemplate}
        onReset={() => {
          setPromptTemplate(DEFAULT_PROMPT)
          setContinuousPromptTemplate(CONTINUOUS_CONVERSATION_PROMPT)
        }}
      />

      <TonePresetSection
        presets={tonePresets}
        setPresets={setTonePresets}
        defaultToneId={defaultToneId}
        setDefaultToneId={setDefaultToneId}
        onReset={() => {
          setTonePresets(DEFAULT_TONE_PRESETS as TonePreset[])
          setDefaultToneId(NO_TONE)
        }}
      />

      <ReplacementRulesSection
        enabled={replacementRulesEnabled}
        setEnabled={setReplacementRulesEnabled}
        rules={replacementRules}
        setRules={setReplacementRules}
      />

      <DebugLogsSection
        isDebugEnabled={isDebugEnabled}
        setIsDebugEnabled={setIsDebugEnabled}
        debugLogs={debugLogs}
        setDebugLogs={setDebugLogs}
      />
    </div>
  )
}