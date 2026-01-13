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


  if (request.action === "test_api") {
    handleTestApi(request)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ error: err.message }))
    return true
  }
})

async function handleTestApi({ provider, apiKey, model }) {
  const testPrompt = "hello, world!!"
  try {
    if (provider === "gemini") {
      // Use helper but override apiKey/model for testing
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: testPrompt }] }]
        })
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || "Gemini API Error")
      }
      const data = await response.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
      return { success: true, text }
    } else {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 10
        })
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || "OpenAI API Error")
      }
      const data = await response.json()
      const text = data.choices?.[0]?.message?.content || ""
      return { success: true, text }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}


async function handleGenerateMessage({ myProfile, targetProfile }) {
  const aiProvider = await storage.get("aiProvider") || "gemini"
  const promptTemplate = await storage.get("promptTemplate")

  if (!promptTemplate) {
    await addLog("error", "Prompt template is missing")
    throw new Error("Prompt template is missing")
  }

  const prompt = promptTemplate
    .replace("{my_info_clean}", myProfile)
    .replace("{target_info_clean}", targetProfile)

  await addLog("info", `Using AI Provider: ${aiProvider}`, {
    myProfileLength: myProfile?.length,
    targetProfileLength: targetProfile?.length,
    promptPreview: prompt.substring(0, 200) + "..."
  })

  if (aiProvider === "gemini") {
    const model = await storage.get("geminiModel") || "gemini-1.5-flash"
    await addLog("info", `Gemini Model: ${model}`)
    return await generateWithGemini(prompt, model)
  } else {
    const model = await storage.get("openaiModel") || "gpt-4o"
    await addLog("info", `OpenAI Model: ${model}`)
    return await generateWithOpenAI(prompt, model)
  }
}

async function generateWithGemini(prompt: string, model: string) {
  const apiKey = await storage.get("geminiApiKey")
  if (!apiKey) {
    await addLog("error", "Gemini API Key is not set")
    throw new Error("Gemini API Key is not set")
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  await addLog("info", "Requesting Gemini API...")
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
    await addLog("error", "Gemini API Error Response", err)
    throw new Error(err.error?.message || "Gemini API Error")
  }
  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  await addLog("info", "Gemini API Response Received", { textLength: text.length })
  return { text }
}

async function generateWithOpenAI(prompt: string, model: string) {
  const apiKey = await storage.get("openaiApiKey")
  if (!apiKey) {
    await addLog("error", "OpenAI API Key is not set")
    throw new Error("OpenAI API Key is not set")
  }

  await addLog("info", "Requesting OpenAI API...")
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
    await addLog("error", "OpenAI API Error Response", err)
    throw new Error(err.error?.message || "OpenAI API Error")
  }
  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ""
  await addLog("info", "OpenAI API Response Received", { textLength: text.length })
  return { text }
}
