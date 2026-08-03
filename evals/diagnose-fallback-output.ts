/**
 * フォールバック先（Cloudflare Workers AI）が「メッセージ本文」ではなく
 * 「相手と自分の解析内容そのもの」を返してしまう問題の切り分け
 *
 * 確かめたいのは次の2つ:
 *   H1. プロンプトがフォールバック先に渡っていない
 *   H2. GLM 等のオープンモデルが、思考過程や分析をそのまま本文として出す
 *
 * 本番と同じ buildMessagePrompt でプロンプトを組み立て、
 * 各モデルを複数回叩いて、本文が出るのか解析が出るのかを数える。
 * 1回目だけは **AI SDK を通さない生 fetch** も行い、
 * モデルの生出力と SDK の text 抽出のどちらが原因かを分離する。
 *
 * 実行:
 *   pnpm exec esbuild evals/diagnose-fallback-output.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/diag/run.mjs
 *   CF_ACCT=... CF_TOKEN=... node test-results/diag/run.mjs
 *
 * 相手のプロフィールは実データを使わず、この場で作った架空のものを使う
 * （他人の個人情報を評価目的でディスクに残さないため）。
 */
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

import { CLOUDFLARE_MODELS, DEFAULT_PROMPT, cloudflareBaseURL } from "../constants"
import { applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { replacementRules } from "../assets/replacement_rules"

const CF_ACCT = process.env.CF_ACCT
const CF_TOKEN = process.env.CF_TOKEN
const RUNS = Number(process.env.RUNS || 3)
const MODELS = process.env.CF_MODEL ? [process.env.CF_MODEL] : CLOUDFLARE_MODELS

if (!CF_ACCT || !CF_TOKEN) {
    console.error("使い方: CF_ACCT=... CF_TOKEN=... node <bundle>")
    process.exit(1)
}

// 本番のプロフィール抽出が出すのと同じ【…】形式に合わせた架空データ
const myProfile = `【基本情報】
40代 / 東京都 / 会社員
【自己紹介】
平日は都内でシステム関係の仕事をしています。休みの日は自宅で映画を観ていることが多いです。
古い邦画が好きで、少しずつ観直しています。お酒は弱いので、話すのが目的の飲み方をします。
【嗜好】
言葉でのやり取りを大事にしたい。焦らずゆっくり関係を作りたいタイプです。
【求める条件】
まずは文章のやり取りを重ねられる方だと嬉しいです。`

const targetProfile = `【基本情報】
30代 / 神奈川県 / 事務
【自己紹介】
一人で美術館に行くのが好きです。最近は写真展によく足を運んでいます。
文章を書くのが好きで、感想をノートに書き留めるのが習慣になっています。
【嗜好】
主導してもらえる関係に安心を感じます。言葉で伝えてもらえると嬉しいです。
【求める条件】
急かさずやり取りできる方。
【好みのカード】
写真が好き / 言葉責めが好き / 猫が好き`

const demandSupplyHint = `## 相手が求めていて、自分が出せるもの
- 相手は「言葉で伝えてもらえると嬉しい」と書いており、自分も「言葉でのやり取りを大事にしたい」と書いている（強さ: 8）
## 自分が求めていて、相手が出せるもの
- 自分は「文章のやり取りを重ねられる方」を求めており、相手は文章を書くのが好きと書いている（強さ: 7）
## 話題になりうる噛み合い
- 共通の好みのカード: 写真が好き`

let prompt = buildMessagePrompt({
    template: DEFAULT_PROMPT,
    myProfile,
    targetProfile,
    targetName: "みなと",
    demandSupplyHint
})
prompt = applyReplacementRules(prompt, replacementRules)

/**
 * 出力が「送れるメッセージ」ではなく「解析/思考過程」に見えるかを判定する。
 * 本文は200字以内・日本語・地の文。解析は箇条書きや見出し、英語の混入が特徴。
 */
function looksLikeAnalysis(text: string) {
    const reasons: string[] = []
    if (/<\/?think(ing)?>/i.test(text)) reasons.push("<think>タグ")
    if (/^\s*[-*#]|\n\s*[-*#]\s|\n\s*\d+\.\s/.test(text)) reasons.push("箇条書き/見出し")
    if (/\*\*/.test(text)) reasons.push("Markdown強調")
    if (/\b(Step|Analyze|Draft|Constraint|Let me|The user)\b/.test(text)) reasons.push("英語の思考語")
    if (/(ステップ1|ステップ2|突き合わせ|強さ:|分析)/.test(text)) reasons.push("解析用語")
    if (text.length > 300) reasons.push(`${text.length}字（上限200を大幅超過）`)
    return reasons
}

console.log("=".repeat(72))
console.log(`プロンプト長: ${prompt.length}字 / 「メッセージ本文のみを出力」を含む: ${prompt.includes("メッセージ本文のみを出力")}`)
console.log(`モデル ${MODELS.length}種 × ${RUNS}回`)
console.log("=".repeat(72))

// --- 生 fetch で1回。モデルの生出力と SDK の抽出を分離する
console.log(`\n### 生fetch（SDKを通さない）: ${MODELS[0]}\n`)
try {
    const res = await fetch(`${cloudflareBaseURL(CF_ACCT)}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELS[0], messages: [{ role: "user", content: prompt }] })
    })
    const json: any = await res.json()
    const msg = json?.choices?.[0]?.message ?? {}
    console.log(`HTTP ${res.status} / finish_reason=${json?.choices?.[0]?.finish_reason}`)
    console.log(`message のキー: ${JSON.stringify(Object.keys(msg))}`)
    for (const k of ["content", "reasoning_content"]) {
        const v = msg[k]
        if (typeof v !== "string" || !v) continue
        console.log(`  ${k}: ${v.length}字${k === "content" ? ` / 解析っぽさ: ${looksLikeAnalysis(v).join("、") || "なし"}` : ""}`)
    }
    if (typeof msg.content === "string") console.log(`  content 全文:\n    ${msg.content.replace(/\n/g, "\n    ")}`)
    console.log(`  usage: ${JSON.stringify(json?.usage)}`)
} catch (e: any) {
    console.log(`  失敗: ${e.message}`)
}

// --- SDK 経路（本番の generateWithCloudflare と同じ）でモデル横断
const cf = createOpenAI({ baseURL: cloudflareBaseURL(CF_ACCT), apiKey: CF_TOKEN })

for (const model of MODELS) {
    console.log(`\n${"─".repeat(72)}\n### ${model}\n`)
    let bad = 0
    for (let i = 1; i <= RUNS; i++) {
        try {
            const { text, finishReason } = await generateText({ model: cf.chat(model), prompt })
            const reasons = looksLikeAnalysis(text)
            if (reasons.length) bad++
            console.log(`  ${i}回目: ${text.length}字 / finish=${finishReason} / ${reasons.length ? `★解析っぽい（${reasons.join("、")}）` : "本文OK"}`)
            console.log(`    ${text.slice(0, 300).replace(/\n/g, "\n    ")}${text.length > 300 ? "…" : ""}`)
        } catch (e: any) {
            console.log(`  ${i}回目: 失敗 ${String(e.message).slice(0, 120)}`)
        }
    }
    console.log(`  → 解析っぽい出力 ${bad}/${RUNS}`)
}

console.log("\n" + "=".repeat(72))
console.log("判定の見方:")
console.log("  - 生fetch の content が既に解析文 → モデルの挙動（H2）")
console.log("  - 生fetch は本文だけ／SDK の text が解析文 → SDK の抽出が原因")
console.log("  - プロンプト長が極端に短い → 渡っていない（H1）")
