import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { createRoot } from "react-dom/client"

export const config: PlasmoCSConfig = {
  matches: ["https://*.luna-matching.com/*", "https://luna-matching.com/*"]
}

console.log("[LUNA-BOOT] Content script is loading at", location.href)

const storage = new Storage({ area: "local" })
let lastTargetAge: number | string | null = null
let lastUrl = location.href
let isDebugEnabledCache = true

// Initialize cache
storage.get<boolean>("isDebugEnabled").then(v => {
  if (v !== undefined) isDebugEnabledCache = v
})

// Listen for storage changes to update cache
storage.watch({
  isDebugEnabled: (c) => {
    isDebugEnabledCache = c.newValue ?? true
  }
})

// --- Logging Helper ---
async function addLog(level: string, message: string, detail?: any) {
  try {
    // Check memory cache instead of async storage call for maximum performance
    if (!isDebugEnabledCache && level !== "error") return

    // Always log to browser console for easy inspection by user if enabled
    console.log(`[LUNA-${level.toUpperCase()}] ${message}`, detail || "")

    if (!isDebugEnabledCache) return

    const logs = await storage.get<any[]>("debugLogs") || []
    const newLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail: typeof detail === 'object' ? JSON.stringify(detail).substring(0, 1000) : detail
    }
    const updatedLogs = [newLog, ...logs].slice(0, 100)
    await storage.set("debugLogs", updatedLogs)
  } catch (e) {
    console.error("[LUNA-ERROR] Failed to add log", e)
  }
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
  if (url.includes("/api/user/show/") || url.includes("/api/user/service/show/")) {
    await addLog("info", `Target Profile Intercepted: ${url}`)
    sessionStorage.setItem("luna_last_viewed_user", JSON.stringify(data))

    // 実年齢の取得と反映
    const targetData = data.user || data.profile || data
    if (targetData) {
      if (targetData.age) {
        lastTargetAge = targetData.age
        await addLog("info", `Target Age Captured from API: ${lastTargetAge}`, { url, age: lastTargetAge })
        updateAgeInDOM()
      } else {
        await addLog("warn", "Target Profile Intercepted but age field missing", { targetData })
      }
    } else {
      await addLog("error", "Target Profile Intercepted but user/profile data missing", { data })
    }
  }
})

function updateAgeInDOM() {
  if (!lastTargetAge) {
    // console.log("[LUNA-DEBUG] updateAgeInDOM skipped: lastTargetAge is null")
    return
  }

  try {
    const xpath = "/html/body/div[1]/div/div/main/div/div/div[2]/div/div[2]/div[1]/small/div/span[2]"
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const element = result.singleNodeValue as HTMLElement

    if (element) {
      const newText = `${lastTargetAge}歳`
      const oldText = element.innerText
      if (oldText !== newText) {
        element.innerText = newText
        addLog("info", `DOM Age Updated: ${oldText} -> ${newText}`)
      }
    } else {
      // ログが溢れないように、最後にこのURLで試行した結果を保持
      if ((window as any)._lastXpathFailedUrl !== location.href) {
        (window as any)._lastXpathFailedUrl = location.href;
        addLog("warn", "Age element not found by XPath. The page structure might be different.", {
          xpath,
          url: location.href,
          lastTargetAge
        })
      }
    }
  } catch (e) {
    addLog("error", "Failed to update age in DOM", { error: (e as Error).toString() })
  }
}

function extractProfileFromJSON(u: any): string {
  let text = ""
  if (u.name) text += `名前: ${u.name}\n`
  if (u.age) text += `年齢: ${u.age}\n`
  if (u.relationship_text) text += `目的: ${u.relationship_text}\n`

  // 自己紹介 (APIキー: profile または introduction)
  const intro = u.profile || u.introduction
  if (intro) text += `\n【自己紹介】\n${intro}\n`

  // 嗜好・プレイスタイル (APIキー: text_my_like または preference)
  const prefs = u.text_my_like || u.preference || u.preferences || u.style
  if (prefs) {
    text += `\n【嗜好・プレイスタイル】\n${typeof prefs === "string" ? prefs : JSON.stringify(prefs, null, 2)}\n`
  }

  // 求める条件 (APIキー: conditions_text または requirement)
  const reqs = u.conditions_text || u.requirement || u.requirements || u.condition
  if (reqs) {
    text += `\n【求める条件】\n${typeof reqs === "string" ? reqs : JSON.stringify(reqs, null, 2)}\n`
  }

  // NG (APIキー: text_my_ng または ng)
  const ng = u.text_my_ng || u.ng || u.not_good || u.dislike
  if (ng) {
    text += `\n【NGなこと・拒否】\n${typeof ng === "string" ? ng : JSON.stringify(ng, null, 2)}\n`
  }

  // 数値データのマッピング (例: 支配欲)
  if (u.q_dom !== undefined) {
    const domMap: any = { 1: "なし", 2: "微弱", 3: "中", 4: "強", 5: "最強" }
    text += `\n支配欲(Dom): ${domMap[u.q_dom] || u.q_dom}`
  }

  return text.trim() || JSON.stringify(u, null, 2) // fallback
}


const GenerateButton = ({ textarea }: { textarea: HTMLTextAreaElement }) => {
  const [loading, setLoading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (loading) {
      setSlow(false)
      setError(false)
      timer = setTimeout(() => {
        setSlow(true)
      }, 5000)
    }
    return () => clearTimeout(timer)
  }, [loading])

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    setError(false)

    await addLog("info", "AI Generate Button Clicked")

    try {
      // 1. Get My Profile (from Storage or Fetch)
      await addLog("info", "Retrieving My Profile...")
      const myProfileText = await getMyProfile()
      await addLog("info", "My Profile Retrieved", { length: myProfileText?.length })

      // 2. Get Target Profile
      await addLog("info", "Retrieving Target Profile...")
      let targetProfileText = ""
      const cachedTarget = sessionStorage.getItem("luna_last_viewed_user")
      if (cachedTarget) {
        await addLog("info", "Using Cached Target Profile from SessionStorage")
        const data = JSON.parse(cachedTarget)
        targetProfileText = extractProfileFromJSON(data)
      }

      if (!targetProfileText || targetProfileText.length < 10) {
        await addLog("error", "Target Profile not found in API cache")
        alert("相手のプロフィール情報（APIデータ）の取得に失敗しました。ページを一度リロードしてから再度お試しください。")
        setLoading(false)
        return
      }
      await addLog("info", "Target Profile Retrieved", { length: targetProfileText?.length })

      // 3. Generate Message
      await addLog("info", "Sending message generation request to background...")

      // プレミアムメッセージかどうかを判定（画面内に特定の文言があるか）
      const isPremium = document.body.innerText.includes("プレミアムメッセージを送る")
      await addLog("info", `Detected message type: ${isPremium ? "Premium" : "Normal"}`)

      const response = await chrome.runtime.sendMessage({
        action: "generate_message",
        myProfile: myProfileText,
        targetProfile: targetProfileText,
        isPremium: isPremium
      })

      if (response.error) {
        await addLog("error", "AI Generation Error Response", { error: response.error })
        setError(true)
      } else if (response.text) {
        await addLog("info", "AI Generation Success", { textPreview: response.text.substring(0, 100) + "..." })
        insertText(textarea, response.text)
        setError(false)
      }
    } catch (err: any) {
      await addLog("error", "AI Generation Exception", { error: err.toString() })
      console.error(err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: "8px" }}>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: "6px 12px",
          backgroundColor: loading ? "#ccc" : (error ? "#f44336" : "#e91e63"),
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontSize: "12px",
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: "bold",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          zIndex: 9999,
          transition: "all 0.3s ease"
        }}
      >
        {loading ? (slow ? "⌛ 時間がかかっています、このままお待ち下さい..." : "🪄 AI生成中...") : (error ? "⚠️ エラーが発生しました、もう一度お試しください" : "✨ AIでメッセージ生成")}
      </button>
      {error && !loading && (
        <p style={{ color: "#f44336", fontSize: "10px", margin: "4px 0 0 4px", fontWeight: "bold" }}>
          通信エラーが発生した可能性があります。
        </p>
      )}
    </div>
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

    // Fallback: fetch directly from API
    await addLog("info", "Fetching my profile from API fallback")
    const res = await fetch("https://luna-matching.com/api/user/get/me")
    if (!res.ok) throw new Error("Fetch failed: " + res.status)

    const data = await res.json()
    const profileData = data.profile || data.user || data
    const text = extractProfileFromJSON(profileData)

    if (text && text.length > 10) {
      // Auto-save to storage for next time
      await storage.set("myProfile", text)
      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      await storage.set("myProfileUpdatedAt", dateStr)
      await addLog("info", "My profile auto-saved from API fallback")
    }

    return text || "プロフィールの取得に失敗しました。詳細な自己紹介を記入し、設定画面でプロフィールを更新してください。"
  } catch (e) {
    await addLog("error", "Failed to fetch my profile from API fallback", { error: e.toString() })
    return "自分のプロフィールの取得に失敗しました。設定画面でプロフィールを更新するか、ログインしてください。"
  }
}


function insertText(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text

  // React/Vue state update trigger
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
  textarea.dispatchEvent(new Event("change", { bubbles: true }))

  textarea.focus()
}

// Main Logic to inject button
function initObserver() {
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      lastTargetAge = null
    }

    // 年齢の更新を試みる
    updateAgeInDOM()

    // 相手のプロフィールページ（/user/show/ または /user/service/show/）である場合のみボタンを挿入
    const isTargetProfilePage = location.pathname.includes("/user/show/") || location.pathname.includes("/user/service/show/")

    if (isTargetProfilePage) {
      const textareas = document.querySelectorAll("textarea")
      textareas.forEach((textarea) => {
        if (textarea.dataset.lunaAiInjected === "true") return
        textarea.dataset.lunaAiInjected = "true"

        const container = document.createElement("div")
        textarea.parentElement?.appendChild(container)

        const root = createRoot(container)
        root.render(<GenerateButton textarea={textarea} />)
      })
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

initObserver()

// Initialization Log
addLog("info", "Luna Content Script Initialized", {
  url: location.href,
  userAgent: navigator.userAgent
})

export default function Content() {
  return null
}
