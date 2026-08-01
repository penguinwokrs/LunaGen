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
 *     パスは EVAL_CORPUS で上書き可能（他人の本番コーパスに触れずに合成コーパスで
 *     煙テストするため。EVAL_OUT_DIR で出力先も同様に上書きできる）
 *
 * 実行: リポジトリルートから
 *   pnpm exec esbuild evals/test-message-quality.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/message-eval/eval.bundle.mjs
 *   node test-results/message-eval/eval.bundle.mjs
 * モデル変更: EVAL_MODEL=gemini-2.5-pro node test-results/message-eval/eval.bundle.mjs
 *
 * EVAL_MODEL の既定値について:
 *   拡張本体の既定モデル（background.ts / options.tsx）は gemini-2.5-flash。
 *   評価ハーネスもこれに合わせてある。本番ユーザーが実際に体験する挙動を測るのが
 *   目的のため、恣意的に別モデルを既定にしない。
 *
 * 既知の制約（今回は未修正。コーパスのスキーマ拡張が必要）:
 *   generateDemandSupplyHint(myRaw, target, {}) は空の lookups で呼んでいるため、
 *   本番の extractLookups(targetRaw) と異なりエリアコード等が解決されない
 *   （例: "13" が "東京都" に変換されない）。
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

const OUT_DIR = process.env.EVAL_OUT_DIR || "test-results/message-eval"
const CORPUS = process.env.EVAL_CORPUS || "test-results/message-research/corpus.json"
mkdirSync(OUT_DIR, { recursive: true })

const apiKey = readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim()
const google = createGoogleGenerativeAI({ apiKey })
// 拡張本体の既定モデル（background.ts / options.tsx）に合わせる。理由はファイル冒頭コメント参照。
const MODEL = process.env.EVAL_MODEL || "gemini-2.5-flash"
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
  "ランチ", "ディナー", "お酒", "居酒屋", "飲みに",
  // 「食べ」の語幹で活用形（食べに行き／食べるの等）をまとめて拾う
  "食べ",
  // 名前「ぴの」からの連想バグ（修正A）で実際に生成された語
  "アイス",
  "スイーツ", "デザート", "甘いもの", "コーヒー", "お茶",
  "焼肉", "ラーメン", "寿司", "一杯"
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

interface RecipientJudgement {
  replyIntent: number | null
  feltRead: number | null
  reason: string
  /** JSONパースに失敗した場合true。集計から除外し、独立カウントするためのフラグ。 */
  parseFailed: boolean
}

async function judgeAsRecipient(message: string, profileText: string): Promise<RecipientJudgement> {
  const prompt = `あなたは以下のプロフィールの人物です。マッチングサイトでこのメッセージを受け取りました。

# あなたのプロフィール
${profileText}

# 受け取ったメッセージ
${message}

以下のJSONのみを出力してください（説明不要）:
{"replyIntent": 1〜5の整数（5=すぐ返信したい, 1=返信しない）, "feltRead": 1〜5の整数（5=自分のプロフィールを読んで書かれたと強く感じる）, "reason": "50字以内の理由"}`
  const raw = await gen(prompt)
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
    return { replyIntent: parsed.replyIntent, feltRead: parsed.feltRead, reason: parsed.reason, parseFailed: false }
  } catch {
    // パース失敗は「実在する最低点」でも「最高点」でもない欠損値。
    // ここで0点や5点相当の値を混ぜると集計が歪むので、呼び出し側で
    // parseFailed を見て平均・rate の両方から除外すること。
    return { replyIntent: null, feltRead: null, reason: `parse failed: ${raw.slice(0, 80)}`, parseFailed: true }
  }
}

interface GenericityJudgement {
  fitsThisPerson: boolean | null
  /** JSONパースに失敗した場合true。失敗を「固有性が高い＝良いスコア」に読み替えないため独立カウントする。 */
  parseFailed: boolean
}

/** 汎用性テスト: 別人のプロフィールに当てても成立してしまうか */
async function judgeGenericity(message: string, otherProfileText: string): Promise<GenericityJudgement> {
  const prompt = `以下のメッセージは、下のプロフィールの人物に宛てて書かれたものとして成立しますか。
「その人固有の内容に触れている」場合のみ成立しないと判断してください。

# プロフィール
${otherProfileText}

# メッセージ
${message}

JSONのみ出力: {"fitsThisPerson": true または false}`
  const raw = await gen(prompt)
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
    return { fitsThisPerson: parsed.fitsThisPerson === true, parseFailed: false }
  } catch {
    return { fitsThisPerson: null, parseFailed: true }
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
      // 「ぴの」を使う: 名前から食べ物（ピノ＝アイスの商品名）を連想する実害バグ（修正A）を
      // このハーネスで再現・検出するため。旧プロンプトでは「アイス」等が出てOFF_TOPIC_WORDSに
      // 引っかかり、新プロンプトでは出ないことが期待される挙動。
      targetName: "ぴの",
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
    const genericityJudgements: GenericityJudgement[] = []
    for (const other of others) genericityJudgements.push(await judgeGenericity(message, other))
    // パース失敗（fitsThisPerson: null）は「固有性が高い＝良いスコア」と
    // 読み替えず、有効な判定だけで率を出す。有効な判定が1つも無ければ null。
    const validGenericity = genericityJudgements.filter((g) => !g.parseFailed)
    const genericityParseFailures = genericityJudgements.length - validGenericity.length
    const genericityRate = validGenericity.length === 0
      ? null
      : validGenericity.filter((g) => g.fitsThisPerson === true).length / validGenericity.length

    results.push({
      id: target.id,
      variant: variant.name,
      stratum: String(target.profile ?? "").trim().length >= 100 ? "rich"
        : String(target.profile ?? "").trim().length >= 30 ? "thin" : "empty",
      message,
      checks,
      judge,
      genericityRate,
      genericityParseFailures
    })
    log(`${target.id} / ${variant.name}: ${checks.length}字 offTopic=${checks.offTopic.length} reply=${judge.replyIntent}`)
  }
}

// ===== 集計 =====

function summarize(variant: string) {
  const rows = results.filter((r) => r.variant === variant && !r.error)
  const n = rows.length
  // 全件エラーで rows が空のときは「良い値0」ではなく判定不能として扱う。
  // avgOver / lowReplyIntentRate は分母が空なら null を返し、下流のPASS判定に
  // 誤って混入しないようにする。
  const inconclusive = n === 0

  const avgOver = (validRows: any[], f: (r: any) => number) =>
    validRows.length === 0 ? null : validRows.reduce((s, r) => s + f(r), 0) / validRows.length

  // judge のJSONパース失敗は「実在最低点(1)より悪い0点」でも
  // 「最高点(5)扱いで低意欲から除外」でもない欠損値。平均・rate の両方から除外し、
  // 失敗件数を独立カウントする。
  const judgeValidRows = rows.filter((r) => !r.judge.parseFailed)
  const judgeParseFailures = rows.length - judgeValidRows.length

  // genericityRate は行ごとに「有効な判定が1つも無ければ null」として作ってあるので、
  // ここでは null の行を平均から除外するだけでよい。
  const genericityValidRows = rows.filter((r) => r.genericityRate !== null)
  const genericityJudgeParseFailures = rows.reduce((s, r) => s + (r.genericityParseFailures || 0), 0)

  return {
    n,
    inconclusive,
    errors: results.filter((r) => r.variant === variant && r.error).length,
    offTopicMessages: rows.filter((r) => r.checks.offTopic.length > 0).length,
    overLength: rows.filter((r) => r.checks.overLength).length,
    notQuestion: rows.filter((r) => !r.checks.endsWithQuestion).length,
    bannedHits: rows.filter((r) => r.checks.bannedFound.length > 0).length,
    ngMentions: rows.filter((r) => r.checks.ngMentioned.length > 0).length,
    avgSpecificity: avgOver(rows, (r) => r.checks.specificityRatio),
    judgeParseFailures,
    avgReplyIntent: avgOver(judgeValidRows, (r) => r.judge.replyIntent),
    avgFeltRead: avgOver(judgeValidRows, (r) => r.judge.feltRead),
    lowReplyIntentRate: judgeValidRows.length === 0
      ? null
      : judgeValidRows.filter((r) => r.judge.replyIntent <= 2).length / judgeValidRows.length,
    genericityJudgeParseFailures,
    avgGenericity: avgOver(genericityValidRows, (r) => r.genericityRate)
  }
}

const legacy = summarize("legacy")
const fresh = summarize("new")

const fmt = (v: any) => (v === null || v === undefined ? "N/A" : typeof v === "number" ? v.toFixed(2) : String(v))
const row = (k: string, a: any, b: any) => `| ${k} | ${fmt(a)} | ${fmt(b)} |`

// 判定不能(INCONCLUSIVE)は「値が良かったからPASS」と区別すること。
// n===0（全件エラー）と、判定用JSONパース失敗で有効データが無い（avg*がnull）の
// 両方をここでチェックする。
const verdict = (
  inconclusiveReason: boolean,
  value: number | null,
  ok: (v: number) => boolean,
  fail: (v: number) => string
): string => {
  if (inconclusiveReason || value === null) return "INCONCLUSIVE（有効な評価データなし）"
  return ok(value) ? "PASS" : fail(value)
}

const offTopicVerdict = verdict(
  fresh.inconclusive,
  fresh.offTopicMessages,
  (v) => v === 0,
  (v) => `FAIL (${v}件)`
)
const genericityVerdict = verdict(
  fresh.inconclusive,
  fresh.avgGenericity,
  (v) => v <= 0.2,
  (v) => `FAIL (${(v * 100).toFixed(0)}%)`
)
const replyIntentVerdict = verdict(
  fresh.inconclusive,
  fresh.avgReplyIntent,
  (v) => v >= 4,
  (v) => `FAIL (${v.toFixed(2)})`
)
const lowReplyIntentVerdict = verdict(
  fresh.inconclusive,
  fresh.lowReplyIntentRate,
  (v) => v <= 0.1,
  (v) => `FAIL (${(v * 100).toFixed(0)}%)`
)
const mechanicalVerdict = fresh.inconclusive
  ? "INCONCLUSIVE（有効な評価データなし）"
  : (fresh.overLength + fresh.notQuestion + fresh.bannedHits + fresh.ngMentions === 0 ? "PASS" : "FAIL")

const report = `# 初回メッセージ生成 評価レポート

model: ${MODEL} / corpus: ${corpus.length} 件 / 生成日時: ${new Date().toISOString()}

${legacy.inconclusive ? "⚠️ 旧プロンプトは評価件数0件のため判定不能（INCONCLUSIVE）です。\n" : ""}${fresh.inconclusive ? "⚠️ 新プロンプトは評価件数0件のため判定不能（INCONCLUSIVE）です。\n" : ""}
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
${row("審査JSONパース失敗（返信意欲/読まれた感）", legacy.judgeParseFailures, fresh.judgeParseFailures)}
${row("返信意欲 平均（パース失敗除く）", legacy.avgReplyIntent, fresh.avgReplyIntent)}
${row("読まれた感 平均（パース失敗除く）", legacy.avgFeltRead, fresh.avgFeltRead)}
${row("返信意欲2以下の割合（パース失敗除く）", legacy.lowReplyIntentRate, fresh.lowReplyIntentRate)}
${row("審査JSONパース失敗（汎用性）", legacy.genericityJudgeParseFailures, fresh.genericityJudgeParseFailures)}
${row("汎用性（他人成立率・パース失敗除く）", legacy.avgGenericity, fresh.avgGenericity)}

## 合格基準（新プロンプト）

評価件数0件、または該当指標に有効な判定データが無い場合は PASS/FAIL ではなく
INCONCLUSIVE（判定不能）と表示する。INCONCLUSIVE を PASS として扱わないこと。

- 素材外話題 0件 → ${offTopicVerdict}
- 汎用性 20%以下 → ${genericityVerdict}
- 返信意欲 平均4.0以上 → ${replyIntentVerdict}
- 返信意欲2以下が10%以下 → ${lowReplyIntentVerdict}
- 機械項目（超過/？/禁止表現/NG言及）全件pass → ${mechanicalVerdict}
`

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2))
writeFileSync(`${OUT_DIR}/report.md`, report)
log(`\n${report}`)
log(`保存: ${OUT_DIR}/report.md`)
