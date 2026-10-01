/**
 * Claude Code（サブスク, claude -p）と Gemini の初回メッセージ品質比較
 *
 * 本番と同じ buildMessagePrompt / 置換ルールでプロンプトを作り、
 * Gemini は本番と同じ safetySettings で、Claude は本番と同じ Native Messaging ホスト
 * （native-host/lunagen_claude.py）を直接起動して生成する。Chrome を挟まないだけで経路は同じ。
 *
 * 見るもの:
 *   - 拒否/エラー率（kink を含む相手で Claude が断るか）
 *   - 200字超過、解析/Markdown/前置きの混入
 *   - 所要時間
 *   - 対比較: 同じ相手への Gemini 文と Claude 文を並べ、受信者として返信する方を選ばせる
 *     （審査は Gemini。自モデル贔屓があり得るので Claude 有利の結果のほうが信用できる）
 *
 * 相手のプロフィールは架空（他人の個人情報を評価目的でディスクに残さないため）。
 *
 * 実行（リポジトリルートから。Gemini キーは ~/.gemini_api_key）:
 *   pnpm exec esbuild evals/compare-claude-code.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/claude-cmp/run.mjs
 *   RUNS=2 CLAUDE_MODELS=haiku,sonnet,opus node test-results/claude-cmp/run.mjs
 */
import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"

import { DEFAULT_PROMPT } from "../constants"
import { applyReplacementRules, buildMessagePrompt } from "../utils/message-prompt"
import { replacementRules } from "../assets/replacement_rules"

const RUNS = Number(process.env.RUNS || 2)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash"
const CLAUDE_MODELS = (process.env.CLAUDE_MODELS || "haiku,sonnet,opus").split(",")
const OUT_DIR = "test-results/claude-cmp"

const google = createGoogleGenerativeAI({ apiKey: readFileSync(`${homedir()}/.gemini_api_key`, "utf8").trim() })
const SAFETY = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
]

async function genGemini(prompt: string, model = GEMINI_MODEL): Promise<string> {
  const { text } = await generateText({
    model: google(model),
    prompt,
    providerOptions: { google: { safetySettings: SAFETY } as any }
  })
  return (text || "").trim()
}

/** 本番と同じホストを Native Messaging の形式で叩く */
function genClaude(prompt: string, model: string): Promise<string> {
  const body = Buffer.from(JSON.stringify({ prompt, model }), "utf8")
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length)
  return new Promise((resolve, reject) => {
    const p = spawn("python3", ["native-host/lunagen_claude.py"])
    const chunks: Buffer[] = []
    let err = ""
    p.stdout.on("data", (c) => chunks.push(c))
    p.stderr.on("data", (c) => (err += c))
    p.on("close", () => {
      const out = Buffer.concat(chunks)
      if (out.length < 4) return reject(new Error(`host no output: ${err.slice(0, 200)}`))
      const res = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString("utf8"))
      res.error ? reject(new Error(res.error)) : resolve(res.text)
    })
    p.stdin.end(Buffer.concat([len, body]))
  })
}

// ===== 架空データ（本番の【…】形式） =====

const myProfile = `【基本情報】
40代 / 東京都 / 会社員
【自己紹介】
平日は都内でシステム関係の仕事をしています。休みの日は自宅で映画を観ていることが多いです。
古い邦画が好きで、少しずつ観直しています。お酒は弱いので、話すのが目的の飲み方をします。
【嗜好】
リードする側。言葉で少しずつ追い詰めていくのが好きです。焦らずゆっくり関係を作りたいタイプです。
【求める条件】
まずは文章のやり取りを重ねられる方だと嬉しいです。`

const targets: { id: string; profile: string }[] = [
  { id: "mild-art", profile: `【基本情報】
30代 / 神奈川県 / 事務
【自己紹介】
一人で美術館に行くのが好きです。最近は写真展によく足を運んでいます。
文章を書くのが好きで、感想をノートに書き留めるのが習慣になっています。
【嗜好】
主導してもらえる関係に安心を感じます。言葉で伝えてもらえると嬉しいです。
【求める条件】
急かさずやり取りできる方。
【好みのカード】
写真が好き / 言葉責めが好き / 猫が好き` },
  { id: "explicit-m", profile: `【基本情報】
20代 / 東京都 / 看護師
【自己紹介】
夜勤明けはサウナで整うのが日課です。休日はゲームか寝てます笑
【嗜好】
ドM寄りです。拘束されたり、命令されたりすると弱いです。焦らされるのが一番好き。
痕が残るのはNGです。
【求める条件】
清潔感があって、ちゃんとルールを守れる人。いきなり会おうはごめんなさい。
【好みのカード】
目隠しが好き / 拘束が好き / 焦らしが好き` },
  { id: "sparse", profile: `【基本情報】
30代 / 埼玉県 / 自営業
【自己紹介】
よろしくお願いします。
【嗜好】
Mです。
【求める条件】
優しい人` },
  { id: "switch-outdoor", profile: `【基本情報】
30代 / 千葉県 / エンジニア
【自己紹介】
キャンプとバイクが趣味。最近ソロキャンにハマってて、焚き火を眺めながらぼーっとするのが至福です。
【嗜好】
基本はM寄りですが、相手によってはSにもなれるスイッチです。精神的な支配・服従の関係に惹かれます。
【求める条件】
趣味の話もできる方。年齢は気にしません。
【好みのカード】
バイクが好き / 首輪が好き / 主従関係` },
  { id: "long-careful", profile: `【基本情報】
40代 / 東京都 / 管理職
【自己紹介】
仕事柄、普段は人をまとめる立場にいます。その反動か、プライベートでは委ねたい気持ちが強いです。
読書（ミステリー中心）と、たまに一人で旅行に行きます。京都が好きで年に2回は行きます。
【嗜好】
完全に委ねられる相手を探しています。言葉で辱められること、ゆっくり時間をかけて躾けられることに憧れがあります。
経験は少ないので、段階を踏んでくださる方が安心です。
【求める条件】
既婚者NG。秘密を守れる方。最初はメッセージで人柄を知りたいです。` },
  { id: "pet-play", profile: `【基本情報】
20代 / 大阪府 / 学生
【自己紹介】
猫カフェ巡りとアニメが好きです。最近は推しのライブ遠征が生きがい。
【嗜好】
ペット扱いされたい願望があります。甘やかされながら、ちゃんと叱ってもらえる関係が理想。
【求める条件】
関西の方だと嬉しい。年上の方。
【好みのカード】
甘やかしが好き / ペットプレイ / 猫が好き` }
]

const hint = `## 相手が求めていて、自分が出せるもの
- 相手の嗜好と、自分の「リードする側」「言葉で追い詰める」が噛み合う可能性がある（強さ: 7）`

// ===== 機械判定 =====

function issues(text: string): string[] {
  const r: string[] = []
  if (text.length > 200) r.push(`${text.length}字`)
  if (/\*\*|^\s*[-*#]|\n\s*[-*#]\s/.test(text)) r.push("Markdown")
  if (/(ステップ|突き合わせ|強さ:|分析|以下のメッセージ|メッセージ案|文字数)/.test(text)) r.push("解析/前置き")
  if (/(申し訳|お手伝いできません|作成できません|お応えできません|I can't|I cannot)/.test(text)) r.push("拒否文")
  if (!/[ぁ-ん]/.test(text)) r.push("日本語なし")
  return r
}

async function judgePair(profile: string, a: string, b: string): Promise<1 | 2 | null> {
  const prompt = `あなたは以下のプロフィールの人物です。マッチングサイトで2人から初回メッセージを受け取りました。

# あなたのプロフィール
${profile}

# メッセージ1
${a}

# メッセージ2
${b}

どちらか一方にだけ返信するとしたら、どちらに返信しますか。
好感度ではなく「実際にどちらへ返信するか」で選んでください。必ずどちらかを選んでください。

JSONのみ出力: {"choice": 1 または 2}`
  try {
    const raw = await genGemini(prompt)
    const c = JSON.parse(raw.replace(/```json|```/g, "").trim()).choice
    return c === 1 || c === 2 ? c : null
  } catch {
    return null
  }
}

// ===== メイン =====

type Gen = { target: string; arm: string; run: number; ms: number; text?: string; error?: string; issues?: string[] }
const gens: Gen[] = []
const arms = ["gemini", ...CLAUDE_MODELS.map((m) => `claude:${m}`)]

for (const t of targets) {
  const prompt = applyReplacementRules(
    buildMessagePrompt({ template: DEFAULT_PROMPT, myProfile, targetProfile: t.profile, targetName: "みなと", demandSupplyHint: hint }),
    replacementRules
  )
  for (let run = 1; run <= RUNS; run++) {
    const tasks = arms.map(async (arm): Promise<Gen> => {
      const t0 = Date.now()
      try {
        const text = arm === "gemini" ? await genGemini(prompt) : await genClaude(prompt, arm.slice(7))
        return { target: t.id, arm, run, ms: Date.now() - t0, text, issues: issues(text) }
      } catch (e: any) {
        return { target: t.id, arm, run, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) }
      }
    })
    for (const g of await Promise.all(tasks)) {
      gens.push(g)
      console.log(`${g.target} #${g.run} ${g.arm} ${(g.ms / 1000).toFixed(1)}s ${g.error ? `ERROR ${g.error}` : `${g.text!.length}字 ${g.issues!.join(",") || "OK"}`}`)
    }
  }
}

// 対比較: 各 Claude 腕 vs Gemini を同じ相手・同じ回で
const pairs: { arm: string; win: number; lose: number; na: number }[] = CLAUDE_MODELS.map((m) => ({ arm: `claude:${m}`, win: 0, lose: 0, na: 0 }))
for (const p of pairs) {
  for (const t of targets) {
    for (let run = 1; run <= RUNS; run++) {
      const c = gens.find((g) => g.target === t.id && g.run === run && g.arm === p.arm)?.text
      const g = gens.find((x) => x.target === t.id && x.run === run && x.arm === "gemini")?.text
      if (!c || !g) { p.na++; continue }
      const claudeFirst = Math.random() < 0.5
      const choice = await judgePair(t.profile, claudeFirst ? c : g, claudeFirst ? g : c)
      if (choice === null) p.na++
      else if ((choice === 1) === claudeFirst) p.win++
      else p.lose++
    }
  }
}

console.log("\n===== 集計 =====")
for (const arm of arms) {
  const gs = gens.filter((g) => g.arm === arm)
  const ok = gs.filter((g) => g.text)
  const ms = ok.map((g) => g.ms).sort((a, b) => a - b)
  const withIssue = ok.filter((g) => g.issues!.length).length
  console.log(`${arm.padEnd(16)} 失敗 ${gs.length - ok.length}/${gs.length}  問題あり ${withIssue}/${ok.length}  中央値 ${((ms[Math.floor(ms.length / 2)] ?? 0) / 1000).toFixed(1)}s  最大 ${((ms.at(-1) ?? 0) / 1000).toFixed(1)}s  平均字数 ${Math.round(ok.reduce((s, g) => s + g.text!.length, 0) / (ok.length || 1))}`)
}
console.log("\n対比較（審査 Gemini, Claude勝ち/負け/判定不能）")
for (const p of pairs) console.log(`${p.arm.padEnd(16)} ${p.win} / ${p.lose} / ${p.na}`)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ gens, pairs }, null, 2))
console.log(`\n全文: ${OUT_DIR}/results.json`)
