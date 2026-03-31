import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"

const apiKey = process.argv[2]
if (!apiKey) { console.error("Usage: node test-premium.mjs <GEMINI_API_KEY>"); process.exit(1) }

const DEFAULT_PROMPT = `あなたはSM嗜好のマッチングサイト「Luna」で、相手に刺さる初回メッセージを送るユーザーです。
以下の情報を段階的に分析し、相手が「この人とは合いそう」と直感的に感じるメッセージを作成してください。

# ステップ1: 相手が求めていることを理解する
「相手の求める条件」セクションを最優先で読み込み、以下を把握すること：
- 相手がどんな人を求めているか（性格、関係性、プレイスタイル等）
- 自分のプロフィールの中で、その条件に合致する要素を特定する
- 合致する要素があれば、それを「言葉にせずとも伝わる」レベルで自然にメッセージに織り込む
- 条件に合致しない部分は触れない。矛盾する印象を与えないこと

# ステップ2: 嗜好の共通点を活用する
「嗜好マッチング分析」セクションがある場合、そこに記載された共通点を活用すること：
- 共通する嗜好は、相手に「同じ感覚を持っている」と感じさせる最強の武器
- 直接的な行為名や卑猥な単語は使わず、暗示的・比喩的な表現で「分かる人には分かる」ように伝える
- 嗜好の共通点が多いほど踏み込んだ表現を使ってよい

# ステップ3: 自己紹介から共通点を見つける
両者の自己紹介を比較し、以下の共通点を探すこと：
- 趣味・興味（食、旅行、映画、音楽等）
- 生活スタイル（仕事、学業、忙しさ等）
- 価値観・考え方
- 共通点が見つかれば、自分の具体的な体験を交えて触れる

# メッセージ生成ルール
- {CONTENT_RULE}
- 相手の文体を読み取り、トーンを合わせる
- 最後は相手が気軽に返せる問いかけで締める
- 対等な目線を保つ
- 初回メッセージで食事・飲みの誘いは禁止

# 禁止事項（厳守）
- テンプレ表現は禁止。いきなり本題に入ること
- 相手のNG条件には一切触れない
- 初回で容姿について具体的に言及しない
- 相手の名前には「さん」を付ける
- 直接的な性的興奮表現は禁止

# 制約事項
- 冒頭の挨拶は自然に
- {CHAR_LIMIT}
- メッセージ本文のみを出力すること。分析過程や補足説明は不要

# 自分のプロフィール
東京都 30歳 男性 | SM傾向：S寄り
自己紹介: 都内でエンジニアをしています。アートや音楽が好きで、美術館巡りが趣味です。猫を飼っています。お酒も好きで日本酒をよく飲みます。

# 相手のプロフィール
梓 東京都 21歳 女性 | SM傾向：M寄り
自己紹介: 梓と申します。美大生です。日々制作に追われているのでスケジュールの融通は効きづらいかもしれません...🙇‍♀️ 普段眼鏡かけてます
好みのカード: アートが好き、ファッションが好き、お酒飲める人がいい、お互いの価値観を大切にする、しっかりと向き合ってくれる人がいい、自然体でいれる関係がいい、縄・緊縛が好き、猫が好き
求める条件: 知的な方と一緒に乱れたい💕 過去の良かったプレイや、これからやってみたいこと、SM以外の話も是非聞かせて欲しいです！普段は友達みたいにラフに、プレイ中はドエロく渇望し合いましょう`

const google = createGoogleGenerativeAI({ apiKey })

async function callGemini(prompt) {
  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    prompt,
  })
  return text
}

async function generatePremium(label) {
  const charLimit = "文字数は句読点・記号・空白・改行すべて含めて合計480〜500文字（厳守。500文字を超えたら失格、450文字未満も失格）"
  const contentRule = "分析結果から3〜4点に触れ、それぞれ自分の具体的な体験やエピソードを交えて深く掘り下げる。4〜5段落で構成し、各段落に十分な厚みを持たせること"
  const prompt = DEFAULT_PROMPT
    .replace("{CHAR_LIMIT}", charLimit)
    .replace("{CONTENT_RULE}", contentRule)

  let text = await callGemini(prompt)
  let len = text.length

  // Retry once if way off (outside 400-500)
  if (len < 400 || len > 500) {
    const feedback = len < 400
      ? `【再生成指示】前回の出力は${len}文字で短すぎました。480〜500文字になるよう、話題を追加し、各話題にエピソードを加えてください。`
      : `【再生成指示】前回の出力は${len}文字で長すぎました。480〜500文字に収まるよう、冗長な部分を削ってください。`
    console.log(`  → 初回 ${len}文字 (範囲外) → リトライ`)
    text = await callGemini(prompt + `\n\n${feedback}`)
    len = text.length
  }

  console.log(`\n=== ${label} ===`)
  console.log(`文字数: ${len}`)
  console.log(`メッセージ:\n${text}`)
  return len
}

console.log("--- プレミアムメッセージ文字数検証 (内容量制御 + 1回リトライ) ---\n")

const results = []
for (let i = 1; i <= 3; i++) {
  const len = await generatePremium(`プレミアム (試行${i}/3)`)
  results.push(len)
}

// Normal for comparison
{
  const normalLimit = "文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）"
  const normalContent = "上記3ステップの分析結果のうち、最も強く刺さりそうな1〜2点に絞って触れる。詰め込みすぎない"
  const prompt = DEFAULT_PROMPT
    .replace("{CHAR_LIMIT}", normalLimit)
    .replace("{CONTENT_RULE}", normalContent)
  const text = await callGemini(prompt)
  console.log(`\n=== 通常メッセージ (比較用) ===`)
  console.log(`文字数: ${text.length}`)
  console.log(`メッセージ:\n${text}`)
}

console.log("\n--- 結果サマリ ---")
console.log(`プレミアム文字数: ${results.join(", ")}`)
console.log(`平均: ${Math.round(results.reduce((a,b) => a+b, 0) / results.length)}文字`)
console.log(`目標: 450〜500文字 (許容400〜500)`)
