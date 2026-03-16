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
      "相手は従順で甘えたい傾向が強いです。メッセージでは頼りがいのある雰囲気を自然に出し、「一緒にいたら安心できそう」と思わせることが重要です。相手の好みを「受け止める」姿勢を見せてください。包容力とリードする余裕を感じさせつつ、威圧的にならないようにしましょう。",
    dominant:
      "相手はリードしたい傾向が強いです。メッセージでは相手の強さや頼りがいへの敬意を示し、「ついていきたい」「任せたい」という素直さをほのめかしてください。相手の主導権を尊重しつつ、自分の魅力も適度にアピールしましょう。",
    pleasure:
      "相手は快楽や心地よさを重視する傾向があります。メッセージでは感覚的な共鳴を大切にし、楽しさや心地よさを共有するトーンを意識してください。重い話題より、軽やかで魅力的なやり取りが効果的です。",
    dependent:
      "相手は誰かに依存したい・甘えたい欲求が強いです。メッセージでは受け止める器の大きさを示し、甘えを肯定する姿勢を見せてください。「そのままでいい」という安心感を与えることが重要です。",
    switch:
      "相手は柔軟な嗜好を持つスイッチャーです。メッセージでは一方的な役割を押し付けず、「一緒に色々な関係を探求できそう」という柔軟性と相性の良さを強調してください。",
    balanced:
      "相手は特定の強い傾向がなくバランス型です。メッセージでは嗜好よりも共通の趣味や価値観を重視した自然体のアプローチが効果的です。プロフィールの趣味や性格に注目してください。",
  }

  return hints[analysis.approachType] || hints.balanced
}
