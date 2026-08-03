/**
 * 「突き合わせ結果を本文に写さない」注意書き（ANALYSIS_SECTION_NOTE）の効果測定
 *
 * 2026-08-03 の調査で、Cloudflare 側のオープンモデルは
 * 「# プロフィール項目の突き合わせ」に書いた内容をそのまま言い直した本文を書いた。
 * 注意書きを足して、それが減るかを A/B で測る。
 *
 * 判定に LLM は使わない。審査モデルは天井に張り付いて差が出ないことが
 * 過去の評価で分かっているため、ここでは機械的な指標だけを見る:
 *   - 突き合わせ文との最長共通部分文字列（8字以上を復唱とみなす）
 *   - 自分の【嗜好】【求める条件】との最長共通部分文字列（＝自分の条件の読み上げ）
 *
 * 実行:
 *   pnpm exec esbuild evals/ab-analysis-recitation.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/ab/run.mjs
 *   CF_ACCT=... CF_TOKEN=... RUNS=6 node test-results/ab/run.mjs
 */
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { readFileSync } from "node:fs"

import { DEFAULT_PROMPT, cloudflareBaseURL } from "../constants"
import { ANALYSIS_SECTION_NOTE, applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { cloudflareMaxOutputTokens } from "../utils/cloudflare-model"
import { replacementRules } from "../assets/replacement_rules"

const CF_ACCT = process.env.CF_ACCT
const CF_TOKEN = process.env.CF_TOKEN
const RUNS = Number(process.env.RUNS || 6)
/** 注意書きは buildMessagePrompt にあるので Gemini（主プロバイダ）にも効く。悪化しないかを同じ指標で見る */
const USE_GEMINI = process.env.PROVIDER === "gemini"
// 思考型は1回449 Neurons・数分かかるため、A/B には思考しないモデルを使う
const MODELS = process.env.CF_MODEL
    ? [process.env.CF_MODEL]
    : process.env.PROVIDER === "gemini"
        ? [process.env.GEMINI_MODEL || "gemini-3.5-flash"]
        : ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"]

if (!USE_GEMINI && (!CF_ACCT || !CF_TOKEN)) {
    console.error("使い方: CF_ACCT=... CF_TOKEN=... node <bundle>  /  PROVIDER=gemini node <bundle>")
    process.exit(1)
}

const myConditions = `言葉でのやり取りを大事にしたい。焦らずゆっくり関係を作りたいタイプです。
まずは文章のやり取りを重ねられる方だと嬉しいです。`

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

/** 2つの文字列の最長共通部分文字列の長さ */
function longestCommonSubstring(a: string, b: string): { len: number; text: string } {
    let best = 0
    let end = 0
    // 直前行だけ保持すれば足りる
    let prev = new Uint16Array(b.length + 1)
    for (let i = 1; i <= a.length; i++) {
        const cur = new Uint16Array(b.length + 1)
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] !== b[j - 1]) continue
            cur[j] = prev[j - 1] + 1
            if (cur[j] > best) {
                best = cur[j]
                end = i
            }
        }
        prev = cur
    }
    return { len: best, text: a.slice(end - best, end) }
}

const withNote = buildMessagePrompt({
    template: DEFAULT_PROMPT, myProfile, targetProfile, targetName: "みなと", demandSupplyHint
})
// 注意書きだけを抜いたものを対照群にする（他は1文字も変えない）
const withoutNote = withNote.split(`${ANALYSIS_SECTION_NOTE}\n\n`).join("")

if (withNote === withoutNote) {
    console.error("対照群の作成に失敗した（注意書きが見つからない）")
    process.exit(1)
}

const ARMS = [
    { name: "注意書き なし（従来）", prompt: applyReplacementRules(withoutNote, replacementRules) },
    { name: "注意書き あり（今回）", prompt: applyReplacementRules(withNote, replacementRules) }
]

const cf = CF_ACCT && CF_TOKEN ? createOpenAI({ baseURL: cloudflareBaseURL(CF_ACCT), apiKey: CF_TOKEN }) : null
const google = USE_GEMINI
    ? createGoogleGenerativeAI({ apiKey: readFileSync(`${process.env.HOME}/.gemini_api_key`, "utf8").trim() })
    : null
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash"
const resolveModel = (m: string) => (USE_GEMINI ? google!(GEMINI_MODEL) : cf!.chat(m))
const RECITE_THRESHOLD = 8

console.log(`各モデル × 各腕 ${RUNS}回 / 復唱とみなす一致長: ${RECITE_THRESHOLD}字以上\n`)

for (const model of MODELS) {
    console.log("=".repeat(72))
    console.log(model)
    console.log("=".repeat(72))
    for (const arm of ARMS) {
        const hintLcs: number[] = []
        const condLcs: number[] = []
        const samples: string[] = []
        for (let i = 0; i < RUNS; i++) {
            try {
                // 本番の generateWithGemini は上限を設定しない。ここで掛けると
                // 思考トークンで枠を使い切り、出力が途中で切れて測定にならない（実際に踏んだ）
                const { text } = await generateText({
                    model: resolveModel(model),
                    prompt: arm.prompt,
                    ...(USE_GEMINI ? {} : { maxOutputTokens: cloudflareMaxOutputTokens(model, 200) })
                })
                const h = longestCommonSubstring(text, demandSupplyHint)
                const c = longestCommonSubstring(text, myConditions)
                hintLcs.push(h.len)
                condLcs.push(c.len)
                samples.push(`${c.len >= RECITE_THRESHOLD ? "★" : "  "}自分条件${String(c.len).padStart(2)}字/突合${String(h.len).padStart(2)}字 « ${c.len >= RECITE_THRESHOLD ? c.text : text.slice(0, 40)} »`)
            } catch (e: any) {
                samples.push(`  失敗: ${String(e.message).slice(0, 80)}`)
            }
        }
        const avg = (a: number[]) => (a.length ? (a.reduce((s, n) => s + n, 0) / a.length).toFixed(1) : "-")
        const over = (a: number[]) => a.filter((n) => n >= RECITE_THRESHOLD).length
        console.log(`\n【${arm.name}】`)
        samples.forEach((s) => console.log(`  ${s}`))
        console.log(`  → 自分の条件の復唱 ${over(condLcs)}/${condLcs.length}（平均一致 ${avg(condLcs)}字） / 突き合わせ文の復唱 ${over(hintLcs)}/${hintLcs.length}（平均 ${avg(hintLcs)}字）`)
    }
    console.log("")
}
