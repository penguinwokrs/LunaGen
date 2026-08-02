/**
 * 性癖タイプ解析モジュール
 *
 * Luna APIのmy_typeコード・q_*スコアを解析し、
 * プロフィール補足テキストとアプローチ戦略ヒントを生成する。
 */

// my_type / conditions_type のコード体系
//
// 2026-08-02、実サイトのフロントエンドバンドルから確定した定義:
//   group "S": S(=S型全体), A,B,C,D,E,F,G,H,I, U
//   group "M": M(=M型全体), J,K,L,N,O,P,Q,R,T, V
//   象限セレクタ: U="サド × サブ", S="サド × ドミ", M="マゾ × サブ", V="マゾ × ドミ"
//
// `S` と `M` は個別のセルではなく「S型全体 / M型全体」を表す集約値。
// 検索の絞り込みや conditions_type で「S型なら誰でも」の意味で使われる。
const TYPE_GROUPS: Record<"S" | "M", string[]> = {
  S: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "U"],
  M: ["J", "K", "L", "N", "O", "P", "Q", "R", "T", "V"]
}

/** コード → 所属グループ（S型 / M型） */
export const TYPE_GROUP: Record<string, "S" | "M"> = (() => {
  const out: Record<string, "S" | "M"> = {}
  for (const g of ["S", "M"] as const) for (const c of TYPE_GROUPS[g]) out[c] = g
  return out
})()

/**
 * タイプ選択（"M,Q,T" 形式）を具体的なセルコードの集合に展開する。
 * `S` / `M` の集約値はグループ全体に展開する。
 */
export function expandTypeCodes(value: unknown): Set<string> {
  const out = new Set<string>()
  if (value === undefined || value === null) return out
  const codes = String(value).split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
  for (const code of codes) {
    if (code === "S" || code === "M") {
      for (const c of TYPE_GROUPS[code]) out.add(c)
    } else if (TYPE_GROUP[code]) {
      out.add(code)
    }
  }
  return out
}

// コード → 象限分類
const QUADRANT_MAP: Record<string, string> = {
  // サド × ドミ（右上）
  A: "dom-sadist", B: "dom-sadist", C: "dom-sadist",
  D: "dom-sadist", E: "dom-sadist", F: "dom-sadist",
  G: "dom-sadist", H: "dom-sadist", I: "dom-sadist",
  // S は「S型全体」。象限セレクタでは "サド × ドミ" に割り当てられている
  S: "dom-sadist",
  // サド × サブ。U は S群に属するので、従来の "switch" は誤りだった
  U: "sub-sadist",
  // マゾ × サブ（左下）。M は「M型全体」で、象限セレクタでは "マゾ × サブ"
  J: "sub-masochist", K: "sub-masochist", L: "sub-masochist",
  N: "sub-masochist", O: "sub-masochist", P: "sub-masochist",
  M: "sub-masochist",
  // マゾ × ドミ（右下）
  Q: "dom-masochist", R: "dom-masochist", T: "dom-masochist",
  // V は象限セレクタでは "マゾ × ドミ" だが、別のセレクタでは "スイッチャー" と
  // ラベルされており解釈が割れる。従来どおり switch のままにしてある。
  V: "switch",
}

const QUADRANT_LABELS: Record<string, string> = {
  "dom-sadist": "支配的・加虐的",
  "sub-sadist": "加虐的・従属的",
  "sub-masochist": "従順・被虐的",
  "dom-masochist": "支配的・被虐的",
  "switch": "スイッチャー",
}

const Q_FIELDS: { key: string; label: string }[] = [
  { key: "q_sex", label: "性行為" },
  { key: "q_pain", label: "苦痛" },
  { key: "q_dom", label: "支配欲" },
  { key: "q_restraint", label: "拘束" },
  { key: "q_shame", label: "羞恥" },
  { key: "q_pleasure", label: "快楽" },
  { key: "q_reliance", label: "依存" },
]

interface KinkAnalysis {
  quadrants: string[]
  quadrantLabels: string[]
  scores: { label: string; value: number; key: string }[]
  highTraits: string[]
  approachType: string
}

/**
 * my_typeコードと q_* スコアから嗜好傾向を解析
 */
export function analyzeKinkType(data: any): KinkAnalysis {
  // my_type パース ("D,P" → ["D", "P"])
  const myType: string = data.my_type || ""
  const codes = myType.split(",").map((c: string) => c.trim().toUpperCase()).filter(Boolean)

  // 象限分類
  const quadrantSet = new Set<string>()
  for (const code of codes) {
    const q = QUADRANT_MAP[code]
    if (q) quadrantSet.add(q)
  }
  const quadrants = Array.from(quadrantSet)
  const quadrantLabels = quadrants.map(q => QUADRANT_LABELS[q]).filter(Boolean)

  // q_* スコア収集
  const scores: { label: string; value: number; key: string }[] = []
  for (const f of Q_FIELDS) {
    const val = data[f.key]
    if (val !== undefined && val !== null) {
      scores.push({ label: f.label, value: Number(val), key: f.key })
    }
  }

  // 高スコア特性 (4以上)
  const highTraits = scores.filter(s => s.value >= 4).map(s => s.label)

  // アプローチタイプ判定
  const approachType = determineApproachType(quadrants, data)

  return { quadrants, quadrantLabels, scores, highTraits, approachType }
}

function determineApproachType(quadrants: string[], data: any): string {
  const qDom = Number(data.q_dom) || 0
  const qReliance = Number(data.q_reliance) || 0
  const qPleasure = Number(data.q_pleasure) || 0
  const qPain = Number(data.q_pain) || 0

  const hasSub = quadrants.includes("sub-masochist")
  const hasDom = quadrants.includes("dom-sadist") || quadrants.includes("dom-masochist")
  const hasSwitch = quadrants.includes("switch")

  if (hasSwitch || (hasSub && hasDom)) return "switch"
  if (hasSub || qReliance >= 4) return "submissive"
  if (hasDom || qDom >= 4) return "dominant"
  if (qPleasure >= 4 && qPain <= 2) return "pleasure"
  if (qReliance >= 4) return "dependent"
  return "balanced"
}

/**
 * プロフィールテキストに追加する嗜好分析セクション
 */
export function formatKinkSection(data: any): string {
  const analysis = analyzeKinkType(data)
  const lines: string[] = []

  // タイプ象限
  if (analysis.quadrantLabels.length > 0) {
    lines.push(`タイプ傾向: ${analysis.quadrantLabels.join(", ")}`)
  }

  // q_* スコア一覧
  if (analysis.scores.length > 0) {
    const scoreText = analysis.scores.map(s => `${s.label}:${s.value}`).join(" ")
    lines.push(`嗜好スコア: ${scoreText}`)
  }

  // 高スコア特性
  if (analysis.highTraits.length > 0) {
    lines.push(`強い傾向: ${analysis.highTraits.join(", ")}`)
  }

  if (lines.length === 0) return ""
  return `\n【嗜好分析】\n${lines.join("\n")}`
}

/**
 * プロンプトに注入するアプローチ戦略ヒント
 * 置換ルールで消えない安全な表現を使用
 *
 * @deprecated 需給マッチ分析（utils/demand-supply.ts の generateDemandSupplyHint）に統合。
 * 現在メッセージ生成からは呼ばれていない。analyzeKinkType/formatKinkSection は引き続き利用。
 */
export function generateApproachHint(data: any): string {
  const analysis = analyzeKinkType(data)

  const hints: Record<string, string> = {
    submissive:
      "相手は甘えたい・頼りたい傾向があります。トーンの指針: 落ち着いた余裕のある話し方を意識する。ただし「守ってあげる」「受け止める」のような直接的な表現は使わず、会話の流れや雰囲気で自然に安心感を出すこと。",
    dominant:
      "相手はリードしたい傾向があります。トーンの指針: 相手を立てる姿勢を意識する。ただし卑屈にならず、素直で明るいトーンを保つこと。相手の話に興味を持って聞く姿勢が効果的。",
    pleasure:
      "相手は心地よさや楽しさを重視する傾向があります。トーンの指針: 軽やかで楽しいやり取りを意識する。重い話題や真面目すぎるトーンは避け、ポジティブな雰囲気を保つこと。",
    dependent:
      "相手は甘えたい欲求が強い傾向があります。トーンの指針: 穏やかで包容力のある話し方を意識する。ただし上から目線にならないよう、あくまで対等な立場から安心感を出すこと。",
    switch:
      "相手は柔軟なタイプです。トーンの指針: 一方的な役割（リードする側・される側）を決めつけず、対等で自然体のトーンを保つこと。相手の反応を見ながら柔軟に合わせる姿勢が重要。",
    balanced:
      "相手は特定の強い傾向がないバランス型です。トーンの指針: 嗜好面には触れず、共通の趣味や価値観に注目した自然体のアプローチを取ること。",
  }

  return hints[analysis.approachType] || hints.balanced
}

/**
 * 自分と相手の嗜好データから詳細な相性分析を生成
 * プロンプトの「嗜好マッチング分析」セクションとして注入される
 *
 * @deprecated 需給マッチ分析（utils/demand-supply.ts の generateDemandSupplyHint）に統合。
 * 現在メッセージ生成からは呼ばれていない。
 */
export function generateCompatibilityHint(myData: any, targetData: any): string {
  const myAnalysis = analyzeKinkType(myData)
  const targetAnalysis = analyzeKinkType(targetData)

  const sections: string[] = []

  // === 1. S/M・Dom/Sub の相補性分析 ===
  const myHasDom = myAnalysis.quadrants.includes("dom-sadist") || myAnalysis.quadrants.includes("dom-masochist")
  const myHasSub = myAnalysis.quadrants.includes("sub-masochist")
  const targetHasDom = targetAnalysis.quadrants.includes("dom-sadist") || targetAnalysis.quadrants.includes("dom-masochist")
  const targetHasSub = targetAnalysis.quadrants.includes("sub-masochist")

  if (myHasDom && targetHasSub) {
    sections.push("【S/M相性: 非常に良い】あなた=S寄り、相手=M寄り。相手は委ねたい・導かれたい傾向あり。メッセージでは余裕と包容力を自然に出すこと。「引っ張ってくれそう」と感じさせる言い回しが効果的。ただし初回から「躾けてあげる」等の直接的な宣言は禁止。")
  } else if (myHasSub && targetHasDom) {
    sections.push("【S/M相性: 非常に良い】あなた=M寄り、相手=S寄り。相手は主導権を握りたい傾向あり。甘え上手で素直な印象を出すと刺さる。「この子は可愛い」と思わせる反応が効果的。")
  } else if (myHasDom && targetHasDom) {
    sections.push("【S/M相性: 同タイプ】お互いS寄り。主導権の駆け引きを楽しめる関係。軽い挑発や「どっちが上か」的なニュアンスが刺さりやすい。")
  } else if (myHasSub && targetHasSub) {
    sections.push("【S/M相性: 同タイプ】お互いM寄り。共感ベースのアプローチが有効。「分かる、その感覚」的な共感表現が刺さる。")
  }

  // === 2. 嗜好スコアの共通高スコア分析 ===
  const sharedHighTraits: { label: string; myVal: number; targetVal: number; hint: string }[] = []

  const TRAIT_HINTS: Record<string, string> = {
    "性行為": "お互い性的な繋がりへの関心が高い。身体的な相性への期待を暗示的に匂わせると効果的。",
    "苦痛": "お互い痛みへの理解がある。「限界を超える感覚」「追い込まれる快感」等の暗示的な表現が強く刺さる。",
    "支配欲": "お互い支配/被支配への関心が高い。力関係や主従のニュアンスを匂わせる表現が有効。",
    "拘束": "お互い束縛・拘束への関心がある。「離さない」「独占」的なニュアンスが響く。",
    "羞恥": "お互い羞恥への感受性が高い。少しドキッとさせる際どい褒め方や、内面に踏み込む表現が効果的。",
    "快楽": "お互い快楽・心地よさを重視。「一緒にいたら気持ちいい時間が過ごせそう」的な表現が自然に刺さる。",
    "依存": "お互い深い繋がりへの欲求がある。「特別な存在」「あなただけ」的な独占的ニュアンスが刺さる。",
  }

  for (const myScore of myAnalysis.scores) {
    if (myScore.value < 3) continue
    const targetScore = targetAnalysis.scores.find(s => s.label === myScore.label)
    if (targetScore && targetScore.value >= 3) {
      const hint = TRAIT_HINTS[myScore.label]
      if (hint) {
        sharedHighTraits.push({
          label: myScore.label,
          myVal: myScore.value,
          targetVal: targetScore.value,
          hint,
        })
      }
    }
  }

  if (sharedHighTraits.length > 0) {
    // スコア合計が高い順にソート
    sharedHighTraits.sort((a, b) => (b.myVal + b.targetVal) - (a.myVal + a.targetVal))
    const traitLines = sharedHighTraits.map(t =>
      `- ${t.label}（自分:${t.myVal} / 相手:${t.targetVal}）: ${t.hint}`
    )
    sections.push(`【共通する嗜好】以下の嗜好で高い共通性あり。これらを活用してメッセージに深みを出すこと：\n${traitLines.join("\n")}`)
  }

  // === 3. 相手だけ高い特性（相手が求めているもの） ===
  const targetOnlyHigh: string[] = []
  for (const targetScore of targetAnalysis.scores) {
    if (targetScore.value < 4) continue
    const myScore = myAnalysis.scores.find(s => s.label === targetScore.label)
    if (!myScore || myScore.value < 3) {
      targetOnlyHigh.push(targetScore.label)
    }
  }

  if (targetOnlyHigh.length > 0) {
    sections.push(`【相手が特に重視する嗜好】${targetOnlyHigh.join("、")} — これらは相手にとって重要だが自分との共通度は低い。無理に触れる必要はないが、否定的な印象を与えないこと。`)
  }

  if (sections.length === 0) return ""

  return sections.join("\n\n")
}
