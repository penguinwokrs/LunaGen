import type { PlasmoCSConfig } from "plasmo"
import { Storage } from "@plasmohq/storage"
import { createRoot, type Root } from "react-dom/client"

import { GenerateButton } from "./components/Content/GenerateButton"
import { ProfileImproveButton } from "./components/Content/ProfileImproveButton"
import { addLog } from "./utils/logger"
import { extractProfileFromJSON } from "./utils/profile"
import { detectProfileField } from "./utils/profile-field"
import { mergePartnerCache } from "./utils/partner"
import { getThreadIdFromMessageListUrl } from "./utils/url"

export const config: PlasmoCSConfig = {
  matches: ["https://*.luna-matching.com/*", "https://luna-matching.com/*"]
}

const storage = new Storage({ area: "local" })

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
    const profileText = extractProfileFromJSON(profileData, data)
    if (profileText && profileText.length > 10) {
      await storage.set("myProfile", profileText)
      await storage.set("myProfileRaw", JSON.stringify(profileData))
      const now = new Date()
      const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      await storage.set("myProfileUpdatedAt", dateStr)
      await addLog("info", "My Profile synced from API", null, "CONTENT")
    }
  }

  // 相手のプロフィール情報（生成ボタン用にキャッシュ）
  if (url.includes("/api/user/show/") || url.includes("/api/user/service/show/")) {
    sessionStorage.setItem("luna_last_viewed_user", JSON.stringify(data))
  }

  // メッセージリスト（会話履歴 + 相手情報）
  if (url.includes("/api/user/message/list/")) {
    const userInfo = data.user_info
    const messageList = data.message_list
    const threadId = getThreadIdFromMessageListUrl(url)

    if (userInfo) {
      // プロフィール情報のキャッシュ更新。
      // user_info は id/name/profile 程度しか持たない薄い情報なので、
      // これだけでは生成に足りないことがある（自己紹介が空の相手など）。
      // 不足分は GenerateButton 側が user_info.id で本体を取り直す。
      sessionStorage.setItem(
        "luna_last_viewed_user",
        mergePartnerCache(sessionStorage.getItem("luna_last_viewed_user"), userInfo, threadId)
      )
      addLog("info", "Partner Profile cached from Message List", null, "CONTENT")
    }

    if (messageList) {
      sessionStorage.setItem(
        "luna_chat_history",
        JSON.stringify({
          messages: messageList,
          partnerId: userInfo?.id,
          threadId,
          cachedAt: new Date().toISOString()
        })
      )
      addLog("info", "Chat History Cached", { count: messageList.length }, "CONTENT")
    }
  }
})

// 注入済みボタンの React root を textarea ごとに保持し、SPA 遷移で
// textarea が DOM から外れたら unmount してリークを防ぐ
const injectedButtons = new Map<
  HTMLTextAreaElement,
  { root: Root; container: HTMLElement }
>()

/**
 * 対象ページの textarea に生成ボタンを注入する
 */
function injectButtons() {
  // 相手のプロフィールページ または メッセージページ である場合のみボタンを挿入
  const isTargetPage =
    location.pathname.includes("/user/show/") ||
    location.pathname.includes("/user/service/show/") ||
    location.href.includes("/message")

  if (!isTargetPage) return

  const textareas = document.querySelectorAll("textarea")
  textareas.forEach((textarea) => {
    if (textarea.dataset.lunaAiInjected === "true") return
    textarea.dataset.lunaAiInjected = "true"

    const container = document.createElement("div")
    textarea.parentElement?.appendChild(container)
    const root = createRoot(container)
    root.render(<GenerateButton textarea={textarea} />)
    injectedButtons.set(textarea, { root, container })
  })
}

/**
 * プロフィール編集ページ(/user/mod)の編集オーバーレイに
 * 「AIで改善」ボタンを注入する。欄はplaceholder（フォールバックで
 * オーバーレイ見出し）から判別し、判別不能なら注入しない。
 */
function findOverlayHeading(textarea: HTMLTextAreaElement): string {
  let node: HTMLElement | null = textarea.parentElement
  for (let hops = 0; hops < 12 && node; hops++) {
    const text = node.innerText || ""
    if (text.includes("保存する")) {
      return (text.split("\n")[0] || "").trim()
    }
    node = node.parentElement
  }
  return ""
}

function injectProfileButtons() {
  if (location.pathname !== "/user/mod") return

  const textareas = document.querySelectorAll("textarea")
  textareas.forEach((textarea) => {
    if (textarea.dataset.lunaAiInjected === "true") return
    if (textarea.dataset.lunaProfileSkip === "true") return

    // placeholderで判別できれば見出し探索（innerText=layout強制）を省く
    let fieldType = detectProfileField(textarea.placeholder)
    if (!fieldType) fieldType = detectProfileField(null, findOverlayHeading(textarea))
    if (!fieldType) {
      // placeholderを持つのに判別不能な欄は対象外として確定し、
      // mutationバッチごとの再探索を止める（placeholder無しは次回再判定）
      if ((textarea.placeholder || "").trim()) textarea.dataset.lunaProfileSkip = "true"
      return
    }
    textarea.dataset.lunaAiInjected = "true"

    const container = document.createElement("div")
    textarea.parentElement?.appendChild(container)
    const root = createRoot(container)
    root.render(<ProfileImproveButton textarea={textarea} fieldType={fieldType} />)
    injectedButtons.set(textarea, { root, container })
  })
}

/**
 * DOM から外れた textarea のボタンを unmount して後始末する
 */
function cleanupDetachedButtons() {
  for (const [textarea, { root, container }] of injectedButtons) {
    if (!textarea.isConnected) {
      root.unmount()
      container.remove()
      injectedButtons.delete(textarea)
    }
  }
}

/**
 * DOM変化に応じた処理をまとめて実行する。
 * 各処理は冪等(同じ結果なら書き込まない)なので、自身の書き込みで
 * 無限ループにはならない。
 */
function processDom() {
  cleanupDetachedButtons()
  injectButtons()
  injectProfileButtons()
}

/**
 * 監視とボタン注入。
 *
 * SPA は短時間に大量の mutation を発火させるため、コールバックを
 * debounce(150ms)で集約し、メインスレッドの占有を防ぐ。以前は
 * mutation ごとに全文書を走査していて重い画面でフリーズしていた。
 */
let processTimer: ReturnType<typeof setTimeout> | null = null
function scheduleProcess() {
  if (processTimer !== null) return
  processTimer = setTimeout(() => {
    processTimer = null
    processDom()
  }, 150)
}

function initObserver() {
  const observer = new MutationObserver(scheduleProcess)
  observer.observe(document.body, { childList: true, subtree: true })
  // 初回は mutation が無くても処理する(既に存在する textarea 対応)
  processDom()
}

// 実行開始
initObserver()
addLog("info", "Luna Content Script Initialized", { url: location.href }, "CONTENT")

export default function Content() {
  return null
}
