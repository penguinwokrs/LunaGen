/**
 * メッセージ生成プロンプトの組み立て（純粋関数）
 *
 * background.ts から抽出した。ユニットテストと評価ハーネス
 * （evals/test-message-quality.ts）が本番と同一の組み立てを通せるようにするため。
 * ここではログを出さない。ログは呼び出し側（background.ts）の責務。
 */
import { FOCUS_TOPIC_INSTRUCTION } from "../constants"
import { applyPremiumPrompt } from "./premium"

/** 分析セクションの見出し */
export const ANALYSIS_SECTION_HEADING = "# プロフィール項目の突き合わせ"

/** 分析セクションを差し込む位置のマーカー */
export const TARGET_PROFILE_MARKER = "# 相手のプロフィール"

export interface BuildMessagePromptInput {
  template: string
  myProfile: string
  targetProfile: string
  targetName?: string
  chatHistory?: string
  demandSupplyHint?: string
  focusTopic?: string
  isPremium?: boolean
}

export function buildMessagePrompt({
  template,
  myProfile,
  targetProfile,
  targetName,
  chatHistory,
  demandSupplyHint,
  focusTopic,
  isPremium
}: BuildMessagePromptInput): string {
  let prompt = template

  if (isPremium) prompt = applyPremiumPrompt(prompt)

  prompt = prompt.replace("{my_info_clean}", myProfile).replace("{target_info_clean}", targetProfile)

  const nameToUse = targetName && targetName.trim() ? targetName.trim() : "ゲスト"
  prompt = prompt.split("[相手の名前]").join(nameToUse)

  if (chatHistory) prompt = prompt.replace("{chat_history}", chatHistory)

  const analysisSections: string[] = []

  // 0. ユーザーがメッセージ入力欄に書いた優先話題（最優先で先頭に置く）
  if (focusTopic && focusTopic.trim()) {
    analysisSections.push(FOCUS_TOPIC_INSTRUCTION.replace("{focus_topic}", focusTopic.trim()))
  }

  // 1. プロフィール項目の突き合わせ
  if (demandSupplyHint) {
    analysisSections.push(`${ANALYSIS_SECTION_HEADING}\n${demandSupplyHint}`)
  }

  // 2. 相手が自由記述した求める条件（補足。初回メッセージのみ）
  if (!chatHistory && targetProfile.includes("【求める条件】")) {
    const reqMatch = targetProfile.match(/【求める条件】\n([\s\S]*?)(?=\n【|$)/)
    if (reqMatch) {
      analysisSections.push(
        `# 補足: 相手が自由記述した求める条件\n以下は相手が自ら書いた「求める条件」です。上の突き合わせと併せて参考にすること。\n\n${reqMatch[1].trim()}`
      )
    }
  }

  if (analysisSections.length > 0) {
    const analysisBlock = analysisSections.join("\n\n")
    prompt = prompt.includes(TARGET_PROFILE_MARKER)
      ? prompt.replace(TARGET_PROFILE_MARKER, `${analysisBlock}\n\n${TARGET_PROFILE_MARKER}`)
      : `${prompt}\n\n${analysisBlock}`
  }

  return prompt
}

export function applyReplacementRules(
  prompt: string,
  rules: { from: string; to: string }[]
): string {
  let out = prompt
  for (const rule of rules) {
    if (rule.from) out = out.split(rule.from).join(rule.to || "")
  }
  return out
}
