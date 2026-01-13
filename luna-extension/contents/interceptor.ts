import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://*.luna-matching.com/*", "https://luna-matching.com/*"],
  world: "MAIN"
}

console.log("[LUNA-BOOT] API Interceptor script is loading in MAIN world")

// XHRのフック
const originalXHR = window.XMLHttpRequest
// @ts-ignore
window.XMLHttpRequest = function () {
  const xhr = new originalXHR()
  const originalOpen = xhr.open
  const originalSend = xhr.send

  // @ts-ignore
  xhr.open = function (method, url) {
    // @ts-ignore
    this._url = url
    // @ts-ignore
    this._method = method
    // @ts-ignore
    return originalOpen.apply(this, arguments)
  }

  // @ts-ignore
  xhr.send = function (body) {
    this.addEventListener("load", function () {
      // @ts-ignore
      const url = this._url
      if (url && (url.includes("/api/user/show/") || url.includes("/api/user/service/show/") || url.includes("/api/user/profile") || url.includes("/api/user/get/me"))) {
        try {
          const responseData = JSON.parse(this.responseText)
          window.postMessage({
            type: "LUNA_API_RESPONSE",
            url: url,
            method: (this as any)._method,
            data: responseData
          }, "*")
          sendLog("info", `XHR Intercepted: ${url}`, { url, data: responseData })
        } catch (e) {
          sendLog("error", `Failed to parse XHR response: ${url}`, { error: e.toString() })
        }
      }
    })
    // @ts-ignore
    return originalSend.apply(this, arguments)
  }

  return xhr
}

// Fetchのフック
const originalFetch = window.fetch
window.fetch = async (...args) => {
  const input = args[0]
  const init = args[1]
  const url = typeof input === "string" ? input : (input as Request).url
  const method = (init?.method || (input as any).method || "GET").toUpperCase()

  const response = await originalFetch(...args)
  const clone = response.clone()

  if (url.includes("/api/user/show/") || url.includes("/api/user/service/show/") || url.includes("/api/user/auth") || url.includes("/api/user/get/me") || url.includes("/api/user/profile")) {
    try {
      const buffer = await clone.arrayBuffer()
      const decoder = new TextDecoder("utf-8")
      const text = decoder.decode(buffer)
      const data = JSON.parse(text)

      window.postMessage({
        type: "LUNA_API_RESPONSE",
        url: url,
        method: method,
        data: data
      }, "*")
      sendLog("info", `Fetch Intercepted: ${url}`, { url, method, data })
    } catch (e) {
      sendLog("error", `Failed to parse Fetch response: ${url}`, { error: e.toString() })
    }
  }

  return response
}

function sendLog(level: "info" | "error" | "warn", message: string, detail?: any) {
  window.postMessage({
    type: "LUNA_LOG",
    level,
    message,
    detail,
    timestamp: new Date().toISOString()
  }, "*")
}

sendLog("info", "Luna API Interceptor injected")
