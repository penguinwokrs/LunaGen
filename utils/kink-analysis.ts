/**
 * 性癖タイプ解析モジュール
 *
 * Luna APIのmy_typeコード・q_*スコアを解析し、
 * プロフィール補足テキストとアプローチ戦略ヒントを生成する。
 */

// my_type コード → 象限分類
// line.png の2軸チャート（縦: サド↔マゾ、横: サブ↔ドミ）と
// app.js のグリッド座標から特定
const QUADRANT_MAP: Record<string, string> = {
  // ドミ×サド象限 (右上)
  A: "dom-sadist", B: "dom-sadist", C: "dom-sadist",
  D: "dom-sadist", E: "dom-sadist", F: "dom-sadist",
  G: "dom-sadist", H: "dom-sadist", I: "dom-sadist",
  // サブ×マゾ象限 (左下)
  J: "sub-masochist", K: "sub-masochist", L: "sub-masochist",
  N: "sub-masochist", O: "sub-masochist", P: "sub-masochist",
  // ドミ×マゾ象限 (右下)
  Q: "dom-masochist", R: "dom-masochist", S: "dom-masochist", T: "dom-masochist",
  // スイッチャー (中央)
  U: "switch", V: "switch",
}

const QUADRANT_LABELS: Record<string, string> = {
  "dom-sadist": "支配的・加虐的",
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
  scores: { label: string; value: number }[]
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
  const scores: { label: string; value: number }[] = []
  for (const f of Q_FIELDS) {
    const val = data[f.key]
    if (val !== undefined && val !== null) {
      scores.push({ label: f.label, value: Number(val) })
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
