import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { Storage } from "@plasmohq/storage"
import { DEFAULT_PROMPT, CONTINUOUS_CONVERSATION_PROMPT } from "./constants"
import { addLog } from "./utils/logger"

import { replacementRules as defaultReplacementRules } from "./assets/replacement_rules"

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
      const google = createGoogleGenerativeAI({ apiKey })
      const { text } = await generateText({
        model: google(model),
        prompt: testPrompt,
      })
      return { success: true, text: text || "" }
    } else {
      const openai = createOpenAI({ apiKey })
      const { text } = await generateText({
        model: openai(model),
        prompt: testPrompt,
        maxTokens: 10,
      })
      return { success: true, text: text || "" }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

async function handleGenerateMessage({ myProfile, targetProfile, targetName, chatHistory, isPremium }: any) {
  const aiProvider = await storage.get("aiProvider") || "gemini"

  let promptTemplate = ""

  if (chatHistory) {
    promptTemplate = await storage.get<string>("continuousPromptTemplate") || CONTINUOUS_CONVERSATION_PROMPT
  } else {
    promptTemplate = await storage.get<string>("promptTemplate") || DEFAULT_PROMPT
  }

  let prompt = promptTemplate

  if (isPremium) {
    prompt = prompt.replace(
      "文字数は、句読点、記号、カッコ、空白、改行などすべてを含めて合計200文字以内（厳守）。",
      "文字数は、句読点、記号、カッコ、空白、改行などすべてを含めて合計500文字以内（厳守）。できる限り480〜500文字ギリギリまで使い切り、内容を充実させること。短すぎるメッセージは不可。"
    )
    await logBG("info", "Premium message: Limit expanded to 500 characters (aim for near-limit)")
  }

  prompt = prompt
    .replace("{my_info_clean}", myProfile)
    .replace("{target_info_clean}", targetProfile)

  // Replace [相手の名前] with actual name or "ゲスト"
  const nameToUse = targetName && targetName.trim() ? targetName.trim() : "ゲスト"
  prompt = prompt.split("[相手の名前]").join(nameToUse)

  if (chatHistory) {
    prompt = prompt.replace("{chat_history}", chatHistory)
  }

  // Sanitize prompt to avoid Safety/Prohibited Content errors
  // IMPORTANT: This must be done AFTER replacing variables like {my_info_clean}
  if (!prompt) {
    await logBG("error", "Prompt became empty before sanitization", { promptTemplate })
    throw new Error("プロンプトの作成に失敗しました。設定画面でプロンプトテンプレートを確認してください。")
  }

  const replacementRules = await storage.get<{ from: string; to: string }[]>("replacementRules") || defaultReplacementRules
  replacementRules.forEach(rule => {
    if (rule.from) {
      // Use global replacement to catch all instances
      prompt = prompt.split(rule.from).join(rule.to || "")
    }
  })

  if (!prompt || prompt.length < 50) {
    await logBG("warn", "Prompt is suspicious small after sanitization", { promptLength: prompt?.length })
  }

  // Debug & Logging Logic
  const isDebugEnabled = await storage.get<boolean>("isDebugEnabled")
  // Safe dev check
  const isDev = (() => {
    try {
      // @ts-ignore
      return process.env.NODE_ENV === "development"
    } catch { return false }
  })()

  if (isDebugEnabled || isDev) {
    console.log("Gemini Prompt Debug:", JSON.stringify(prompt))
    await logBG("info", `Gemini Prompt Debug: ${prompt}`)
  }

  await logBG("info", `Using AI Provider: ${aiProvider}`, { isPremium: !!isPremium, hasHistory: !!chatHistory })

  try {
    if (aiProvider === "gemini") {
      const model = await storage.get("geminiModel") || "gemini-1.5-flash"
      return await generateWithGemini(prompt, model)
    } else {
      const model = await storage.get("openaiModel") || "gpt-4o"
      return await generateWithOpenAI(prompt, model)
    }
  } catch (e: any) {
    // Log prompt on error - append to message to ensure it's saved/displayed
    await logBG("error", `Generation Failed. Prompt was: ${prompt}`, { error: e.message })
    throw e
  }
}

async function generateWithGemini(prompt: string, model: string) {
  const apiKey = await syncStorage.get("geminiApiKey")
  if (!apiKey) throw new Error("Gemini API Key is not set")

  const google = createGoogleGenerativeAI({ apiKey })

  let retries = 0
  const maxRetries = 3

  while (retries <= maxRetries) {
    try {
      const { text, finishReason } = await generateText({
        model: google(model, {
          safetySettings: [
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        }),
        prompt,
      })

      if (!text) {
        await logBG("error", "Gemini generated empty text", { finishReason })
        throw new Error(`Gemini generated no text. (FinishReason: ${finishReason})`)
      }

      return { text }

    } catch (e: any) {
      const isOverloaded = e.message?.includes("503") || e.message?.includes("Overloaded")
      if (isOverloaded && retries < maxRetries) {
        retries++
        const waitTime = Math.pow(2, retries) * 1000
        await logBG("warn", `Gemini Overloaded. Retrying in ${waitTime}ms... (${retries}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }
      if (isOverloaded) {
        throw new Error("サーバーが現在混雑しています (503 Overloaded)。時間をおいて試すか、オプション画面でモデルを変更してください。")
      }
      throw e
    }
  }

}

async function generateWithOpenAI(prompt: string, model: string) {
  const apiKey = await syncStorage.get("openaiApiKey")
  if (!apiKey) throw new Error("OpenAI API Key is not set")

  const openai = createOpenAI({ apiKey })

  const { text } = await generateText({
    model: openai(model),
    system: "You are a helpful assistant.",
    prompt,
    maxTokens: 500,
  })

  return { text: text || "" }
}
