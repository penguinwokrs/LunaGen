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
 * モデル変更:
 *   EVAL_MODEL=gemini-2.5-pro       … 生成に使うモデル
 *   EVAL_JUDGE_MODEL=gemini-2.5-pro … 審査（返信するか・汎用性）に使うモデル
 *
 * モデルの既定値について（2026-08-02 オーナー指示）:
 *   生成・審査とも gemini-3.5-flash 以上を既定とする。gemini-2.5-flash は
 *   置換ルールの実API検証（evals/verify-replacement-rules.ts）で、BLOCK_NONE 下では
 *   陽性対照すらブロックしないなど判定材料として当てにならない挙動が確認されている。
 *   拡張本体の既定モデル（background.ts / options.tsx）も同日 gemini-3.5-flash に
 *   変更したため、評価結果は既定設定のユーザーが体験する挙動と一致する。
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
import { formatCardsSection } from "../utils/cards"
import { generateDemandSupplyHint } from "../utils/demand-supply"
import { applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { extractProfileFromJSON } from "../utils/profile"

const OUT_DIR = process.env.EVAL_OUT_DIR || "test-results/message-eval"
const CORPUS = process.env.EVAL_CORPUS || "test-results/message-research/corpus.json"
mkdirSync(OUT_DIR, { recursive: true })

const apiKey = readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim()
const google = createGoogleGenerativeAI({ apiKey })
// 生成用と審査用でモデルを分ける。既定はどちらも 3.5-flash。理由はファイル冒頭コメント参照。
const MODEL = process.env.EVAL_MODEL || "gemini-3.5-flash"
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gemini-3.5-flash"
const log = (...a: any[]) => console.log("[eval]", ...a)

const SAFETY = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
] as const

async function gen(prompt: string, model: string = MODEL): Promise<string> {
  const { text } = await generateText({
    model: google(model),
    prompt,
    providerOptions: { google: { safetySettings: SAFETY } as any }
  })
  return (text || "").trim()
}

// ===== 自動チェック（決定論） =====

/**
 * 素材外の逃げ先として実際に混入した話題。見つけ次第ここに追加する。
 *
 * 語単位で「メッセージに在り、相手プロフィールに無い」を判定すると誤検出する。
 * 2026-08-02 の実測では、相手が「食べるものまで主好みに染まりたい」と書いているのに
 * メッセージ側の「食事」が語として一致せず、根拠のある発言を素材外と誤判定した。
 * そこで話題をグループにし、根拠の有無は groundStems（表記ゆれを吸収する語幹）で見る。
 */
const OFF_TOPIC_GROUPS = [
  {
    name: "飲食",
    words: [
      "食事", "ご飯", "ごはん", "グルメ", "料理", "レストラン", "カフェ",
      "ランチ", "ディナー", "お酒", "居酒屋", "飲みに",
      // 「食べ」の語幹で活用形（食べに行き／食べるの等）をまとめて拾う
      "食べ",
      // 名前「ぴの」からの連想バグで実際に生成された語
      "アイス",
      "スイーツ", "デザート", "甘いもの", "コーヒー", "お茶",
      "焼肉", "ラーメン", "寿司", "一杯"
    ],
    // 相手プロフィールにこれらのいずれかがあれば、飲食の話題には根拠がある
    // 「ご飯」「おいしい」は漢字の「食」を含まないため、これらが無いと
    // 相手が「趣味: ご飯屋さん開拓」と書いているメッセージまで素材外と誤判定する
    // （2026-08-02 の3周目で実際に1件発生した）。
    groundStems: [
      "食", "飲", "グルメ", "料理", "カフェ", "酒", "スイーツ", "甘いもの", "お茶",
      "ご飯", "ごはん", "美味", "おいし", "居酒屋",
      // プロフィールにアルファベットで書かれる場合がある（4周目で "cafe" の
      // 表記により、根拠のある応答を素材外と誤判定した）
      "cafe", "Cafe", "coffee", "Coffee", "bar", "Bar"
    ]
  }
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
  // グループごとに根拠の有無を見る。相手プロフィールがそのグループに触れていれば、
  // メッセージ側でどの語を使っても素材外ではない（表記ゆれで誤検出しないため）。
  const offTopic: string[] = []
  for (const group of OFF_TOPIC_GROUPS) {
    const grounded = group.groundStems.some((s) => targetProfileText.includes(s))
    if (grounded) continue
    offTopic.push(...group.words.filter((w) => message.includes(w)))
  }
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
  /** 実際に返信するか（行動の予測） */
  wouldReply: boolean | null
  /** 連絡先を交換するところまで行くか。Matz et al. が予測対象にした指標 */
  wouldExchangeContact: boolean | null
  /** 読まれた感。好意度とは別の構成概念なので5段階のまま残す */
  feltRead: number | null
  reason: string
  /** JSONパースに失敗した場合true。集計から除外し、独立カウントするためのフラグ。 */
  parseFailed: boolean
}

/**
 * 受信者になりきって行動を予測させる。
 *
 * 好意度の5段階（旧設計）は4回の測定すべてで4.5〜5.0に張り付き、判断材料にならなかった。
 * Matz et al. (2026, Scientific Reports) は964回のスピードデートで、LLMが連絡先交換の
 * 成否を人間の判定者と同等（r=0.12〜0.23）に予測できると報告している。行動の二値予測に
 * 変えたところ、実際に弁別するようになった（定型文・不躾な文は false、具体的な文は true）。
 *
 * 注意: 二値判定は1件あたり3回に1回ほど揺れる（校正時の実測）。個別の判定は信用せず、
 * 40件以上での「率」として読むこと。「迷ったら送らない側に倒す」のような保守寄りの
 * 誘導を入れると全件 false に倒れて弁別しなくなるので入れない。
 */
async function judgeAsRecipient(message: string, profileText: string): Promise<RecipientJudgement> {
  const prompt = `あなたは以下のプロフィールの人物です。マッチングサイトでこのメッセージを受け取りました。

# あなたのプロフィール
${profileText}

# 受け取ったメッセージ
${message}

好感度ではなく「実際に返信するかどうか」という行動として答えてください。
あなたなら実際どうするかを、正直に予測してください。

以下のJSONのみを出力してください（説明不要）:
{"wouldReply": true または false（実際に返信するか）, "wouldExchangeContact": true または false（やり取りを続けて連絡先を交換するところまで行きそうか）, "feltRead": 1〜5の整数（5=自分のプロフィールを読んで書かれたと強く感じる）, "reason": "50字以内の理由"}`
  // 審査プロンプトにも相手のプロフィール本文が入るため、安全フィルタで
  // PROHIBITED_CONTENT ブロックが起きる（2026-08-02 実測、gemini-3.5-flash）。
  // ここで例外を素通しすると評価全体が途中で落ちるので、判定失敗として扱う。
  let raw: string
  try {
    raw = await gen(prompt, JUDGE_MODEL)
  } catch (e: any) {
    return { wouldReply: null, wouldExchangeContact: null, feltRead: null, reason: `api failed: ${String(e?.message ?? e).slice(0, 80)}`, parseFailed: true }
  }
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
    return {
      wouldReply: parsed.wouldReply === true,
      wouldExchangeContact: parsed.wouldExchangeContact === true,
      feltRead: parsed.feltRead,
      reason: parsed.reason,
      parseFailed: false
    }
  } catch {
    // パース失敗は「実在する最低点」でも「最高点」でもない欠損値。
    // ここで0点や5点相当の値を混ぜると集計が歪むので、呼び出し側で
    // parseFailed を見て平均・rate の両方から除外すること。
    return { wouldReply: null, wouldExchangeContact: null, feltRead: null, reason: `parse failed: ${raw.slice(0, 80)}`, parseFailed: true }
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
  // judgeAsRecipient と同じ理由で API エラーも判定失敗として扱う（評価全体を止めない）。
  let raw: string
  try {
    raw = await gen(prompt, JUDGE_MODEL)
  } catch {
    return { fitsThisPerson: null, parseFailed: true }
  }
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
    return { fitsThisPerson: parsed.fitsThisPerson === true, parseFailed: false }
  } catch {
    return { fitsThisPerson: null, parseFailed: true }
  }
}

// ===== メイン =====

const corpus = JSON.parse(readFileSync(CORPUS, "utf8")).users as any[]
log(`corpus: ${corpus.length} 件, 生成=${MODEL}, 審査=${JUDGE_MODEL}`)

// 自分のプロフィールは固定。実データがあれば使う
let myRaw: any = { age: 35, area: "13", my_type: "A", q_sex: 4, profile: "評価用の自分プロフィール" }
try {
  myRaw = JSON.parse(readFileSync("test-results/message-research/me.json", "utf8"))
  log("me.json を使用")
} catch {
  log("me.json が無いので合成プロフィールを使用")
}
const myProfileText = extractProfileFromJSON(myRaw)

/**
 * EVAL_VARIANTS=cards で「好みのカードあり / なし」の比較に切り替える。
 * どちらも新プロンプトを使い、カードを素材に入れるかどうかだけを変える。
 * コーパスは WITH_CARDS=1 で収集したもの（_cards / _commonCards を持つ）が必要。
 */
const CARD_MODE = process.env.EVAL_VARIANTS === "cards"

const VARIANTS: { name: string; template: string; useCards: boolean }[] = CARD_MODE
  ? [
      { name: "legacy", template: DEFAULT_PROMPT, useCards: false },
      { name: "new", template: DEFAULT_PROMPT, useCards: true }
    ]
  : [
      { name: "legacy", template: LEGACY_DEFAULT_PROMPT_V1, useCards: false },
      { name: "new", template: DEFAULT_PROMPT, useCards: false }
    ]

const results: any[] = []

for (const target of corpus) {
  const baseProfileText = extractProfileFromJSON(target)
  const ownCards: string[] = Array.isArray(target._cards) ? target._cards : []
  const commonCards: string[] = Array.isArray(target._commonCards) ? target._commonCards : []
  // カード無しの腕でも、汎用性の比較対象として同じ相手を使う
  const targetProfileText = baseProfileText
  if (!targetProfileText || targetProfileText.length < 5) continue
  const ngText = String(target.text_my_ng ?? target.ng ?? "")
  const hintWithoutCards = generateDemandSupplyHint(myRaw, target, {})
  const hintWithCards = generateDemandSupplyHint(myRaw, target, {}, commonCards)
  const others = corpus.filter((u) => u.id !== target.id).slice(0, 3).map((u) => extractProfileFromJSON(u))

  for (const variant of VARIANTS) {
    let prompt = buildMessagePrompt({
      template: variant.template,
      myProfile: myProfileText,
      targetProfile: variant.useCards
        ? targetProfileText + formatCardsSection(ownCards)
        : targetProfileText,
      // 「ぴの」を使う: 名前から食べ物（ピノ＝アイスの商品名）を連想する実害バグ（修正A）を
      // このハーネスで再現・検出するため。旧プロンプトでは「アイス」等が出て飲食グループの検出に
      // 引っかかり、新プロンプトでは出ないことが期待される挙動。
      targetName: "ぴの",
      demandSupplyHint: variant.useCards ? hintWithCards : hintWithoutCards
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

    // カードを素材に入れた腕では、判定の参照プロフィールにもカードを含める。
    // 含めないと、カード由来の語が「プロフィールに無い語」と見なされ、固有度が
    // 不当に下がり、素材外話題の誤検出も起きる（2026-08-02 の実測で判明）。
    const profileForChecks = variant.useCards
      ? targetProfileText + formatCardsSection(ownCards) + formatCardsSection(commonCards)
      : targetProfileText
    const checks = checkMessage(message, profileForChecks, ngText)
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
    log(
      `${target.id} / ${variant.name}: ${checks.length}字 offTopic=${checks.offTopic.length} ` +
        `reply=${judge.parseFailed ? "?" : judge.wouldReply ? "yes" : "no"}`
    )
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
    replyRate: avgOver(judgeValidRows, (r) => (r.judge.wouldReply ? 1 : 0)),
    contactExchangeRate: avgOver(judgeValidRows, (r) => (r.judge.wouldExchangeContact ? 1 : 0)),
    avgFeltRead: avgOver(judgeValidRows, (r) => r.judge.feltRead),
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
// 返信率・連絡先交換率は絶対値の閾値を置かない。審査LLMの水準が分からないうちに
// 基準を決めると、基準の方が間違っていても気づけない。旧プロンプトとの差で見る。
const pct = (v: number | null) => (v === null ? "N/A" : `${(v * 100).toFixed(0)}%`)
const diffVerdict = (label: string, a: number | null, b: number | null) => {
  if (fresh.inconclusive || a === null || b === null) return `${label}: INCONCLUSIVE（有効な評価データなし）`
  const d = (b - a) * 100
  const sign = d > 0 ? "+" : ""
  return `${label}: ${pct(a)} → ${pct(b)}（${sign}${d.toFixed(0)}pt）`
}
const mechanicalVerdict = fresh.inconclusive
  ? "INCONCLUSIVE（有効な評価データなし）"
  : (fresh.overLength + fresh.notQuestion + fresh.bannedHits + fresh.ngMentions === 0 ? "PASS" : "FAIL")

const report = `# 初回メッセージ生成 評価レポート

生成モデル: ${MODEL} / 審査モデル: ${JUDGE_MODEL} / corpus: ${corpus.length} 件 / 生成日時: ${new Date().toISOString()}

※ 拡張本体の既定モデルも gemini-3.5-flash。この評価は既定設定のユーザーの挙動を測ったもの。

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
${row("審査JSONパース失敗（返信/読まれた感）", legacy.judgeParseFailures, fresh.judgeParseFailures)}
${row("返信する と判定された割合", legacy.replyRate, fresh.replyRate)}
${row("連絡先交換まで行くと判定された割合", legacy.contactExchangeRate, fresh.contactExchangeRate)}
${row("読まれた感 平均（パース失敗除く）", legacy.avgFeltRead, fresh.avgFeltRead)}
${row("審査JSONパース失敗（汎用性）", legacy.genericityJudgeParseFailures, fresh.genericityJudgeParseFailures)}
${row("汎用性（他人成立率・パース失敗除く）", legacy.avgGenericity, fresh.avgGenericity)}

## 合格基準（新プロンプト）

評価件数0件、または該当指標に有効な判定データが無い場合は PASS/FAIL ではなく
INCONCLUSIVE（判定不能）と表示する。INCONCLUSIVE を PASS として扱わないこと。

- 素材外話題 0件 → ${offTopicVerdict}
- 汎用性 20%以下 → ${genericityVerdict}
- ${diffVerdict("返信する割合", legacy.replyRate, fresh.replyRate)}
- ${diffVerdict("連絡先交換まで行く割合", legacy.contactExchangeRate, fresh.contactExchangeRate)}
  （この2つは絶対値の閾値を置かず、旧プロンプトとの差で見る。
   n が小さいとノイズに埋もれるので、40件未満の測定では差を解釈しないこと）
- 機械項目（超過/？/禁止表現/NG言及）全件pass → ${mechanicalVerdict}
`

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2))
writeFileSync(`${OUT_DIR}/report.md`, report)
log(`\n${report}`)
log(`保存: ${OUT_DIR}/report.md`)
