/**
 * 需給マッチ分析モジュール
 *
 * 相手と自分のプロフィールを突き合わせ、「相手が求める条件 × 自分が出せるもの」と
 * 「自分が求める条件 × 相手が出せるもの」の双方向で噛み合う点を抽出する。
 *
 * 関係目的・役割(S/M)・生活条件・嗜好(kink) の4軸を対等に扱い、最も噛み合う点を
 * 強い順に返す。kink の象限/スコア計算は kink-analysis.ts を再利用する。
 *
 * 出力は実務的・具体的なトーン。ロマンチックな決め台詞は使わない。
 */
import { analyzeKinkType } from "./kink-analysis"

export type Axis = "目的" | "役割" | "生活条件" | "嗜好"
export type Direction = "相手→自分" | "自分→相手" | "相互"

export interface DemandMatch {
  axis: Axis
  direction: Direction
  /** 並び替え用スコア（相互＞片方向、共通度が高いほど大） */
  strength: number
  /** 噛み合いの要約ラベル */
  label: string
  /** メッセージへの落とし込み方（実務的・非ロマンチック） */
  talkingPoint: string
}

export interface DemandSupplyResult {
  matches: DemandMatch[]
  avoid: string[]
}

/** `*_list` ルックアップ表（コード→表示名）。無くても動く。 */
export type Lookups = Record<string, Record<string, string> | undefined>

// ===== 小さなヘルパ（欠損に強く） =====

function num(v: any): number | null {
  if (v === undefined || v === null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 配列 / カンマ区切り文字列 / 単一値 を文字列コード集合へ正規化 */
function toCodeSet(v: any): Set<string> {
  const out = new Set<string>()
  if (v === undefined || v === null) return out
  if (Array.isArray(v)) {
    v.forEach((x) => x !== null && x !== undefined && out.add(String(x)))
    return out
  }
  if (typeof v === "string") {
    v.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s))
    return out
  }
  if (typeof v === "object") {
    // {key: truthy} 形式
    for (const k of Object.keys(v)) if (v[k]) out.add(k)
    return out
  }
  out.add(String(v))
  return out
}

/** `prefix + 数字` の真偽キー群から、真の数字サフィックス集合を集める
 *  例: conditions_area_3 = true → "3"（conditions_area_text 等の非数字は除外） */
function collectFlagSet(data: any, prefix: string): Set<string> {
  const out = new Set<string>()
  if (!data || typeof data !== "object") return out
  for (const k of Object.keys(data)) {
    if (k.startsWith(prefix) && data[k]) {
      const suffix = k.slice(prefix.length)
      if (/^\d+$/.test(suffix)) out.add(suffix)
    }
  }
  return out
}

/** 相手が求める「地域/体型」等の条件集合（配列形式 + 真偽群の両対応） */
function conditionSet(data: any, field: string): Set<string> {
  const a = toCodeSet(data?.[field])
  const b = collectFlagSet(data, `${field}_`)
  return new Set<string>([...a, ...b])
}

function resolve(code: string | null, list?: Record<string, string>): string {
  if (code === null) return ""
  if (list && list[code]) return list[code]
  return code
}

function setIntersection(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x))
}

// ===== 双方向の充足を1件の match にまとめる =====

interface BidiOpts {
  axis: Axis
  baseStrength: number
  satisfiedToMe: boolean // 自分の供給が相手の需要を満たす（相手→自分）
  satisfiedToYou: boolean // 相手の供給が自分の需要を満たす（自分→相手）
  labelMutual: string
  labelToMe: string
  labelToYou: string
  talkingPoint: string
}

function pushBidirectional(matches: DemandMatch[], o: BidiOpts) {
  if (o.satisfiedToMe && o.satisfiedToYou) {
    matches.push({
      axis: o.axis,
      direction: "相互",
      strength: o.baseStrength + 1.5,
      label: o.labelMutual,
      talkingPoint: o.talkingPoint
    })
  } else if (o.satisfiedToMe) {
    matches.push({ axis: o.axis, direction: "相手→自分", strength: o.baseStrength, label: o.labelToMe, talkingPoint: o.talkingPoint })
  } else if (o.satisfiedToYou) {
    matches.push({ axis: o.axis, direction: "自分→相手", strength: o.baseStrength, label: o.labelToYou, talkingPoint: o.talkingPoint })
  }
}

function ageInRange(person: any, age: number | null): boolean {
  if (age === null) return false
  const from = num(person?.conditions_age_from)
  const to = num(person?.conditions_age_to)
  if (from === null && to === null) return false // 条件未設定はスキップ
  if (from !== null && age < from) return false
  if (to !== null && age > to) return false
  return true
}

// ===== メイン計算（純粋関数） =====

export function computeDemandSupply(
  myData: any,
  targetData: any,
  lookups: Lookups = {}
): DemandSupplyResult {
  const matches: DemandMatch[] = []
  const avoid: string[] = []
  if (!myData || !targetData) return { matches, avoid }

  // --- 関係目的（双方が求める関係の重なり = 相互） ---
  const myRel = new Set<string>([...toCodeSet(myData.relationship), ...collectFlagSet(myData, "relationship_")])
  const tRel = new Set<string>([...toCodeSet(targetData.relationship), ...collectFlagSet(targetData, "relationship_")])
  const relShared = setIntersection(myRel, tRel)
  if (relShared.length > 0) {
    const labels = relShared.map((c) => resolve(c, lookups.relationship_list)).filter(Boolean)
    const shown = labels.length > 0 ? labels.join("・") : `${relShared.length}件`
    matches.push({
      axis: "目的",
      direction: "相互",
      strength: 2 + relShared.length,
      label: `求める関係性が重なる（${shown}）`,
      talkingPoint: "同じ関係性を探している点に軽く触れると、ゴールが一致していると伝わる。宣言調にしない。"
    })
  }

  // --- 役割（S/M象限の相補・同型 = 相互） ---
  const myKink = analyzeKinkType(myData)
  const tKink = analyzeKinkType(targetData)
  const myDom = myKink.quadrants.includes("dom-sadist") || myKink.quadrants.includes("dom-masochist")
  const mySub = myKink.quadrants.includes("sub-masochist")
  const tDom = tKink.quadrants.includes("dom-sadist") || tKink.quadrants.includes("dom-masochist")
  const tSub = tKink.quadrants.includes("sub-masochist")
  if ((myDom && tSub) || (mySub && tDom)) {
    matches.push({
      axis: "役割",
      direction: "相互",
      strength: 4,
      label: myDom ? "役割が相補的（自分=S寄り / 相手=M寄り）" : "役割が相補的（自分=M寄り / 相手=S寄り）",
      talkingPoint: "委ねる-導くの方向性が噛み合う。役割そのものを宣言せず、自然な距離感で示す。"
    })
  } else if (myDom && tDom) {
    matches.push({ axis: "役割", direction: "相互", strength: 2.5, label: "お互いS寄り", talkingPoint: "主導権の駆け引きを楽しめる関係。軽いやり取りで。" })
  } else if (mySub && tSub) {
    matches.push({ axis: "役割", direction: "相互", strength: 2.5, label: "お互いM寄り", talkingPoint: "共感ベースのやり取りが噛み合う。" })
  }

  // --- 生活条件（双方向） ---
  // 年齢
  pushBidirectional(matches, {
    axis: "生活条件",
    baseStrength: 1.5,
    satisfiedToMe: ageInRange(targetData, num(myData.age)),
    satisfiedToYou: ageInRange(myData, num(targetData.age)),
    labelMutual: "年齢がお互いの希望条件に合致",
    labelToMe: "自分の年齢が相手の希望条件に合致",
    labelToYou: "相手の年齢が自分の希望条件に合致",
    talkingPoint: "年齢条件が噛み合っている。直接「条件に合う」とは言わず前提として扱う。"
  })

  // 地域
  const myArea = myData.area !== undefined && myData.area !== null ? String(myData.area) : null
  const tArea = targetData.area !== undefined && targetData.area !== null ? String(targetData.area) : null
  const tWantArea = conditionSet(targetData, "conditions_area")
  const myWantArea = conditionSet(myData, "conditions_area")
  const areaLabel = resolve(myArea, lookups.area_list) || resolve(tArea, lookups.area_list)
  pushBidirectional(matches, {
    axis: "生活条件",
    baseStrength: 1.5,
    satisfiedToMe: !!myArea && tWantArea.size > 0 && tWantArea.has(myArea),
    satisfiedToYou: !!tArea && myWantArea.size > 0 && myWantArea.has(tArea),
    labelMutual: `居住エリアがお互いの希望に合致${areaLabel ? `（${resolve(tArea, lookups.area_list)}付近）` : ""}`,
    labelToMe: "自分の居住エリアが相手の希望に合致",
    labelToYou: `相手の居住エリアが自分の希望に合致${resolve(tArea, lookups.area_list) ? `（${resolve(tArea, lookups.area_list)}）` : ""}`,
    talkingPoint: "エリアが噛み合う。会いやすさ・距離感に軽く触れられる。"
  })

  // 体型
  const myBody = myData.body_type !== undefined && myData.body_type !== null ? String(myData.body_type) : null
  const tBody = targetData.body_type !== undefined && targetData.body_type !== null ? String(targetData.body_type) : null
  pushBidirectional(matches, {
    axis: "生活条件",
    baseStrength: 1,
    satisfiedToMe: !!myBody && conditionSet(targetData, "conditions_body").has(myBody),
    satisfiedToYou: !!tBody && conditionSet(myData, "conditions_body").has(tBody),
    labelMutual: "体型の希望がお互いに合致",
    labelToMe: "自分の体型が相手の希望に合致",
    labelToYou: "相手の体型が自分の希望に合致",
    talkingPoint: "体型条件が噛み合う。直接的な容姿言及はせず前提に留める。"
  })

  // 喫煙
  const mySmoke = myData.is_smoking !== undefined && myData.is_smoking !== null ? String(myData.is_smoking) : null
  const tSmoke = targetData.is_smoking !== undefined && targetData.is_smoking !== null ? String(targetData.is_smoking) : null
  pushBidirectional(matches, {
    axis: "生活条件",
    baseStrength: 0.8,
    satisfiedToMe: !!mySmoke && conditionSet(targetData, "conditions_is_smoking").has(mySmoke),
    satisfiedToYou: !!tSmoke && conditionSet(myData, "conditions_is_smoking").has(tSmoke),
    labelMutual: "喫煙の希望がお互いに合致",
    labelToMe: "自分の喫煙状況が相手の希望に合致",
    labelToYou: "相手の喫煙状況が自分の希望に合致",
    talkingPoint: "喫煙条件が噛み合う。生活面の相性として自然に。"
  })

  // プライベートパートナー
  const myPp = myData.is_private_partner !== undefined && myData.is_private_partner !== null ? String(myData.is_private_partner) : null
  const tPp = targetData.is_private_partner !== undefined && targetData.is_private_partner !== null ? String(targetData.is_private_partner) : null
  pushBidirectional(matches, {
    axis: "生活条件",
    baseStrength: 0.8,
    satisfiedToMe: !!myPp && conditionSet(targetData, "conditions_is_private_partner").has(myPp),
    satisfiedToYou: !!tPp && conditionSet(myData, "conditions_is_private_partner").has(tPp),
    labelMutual: "パートナー状況の希望がお互いに合致",
    labelToMe: "自分のパートナー状況が相手の希望に合致",
    labelToYou: "相手のパートナー状況が自分の希望に合致",
    talkingPoint: "プライベートな前提条件が噛み合う。深追いせず前提に留める。"
  })

  // --- 嗜好（q_* 共通高スコア = 相互） ---
  for (const myScore of myKink.scores) {
    if (myScore.value < 3) continue
    const tScore = tKink.scores.find((s) => s.label === myScore.label)
    if (tScore && tScore.value >= 3) {
      matches.push({
        axis: "嗜好",
        direction: "相互",
        strength: 1.5 + (myScore.value + tScore.value) / 10,
        label: `「${myScore.label}」への関心が共通（自分${myScore.value}/相手${tScore.value}）`,
        talkingPoint: `${myScore.label}の指向が共通。相手がプロフィールで使っている表現に合わせ、自分も同じ嗜好だと具体的に示す。卑猥語・過激表現は避ける。`
      })
    }
  }

  // --- 避けるべき点 ---
  const ngText = targetData.text_my_ng || targetData.ng || targetData.dislike
  if (ngText && String(ngText).trim().length > 0) {
    avoid.push("相手はNG・拒否事項を明記している。該当事項には一切触れない（『〜はしません』と引用するのも逆効果）。")
  }
  // 相手だけが強く重視する嗜好（共通度が低い）
  const targetOnlyHigh: string[] = []
  for (const tScore of tKink.scores) {
    if (tScore.value < 4) continue
    const myScore = myKink.scores.find((s) => s.label === tScore.label)
    if (!myScore || myScore.value < 3) targetOnlyHigh.push(tScore.label)
  }
  if (targetOnlyHigh.length > 0) {
    avoid.push(`相手が重視するが共通度が低い: ${targetOnlyHigh.join("、")}。無理に触れない。`)
  }

  return { matches, avoid }
}

// ===== 整形 =====

const MAX_MATCHES = 4

export function formatDemandSupplyHint(result: DemandSupplyResult): string {
  const top = [...result.matches].sort((a, b) => b.strength - a.strength).slice(0, MAX_MATCHES)
  if (top.length === 0 && result.avoid.length === 0) return ""

  const lines: string[] = []
  if (top.length > 0) {
    lines.push("噛み合う点（強い順。最も噛み合う1〜2点を主役にする）:")
    for (const m of top) {
      lines.push(`- [${m.axis}/${m.direction}] ${m.label} — ${m.talkingPoint}`)
    }
  }
  if (result.avoid.length > 0) {
    lines.push("")
    lines.push("避ける点:")
    for (const a of result.avoid) lines.push(`- ${a}`)
  }
  return lines.join("\n")
}

/**
 * プロンプトに注入する需給マッチ分析テキストを生成する。
 * 噛み合う点が無ければ空文字を返す。
 */
export function generateDemandSupplyHint(myData: any, targetData: any, lookups: Lookups = {}): string {
  return formatDemandSupplyHint(computeDemandSupply(myData, targetData, lookups))
}

/** API レスポンス全体から `*_list` ルックアップ表を抽出する */
export function extractLookups(responseData: any): Lookups {
  const out: Lookups = {}
  if (!responseData || typeof responseData !== "object") return out
  for (const k of Object.keys(responseData)) {
    const v = responseData[k]
    if (k.endsWith("_list") && v && typeof v === "object") out[k] = v as Record<string, string>
  }
  return out
}
