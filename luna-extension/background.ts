import { Storage } from "@plasmohq/storage"

const storage = new Storage()

async function addLog(level: string, message: string, detail?: any) {
  const logs = await storage.get<any[]>("debugLogs") || []
  const newLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
    detail
  }
  const updatedLogs = [newLog, ...logs].slice(0, 500)
  await storage.set("debugLogs", updatedLogs)
  console.log(`[LUNA-BG-${level.toUpperCase()}] ${message}`, detail || "")
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generate_message") {
    addLog("info", "Generating message...")
    handleGenerateMessage(request)
      .then((res) => {
        addLog("info", "Message generated successfully")
        sendResponse(res)
      })
      .catch((err) => {
        addLog("error", "Failed to generate message", { error: err.message })
        sendResponse({ error: err.message })
      })
    return true
  }

  if (request.action === "capture_profile_screenshot") {
    addLog("info", "Capturing profile screenshot...")
    handleCaptureScreenshot()
      .then(() => {
        addLog("info", "Screenshot captured and download triggered")
        sendResponse({ success: true })
      })
      .catch((err) => {
        addLog("error", "Failed to capture screenshot", { error: err.message })
        sendResponse({ error: err.message })
      })
    return true
  }
})

async function handleCaptureScreenshot() {
  const url = "https://luna-matching.com/profile"

  // 1. 新しいタブでプロフィールを開く
  const tab = await chrome.tabs.create({ url, active: true })

  // 2. 読み込み完了を待つ
  return new Promise((resolve, reject) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)

        // 少し待機（SPAのレンダリング待ち）
        setTimeout(async () => {
          try {
            // 3. スクリーンショット撮影
            const dataUrl = await chrome.tabs.captureVisibleTab()

            // 4. ダウンロード
            chrome.downloads.download({
              url: dataUrl,
              filename: `luna_profile_debug_${Date.now()}.png`,
              saveAs: false
            })

            resolve(true)
          } catch (e) {
            reject(e)
          }
        }, 3000)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function handleGenerateMessage({ myProfile, targetProfile }) {
  const aiProvider = await storage.get("aiProvider") || "gemini"
  const promptTemplate = await storage.get("promptTemplate")

  const prompt = promptTemplate
    .replace("{my_info_clean}", myProfile)
    .replace("{target_info_clean}", targetProfile)

  if (aiProvider === "gemini") {
    const model = await storage.get("geminiModel") || "gemini-1.5-flash"
    return await generateWithGemini(prompt, model)
  } else {
    const model = await storage.get("openaiModel") || "gpt-4o"
    return await generateWithOpenAI(prompt, model)
  }
}

async function generateWithGemini(prompt: string, model: string) {
  const apiKey = await storage.get("geminiApiKey")
  if (!apiKey) throw new Error("Gemini API Key is not set")
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      safetySettings: [
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    })
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error?.message || "Gemini API Error")
  }
  const data = await response.json()
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" }
}

async function generateWithOpenAI(prompt: string, model: string) {
  const apiKey = await storage.get("openaiApiKey")
  if (!apiKey) throw new Error("OpenAI API Key is not set")
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500
    })
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error?.message || "OpenAI API Error")
  }
  const data = await response.json()
  return { text: data.choices?.[0]?.message?.content || "" }
}
