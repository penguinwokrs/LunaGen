/**
 * メッセージ生成プロンプトの組み立て（純粋関数）
 *
 * background.ts から抽出した。ユニットテストと評価ハーネス
 * （evals/test-message-quality.ts）が本番と同一の組み立てを通せるようにするため。
 * ここではログを出さない。ログは呼び出し側（background.ts）の責務。
 */
import { FOCUS_TOPIC_INSTRUCTION } from "../constants"
import { applyPremiumPrompt } from "./premium"
import { injectToneBlock } from "./tone"

/** 分析セクションの見出し */
export const ANALYSIS_SECTION_HEADING = "# プロフィール項目の突き合わせ"

/**
 * 分析セクションの扱い方。見出しの直後に置く。
 *
 * 2026-08-03 の実測（evals/diagnose-fallback-output.ts）で、Cloudflare 側の
 * オープンモデルはこのセクションを**そのまま言い直した**メッセージを書いた。
 * 例:「言葉でのやり取りを大事にしたいと思っているので、ゆっくり文章のやり取りを
 * 重ねられたら嬉しいです」——これは突き合わせ結果の読み上げであって、
 * 相手のプロフィールを読んだ証拠にならない。Gemini は抽象化するが、
 * 能力の低いモデルほど与えた分析を出力に写す。
 */
export const ANALYSIS_SECTION_NOTE = `※以下は相手を理解するための判断材料であり、メッセージに書き写す材料ではありません。
- ここに書かれた文言をそのまま、あるいは言い換えて本文に載せないこと
- 「噛み合っている」「条件が合っている」という事実自体を伝えないこと。自分の希望条件を述べる文（「〜を大事にしたいと思っているので」「〜を求めているので」等）もこれに当たる
- 使ってよいのは、この突き合わせで見つけた「どこに触れるか」という当たりだけ。本文に書く言葉は相手のプロフィール本文から取ること`

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
  /** 口調の指示文。null / 未指定なら口調ブロックを足さない */
  toneInstruction?: string | null
}

export function buildMessagePrompt({
  template,
  myProfile,
  targetProfile,
  targetName,
  chatHistory,
  demandSupplyHint,
  focusTopic,
  isPremium,
  toneInstruction
}: BuildMessagePromptInput): string {
  let prompt = template

  if (isPremium) prompt = applyPremiumPrompt(prompt)

  // split/join を使う。replace は置換文字列の $& や $' を特殊解釈するため、
  // プロフィール本文や入力欄のテキストに含まれるとプロンプトが壊れる。
  prompt = prompt.split("{my_info_clean}").join(myProfile).split("{target_info_clean}").join(targetProfile)

  const nameToUse = targetName && targetName.trim() ? targetName.trim() : "ゲスト"
  prompt = prompt.split("[相手の名前]").join(nameToUse)

  if (chatHistory) prompt = prompt.split("{chat_history}").join(chatHistory)

  const analysisSections: string[] = []

  // 0. ユーザーがメッセージ入力欄に書いた優先話題（最優先で先頭に置く）
  if (focusTopic && focusTopic.trim()) {
    analysisSections.push(FOCUS_TOPIC_INSTRUCTION.split("{focus_topic}").join(focusTopic.trim()))
  }

  // 1. プロフィール項目の突き合わせ
  if (demandSupplyHint) {
    analysisSections.push(`${ANALYSIS_SECTION_HEADING}\n${ANALYSIS_SECTION_NOTE}\n\n${demandSupplyHint}`)
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
      ? prompt.split(TARGET_PROFILE_MARKER).join(`${analysisBlock}\n\n${TARGET_PROFILE_MARKER}`)
      : `${prompt}\n\n${analysisBlock}`
  }

  prompt = injectToneBlock(prompt, toneInstruction ?? null)

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
