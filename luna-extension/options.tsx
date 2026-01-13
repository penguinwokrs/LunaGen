import { useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"

const DEFAULT_PROMPT = `あなたはマッチングサイトの人気ユーザーです。
以下の「自分のプロフィール」と「相手のプロフィール」を元に、相手が「この人は私のことを分かってくれている」「話してみたい」と感じ、思わず「いいね」や返信をしたくなるような魅力的な初回メッセージを作成してください。

# 成功のポイント（思わず返信したくなる要素）
1. **「あなただけ」という特別感**: プロフィールの具体的な記述（具体的な趣味、性格、独特な価値観など）を引用し、「まさにそこに惹かれました」と伝える。
2. **感情の共有**: 共通点に対して事実だけでなく、「それが好きなんて最高ですね！」「気が合いそうで嬉しいです」といったポジティブな感情を添える。
3. **安心感と包容力**: 誠実さを伝えつつ、相手の嗜好（M気質や躾けられたい願望など）を「受け止められる」「叶えられる」という頼りがいやS気質をさりげなく匂わせる。
4. **返信のしやすさ**: 相手がパッと答えられる、または語りたくなるような楽しい質問で締めくくる。

# 制約事項
- 最初の文章は必ず「[相手の名前]さん、はじめまして！」のように、相手の名前と挨拶から始めること。
- 文字数は、句読点、記号、カッコ、空白、改行などすべてを含めて合計200文字以内（厳守）。
- 丁寧だが、堅苦しすぎない親しみやすいトーン（絵文字や！を適度に使って明るく）。
- テンプレート感を出さない。自分の言葉で語りかけるように。
- メッセージ本文のみを出力すること。

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}`

const GEMINI_MODELS = [
  "gemini-2.0-flash-latest",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.5-flash-8b-latest",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
]
const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "o1-2024-12-17",
  "gpt-3.5-turbo",
]

export default function Options() {
  const [aiProvider, setAiProvider] = useStorage("aiProvider", "gemini")

  const [geminiApiKey, setGeminiApiKey] = useStorage("geminiApiKey", "")
  const [geminiModel, setGeminiModel] = useStorage("geminiModel", "gemini-1.5-flash")

  const [openaiApiKey, setOpenaiApiKey] = useStorage("openaiApiKey", "")
  const [openaiModel, setOpenaiModel] = useStorage("openaiModel", "gpt-4o")

  const [promptTemplate, setPromptTemplate] = useStorage("promptTemplate", DEFAULT_PROMPT)

  // New storage for My Profile
  const [myProfile, setMyProfile] = useStorage("myProfile", "")
  const [myProfileUpdatedAt, setMyProfileUpdatedAt] = useStorage("myProfileUpdatedAt", "")
  const [isDebugEnabled, setIsDebugEnabled] = useStorage("isDebugEnabled", true)
  const [debugLogs, setDebugLogs] = useStorage<any[]>("debugLogs", [])

  const [status, setStatus] = useState<{ message: string, type: "success" | "error" } | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)
  const [testResults, setTestResults] = useState<{ [key: string]: { loading: boolean, result?: string, error?: string } }>({})

  const handleSave = () => {
    setStatus({ message: "設定を保存しました！", type: "success" })
    setTimeout(() => setStatus(null), 2000)
  }

  // Add log helper within the component to use state setter
  const addLocalLog = (level: string, message: string, detail?: any) => {
    const newLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail
    }
    setDebugLogs((prev) => [newLog, ...(prev || [])].slice(0, 500))
  }

  const fetchMyProfile = async () => {
    setIsLoadingProfile(true)
    try {
      addLocalLog("info", "Checking auth status before profile update")

      // ログイン状態の明示的な確認
      const authRes = await fetch("https://luna-matching.com/api/user/is_auth")
      if (authRes.ok) {
        const authData = await authRes.json()
        addLocalLog("info", "Auth check response", { authData })
        // APIのタイポ "is_atuh" に合わせる
        if (authData.is_atuh === false) {
          throw new Error("Lunaにログインしていないようです。ログインしてから再度お試しください。")
        }
      }

      addLocalLog("info", "Manual profile update started from Options")
      const res = await fetch("https://luna-matching.com/api/user/get/me")

      if (!res.ok) {
        let errorBody = ""
        try {
          errorBody = await res.text()
        } catch (e) { }

        addLocalLog("error", `API returned error status: ${res.status}`, { status: res.status, body: errorBody })

        if (res.status === 404 || res.status === 401 || res.status === 403) {
          throw new Error("プロフィールの取得に失敗しました。ログインしているか確認してください。")
        }
        throw new Error(`通信エラーが発生しました (Status: ${res.status})`)
      }

      const data = await res.json()
      // The API response structure is { user: { ... } }
      const userData = data.user || data
      addLocalLog("info", "API call successful, parsing data", { hasUser: !!data.user })

      const cleanText = extractProfileFromJSON(userData)

      if (!cleanText || cleanText.length < 10) {
        addLocalLog("warn", "Extracted profile text is too short", { cleanText })
        throw new Error("プロフィール情報をうまく取得できませんでした。")
      }

      setMyProfile(cleanText)

      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      setMyProfileUpdatedAt(dateStr)

      addLocalLog("info", "Profile manually updated via API in Options", { url: "/api/user/get/me" })

      setStatus({ message: "プロフィールを更新しました！", type: "success" })
      setTimeout(() => setStatus(null), 2000)

    } catch (e: any) {
      console.error(e)
      addLocalLog("error", "Failed manual update execution", { error: e.message, stack: e.stack })
      const errorMsg = e.message?.includes("ログイン") ? e.message : "プロフィールの取得に失敗しました。ログインしているか確認してください。"
      setStatus({ message: errorMsg, type: "error" })
      setTimeout(() => setStatus(null), 3000)
    } finally {
      setIsLoadingProfile(false)
    }
  }

  const runApiTest = async (provider: "gemini" | "openai") => {
    const apiKey = provider === "gemini" ? geminiApiKey : openaiApiKey
    const model = provider === "gemini" ? geminiModel : openaiModel

    if (!apiKey) {
      alert("APIキーを入力してください")
      return
    }

    setTestResults(prev => ({ ...prev, [provider]: { loading: true } }))

    try {
      const response: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "test_api",
          provider,
          apiKey,
          model
        }, resolve)
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

  function extractProfileFromJSON(u: any): string {
    let text = ""
    if (u.name) text += `名前: ${u.name}\n`
    if (u.age) text += `年齢: ${u.age}\n`
    if (u.relationship_text) text += `目的: ${u.relationship_text}\n`

    // 自己紹介 (APIキー: profile)
    if (u.profile) text += `\n【自己紹介】\n${u.profile}\n`

    // 嗜好・プレイスタイル (APIキー: text_my_like)
    if (u.text_my_like) {
      text += `\n【嗜好・プレイスタイル】\n${u.text_my_like}\n`
    }

    // 求める条件 (APIキー: conditions_text)
    if (u.conditions_text) {
      text += `\n【求める条件】\n${u.conditions_text}\n`
    }

    // NG (APIキー: text_my_ng)
    if (u.text_my_ng) {
      text += `\n【NGなこと・拒否】\n${u.text_my_ng}\n`
    }

    // 数値データのマッピング (例: 支配欲)
    if (u.q_dom !== undefined) {
      const domMap: any = { 1: "なし", 2: "微弱", 3: "中", 4: "強", 5: "最強" }
      text += `\n支配欲(Dom): ${domMap[u.q_dom] || u.q_dom}`
    }

    return text.trim() || JSON.stringify(u, null, 2)
  }

  const isGeminiReady = !!geminiApiKey
  const isOpenAIReady = !!openaiApiKey

  return (
    <div style={{ padding: "40px 20px 20px", maxWidth: "700px", margin: "0 auto", fontFamily: "sans-serif", color: "#333", position: "relative" }}>

      {/* --- Floating Toast at the TOP --- */}
      {status && (
        <div style={{
          position: "fixed",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          padding: "12px 24px",
          backgroundColor: status.type === "error" ? "#ff4d4f" : "#28a745",
          color: "white",
          borderRadius: "30px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 10000,
          textAlign: "center",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          transition: "all 0.3s ease"
        }}>
          {status.type === "error" ? "⚠️" : "✨"} {status.message}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #e91e63", marginBottom: "20px" }}>
        <h1 style={{ paddingBottom: "10px", color: "#e91e63", margin: 0 }}>
          Luna Extension 設定
        </h1>
        <a href="#debug-logs" style={{ fontSize: "0.9rem", color: "#666", textDecoration: "none", border: "1px solid #ccc", padding: "4px 8px", borderRadius: "4px" }}>
          🔍 ログを確認
        </a>
      </div>

      {/* --- My Profile Section (NEW) --- */}
      <section style={{ marginBottom: "30px", padding: "15px", backgroundColor: "#fff0f5", borderRadius: "8px", border: "1px solid #ffcce0" }}>
        <h2 style={{ fontSize: "1.2rem", marginTop: 0, display: "flex", alignItems: "center" }}>
          0. 自分のプロフィール
        </h2>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: "0 0 5px 0", fontSize: "0.9rem", color: "#666" }}>
              AIに学習させる自分のプロフィール情報を保存します。<br />
              Lunaにログインした状態で取得ボタンを押してください。
            </p>
            {myProfileUpdatedAt ? (
              <>
                <div style={{ display: "flex", alignItems: "center", color: "green", fontWeight: "bold", marginTop: "8px" }}>
                  <span style={{ fontSize: "1.2rem", marginRight: "5px" }}>✅</span>
                  <span>保存済み ({myProfileUpdatedAt})</span>
                </div>
                <details style={{ marginTop: "10px", backgroundColor: "white", padding: "8px", borderRadius: "4px", border: "1px solid #ffcce0" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#e91e63", fontWeight: "bold" }}>
                    保存内容を確認
                  </summary>
                  <pre style={{
                    whiteSpace: "pre-wrap",
                    fontSize: "0.8rem",
                    marginTop: "8px",
                    padding: "8px",
                    backgroundColor: "#f9f9f9",
                    borderRadius: "4px",
                    maxHeight: "200px",
                    overflowY: "auto",
                    margin: 0
                  }}>
                    {myProfile}
                  </pre>
                </details>
              </>
            ) : (
              <div style={{ color: "#888", marginTop: "8px", fontStyle: "italic" }}>
                未保存
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={fetchMyProfile}
              disabled={isLoadingProfile}
              title="プロフィールをLunaから取得して更新"
              style={{
                backgroundColor: "white",
                border: "1px solid #e91e63",
                borderRadius: "50%",
                width: "48px",
                height: "48px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isLoadingProfile ? "not-allowed" : "pointer",
                boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                transition: "all 0.2s"
              }}
            >
              {isLoadingProfile ? (
                <div style={{
                  border: "3px solid #f3f3f3",
                  borderTop: "3px solid #e91e63",
                  borderRadius: "50%",
                  width: "20px",
                  height: "20px",
                  animation: "spin 1s linear infinite"
                }} />
              ) : (
                <span style={{ fontSize: "1.5rem" }}>🔄</span>
              )}
            </button>
          </div>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </section>

      {/* --- AI Provider Selection --- */}
      <section style={{ marginBottom: "30px", padding: "15px", backgroundColor: "#f9f9f9", borderRadius: "8px" }}>
        <h2 style={{ fontSize: "1.2rem", marginTop: 0 }}>1. 使用するAIを選択</h2>
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
      </section>

      {/* --- Configuration Details --- */}
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
              style={{
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                borderRadius: "6px",
                border: "1px solid #ccc",
                outline: "none"
              }}
            />
          </div>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                borderRadius: "6px",
                border: "1px solid #ccc",
                backgroundColor: "#fff"
              }}
            >
              {GEMINI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <button
              onClick={() => runApiTest("gemini")}
              disabled={testResults["gemini"]?.loading}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: testResults["gemini"]?.loading ? "#ccc" : "#007bff",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: "bold",
                transition: "background-color 0.2s"
              }}
            >
              {testResults["gemini"]?.loading ? "テスト通信中..." : "接続をテストする"}
            </button>

            {testResults["gemini"]?.error && (
              <div style={{
                marginTop: "12px",
                padding: "10px",
                backgroundColor: "#fff2f0",
                border: "1px solid #ffccc7",
                borderRadius: "4px",
                color: "#ff4d4f",
                fontSize: "0.85rem",
                lineHeight: "1.4"
              }}>
                <strong>⚠️ 使用不可:</strong> このモデルは使用できません。APIにクォータ制限がかかっているか、キーが無効な可能性があります。
                <div style={{ fontSize: "0.75rem", marginTop: "4px", opacity: 0.8 }}>({testResults["gemini"].error})</div>
              </div>
            )}

            {testResults["gemini"]?.result && (
              <div style={{
                marginTop: "12px",
                padding: "10px",
                backgroundColor: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: "4px",
                color: "#52c41a",
                fontSize: "0.85rem"
              }}>
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
              style={{
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                borderRadius: "6px",
                border: "1px solid #ccc",
                outline: "none"
              }}
            />
          </div>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "#666" }}>モデル</label>
            <select
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                borderRadius: "6px",
                border: "1px solid #ccc",
                backgroundColor: "#fff"
              }}
            >
              {OPENAI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <button
              onClick={() => runApiTest("openai")}
              disabled={testResults["openai"]?.loading}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: testResults["openai"]?.loading ? "#ccc" : "#10a37f",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: "bold",
                transition: "background-color 0.2s"
              }}
            >
              {testResults["openai"]?.loading ? "テスト通信中..." : "接続をテストする"}
            </button>

            {testResults["openai"]?.error && (
              <div style={{
                marginTop: "12px",
                padding: "10px",
                backgroundColor: "#fff2f0",
                border: "1px solid #ffccc7",
                borderRadius: "4px",
                color: "#ff4d4f",
                fontSize: "0.85rem",
                lineHeight: "1.4"
              }}>
                <strong>⚠️ 使用不可:</strong> このモデルは使用できません。APIにクォータ制限がかかっているか、キーが無効な可能性があります。
                <div style={{ fontSize: "0.75rem", marginTop: "4px", opacity: 0.8 }}>({testResults["openai"].error})</div>
              </div>
            )}

            {testResults["openai"]?.result && (
              <div style={{
                marginTop: "12px",
                padding: "10px",
                backgroundColor: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: "4px",
                color: "#10a37f",
                fontSize: "0.85rem"
              }}>
                ✨ 正常にレスポンスを受信しました: "{testResults["openai"].result.slice(0, 30)}..."
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- Prompt Template --- */}
      <section style={{ marginBottom: "30px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.2rem" }}>3. プロンプトテンプレート</h2>
          <button
            onClick={() => {
              setPromptTemplate(DEFAULT_PROMPT)
              setStatus({ message: "プロンプトを初期化しました", type: "success" })
              setTimeout(() => setStatus(null), 2000)
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

      <button
        onClick={handleSave}
        style={{
          width: "100%",
          padding: "12px",
          backgroundColor: "#e91e63",
          color: "white",
          border: "none",
          cursor: "pointer",
          borderRadius: "4px",
          fontWeight: "bold",
          fontSize: "1rem",
          marginBottom: "40px"
        }}
      >
        設定を保存
      </button>

      {/* --- Debug Logs Section --- */}
      <section id="debug-logs" style={{
        marginTop: "40px",
        padding: "15px",
        backgroundColor: "#f0f0f0",
        borderRadius: "8px",
        border: "1px solid #ccc",
        opacity: isDebugEnabled ? 1 : 0.8
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "15px", borderBottom: "1px solid #ccc", paddingBottom: "10px" }}>
          <h2 style={{ fontSize: "1.2rem", margin: 0 }}>4. デバッグログ設定</h2>
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
                    borderBottom: "1px solid #f0f0f0",
                    color: log.level === "error" ? "red" : log.level === "warn" ? "orange" : "#333"
                  }}>
                    <span style={{ color: "#888" }}>[{log.timestamp}]</span> [{log.level.toUpperCase()}] {log.message}
                  </div>
                ))
              ) : (
                <div style={{ color: "#888" }}>ログはありません</div>
              )}
            </div>
          </>
        )}
      </section>

    </div>
  )
}