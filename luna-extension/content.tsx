import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { createRoot } from "react-dom/client"

export const config: PlasmoCSConfig = {
  matches: ["https://luna-matching.com/*"]
}

const storage = new Storage()

// --- Logging Helper ---
async function addLog(level: string, message: string, detail?: any) {
  const logs = await storage.get<any[]>("debugLogs") || []
  const newLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
    detail
  }
  const updatedLogs = [newLog, ...logs].slice(0, 500) // Keep last 500 logs
  await storage.set("debugLogs", updatedLogs)
  console.log(`[LUNA-${level.toUpperCase()}] ${message}`, detail || "")
}

// --- Message Listener for API Interceptor ---
window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data) {
    return
  }

  // Handle Logs from Interceptor
  if (event.data.type === "LUNA_LOG") {
    const { level, message, detail } = event.data
    await addLog(level, message, detail)
    return
  }

  if (event.data.type !== "LUNA_API_RESPONSE") {
    return
  }

  const { url, data, method } = event.data

  // 自分のプロフィール情報
  if (url.includes("/api/user/auth") || url.includes("/api/user/get/me") || url.includes("/api/user/profile")) {
    await addLog("info", `Profile Sync triggered by ${url} (${method})`)

    // データ構造の正規化
    const profileData = data.profile || data.user || data

    const profileText = extractProfileFromJSON(profileData)
    if (profileText && profileText.length > 10) {
      await storage.set("myProfile", profileText)
      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      await storage.set("myProfileUpdatedAt", dateStr)
      await addLog("info", "My Profile updated and saved to storage")
    } else {
      await addLog("warn", "Profile data extracted was too short or empty", { profileData })
    }
  }

  // 相手のプロフィール情報
  if (url.includes("/api/user/show/")) {
    await addLog("info", `Target Profile Intercepted: ${url}`)
    sessionStorage.setItem("luna_last_viewed_user", JSON.stringify(data))
  }
})

function extractProfileFromJSON(data: any): string {
  // JSON構造に合わせてテキスト化
  // data.user, data.profile, data.questions などを想定
  let text = ""
  if (data.name) text += `名前: ${data.name}\n`
  if (data.age) text += `年齢: ${data.age}\n`
  if (data.introduction) text += `自己紹介:\n${data.introduction}\n`

  // 他のフィールドも必要に応じて追加
  // APIレスポンスの構造が不明なため、汎用的にダンプするか、
  // 主要なフィールド（introductionなど）を優先する

  return text || JSON.stringify(data, null, 2) // fallback
}


const GenerateButton = ({ textarea }: { textarea: HTMLTextAreaElement }) => {
  const [loading, setLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)

    try {
      // 1. Get My Profile (from Storage or Fetch)
      const myProfileText = await getMyProfile()

      // 2. Get Target Profile
      // APIから取得したキャッシュがあればそれを使う、なければDOMから
      let targetProfileText = ""
      const cachedTarget = sessionStorage.getItem("luna_last_viewed_user")
      if (cachedTarget) {
        const data = JSON.parse(cachedTarget)
        targetProfileText = extractProfileFromJSON(data)
      }

      if (!targetProfileText || targetProfileText.length < 10) {
        targetProfileText = getTargetProfile()
      }

      // 3. Generate Message
      const response = await chrome.runtime.sendMessage({
        action: "generate_message",
        myProfile: myProfileText,
        targetProfile: targetProfileText
      })

      if (response.error) {
        alert("Error: " + response.error)
      } else if (response.text) {
        insertText(textarea, response.text)
      }
    } catch (err) {
      console.error(err)
      alert("AI生成中にエラーが発生しました。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        marginTop: "8px",
        padding: "6px 12px",
        backgroundColor: loading ? "#ccc" : "#e91e63",
        color: "white",
        border: "none",
        borderRadius: "4px",
        fontSize: "12px",
        cursor: loading ? "not-allowed" : "pointer",
        fontWeight: "bold",
        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
        zIndex: 9999
      }}
    >
      {loading ? "AI生成中..." : "✨ AIでメッセージ生成"}
    </button>
  )
}

// Helper to get My Profile (Storage -> Fetch Fallback)
async function getMyProfile() {
  try {
    // Try to get from storage first
    const storedProfile = await storage.get("myProfile")
    if (storedProfile && storedProfile.length > 10) {
      return storedProfile
    }

    // Fallback: fetch directly (Legacy Scraping)
    const res = await fetch("https://luna-matching.com/profile")
    if (!res.ok) throw new Error("Fetch failed")

    const html = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    const text = cleanText(doc.body.innerText)

    // Auto-save to storage for next time
    await storage.set("myProfile", text)

    return text
  } catch (e) {
    console.error("Failed to fetch my profile", e)
    return "自分のプロフィールの取得に失敗しました。設定画面でプロフィールを更新するか、ログインしてください。"
  }
}

// Helper to scrape Target Profile (Current Page)
function getTargetProfile() {
  const main = document.querySelector("main")
  if (main) return cleanText(main.innerText)
  return cleanText(document.body.innerText)
}

function cleanText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
}

function insertText(textarea: HTMLTextAreaElement, text: string) {
  const originalValue = textarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  const newValue = originalValue.substring(0, start) + text + originalValue.substring(end)
  textarea.value = newValue

  // React/Vue state update trigger
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
  textarea.dispatchEvent(new Event("change", { bubbles: true }))

  // Move cursor
  textarea.selectionStart = textarea.selectionEnd = start + text.length
  textarea.focus()
}

// Main Logic to inject button
function initObserver() {
  const observer = new MutationObserver(() => {
    const textareas = document.querySelectorAll("textarea")
    textareas.forEach((textarea) => {
      if (textarea.dataset.lunaAiInjected === "true") return
      textarea.dataset.lunaAiInjected = "true"

      const container = document.createElement("div")
      textarea.parentElement?.appendChild(container)

      const root = createRoot(container)
      root.render(<GenerateButton textarea={textarea} />)
    })
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

initObserver()

export default function Content() {
  return null
}
