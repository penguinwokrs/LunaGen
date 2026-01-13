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

const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"]
const OPENAI_MODELS = ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]

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
  const [debugLogs, setDebugLogs] = useStorage<any[]>("debugLogs", [])

  const [status, setStatus] = useState("")
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)

  const handleSave = () => {
    setStatus("設定を保存しました！")
    setTimeout(() => setStatus(""), 2000)
  }

  const fetchMyProfile = async () => {
    setIsLoadingProfile(true)
    try {
      // Fetch from luna
      const res = await fetch("https://luna-matching.com/profile")
      if (!res.ok) {
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          throw new Error("プロフィールの取得に失敗しました。ログインしているか確認してください。")
        }
        throw new Error("通信エラーが発生しました。")
      }
      const html = await res.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, "text/html")

      const rawText = doc.body.innerText || doc.body.textContent || ""
      const cleanText = rawText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")

      if (!cleanText || cleanText.length < 10) {
        throw new Error("プロフィール情報をうまく取得できませんでした。")
      }

      setMyProfile(cleanText)

      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      setMyProfileUpdatedAt(dateStr)

      setStatus("プロフィールを更新しました！")
      setTimeout(() => setStatus(""), 2000)

    } catch (e) {
      console.error(e)
      setStatus(e.message || "エラーが発生しました")
      setTimeout(() => setStatus(""), 3000)
    } finally {
      setIsLoadingProfile(false)
    }
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
          backgroundColor: status.includes("エラー") ? "#f8d7da" : "#d4edda",
          color: status.includes("エラー") ? "#721c24" : "#155724",
          borderColor: status.includes("エラー") ? "#f5c6cb" : "#c3e6cb",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 10000,
          textAlign: "center",
          fontWeight: "bold",
          border: "1px solid",
          minWidth: "200px"
        }}>
          {status}
        </div>
      )}

      <h1 style={{ borderBottom: "2px solid #e91e63", paddingBottom: "10px", color: "#e91e63" }}>
        Luna Extension 設定
      </h1>

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
              <div style={{ display: "flex", alignItems: "center", color: "green", fontWeight: "bold", marginTop: "8px" }}>
                <span style={{ fontSize: "1.2rem", marginRight: "5px" }}>✅</span>
                <span>保存済み ({myProfileUpdatedAt})</span>
              </div>
            ) : (
              <div style={{ color: "#888", marginTop: "8px", fontStyle: "italic" }}>
                未保存
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={async () => {
                setStatus("スクショを準備中...")
                const res = await chrome.runtime.sendMessage({ action: "capture_profile_screenshot" })
                if (res.error) setStatus("エラー: " + res.error)
                else setStatus("スクショを保存しました")
                setTimeout(() => setStatus(""), 2000)
              }}
              title="実際のプロフィール画面を確認（スクショ保存）"
              style={{
                backgroundColor: "white",
                border: "1px solid #ccc",
                borderRadius: "50%",
                width: "48px",
                height: "48px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "1.2rem"
              }}
            >
              📸
            </button>

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
          </div>        </div>
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
            {isGeminiReady && <span style={{ marginLeft: "5px", color: "green", fontSize: "0.8em" }}>● 設定済</span>}
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
            {isOpenAIReady && <span style={{ marginLeft: "5px", color: "green", fontSize: "0.8em" }}>● 設定済</span>}
          </label>
        </div>
      </section>

      {/* --- Configuration Details --- */}
      <section style={{ marginBottom: "30px" }}>
        <h2 style={{ fontSize: "1.2rem" }}>2. API設定</h2>

        {/* Gemini Settings */}
        <div style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          opacity: aiProvider === "gemini" ? 1 : 0.6,
          pointerEvents: aiProvider === "gemini" ? "auto" : "none",
          backgroundColor: aiProvider === "gemini" ? "#fff" : "#f5f5f5"
        }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#444" }}>Google Gemini 設定</h3>
          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>API Key</label>
            <input
              type="password"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="AIza..."
              style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>モデル</label>
            <input
              list="gemini-models"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
              placeholder="gemini-1.5-flash"
            />
            <datalist id="gemini-models">
              {GEMINI_MODELS.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
        </div>

        {/* OpenAI Settings */}
        <div style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          opacity: aiProvider === "openai" ? 1 : 0.6,
          pointerEvents: aiProvider === "openai" ? "auto" : "none",
          backgroundColor: aiProvider === "openai" ? "#fff" : "#f5f5f5"
        }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#444" }}>OpenAI 設定</h3>
          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>API Key</label>
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-..."
              style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>モデル</label>
            <input
              list="openai-models"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
              placeholder="gpt-4o"
            />
            <datalist id="openai-models">
              {OPENAI_MODELS.map(m => <option key={m} value={m} />)}
            </datalist>
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
              setStatus("プロンプトを初期化しました")
              setTimeout(() => setStatus(""), 2000)
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
      <section style={{
        marginTop: "40px",
        padding: "15px",
        backgroundColor: "#f0f0f0",
        borderRadius: "8px",
        border: "1px solid #ccc"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <h2 style={{ fontSize: "1.2rem", margin: 0 }}>4. デバッグログ (ローカル保存)</h2>
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
      </section>

    </div>
  )
}