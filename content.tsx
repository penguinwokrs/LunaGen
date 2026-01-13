import type { PlasmoCSConfig } from "plasmo"
import { Storage } from "@plasmohq/storage"
import { createRoot } from "react-dom/client"

import { GenerateButton } from "./components/Content/GenerateButton"
import { addLog } from "./utils/logger"
import { extractProfileFromJSON } from "./utils/profile"

export const config: PlasmoCSConfig = {
  matches: ["https://*.luna-matching.com/*", "https://luna-matching.com/*"]
}

const storage = new Storage({ area: "local" })
let lastTargetAge: number | string | null = null
let lastUrl = location.href

/**
 * 年齢表示を更新するDOM操作
 */
function updateAgeInDOM() {
  if (!lastTargetAge) return

  try {
    const xpath = "/html/body/div[1]/div/div/main/div/div/div[2]/div/div[2]/div[1]/small/div/span[2]"
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const element = result.singleNodeValue as HTMLElement

    if (element) {
      const newText = `${lastTargetAge}歳`
      if (element.innerText !== newText) {
        element.innerText = newText
        addLog("info", `DOM Age Updated: ${newText}`, null, "CONTENT")
      }
    }
  } catch (e: any) {
    addLog("error", "Failed to update age in DOM", { error: e.toString() }, "CONTENT")
  }
}

/**
 * APIインターセプターからのメッセージを処理
 */
window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data) return

  // ログ転送
  if (event.data.type === "LUNA_LOG") {
    const { level, message, detail } = event.data
    await addLog(level, message, detail, "MAIN")
    return
  }

  if (event.data.type !== "LUNA_API_RESPONSE") return

  const { url, data } = event.data

  // プロフィール更新検知 (自分)
  if (url.includes("/api/user/auth") || url.includes("/api/user/get/me") || url.includes("/api/user/profile")) {
    const profileData = data.profile || data.user || data
    const profileText = extractProfileFromJSON(profileData)
    if (profileText && profileText.length > 10) {
      await storage.set("myProfile", profileText)
      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      await storage.set("myProfileUpdatedAt", dateStr)
      await addLog("info", "My Profile synced from API", null, "CONTENT")
    }
  }

  // 相手のプロフィール情報
  if (url.includes("/api/user/show/") || url.includes("/api/user/service/show/")) {
    sessionStorage.setItem("luna_last_viewed_user", JSON.stringify(data))
    const targetData = data.user || data.profile || data
    if (targetData?.age) {
      lastTargetAge = targetData.age
      updateAgeInDOM()
    }
  }
})

/**
 * 監視とボタン注入
 */
function initObserver() {
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      lastTargetAge = null
      // ユーザーが別のページに移動したらキャッシュされたプロフィールを消去する
      sessionStorage.removeItem("luna_last_viewed_user")
    }

    updateAgeInDOM()

    // 相手のプロフィールページである場合のみボタンを挿入
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

// 実行開始
initObserver()
addLog("info", "Luna Content Script Initialized", { url: location.href }, "CONTENT")

export default function Content() {
  return null
}
