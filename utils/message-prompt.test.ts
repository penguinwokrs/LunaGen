import { describe, expect, it } from "vitest"

import { applyReplacementRules, buildMessagePrompt } from "./message-prompt"

const TEMPLATE = `テンプレ本文

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}`

const CONTINUOUS_TEMPLATE = `${TEMPLATE}

# 会話履歴
{chat_history}`

const base = { template: TEMPLATE, myProfile: "私のプロフ", targetProfile: "相手のプロフ" }

describe("buildMessagePrompt: 変数の置換", () => {
  it("自分と相手のプロフィールを差し込む", () => {
    const out = buildMessagePrompt(base)
    expect(out).toContain("私のプロフ")
    expect(out).toContain("相手のプロフ")
    expect(out).not.toContain("{my_info_clean}")
    expect(out).not.toContain("{target_info_clean}")
  })

  it("[相手の名前] を実名に置換する", () => {
    const out = buildMessagePrompt({ ...base, template: "[相手の名前]さん、[相手の名前]さん", targetName: "ハナ" })
    expect(out).toBe("ハナさん、ハナさん")
  })

  it("名前が空なら「ゲスト」にする", () => {
    const out = buildMessagePrompt({ ...base, template: "[相手の名前]さん", targetName: "   " })
    expect(out).toBe("ゲストさん")
  })

  it("会話履歴があれば差し込む", () => {
    const out = buildMessagePrompt({ ...base, template: CONTINUOUS_TEMPLATE, chatHistory: "Me: やあ" })
    expect(out).toContain("Me: やあ")
    expect(out).not.toContain("{chat_history}")
  })
})

describe("buildMessagePrompt: 分析セクションの挿入", () => {
  it("需給マッチヒントを相手のプロフィール見出しの前に入れる", () => {
    const out = buildMessagePrompt({ ...base, demandSupplyHint: "噛み合いメモ" })
    expect(out).toContain("噛み合いメモ")
    expect(out.indexOf("噛み合いメモ")).toBeLessThan(out.indexOf("# 相手のプロフィール"))
  })

  it("優先話題は分析セクションの先頭に置く", () => {
    const out = buildMessagePrompt({ ...base, demandSupplyHint: "噛み合いメモ", focusTopic: "旅行" })
    expect(out).toContain("旅行")
    expect(out.indexOf("旅行")).toBeLessThan(out.indexOf("噛み合いメモ"))
  })

  it("空白だけの優先話題は無視する", () => {
    const out = buildMessagePrompt({ ...base, focusTopic: "   " })
    expect(out).not.toContain("優先話題")
  })

  it("初回メッセージでは相手の【求める条件】を補足として添える", () => {
    const out = buildMessagePrompt({
      ...base,
      targetProfile: "【求める条件】\n優しい人\n【NG】\nなし"
    })
    expect(out).toContain("補足: 相手が自由記述した求める条件")
    expect(out).toContain("優しい人")
  })

  it("会話継続では【求める条件】の補足を添えない", () => {
    const out = buildMessagePrompt({
      ...base,
      template: CONTINUOUS_TEMPLATE,
      targetProfile: "【求める条件】\n優しい人",
      chatHistory: "Me: やあ"
    })
    expect(out).not.toContain("補足: 相手が自由記述した求める条件")
  })

  it("マーカーが無いテンプレートでは末尾に追記する", () => {
    const out = buildMessagePrompt({ ...base, template: "マーカー無し", demandSupplyHint: "噛み合いメモ" })
    expect(out.endsWith("噛み合いメモ")).toBe(true)
  })
})

describe("buildMessagePrompt: プレミアム", () => {
  it("isPremium のとき文字数指定が拡張される", () => {
    const template = "文字数は合計200文字以内（厳守。200文字を1文字でも超えたら失格）"
    const out = buildMessagePrompt({ ...base, template, isPremium: true })
    expect(out).toContain("500")
    expect(out).not.toBe(template)
  })
})

describe("applyReplacementRules", () => {
  it("すべての出現箇所を置換する", () => {
    expect(applyReplacementRules("蝋燭と蝋燭", [{ from: "蝋燭", to: "温感" }])).toBe("温感と温感")
  })

  it("to が空なら削除する", () => {
    expect(applyReplacementRules("あ薬い", [{ from: "薬", to: "" }])).toBe("あい")
  })

  it("from が空のルールは無視する", () => {
    expect(applyReplacementRules("そのまま", [{ from: "", to: "X" }])).toBe("そのまま")
  })
})
