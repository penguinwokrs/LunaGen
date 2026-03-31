import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { Storage } from "@plasmohq/storage"
import { DEFAULT_PROMPT, CONTINUOUS_CONVERSATION_PROMPT, OLLAMA_DEFAULT_HOST, OLLAMA_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "./constants"
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

async function handleTestApi({ provider, apiKey, model, baseURL }: any) {
  const testPrompt = "hello, world!!"
  logBG("info", `Sending test request to ${provider}`, { model })
  try {
    switch (provider) {
      case "gemini": {
        const google = createGoogleGenerativeAI({ apiKey })
        const { text } = await generateText({
          model: google(model),
          prompt: testPrompt,
        })
        return { success: true, text: text || "" }
      }
      case "ollama": {
        const ollamaUrl = baseURL || `http://${OLLAMA_DEFAULT_HOST}:${OLLAMA_DEFAULT_PORT}`
        const ollama = createOpenAI({ baseURL: `${ollamaUrl}/v1`, apiKey: "ollama" })
        const { text } = await generateText({
          model: ollama(model || OLLAMA_DEFAULT_MODEL),
          prompt: testPrompt,
        })
        return { success: true, text: text || "" }
      }
      case "openai": {
        const openai = createOpenAI({ apiKey })
        const { text } = await generateText({
          model: openai(model),
          prompt: testPrompt,
          maxTokens: 10,
        })
        return { success: true, text: text || "" }
      }
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

async function handleGenerateMessage({ myProfile, targetProfile, targetName, chatHistory, isPremium, kinkHint, compatibilityHint }: any) {
  const aiProvider = await storage.get("aiProvider") || "gemini"

  let promptTemplate = ""

  if (chatHistory) {
    promptTemplate = await storage.get<string>("continuousPromptTemplate") || CONTINUOUS_CONVERSATION_PROMPT
  } else {
    promptTemplate = await storage.get<string>("promptTemplate") || DEFAULT_PROMPT
  }

  let prompt = promptTemplate

  if (isPremium) {
    const premiumLimit = "文字数は句読点・記号・空白・改行すべて含めて合計480〜500文字（厳守。500文字を超えたら失格、450文字未満も失格）"
    const normalLimit = "文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）"
    if (prompt.includes(normalLimit)) {
      prompt = prompt.replace(normalLimit, premiumLimit)
    } else {
      prompt += `\n\n# 文字数制約（最重要）\n${premiumLimit}`
    }
    // Expand content rules: touch more topics to naturally fill 500 chars
    prompt = prompt.replace(
      "最も強く刺さりそうな1〜2点に絞って触れる。詰め込みすぎない",
      "分析結果から3〜4点に触れ、それぞれ自分の具体的な体験やエピソードを交えて深く掘り下げる。4〜5段落で構成し、各段落に十分な厚みを持たせること"
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

  // Build structured analysis section before target profile
  {
    const analysisSections: string[] = []

    // 1. 嗜好マッチング分析（approach hint + compatibility hint）
    if (kinkHint || compatibilityHint) {
      let kinkSection = "# 嗜好マッチング分析\n"
      if (kinkHint) {
        kinkSection += `## アプローチ戦略\n${kinkHint}\n\n`
      }
      if (compatibilityHint) {
        kinkSection += `## 相性の詳細\n${compatibilityHint}\n`
      }
      analysisSections.push(kinkSection.trimEnd())
    }

    // 2. 求める条件の強調（初回メッセージのみ）
    if (!chatHistory && targetProfile.includes("【求める条件】")) {
      const reqMatch = targetProfile.match(/【求める条件】\n([\s\S]*?)(?=\n【|$)/)
      if (reqMatch) {
        const reqText = reqMatch[1].trim()
        analysisSections.push(
          `# 相手が明示している求める条件\n以下は相手が自ら書いた「求める条件」です。自分のプロフィールでこの条件に合致する要素を特定し、メッセージ内でさりげなく伝わるようにすること。\n\n${reqText}`
        )
      }
    }

    // Insert analysis before target profile section
    if (analysisSections.length > 0) {
      const analysisBlock = analysisSections.join("\n\n")
      const marker = "# 相手のプロフィール"
      if (prompt.includes(marker)) {
        prompt = prompt.replace(marker, `${analysisBlock}\n\n${marker}`)
      } else {
        prompt += `\n\n${analysisBlock}`
      }
    }
  }

  // Sanitize prompt to avoid Safety/Prohibited Content errors
  // IMPORTANT: This must be done AFTER replacing variables like {my_info_clean}
  if (!prompt) {
    await logBG("error", "Prompt became empty before sanitization", { promptTemplate })
    throw new Error("プロンプトの作成に失敗しました。設定画面でプロンプトテンプレートを確認してください。")
  }

  const replacementRulesEnabled = await storage.get<boolean>("replacementRulesEnabled") ?? true
  if (replacementRulesEnabled) {
    const replacementRules = await storage.get<{ from: string; to: string }[]>("replacementRules") || defaultReplacementRules
    replacementRules.forEach(rule => {
      if (rule.from) {
        prompt = prompt.split(rule.from).join(rule.to || "")
      }
    })
  }

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

  const generateOnce = async (p: string) => {
    switch (aiProvider) {
      case "ollama": {
        const model = await storage.get("ollamaModel") || OLLAMA_DEFAULT_MODEL
        const host = await storage.get("ollamaHost") || OLLAMA_DEFAULT_HOST
        const port = await storage.get("ollamaPort") || OLLAMA_DEFAULT_PORT
        return await generateWithOllama(p, model, `http://${host}:${port}`)
      }
      case "gemini": {
        const model = await storage.get("geminiModel") || "gemini-1.5-flash"
        return await generateWithGemini(p, model)
      }
      case "openai": {
        const model = await storage.get("openaiModel") || "gpt-4o"
        return await generateWithOpenAI(p, model, !!isPremium)
      }
      default:
        throw new Error(`Unknown AI provider: ${aiProvider}`)
    }
  }

  try {
    let result = await generateOnce(prompt)

    // Premium: retry once if character count is way off (outside 400-500)
    if (isPremium && result.text) {
      const len = result.text.length
      if (len < 400 || len > 500) {
        const retryPrompt = len < 400
          ? `${prompt}\n\n【再生成指示】前回の出力は${len}文字で短すぎました。480〜500文字になるよう、話題を追加し、各話題にエピソードを加えてください。`
          : `${prompt}\n\n【再生成指示】前回の出力は${len}文字で長すぎました。480〜500文字に収まるよう、冗長な部分を削ってください。`
        await logBG("info", `Premium retry: ${len} chars → retrying for 480-500 range`)
        result = await generateOnce(retryPrompt)
      }
      await logBG("info", `Premium final length: ${result.text.length} chars`)
    }

    return result
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

async function generateWithOpenAI(prompt: string, model: string, isPremium = false) {
  const apiKey = await syncStorage.get("openaiApiKey")
  if (!apiKey) throw new Error("OpenAI API Key is not set")

  const openai = createOpenAI({ apiKey })

  const { text } = await generateText({
    model: openai(model),
    system: "You are a helpful assistant.",
    prompt,
    maxTokens: isPremium ? 2000 : 500,
  })

  return { text: text || "" }
}

async function generateWithOllama(prompt: string, model: string, baseURL: string) {
  const ollama = createOpenAI({ baseURL: `${baseURL}/v1`, apiKey: "ollama" })

  const { text, finishReason } = await generateText({
    model: ollama(model),
    prompt,
  })

  if (!text) {
    await logBG("error", "Ollama generated empty text", { finishReason })
    throw new Error(`Ollama generated no text. (FinishReason: ${finishReason})`)
  }

  return { text }
}
