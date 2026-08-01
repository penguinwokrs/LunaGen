/**
 * 初回メッセージ生成の実LLM評価ハーネス
 *
 * 本番と同じ buildMessagePrompt / 需給マッチ注入 / 置換ルール / safetySettings で
 * 旧プロンプト(LEGACY_DEFAULT_PROMPT_V1)と新プロンプト(DEFAULT_PROMPT)を
 * 同一コーパスに対して走らせ、差分を比較する。
 *
 * 前提:
 *   - ~/.gemini_api_key にAPIキー（コミットしないこと。中身を出力しないこと）
 *   - test-results/message-research/corpus.json（evals/collect-partner-corpus.mjs で収集）
 *
 * 実行: リポジトリルートから
 *   pnpm exec esbuild evals/test-message-quality.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/message-eval/eval.bundle.mjs
 *   node test-results/message-eval/eval.bundle.mjs
 * モデル変更: EVAL_MODEL=gemini-2.5-flash node test-results/message-eval/eval.bundle.mjs
 *
 * 【重要】コーパスは他人の実プロフィールです。評価が完了したら削除してください:
 *   rm -rf test-results/message-research test-results/message-eval
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { replacementRules } from "../assets/replacement_rules"
import { DEFAULT_PROMPT, LEGACY_DEFAULT_PROMPT_V1 } from "../constants"
import { generateDemandSupplyHint } from "../utils/demand-supply"
import { applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { extractProfileFromJSON } from "../utils/profile"

const OUT_DIR = "test-results/message-eval"
const CORPUS = "test-results/message-research/corpus.json"
mkdirSync(OUT_DIR, { recursive: true })

const apiKey = readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim()
const google = createGoogleGenerativeAI({ apiKey })
const MODEL = process.env.EVAL_MODEL || "gemini-3.5-flash"
const log = (...a: any[]) => console.log("[eval]", ...a)

const SAFETY = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
] as const

async function gen(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: google(MODEL),
    prompt,
    providerOptions: { google: { safetySettings: SAFETY } as any }
  })
  return (text || "").trim()
}

// ===== 自動チェック（決定論） =====

/** 素材外の逃げ先として実際に混入した語。見つけ次第ここに追加する。 */
const OFF_TOPIC_WORDS = [
  "食事", "ご飯", "ごはん", "グルメ", "料理", "レストラン", "カフェ",
  "ランチ", "ディナー", "お酒", "居酒屋", "飲みに"
]

const BANNED_EXPRESSIONS = [
  "プロフィール拝見", "プロフィールを見て", "そそられ", "興奮", "ムラムラ"
]

interface Checks {
  offTopic: string[]
  overLength: boolean
  length: number
  endsWithQuestion: boolean
  bannedFound: string[]
  ngMentioned: string[]
  specificityRatio: number
}

/**
 * 文末の絵文字・装飾記号を取り除いてから「？で終わっているか」を見る。
 * 生成メッセージは「〜ですか？✨」のように問いの直後へ絵文字を続けることが多く、
 * 素の /？\s*$/ ではそれらを「？で終わっていない」と誤判定してしまう
 * （煙テストで実際に4件中2件が誤検出された）。
 */
function endsWithQuestion(message: string): boolean {
  const stripped = message
    .trimEnd()
    .replace(/[\p{Extended_Pictographic}️～〜!！。、\s]+$/gu, "")
  return /[？?]$/.test(stripped)
}

function checkMessage(message: string, targetProfileText: string, ngText: string): Checks {
  const offTopic = OFF_TOPIC_WORDS.filter(
    (w) => message.includes(w) && !targetProfileText.includes(w)
  )
  const ngTerms = ngText.split(/[、。,\s]+/).map((s) => s.trim()).filter((s) => s.length >= 2)
  // 内容語の近似: 2文字以上の漢字/カタカナ連続を content word とみなす
  const contentWords = [...message.matchAll(/[一-龠々]{2,}|[ァ-ヶー]{2,}/g)].map((m) => m[0])
  const hit = contentWords.filter((w) => targetProfileText.includes(w))
  return {
    offTopic,
    length: message.length,
    overLength: message.length > 200,
    endsWithQuestion: endsWithQuestion(message),
    bannedFound: BANNED_EXPRESSIONS.filter((w) => message.includes(w)),
    ngMentioned: ngTerms.filter((t) => message.includes(t)),
    specificityRatio: contentWords.length === 0 ? 0 : hit.length / contentWords.length
  }
}

// ===== LLM審査 =====

async function judgeAsRecipient(message: string, profileText: string) {
  const prompt = `あなたは以下のプロフィールの人物です。マッチングサイトでこのメッセージを受け取りました。

# あなたのプロフィール
${profileText}

# 受け取ったメッセージ
${message}

以下のJSONのみを出力してください（説明不要）:
{"replyIntent": 1〜5の整数（5=すぐ返信したい, 1=返信しない）, "feltRead": 1〜5の整数（5=自分のプロフィールを読んで書かれたと強く感じる）, "reason": "50字以内の理由"}`
  const raw = await gen(prompt)
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    return { replyIntent: null, feltRead: null, reason: `parse failed: ${raw.slice(0, 80)}` }
  }
}

/** 汎用性テスト: 別人のプロフィールに当てても成立してしまうか */
async function judgeGenericity(message: string, otherProfileText: string): Promise<boolean> {
  const prompt = `以下のメッセージは、下のプロフィールの人物に宛てて書かれたものとして成立しますか。
「その人固有の内容に触れている」場合のみ成立しないと判断してください。

# プロフィール
${otherProfileText}

# メッセージ
${message}

JSONのみ出力: {"fitsThisPerson": true または false}`
  const raw = await gen(prompt)
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()).fitsThisPerson === true
  } catch {
    return false
  }
}

// ===== メイン =====

const corpus = JSON.parse(readFileSync(CORPUS, "utf8")).users as any[]
log(`corpus: ${corpus.length} 件, model=${MODEL}`)

// 自分のプロフィールは固定。実データがあれば使う
let myRaw: any = { age: 35, area: "13", my_type: "A", q_sex: 4, profile: "評価用の自分プロフィール" }
try {
  myRaw = JSON.parse(readFileSync("test-results/message-research/me.json", "utf8"))
  log("me.json を使用")
} catch {
  log("me.json が無いので合成プロフィールを使用")
}
const myProfileText = extractProfileFromJSON(myRaw)

const VARIANTS = [
  { name: "legacy", template: LEGACY_DEFAULT_PROMPT_V1 },
  { name: "new", template: DEFAULT_PROMPT }
]

const results: any[] = []

for (const target of corpus) {
  const targetProfileText = extractProfileFromJSON(target)
  if (!targetProfileText || targetProfileText.length < 5) continue
  const ngText = String(target.text_my_ng ?? target.ng ?? "")
  const hint = generateDemandSupplyHint(myRaw, target, {})
  const others = corpus.filter((u) => u.id !== target.id).slice(0, 3).map((u) => extractProfileFromJSON(u))

  for (const variant of VARIANTS) {
    let prompt = buildMessagePrompt({
      template: variant.template,
      myProfile: myProfileText,
      targetProfile: targetProfileText,
      targetName: "テスト",
      demandSupplyHint: hint
    })
    prompt = applyReplacementRules(prompt, replacementRules)

    let message = ""
    let error: string | null = null
    try {
      message = await gen(prompt)
    } catch (e: any) {
      error = e?.message ?? String(e)
    }

    if (error || !message) {
      results.push({ id: target.id, variant: variant.name, error: error ?? "empty" })
      log(`${target.id} / ${variant.name}: ERROR ${error ?? "empty"}`)
      continue
    }

    const checks = checkMessage(message, targetProfileText, ngText)
    const judge = await judgeAsRecipient(message, targetProfileText)
    const fitsOthers: boolean[] = []
    for (const other of others) fitsOthers.push(await judgeGenericity(message, other))

    results.push({
      id: target.id,
      variant: variant.name,
      stratum: String(target.profile ?? "").trim().length >= 100 ? "rich"
        : String(target.profile ?? "").trim().length >= 30 ? "thin" : "empty",
      message,
      checks,
      judge,
      genericityRate: fitsOthers.length === 0 ? 0 : fitsOthers.filter(Boolean).length / fitsOthers.length
    })
    log(`${target.id} / ${variant.name}: ${checks.length}字 offTopic=${checks.offTopic.length} reply=${judge.replyIntent}`)
  }
}

// ===== 集計 =====

function summarize(variant: string) {
  const rows = results.filter((r) => r.variant === variant && !r.error)
  const n = rows.length || 1
  const avg = (f: (r: any) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0) / n
  return {
    n: rows.length,
    errors: results.filter((r) => r.variant === variant && r.error).length,
    offTopicMessages: rows.filter((r) => r.checks.offTopic.length > 0).length,
    overLength: rows.filter((r) => r.checks.overLength).length,
    notQuestion: rows.filter((r) => !r.checks.endsWithQuestion).length,
    bannedHits: rows.filter((r) => r.checks.bannedFound.length > 0).length,
    ngMentions: rows.filter((r) => r.checks.ngMentioned.length > 0).length,
    avgSpecificity: avg((r) => r.checks.specificityRatio),
    avgReplyIntent: avg((r) => r.judge.replyIntent),
    avgFeltRead: avg((r) => r.judge.feltRead),
    lowReplyIntentRate: rows.filter((r) => (r.judge.replyIntent ?? 5) <= 2).length / n,
    avgGenericity: avg((r) => r.genericityRate)
  }
}

const legacy = summarize("legacy")
const fresh = summarize("new")

const row = (k: string, a: any, b: any) => `| ${k} | ${typeof a === "number" ? a.toFixed(2) : a} | ${typeof b === "number" ? b.toFixed(2) : b} |`
const report = `# 初回メッセージ生成 評価レポート

model: ${MODEL} / corpus: ${corpus.length} 件 / 生成日時: ${new Date().toISOString()}

| 指標 | 旧プロンプト | 新プロンプト |
|---|---|---|
${row("評価件数", legacy.n, fresh.n)}
${row("生成エラー", legacy.errors, fresh.errors)}
${row("素材外話題が出た件数", legacy.offTopicMessages, fresh.offTopicMessages)}
${row("200字超過", legacy.overLength, fresh.overLength)}
${row("？で終わっていない", legacy.notQuestion, fresh.notQuestion)}
${row("禁止表現あり", legacy.bannedHits, fresh.bannedHits)}
${row("NG言及あり", legacy.ngMentions, fresh.ngMentions)}
${row("固有度（参考）", legacy.avgSpecificity, fresh.avgSpecificity)}
${row("返信意欲 平均", legacy.avgReplyIntent, fresh.avgReplyIntent)}
${row("読まれた感 平均", legacy.avgFeltRead, fresh.avgFeltRead)}
${row("返信意欲2以下の割合", legacy.lowReplyIntentRate, fresh.lowReplyIntentRate)}
${row("汎用性（他人成立率）", legacy.avgGenericity, fresh.avgGenericity)}

## 合格基準（新プロンプト）

- 素材外話題 0件 → ${fresh.offTopicMessages === 0 ? "PASS" : `FAIL (${fresh.offTopicMessages}件)`}
- 汎用性 20%以下 → ${fresh.avgGenericity <= 0.2 ? "PASS" : `FAIL (${(fresh.avgGenericity * 100).toFixed(0)}%)`}
- 返信意欲 平均4.0以上 → ${fresh.avgReplyIntent >= 4 ? "PASS" : `FAIL (${fresh.avgReplyIntent.toFixed(2)})`}
- 返信意欲2以下が10%以下 → ${fresh.lowReplyIntentRate <= 0.1 ? "PASS" : `FAIL (${(fresh.lowReplyIntentRate * 100).toFixed(0)}%)`}
- 機械項目（超過/？/禁止表現/NG言及）全件pass → ${fresh.overLength + fresh.notQuestion + fresh.bannedHits + fresh.ngMentions === 0 ? "PASS" : "FAIL"}
`

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2))
writeFileSync(`${OUT_DIR}/report.md`, report)
log(`\n${report}`)
log(`保存: ${OUT_DIR}/report.md`)
