import { Storage } from "@plasmohq/storage"
import { DEFAULT_PROMPT, CONTINUOUS_CONVERSATION_PROMPT } from "./constants"
import { addLog } from "./utils/logger"

import { replacementRules } from "./assets/replacement_rules"

const storage = new Storage({ area: "local" })
const syncStorage = new Storage({ area: "sync" })

const logBG = (level: string, message: string, detail?: any) => addLog(level, message, detail, "BG")

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generate_message") {
    logBG("info", "Generating message...")
    handleGenerateMessage(request)
      .then((res) => {
        logBG("info", "Message generated successfully")
        sendResponse(res)
      })
      .catch((err) => {
        logBG("error", "Failed to generate message", { error: err.message })
        sendResponse({ error: err.message })
      })
    return true
  }

  if (request.action === "test_api") {
    logBG("info", `Testing API: ${request.provider}`)
    handleTestApi(request)
      .then((res) => {
        logBG("info", "Test API Success", res)
        sendResponse(res)
      })
      .catch((err) => {
        logBG("error", "Test API Failed", { error: err.message })
        sendResponse({ error: err.message })
      })
    return true
  }
})

async function handleTestApi({ provider, apiKey, model }: any) {
  const testPrompt = "hello, world!!"
  logBG("info", `Sending test request to ${provider}`, { model })
  try {
    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] })
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || "Gemini API Error")
      }
      const data = await response.json()
      return { success: true, text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" }
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
      return { success: true, text: data.choices?.[0]?.message?.content || "" }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

async function handleGenerateMessage({ myProfile, targetProfile, chatHistory, isPremium }: any) {
  const aiProvider = await storage.get("aiProvider") || "gemini"
  
  let promptTemplate = ""

  if (chatHistory) {
      promptTemplate = await storage.get<string>("continuousPromptTemplate") || CONTINUOUS_CONVERSATION_PROMPT
  } else {
      promptTemplate = await storage.get<string>("promptTemplate") || DEFAULT_PROMPT
  }

  let prompt = promptTemplate

  if (isPremium) {
    prompt = prompt.replace("200文字以内", "500文字以内")
    await logBG("info", "Premium message: Limit expanded to 500 characters")
  }

  prompt = prompt
    .replace("{my_info_clean}", myProfile)
    .replace("{target_info_clean}", targetProfile)

  if (chatHistory) {
      prompt = prompt.replace("{chat_history}", chatHistory)
  }

  // Sanitize prompt to avoid Safety/Prohibited Content errors
  // IMPORTANT: This must be done AFTER replacing variables like {my_info_clean}
  replacementRules.forEach(rule => {
    // Use global replacement to catch all instances
    prompt = prompt.split(rule.from).join(rule.to)
  })

  await logBG("info", `Using AI Provider: ${aiProvider}`, { isPremium: !!isPremium, hasHistory: !!chatHistory })

  if (aiProvider === "gemini") {
    const model = await storage.get("geminiModel") || "gemini-1.5-flash"
    return await generateWithGemini(prompt, model)
  } else {
    const model = await storage.get("openaiModel") || "gpt-4o"
    return await generateWithOpenAI(prompt, model)
  }
}

async function generateWithGemini(prompt: string, model: string) {
  const apiKey = await syncStorage.get("geminiApiKey")
  if (!apiKey) throw new Error("Gemini API Key is not set")

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  
  let retries = 0
  const maxRetries = 3
  
  while (retries <= maxRetries) {
    try {
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

      if (response.status === 503) {
        throw new Error("Overloaded")
      }

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || "Gemini API Error")
      }

      const data = await response.json()
      const candidate = data.candidates?.[0]
      const text = candidate?.content?.parts?.[0]?.text
    
      if (!text) {
        await logBG("error", "Gemini Raw Response for Empty Text", { data })
    
        let details = "UNKNOWN_ERROR"
        if (candidate?.finishReason) {
          details = `FinishReason: ${candidate.finishReason}`
        } else if (data.promptFeedback) {
          const blockReason = data.promptFeedback.blockReason
          if (blockReason) {
            details = `PromptBlocked: ${blockReason}`
          } else {
            details = `PromptFeedback: ${JSON.stringify(data.promptFeedback)}`
          }
        }
    
        throw new Error(`Gemini generated no text. (${details})`)
      }
    
      return { text }

    } catch (e: any) {
      if (e.message === "Overloaded" && retries < maxRetries) {
        retries++
        const waitTime = Math.pow(2, retries) * 1000
        await logBG("warn", `Gemini Overloaded. Retrying in ${waitTime}ms... (${retries}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }
      if (e.message === "Overloaded") {
         throw new Error("サーバーが現在混雑しています (503 Overloaded)。時間をおいて試すか、オプション画面でモデルを変更してください。")
      }
      throw e
    }
  }
  const data = await response.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text

  if (!text) {
    await logBG("error", "Gemini Raw Response for Empty Text", { data })

    let details = "UNKNOWN_ERROR"
    if (candidate?.finishReason) {
      details = `FinishReason: ${candidate.finishReason}`
    } else if (data.promptFeedback) {
      const blockReason = data.promptFeedback.blockReason
      if (blockReason) {
        details = `PromptBlocked: ${blockReason}`
      } else {
        details = `PromptFeedback: ${JSON.stringify(data.promptFeedback)}`
      }
    }

    throw new Error(`Gemini generated no text. (${details})`)
  }

  return { text }
}

async function generateWithOpenAI(prompt: string, model: string) {
  const apiKey = await syncStorage.get("openaiApiKey")
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
