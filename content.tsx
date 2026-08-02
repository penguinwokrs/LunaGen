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
      // area は数値コードで返るため、raw キャッシュには表示名を解決して同梱する
      // （area_list はレスポンス直下にあり raw には保存されない）
      if (data.area_list && profileData.area && !profileData.area_text) {
        profileData.area_text = data.area_list[String(profileData.area)]
      }
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
/**
 * ボタンをどこに挿すかを決める。
 *
 * 素直に textarea の親へ足すと、マッチ後のメッセージ画面では親が
 * `display:flex / flex-direction:row / flex-wrap:nowrap` の form なので、
 * ボタンが入力欄と横並びになって入力欄が潰れる
 * （2026-08-03 実測: 540px の行で textarea が 225px まで縮んでいた）。
 *
 * 親が折り返さない横並びの flex なら、その親自身を折り返させて、ボタンを1行目に置く。
 * 入力欄は2行目へ回るので、幅を取り合わなくなる。
 *
 * form の外に出す案は使えない。メッセージ画面の form は `position: sticky` で画面下端に
 * 貼り付いており、DOM上その直後に置くとボタンが画面外へ（実測 y=910 / 表示領域900px）、
 * 直前に置くと sticky な form の下に潜り込む（実測 838〜867 が form の 830〜900 と重なり、
 * elementFromPoint が form を返した）。form の中に入れておけば sticky に追随する。
 * それ以外（プロフィールページ等の通常のブロック）は従来どおり親の末尾に足す。
 */
function insertButtonContainer(textarea: HTMLTextAreaElement, container: HTMLElement) {
  const parent = textarea.parentElement
  if (!parent) return

  const cs = getComputedStyle(parent)
  const isRowFlex =
    (cs.display === "flex" || cs.display === "inline-flex") &&
    cs.flexDirection.startsWith("row") &&
    cs.flexWrap === "nowrap"

  if (isRowFlex) {
    // 親を折り返し可にして、幅100%のボタン行を1行目に置く。入力欄は2行目へ回る
    parent.style.flexWrap = "wrap"
    container.style.flexBasis = "100%"
    container.style.width = "100%"
    container.style.marginBottom = "6px"
    parent.insertBefore(container, parent.firstChild)

    // 入力欄は flex-basis:auto かつ width:100% で1行を占有するため、そのままだと
    // 送信ボタンがさらに次の行へ落ちる。基準幅を0にして送信ボタンと同じ行に収める
    // （flex-grow は元から1なので、残り幅いっぱいに広がる）。
    textarea.style.flexBasis = "0"
  } else {
    parent.appendChild(container)
  }
}

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
    insertButtonContainer(textarea, container)
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
