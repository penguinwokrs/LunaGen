import { describe, expect, it } from "vitest"

import {
  CONTINUOUS_CONVERSATION_PROMPT,
  DEFAULT_PROMPT,
  LEGACY_CONTINUOUS_PROMPT_V1,
  LEGACY_DEFAULT_PROMPT_V1
} from "./constants"

// プロンプトが具体トピックを名指しすると、LLMは素材が無くてもその話題へ逃げる。
// 食べ物の混入はこれが原因だったので、具体名詞の再混入をテストで縛る。
const CONCRETE_TOPIC_WORDS = [
  "食事", "ご飯", "ごはん", "飲みに", "グルメ", "料理", "レストラン",
  "カフェ", "ランチ", "ディナー", "お酒", "居酒屋"
]

describe("DEFAULT_PROMPT", () => {
  it("具体的な話題を名指ししない", () => {
    for (const word of CONCRETE_TOPIC_WORDS) {
      expect(DEFAULT_PROMPT, `「${word}」が含まれている`).not.toContain(word)
    }
  })

  it("素材外の話題を禁止する行を持つ", () => {
    expect(DEFAULT_PROMPT).toContain("相手のプロフィールに無い話題を持ち出すこと")
  })

  it("3ステップの手順を持つ", () => {
    expect(DEFAULT_PROMPT).toContain("# ステップ1: 主役にする一節を選ぶ")
    expect(DEFAULT_PROMPT).toContain("# ステップ2: 自分の側の具体を1つ添える")
    expect(DEFAULT_PROMPT).toContain("# ステップ3: 答えやすい問いで締める")
  })

  it("自由記述が少ない相手のフォールバックを持つ", () => {
    expect(DEFAULT_PROMPT).toContain("# 相手の自由記述が少ない場合")
    expect(DEFAULT_PROMPT).toContain("100文字程度で短く書く")
  })

  it("プレースホルダを両方持つ", () => {
    expect(DEFAULT_PROMPT).toContain("{my_info_clean}")
    expect(DEFAULT_PROMPT).toContain("{target_info_clean}")
  })

  it("プレミアム加工が効く文字数指定の文面を持つ", () => {
    // utils/premium.ts の applyPremiumPrompt が置換対象にする文面
    expect(DEFAULT_PROMPT).toContain("200文字以内")
  })
})

describe("LEGACY プロンプト定数", () => {
  it("旧デフォルトは新デフォルトと異なる", () => {
    expect(LEGACY_DEFAULT_PROMPT_V1).not.toBe(DEFAULT_PROMPT)
  })

  it("旧デフォルトは食に関する行を持つ（移行判定の対象そのもの）", () => {
    expect(LEGACY_DEFAULT_PROMPT_V1).toContain("食事・飲みの誘いは禁止")
  })

  it("旧継続プロンプトは新継続プロンプトと異なる", () => {
    expect(LEGACY_CONTINUOUS_PROMPT_V1).not.toBe(CONTINUOUS_CONVERSATION_PROMPT)
  })
})
