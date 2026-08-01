import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { Storage } from "@plasmohq/storage"
import { DEFAULT_PROMPT, CONTINUOUS_CONVERSATION_PROMPT, OLLAMA_DEFAULT_HOST, OLLAMA_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "./constants"
import { buildProfilePrompt, checkKinkPreservation, enforceLength, resolveAudience } from "./utils/profile-field"
import { describeAiError } from "./utils/ai-error"
import { applyReplacementRules, buildMessagePrompt } from "./utils/message-prompt"
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

  if (request.action === "generate_profile") {
    logBG("info", `Profile generation requested: ${request.fieldType}/${request.taste}`)
    handleGenerateProfile(request)
      .then((res) => sendResponse(res))
      .catch((err) => {
        logBG("error", "Failed to generate profile", { error: err.message })
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
          maxOutputTokens: 10,
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

/** 設定済みプロバイダで1回生成する（メッセージ/プロフィール共用） */
async function generateWithConfiguredProvider(
  prompt: string,
  opts: { openaiMaxTokens?: number } = {}
) {
  const aiProvider = await storage.get("aiProvider") || "gemini"
  switch (aiProvider) {
    case "ollama": {
      const model = await storage.get("ollamaModel") || OLLAMA_DEFAULT_MODEL
      const host = await storage.get("ollamaHost") || OLLAMA_DEFAULT_HOST
      const port = await storage.get("ollamaPort") || OLLAMA_DEFAULT_PORT
      return await generateWithOllama(prompt, model, `http://${host}:${port}`)
    }
    case "gemini": {
      const model = await storage.get("geminiModel") || "gemini-2.5-flash"
      return await generateWithGemini(prompt, model)
    }
    case "openai": {
      const model = await storage.get("openaiModel") || "gpt-4o"
      return await generateWithOpenAI(prompt, model, opts.openaiMaxTokens ?? 500)
    }
    default:
      throw new Error(`Unknown AI provider: ${aiProvider}`)
  }
}

/** 上限 cap を超えない範囲で最も cap に近い候補を選ぶ。両方超過なら短い方を選ぶ。 */
function pickNearCap(a: { text: string }, b: { text: string }, cap: number) {
  const aLen = a.text?.length ?? 0
  const bLen = b.text?.length ?? 0
  const aOk = aLen <= cap
  const bOk = bLen <= cap
  if (aOk && bOk) return aLen >= bLen ? a : b
  if (aOk) return a
  if (bOk) return b
  return aLen <= bLen ? a : b
}

async function handleGenerateMessage({ myProfile, targetProfile, targetName, chatHistory, isPremium, demandSupplyHint, focusTopic }: any) {
  const aiProvider = await storage.get("aiProvider") || "gemini"

  let promptTemplate = ""

  if (chatHistory) {
    promptTemplate = await storage.get<string>("continuousPromptTemplate") || CONTINUOUS_CONVERSATION_PROMPT
  } else {
    promptTemplate = await storage.get<string>("promptTemplate") || DEFAULT_PROMPT
  }

  let prompt = buildMessagePrompt({
    template: promptTemplate,
    myProfile,
    targetProfile,
    targetName,
    chatHistory,
    demandSupplyHint,
    focusTopic,
    isPremium
  })

  if (isPremium) {
    await logBG("info", "Premium message: Limit expanded to 500 characters (aim for near-limit)")
  }
  if (focusTopic && String(focusTopic).trim()) {
    await logBG("info", "Focus topic supplied from message box", { focusTopic: String(focusTopic).trim() })
  }

  // Sanitize prompt to avoid Safety/Prohibited Content errors
  // IMPORTANT: This must be done AFTER replacing variables like {my_info_clean}
  if (!prompt) {
    await logBG("error", "Prompt became empty before sanitization", { promptTemplate })
    throw new Error("プロンプトの作成に失敗しました。設定画面でプロンプトテンプレートを確認してください。")
  }

  const replacementRulesEnabled = await storage.get<boolean>("replacementRulesEnabled") ?? true
  if (replacementRulesEnabled) {
    const rules = await storage.get<{ from: string; to: string }[]>("replacementRules") || defaultReplacementRules
    prompt = applyReplacementRules(prompt, rules)
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

  const generateOnce = (p: string) =>
    generateWithConfiguredProvider(p, { openaiMaxTokens: isPremium ? 2000 : 500 })

  try {
    let result = await generateOnce(prompt)

    // Premium: 上限500を超えない範囲で、できるだけ500文字に近づける。
    // 受理帯(490〜500)に入るまで最大2回リトライし、上限超過しない最良候補を採用する。
    if (isPremium && result.text) {
      const CAP = 500
      const FLOOR = 490
      const MAX_RETRY = 2
      const inBand = (n: number) => n >= FLOOR && n <= CAP

      let attempt = 0
      while (!inBand(result.text.length) && attempt < MAX_RETRY) {
        attempt++
        const len = result.text.length
        const retryPrompt = len < FLOOR
          ? `${prompt}\n\n【再生成指示】前回は${len}文字で、上限500に対して短すぎます。選んだ一節の掘り下げと自分の開示を厚くして、上限500を超えない範囲で${FLOOR}〜${CAP}文字（できるだけ500に近づける）にしてください。`
          : `${prompt}\n\n【再生成指示】前回は${len}文字で上限500を超えています。内容を保ちつつ${FLOOR}〜${CAP}文字に収めてください。`
        await logBG("info", `Premium retry ${attempt}: ${len} chars → aiming ${FLOOR}-${CAP}`)
        const next = await generateOnce(retryPrompt)
        result = pickNearCap(result, next, CAP)
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

/**
 * プロフィール改善案の生成（1テイスト分）
 * 400字コード検証（短縮リトライ最大2回）と、嗜好欄の名詞保全チェック付き。
 */
async function handleGenerateProfile({ fieldType, taste, currentText, myProfileRaw }: any) {
  let myRaw: any = null
  try { myRaw = JSON.parse(myProfileRaw) } catch { /* 下のnullチェックで拾う */ }
  if (!myRaw) {
    throw new Error("プロフィールデータの取得に失敗しました。Lunaにログインした状態でページを再読み込みしてください。")
  }

  const audience = resolveAudience(myRaw)
  const prompt = buildProfilePrompt({ fieldType, taste, currentText: currentText || "", myRaw, audience })

  // 注意: プロフィール生成では置換ルールをプロンプトに適用しない。
  // メッセージと違い出力は保存される公開文章であり、置換で元文が書き換わると
  // 生成結果の語彙が歪む（例: 出血→激しいこと に置換され、NG欄の意味が反転する
  // 事故を実LLM評価で確認済み）。セーフティはBLOCK_NONE設定と、失敗時の
  // カード単位再生成で担保する。ルールは保全チェックの照合にのみ使う。
  const rules =
    (await storage.get<{ from: string; to: string }[]>("replacementRules")) || defaultReplacementRules

  await logBG("info", `Generating profile: ${fieldType}/${taste} (audience=${audience})`)

  const isDebugEnabled = await storage.get<boolean>("isDebugEnabled")
  if (isDebugEnabled) {
    await logBG("info", `Profile Prompt Debug: ${prompt}`)
  }

  const CAP = 400
  const candidates: string[] = []
  const first = await generateWithConfiguredProvider(prompt, { openaiMaxTokens: 1000 })
  candidates.push(first.text)

  // 400字超過時の短縮リトライ（最大2回）
  let attempt = 0
  while (candidates[candidates.length - 1].length > CAP && attempt < 2) {
    attempt++
    const len = candidates[candidates.length - 1].length
    const retryPrompt = `${prompt}\n\n【再生成指示】前回の出力は${len}文字で上限400を超えています。優先度の低い内容（推奨事項に相当する部分）から削り、330〜380字を目安に書き直してください（400字を1文字でも超えたら失格）。`
    await logBG("info", `Profile retry ${attempt}: ${len} chars > ${CAP}`)
    const next = await generateWithConfiguredProvider(retryPrompt, { openaiMaxTokens: 1000 })
    candidates.push(next.text)
  }

  let text = enforceLength(candidates, CAP)

  // 嗜好欄のみ: 元の嗜好名詞の保全チェック（セーフティによる無言の希釈検知）。
  // 読者=女性（男性ユーザー）は「主要2〜3個に絞る」原則のため lenient。
  const preservationMode = audience === "men" ? "strict" as const : "lenient" as const
  let kinkWarning: string | undefined
  if (fieldType === "kink") {
    const check = checkKinkPreservation(currentText || "", text, rules, preservationMode)
    if (!check.ok) {
      await logBG("warn", "Kink preservation failed; retrying", { missingCount: check.missing.length })
      const retryPrompt = `${prompt}\n\n【再生成指示】元の文にある嗜好（${check.missing.join("、")}）が出力から欠落しています。これらを（穏当な言い換えでもよいので）保持したまま書き直してください。400字以内厳守。`
      const next = await generateWithConfiguredProvider(retryPrompt, { openaiMaxTokens: 1000 })
      const recheck = checkKinkPreservation(currentText || "", next.text, rules, preservationMode)
      if (recheck.ok && next.text.length <= CAP) {
        text = next.text
      } else {
        // ユーザー向け警告は原語のままの方が分かりやすい（APIには送られない）
        kinkWarning = `元の嗜好の一部（${check.missing.slice(0, 5).join("、")}）が反映されていない可能性があります。`
      }
    }
  }

  // 最終テキスト確定後に警告を決める（リトライで差し替わった後の残留/上書きを防ぐ）
  const warning =
    text.length > CAP
      ? "400字に収まりませんでした。採用後に手動で調整してください。"
      : kinkWarning

  await logBG("info", `Profile generated: ${fieldType}/${taste} ${text.length} chars`)
  return { text, warning }
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
        model: google(model),
        prompt,
        providerOptions: {
          google: {
            safetySettings: [
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
          },
        },
      })

      if (!text) {
        // 安全フィルタで中断された場合、SDKは例外を投げず空文字を返す。
        // finishReason を文面に残し、下の catch で安全ブロックとして扱えるようにする。
        await logBG("error", "Gemini generated empty text", { finishReason })
        throw new Error(`Gemini generated no text. (FinishReason: ${finishReason})`)
      }

      return { text }

    } catch (e: any) {
      const described = describeAiError(e)
      // 「Invalid JSON response」等の中身の無いメッセージだけで終わらせず、
      // statusCode / responseBody / cause まで残す（原因特定に必須）
      await logBG("error", `Gemini call failed: ${described.message}`, described.detail)

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

      // 安全フィルタのブロックは判定が揺れることがあるため一度だけ再試行し、
      // それでも駄目なら原因と対処が分かるメッセージにして返す。
      if (described.isSafetyBlock && retries < 1) {
        retries++
        await logBG("warn", `Gemini safety block (${described.detail.blockReason}). Retrying once...`)
        continue
      }

      throw new Error(described.message)
    }
  }

}

async function generateWithOpenAI(prompt: string, model: string, maxOutputTokens = 500) {
  const apiKey = await syncStorage.get("openaiApiKey")
  if (!apiKey) throw new Error("OpenAI API Key is not set")

  const openai = createOpenAI({ apiKey })

  try {
    const { text } = await generateText({
      model: openai(model),
      system: "You are a helpful assistant.",
      prompt,
      maxOutputTokens,
    })

    return { text: text || "" }
  } catch (e: any) {
    const described = describeAiError(e)
    await logBG("error", `OpenAI call failed: ${described.message}`, described.detail)
    throw new Error(described.message)
  }
}

async function generateWithOllama(prompt: string, model: string, baseURL: string) {
  const ollama = createOpenAI({ baseURL: `${baseURL}/v1`, apiKey: "ollama" })

  try {
    const { text, finishReason } = await generateText({
      model: ollama(model),
      prompt,
    })

    if (!text) {
      await logBG("error", "Ollama generated empty text", { finishReason })
      throw new Error(`Ollama generated no text. (FinishReason: ${finishReason})`)
    }

    return { text }
  } catch (e: any) {
    if (/Ollama generated no text/.test(e?.message || "")) throw e
    const described = describeAiError(e)
    await logBG("error", `Ollama call failed: ${described.message}`, described.detail)
    throw new Error(described.message)
  }
}
