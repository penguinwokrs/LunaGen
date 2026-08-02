import { describe, expect, it } from "vitest"

import {
  computeDemandSupply,
  extractLookups,
  formatDemandSupplyHint,
  generateDemandSupplyHint
} from "./demand-supply"

const ROMANTIC_BANNED = ["特別な存在", "あなただけ", "離さない", "独占", "心ごと掴む"]

describe("computeDemandSupply: 生活条件（年齢）", () => {
  it("双方の年齢が互いの希望レンジに入れば相互マッチ", () => {
    const me = { age: 33, conditions_age_from: 25, conditions_age_to: 35 }
    const target = { age: 28, conditions_age_from: 30, conditions_age_to: 40 }
    const { matches } = computeDemandSupply(me, target)
    const age = matches.find((m) => m.label.includes("年齢"))
    expect(age).toBeTruthy()
    expect(age!.direction).toBe("相互")
  })

  it("片方向だけ満たす場合はその方向のマッチ", () => {
    const me = { age: 50, conditions_age_from: 25, conditions_age_to: 35 }
    const target = { age: 28, conditions_age_from: 30, conditions_age_to: 40 }
    // 自分50は相手希望30-40外 / 相手28は自分希望25-35内 → 自分→相手のみ
    const { matches } = computeDemandSupply(me, target)
    const age = matches.find((m) => m.label.includes("年齢"))
    expect(age?.direction).toBe("自分→相手")
  })

  it("年齢条件が未設定ならマッチしない", () => {
    const { matches } = computeDemandSupply({ age: 30 }, { age: 28 })
    expect(matches.find((m) => m.label.includes("年齢"))).toBeUndefined()
  })
})

describe("computeDemandSupply: 生活条件（地域）", () => {
  it("配列形式の希望地域に自分の地域が含まれれば合致", () => {
    const me = { area: 13 }
    const target = { conditions_area: ["13", "14"] }
    const { matches } = computeDemandSupply(me, target)
    expect(matches.some((m) => m.axis === "生活条件" && m.label.includes("エリア"))).toBe(true)
  })

  it("真偽群形式（conditions_area_N）にも対応する", () => {
    const me = { area: "13" }
    const target = { conditions_area_13: true, conditions_area_text: "東京" }
    const { matches } = computeDemandSupply(me, target)
    expect(matches.some((m) => m.label.includes("エリア"))).toBe(true)
  })
})

describe("computeDemandSupply: 体型・喫煙の3値", () => {
  it("希望集合に含まれれば合致、含まれなければ非合致", () => {
    const hit = computeDemandSupply({ body_type: "3" }, { conditions_body: ["3", "4"] })
    expect(hit.matches.some((m) => m.label.includes("体型"))).toBe(true)

    const miss = computeDemandSupply({ body_type: "9" }, { conditions_body: ["3", "4"] })
    expect(miss.matches.some((m) => m.label.includes("体型"))).toBe(false)
  })

  it("希望未設定（不問）はスキップ", () => {
    const { matches } = computeDemandSupply({ is_smoking: "1" }, { is_smoking: "1" })
    expect(matches.some((m) => m.label.includes("喫煙"))).toBe(false)
  })
})

describe("computeDemandSupply: 関係目的", () => {
  it("relationship_N の重なりを相互マッチにする", () => {
    const me = { relationship_1: true, relationship_3: true }
    const target = { relationship_3: true, relationship_5: true }
    const { matches } = computeDemandSupply(me, target)
    const rel = matches.find((m) => m.axis === "目的")
    expect(rel).toBeTruthy()
    expect(rel!.direction).toBe("相互")
  })
})

describe("computeDemandSupply: 役割(S/M相補)", () => {
  it("自分S寄り・相手M寄りで相補マッチ", () => {
    const me = { my_type: "A" } // dom-sadist
    const target = { my_type: "J" } // sub-masochist
    const { matches } = computeDemandSupply(me, target)
    const role = matches.find((m) => m.axis === "役割")
    expect(role?.label).toContain("相補")
  })

  it("お互いM寄りは同型マッチ", () => {
    const { matches } = computeDemandSupply({ my_type: "J" }, { my_type: "K" })
    expect(matches.find((m) => m.axis === "役割")?.label).toContain("M寄り")
  })
})

describe("computeDemandSupply: 嗜好(q_*共通)", () => {
  it("双方が高スコアの嗜好を共通マッチにする", () => {
    const me = { q_pleasure: 5, q_pain: 1 }
    const target = { q_pleasure: 4, q_pain: 0 }
    const { matches } = computeDemandSupply(me, target)
    const kink = matches.find((m) => m.axis === "嗜好")
    expect(kink?.label).toContain("快楽")
    expect(kink?.direction).toBe("相互")
  })

  it("相手だけ高スコアは avoid に入る", () => {
    const me = { q_shame: 0 }
    const target = { q_shame: 5 }
    const { avoid } = computeDemandSupply(me, target)
    expect(avoid.some((a) => a.includes("羞恥"))).toBe(true)
  })
})

describe("computeDemandSupply: 堅牢性", () => {
  it("全フィールド欠損なら matches も avoid も空", () => {
    const { matches, avoid } = computeDemandSupply({}, {})
    expect(matches).toHaveLength(0)
    expect(avoid).toHaveLength(0)
  })

  it("null 入力でも落ちない", () => {
    expect(computeDemandSupply(null, null)).toEqual({ matches: [], avoid: [] })
  })

  it("NG明記は avoid に入る", () => {
    const { avoid } = computeDemandSupply({}, { text_my_ng: "苦痛はNG" })
    expect(avoid.some((a) => a.includes("NG"))).toBe(true)
  })
})

describe("formatDemandSupplyHint", () => {
  it("strength降順で話題は上位3件・前提条件は上位3件までに制限", () => {
    const me = {
      age: 33, conditions_age_from: 25, conditions_age_to: 40, area: "13",
      conditions_area: ["13"], body_type: "3", conditions_body: ["3"],
      is_smoking: "1", conditions_is_smoking: ["1"],
      my_type: "A", q_sex: 5, q_pleasure: 5, q_dom: 5
    }
    const target = {
      age: 30, conditions_age_from: 30, conditions_age_to: 40, area: "13",
      conditions_area: ["13"], body_type: "3", conditions_body: ["3"],
      is_smoking: "1", conditions_is_smoking: ["1"],
      my_type: "J", q_sex: 4, q_pleasure: 4, q_dom: 4
    }
    const result = computeDemandSupply(me, target)
    // 話題候補（役割1件 + 嗜好3件 = 4件）・前提条件候補（生活条件4件）ともに
    // 各ブロックの上限（3件）を超える
    expect(result.matches.filter((m) => m.axis === "生活条件").length).toBeGreaterThan(3)
    const text = formatDemandSupplyHint(result)
    // 話題ブロックの箇条書きは [軸/方向] 形式、前提条件ブロックは [方向] 形式
    const topicLines = text.split("\n").filter((l) => /^- \[[^/]+\/.+\]/.test(l))
    const premiseLines = text.split("\n").filter((l) => /^- \[[^/]+\]/.test(l) && !/\//.test(l))
    expect(topicLines.length).toBe(3)
    expect(premiseLines.length).toBe(3)
  })

  it("ロマンチックな決め台詞を含まない", () => {
    const me = { my_type: "A", q_pleasure: 5, q_reliance: 5, q_restraint: 5 }
    const target = { my_type: "J", q_pleasure: 5, q_reliance: 5, q_restraint: 5 }
    const text = generateDemandSupplyHint(me, target)
    for (const banned of ROMANTIC_BANNED) {
      expect(text).not.toContain(banned)
    }
  })

  it("噛み合いゼロなら空文字", () => {
    expect(generateDemandSupplyHint({}, {})).toBe("")
  })
})

describe("lookups", () => {
  it("extractLookups が *_list を抽出する", () => {
    const resp = { user: {}, area_list: { "13": "東京都" }, foo: 1, bar_list: { a: "b" } }
    const lk = extractLookups(resp)
    expect(lk.area_list).toEqual({ "13": "東京都" })
    expect(lk.bar_list).toEqual({ a: "b" })
    expect((lk as any).foo).toBeUndefined()
  })

  it("lookup あり/なし両方で落ちず、ありなら表示名を解決", () => {
    const me = { area: "13" }
    const target = { conditions_area: ["13"], area: "13", conditions_area_self: [] }
    const withLk = generateDemandSupplyHint(me, target, { area_list: { "13": "東京都" } })
    const without = generateDemandSupplyHint(me, target)
    expect(typeof withLk).toBe("string")
    expect(typeof without).toBe("string")
  })
})

describe("formatDemandSupplyHint: 3ブロック分割", () => {
  const topicMatch = {
    axis: "嗜好" as const,
    direction: "相互" as const,
    strength: 3,
    label: "「拘束」への関心が共通（自分4/相手5）",
    talkingPoint: "拘束の指向が共通。相手の表現に合わせる。"
  }
  const premiseMatch = {
    axis: "生活条件" as const,
    direction: "相互" as const,
    strength: 2.5,
    label: "年齢がお互いの希望条件に合致",
    talkingPoint: "年齢条件が噛み合っている。前提として扱う。"
  }

  it("生活条件だけなら前提条件ブロックのみ出力し、話題ブロックを出さない", () => {
    const out = formatDemandSupplyHint({ matches: [premiseMatch], avoid: [] })
    expect(out).toContain("前提条件")
    expect(out).not.toContain("話題になりうる噛み合い")
  })

  it("前提条件ブロックには talkingPoint を出力しない", () => {
    const out = formatDemandSupplyHint({ matches: [premiseMatch], avoid: [] })
    expect(out).toContain("年齢がお互いの希望条件に合致")
    expect(out).not.toContain("前提として扱う")
  })

  it("嗜好軸は話題になりうる噛み合いブロックに入る", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch, premiseMatch], avoid: [] })
    expect(out).toContain("話題になりうる噛み合い")
    const topicIdx = out.indexOf("「拘束」への関心が共通")
    const premiseIdx = out.indexOf("年齢がお互いの希望条件に合致")
    expect(topicIdx).toBeGreaterThanOrEqual(0)
    expect(premiseIdx).toBeGreaterThan(topicIdx)
  })

  it("話題ブロックには talkingPoint を出力する", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch], avoid: [] })
    expect(out).toContain("拘束の指向が共通")
  })

  it("避ける点は独立したブロックとして維持される", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch], avoid: ["相手はNGを明記している。"] })
    expect(out).toContain("避ける点:")
    expect(out).toContain("相手はNGを明記している。")
  })

  it("マッチも避ける点も無ければ空文字", () => {
    expect(formatDemandSupplyHint({ matches: [], avoid: [] })).toBe("")
  })

  it("旧見出し『最も噛み合う1〜2点を主役にする』は出力しない", () => {
    const out = formatDemandSupplyHint({ matches: [topicMatch, premiseMatch], avoid: [] })
    expect(out).not.toContain("主役にする")
  })
})

describe("computeDemandSupply: タイプの需給（conditions_type）", () => {
  it("相手が求めるタイプに自分が該当すれば「相手→自分」", () => {
    // 自分は S型のE、相手は「M型全体」を求めている → 自分は該当しない
    // 相手は M型のK、自分は「M型全体」を求めている → 相手が自分の希望に該当
    const me = { my_type: "E", conditions_type: "M" }
    const target = { my_type: "K", conditions_type: "M" }
    const { matches } = computeDemandSupply(me, target)
    const m = matches.find((x) => x.label.includes("求めるタイプ"))
    expect(m?.direction).toBe("自分→相手")
  })

  it("双方が求めるタイプに該当すれば相互", () => {
    const me = { my_type: "E", conditions_type: "M" }
    const target = { my_type: "K", conditions_type: "S" }
    const { matches } = computeDemandSupply(me, target)
    const m = matches.find((x) => x.label.includes("求めるタイプ"))
    expect(m?.direction).toBe("相互")
    expect(m?.axis).toBe("役割")
  })

  it("集約値 S / M はグループ全体に展開される", () => {
    // 相手は "S"（S型全体）を求めている。自分は S群の U
    const me = { my_type: "U" }
    const target = { my_type: "K", conditions_type: "S" }
    const { matches } = computeDemandSupply(me, target)
    expect(matches.find((x) => x.label.includes("求めるタイプ"))).toBeTruthy()
  })

  it("個別コードの指定でも合致する", () => {
    const me = { my_type: "E,H" }
    const target = { my_type: "K", conditions_type: "H,I" }
    const { matches } = computeDemandSupply(me, target)
    expect(matches.find((x) => x.label.includes("求めるタイプ"))?.direction).toBe("相手→自分")
  })

  it("噛み合わなければタイプの需給マッチは出ない", () => {
    const me = { my_type: "E" }
    const target = { my_type: "K", conditions_type: "J,K,L" }
    const { matches } = computeDemandSupply(me, target)
    expect(matches.find((x) => x.label.includes("求めるタイプ"))).toBeUndefined()
  })

  it("タイプの需給が成立したら象限推定の役割マッチは重複して出さない", () => {
    const me = { my_type: "E", conditions_type: "M" }
    const target = { my_type: "K", conditions_type: "S" }
    const { matches } = computeDemandSupply(me, target)
    const roleMatches = matches.filter((x) => x.axis === "役割")
    expect(roleMatches).toHaveLength(1)
    expect(roleMatches[0].label).toContain("求めるタイプ")
  })

  it("conditions_type が無ければ従来どおり象限推定で役割を出す", () => {
    const me = { my_type: "E" } // S寄り
    const target = { my_type: "K" } // M寄り
    const { matches } = computeDemandSupply(me, target)
    const role = matches.find((x) => x.axis === "役割")
    expect(role?.label).toContain("相補的")
  })
})
