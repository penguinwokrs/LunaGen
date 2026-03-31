import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY
if (!apiKey) { console.error("Usage: node test-quality.mjs <GEMINI_API_KEY> or set GEMINI_API_KEY env"); process.exit(1) }

// === プロンプトテンプレート（constants.tsと同一） ===
const DEFAULT_PROMPT = `あなたはSM嗜好のマッチングサイト「Luna」で、相手に刺さる初回メッセージを送るユーザーです。
以下の情報を段階的に分析し、相手が「この人とは合いそう」と直感的に感じるメッセージを作成してください。

# ステップ1: 相手が求めていることを理解する
「相手の求める条件」セクションを最優先で読み込み、以下を把握すること：
- 相手がどんな人を求めているか（性格、関係性、プレイスタイル等）
- 自分のプロフィールの中で、その条件に合致する要素を特定する
- 合致する要素があれば、それを「言葉にせずとも伝わる」レベルで自然にメッセージに織り込む
- 条件に合致しない部分は触れない。矛盾する印象を与えないこと

# ステップ2: 嗜好の共通点を活用する（最重要 — 必ずメッセージに反映すること）
「嗜好マッチング分析」セクションがある場合、そこに記載された共通点を**必ず1つ以上**メッセージに織り込むこと：
- 共通する嗜好は、相手に「同じ感覚を持っている」と感じさせる最強の武器
- **性的な嗜好（プレイスタイル、好きなプレイ、S/M相性）に共通点や類似点がある場合、それをステップ3の趣味よりも優先して触れること。** このサイトのユーザーはSM嗜好を前提にマッチングしているため、性的な相性への言及こそが最も「この人分かってる」と感じさせる
- 相手のプロフィールや嗜好欄に書いてある表現・用語はそのまま使ってよい。相手が自分で書いている言葉を使うことで「ちゃんと読んでくれている」「同じ言語で話せる人だ」と感じさせる
- 例: 相手が「スパンキングが好き」と書いていれば「スパンキング」と書いてOK。「拘束」「呼吸管理」「首輪」「鞭」「踏みつけ」等も相手が使っている表現ならそのまま使える
- ただし相手が使っていない過激な表現や、卑猥な単語は避ける
- 共通点に触れる際は、自分も同じ嗜好があることを具体的に伝える。回りくどい比喩より「僕も〇〇が好きで」とストレートに共感を示す方が刺さる
- 具体例:
  - スパンキング共通 →「僕もスパンキング好きで、反応を見ながら少しずつ強くしていくのがたまらないです」
  - 拘束共通 →「拘束して自由を奪った状態で追い詰めていく時間が好きです」
  - 精神的支配共通 →「コントロールされて安心する感覚、すごく分かります」「言葉で追い詰めて心ごと掴むのが好きで」
  - 羞恥の共通 →「恥ずかしいのに逃げられない状況、お互い好きなの嬉しいです」
  - 快楽の共通 →「お互い心地よく溶けていくような時間」
  - 依存の共通 →「気がつくとずっと考えてしまうような存在になりたい」
- 嗜好の共通点が多いほど踏み込んだ表現を使ってよい
- ステップ2の分析結果がメッセージに全く反映されていない場合、そのメッセージは失格とする

# ステップ3: 自己紹介から共通点を見つける
両者の自己紹介を比較し、以下の共通点を探すこと：
- 趣味・興味（食、旅行、映画、音楽等）
- 生活スタイル（仕事、学業、忙しさ等）
- 価値観・考え方
- 共通点が見つかれば、自分の具体的な体験を交えて触れる（「〇〇が好きなんですね」のような定型表現は禁止）

# メッセージ生成ルール
- 必ず以下の2軸を含めること。片方だけに偏ったメッセージは不可：
  (A)【優先】ステップ1〜2の分析結果（性的嗜好の相性・プレイスタイルの共通点・求める条件への合致）から1点以上。嗜好の共通点がある場合はそれを最優先で取り上げる
  (B) ステップ3の共通点（趣味・価値観・生活スタイル）から1点以上。自分の具体的な体験を交えて触れる
- 配分の目安: Aを軸にメッセージの核とし、Bは会話の入り口や自然な導入として添える
- 相手の文体（カジュアル/丁寧、絵文字多め/少なめ）を読み取り、トーンを合わせる
- 最後は必ず疑問符（？）を使った問いかけで締める。「〜ですね」「〜ください」等の平叙文で終わらない
- 対等な目線を保つ。初対面で「受け止めます」「リードします」等の宣言はしない
- 初回メッセージで「ご飯行きましょう」「飲みに行きませんか」のような食事・飲みの誘いは禁止。食の好みに触れるのはOK

# 禁止事項（厳守）
- 「プロフィール拝見しました」「プロフィールを見て」等のテンプレ表現は禁止。いきなり本題に入ること
- 相手のNG条件・拒否事項には一切触れない。「〇〇はしません」「〇〇はつけないから安心して」のようにNG事項を引用して安心させようとするのは逆効果
- 初回で相手の容姿・表情・身体について具体的に言及しない（「弱っていく表情」「ぐずぐずになった姿」等は距離感が近すぎる）
- 相手の名前には「さん」を付ける。「ちゃん」「くん」等の馴れ馴れしい呼び方は禁止
- 「そそられる」「興奮する」「ムラムラ」等の直接的な性的興奮を示す表現は禁止

# 制約事項
- 冒頭の挨拶は相手のトーンに合わせて自然に。「[相手の名前]さん、はじめまして！」の定型でなくてよい
- 文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）
- 感情表現には記号の顔文字（(^^), m(_ _)m等）を使わず、絵文字（😊, ✨等）を使用する
- メッセージ本文のみを出力すること。分析過程や補足説明は不要

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}`

// === 自分のプロフィール（テスト用） ===
const MY_PROFILE = `名前: テスト太郎
年齢: 32歳
性別: 男性
居住地: 東京都
目的: パートナー探し
職業: IT系

【自己紹介】
都内でWebエンジニアをしています。
休日は美術館巡りやカフェ探しが好きです。最近はサウナにもハマってます。
お酒は好きで、特にフルーティーなお酒を求めて色んな居酒屋を開拓中。猫を2匹飼ってます🐱
穏やかに見られがちですが、内面はけっこう情熱的です。
じっくり対話しながらお互いを知っていける関係が理想です。

【嗜好・プレイスタイル】
基本的にS寄りですが、相手の反応を見ながら加減するのが好きです。
一方的ではなく、お互いが没頭できる空間を作りたいタイプ。
言葉や雰囲気での心理的な揺さぶりが得意です。

【嗜好分析】
タイプ傾向: 支配的・加虐的
嗜好スコア: 性行為:4 苦痛:3 支配欲:4 拘束:3 羞恥:4 快楽:5 依存:3
強い傾向: 性行為, 支配欲, 羞恥, 快楽`

// === ターゲットプロフィール（luna-matching.com/user/show/113611 実データ） ===
const TARGET_PROFILE = `名前: 山田
年齢: 24歳
性別: 女性
居住地: 東京都
SM傾向: スイッチ

【自己紹介】
関東在住、土日休みの社会人です。
162/58/sub/m

お友達くらいの関係でお互いのペースで定期的に会える相手を探しています。
今は土日か平日仕事終わりにお会いできる方がいたらうれしいです。

男性でも女性でも🫶
まずはお話してから会いたいと思っています。

サブ強めのMです。コントロールされることや酷いことをされている状況が好き。
身体的より精神的に興奮する方が好きなので性的接触はありなしどちらでも🙆

イチャイチャするのは気分的にできる時とできない時があります😢ペットとして可愛がられるのは大丈夫です🐶

普段は、出かけるのが好きで買い物したり美味しいもの食べたりしてます。
♡:サウナ　服　美容　辛いもの　甘いもの　コーヒー　旅行　映画

【好みのカード】
美味しいものが好き、お互いの価値観を大切にする、鞭が好き、ディシスパの人です、呼吸制御、SMの話が出来る友達がほしい、首輪が好き、躾け、CMNF

【嗜好・プレイスタイル】
sub>M
痛いことも好きですが、それを通して自分をコントロールされていることに安心するし興奮します。
自分より立場が上の人に見下されたいし、謝らせられたいし、許されたいです。
基本マゾなんですが、いじめられて喜んでる人を情けなくて可愛いとも思います。どちらかというとキュンとするとか萌えの感情が近いです。

♡:スパンキング、バラ鞭、拘束、呼吸管理、口内、踏みつけ
好きなプレイは模索中です

【求める条件】
清潔にしている方、楽しくお話しできる方だと嬉しいです☺︎
プレイとそれ以外で切り替えられる方。Mとして振舞う分には問題ありませんが、日常生活での束縛はNGです。
性対象: 女性,男性
年齢: 20代前半〜30代前半
地域: 関東
体型: スリム,やや細め,普通

【NGなこと・拒否】
汚いこと、流血を伴うプレイ、着衣で見える位置の痕、社会に迷惑をかける行為、日常生活における束縛
イチャイチャは苦手です。
NGではありませんが、痣が出るほどのプレイはまだ経験がないので段階を踏んでくださる方だとありがたいです。

【嗜好分析】
タイプ傾向: 従順・被虐的, スイッチャー
嗜好スコア: 性行為:3 苦痛:4 支配欲:2 拘束:4 羞恥:4 快楽:3 依存:4
強い傾向: 苦痛, 拘束, 羞恥, 依存`

// === kinkHint (generateApproachHint相当 — 実データから算出) ===
const KINK_HINT = "相手は甘えたい・頼りたい傾向があります（sub/M）。トーンの指針: 落ち着いた余裕のある話し方を意識する。ただし「守ってあげる」「受け止める」のような直接的な表現は使わず、会話の流れや雰囲気で自然に安心感を出すこと。相手は精神的なコントロールに惹かれるタイプ。"

// === compatibilityHint (generateCompatibilityHint相当 — 実データから算出) ===
const COMPATIBILITY_HINT = `【S/M相性: 非常に良い】あなた=S寄り（支配的・加虐的）、相手=sub/M寄り。相手はコントロールされることに安心感を覚え、精神的な支配を好む。メッセージでは余裕と包容力を自然に出すこと。「引っ張ってくれそう」と感じさせる言い回しが効果的。ただし初回から「躾けてあげる」等の直接的な宣言は禁止。

【共通する嗜好】以下の嗜好で高い共通性あり。これらを活用してメッセージに深みを出すこと：
- 羞恥（自分:4 / 相手:4）: お互い羞恥への感受性が高い。少しドキッとさせる際どい褒め方や、内面に踏み込む表現が効果的。
- 苦痛（自分:3 / 相手:4）: 相手はスパンキングやバラ鞭が好き。痛みを通じたコントロールに安心感を覚える。「限界を探る」「じわじわ追い込む」的な暗示が刺さる。
- 拘束（自分:3 / 相手:4）: 相手は拘束・首輪・呼吸管理が好き。「逃がさない」「委ねる」的なニュアンスが響く。
- 依存（自分:3 / 相手:4）: 相手は深い繋がりへの欲求が強い。「特別な存在」「あなただけ」的な独占的ニュアンスが刺さる。
- 性行為（自分:4 / 相手:3）: お互い一定の関心あり。身体的な相性への期待を暗示的に匂わせると効果的。

【相手の好きなプレイ】スパンキング、バラ鞭、拘束、呼吸管理、口内、踏みつけ — これらは直接的に言及せず、暗示的な表現で「分かる人には分かる」ように匂わせること。

【相手の精神的嗜好】コントロールされること、見下されること、謝らされて許されること、ペットとして可愛がられること — 精神的な支配への欲求が強い。`

// === 置換ルール（assets/replacement_rules.tsと同一） ===
const REPLACEMENT_RULES = [
  { from: "SM", to: "特別な関係" },
  { from: "拘束", to: "固定" },
  { from: "日本酒", to: "お酒" },
]

// === プロンプト構築（background.tsのhandleGenerateMessageを再現） ===
function buildPrompt() {
  let prompt = DEFAULT_PROMPT
    .replace("{my_info_clean}", MY_PROFILE)
    .replace("{target_info_clean}", TARGET_PROFILE)

  // 嗜好マッチング分析セクションを注入
  const analysisSections = []

  if (KINK_HINT || COMPATIBILITY_HINT) {
    let kinkSection = "# 嗜好マッチング分析\n"
    kinkSection += `## アプローチ戦略\n${KINK_HINT}\n\n`
    kinkSection += `## 相性の詳細\n${COMPATIBILITY_HINT}\n`
    analysisSections.push(kinkSection.trimEnd())
  }

  // 求める条件の強調
  const reqMatch = TARGET_PROFILE.match(/【求める条件】\n([\s\S]*?)(?=\n【|$)/)
  if (reqMatch) {
    analysisSections.push(
      `# 相手が明示している求める条件\n以下は相手が自ら書いた「求める条件」です。自分のプロフィールでこの条件に合致する要素を特定し、メッセージ内でさりげなく伝わるようにすること。\n\n${reqMatch[1].trim()}`
    )
  }

  if (analysisSections.length > 0) {
    const analysisBlock = analysisSections.join("\n\n")
    prompt = prompt.replace("# 相手のプロフィール", `${analysisBlock}\n\n# 相手のプロフィール`)
  }

  // 置換ルール適用
  REPLACEMENT_RULES.forEach(rule => {
    if (rule.from) prompt = prompt.split(rule.from).join(rule.to || "")
  })

  return prompt
}

// === 品質評価 ===
function evaluateMessage(text) {
  const checks = {
    "性的嗜好への言及": false,
    "嗜好への言及(全般)": false,
    "共通点への言及": false,
    "趣味/ライフスタイル共通点": false,
    "求める条件の反映": false,
    "テンプレ表現なし": true,
    "200文字以内": text.length <= 200,
    "問いかけで締め": false,
  }

  const lower = text

  // 嗜好への言及チェック — 具体的なプレイ暗示 or 精神的支配の暗示
  // (A) 具体的プレイ暗示（スパンキング、鞭、拘束、呼吸管理、踏みつけ等の暗喩）
  const playKeywords = ["叩", "打", "鞭", "スパンキング", "縛", "固定", "拘束", "首輪", "息", "呼吸", "踏", "逃がさ", "離さ", "締め", "追い詰", "追い込", "限界", "痛", "刺激"]
  // (B) 精神的支配・M嗜好の暗示
  const mentalKeywords = ["コントロール", "支配", "見下", "従", "委ね", "導", "謝", "許", "ペット", "可愛がら", "躾", "命令", "服従", "主従"]
  // (C) 一般的な嗜好暗示（前回から継続）
  const generalKinkKeywords = ["じわじわ", "ドキッ", "ギャップ", "素直", "没頭", "心理", "揺さぶ", "言葉で", "二人きり", "特別", "秘密", "内面", "本音", "余裕", "包容", "甘え", "頼", "溶け", "心地よ", "感覚", "深く", "解き放", "ゾクッ", "ドキドキ", "踏み込", "さらけ出", "ペース", "加減"]

  // 性的嗜好への言及（具体プレイ暗示 or 精神的支配の暗示）
  const sexualKinkKeywords = [...playKeywords, ...mentalKeywords]
  const matchedSexualKink = sexualKinkKeywords.filter(k => lower.includes(k))
  if (matchedSexualKink.length > 0) {
    checks["性的嗜好への言及"] = true
  }

  // 嗜好全般（性的 + 一般的暗示すべて）
  const allKinkKeywords = [...playKeywords, ...mentalKeywords, ...generalKinkKeywords]
  const matchedKink = allKinkKeywords.filter(k => lower.includes(k))
  if (matchedKink.length > 0) {
    checks["嗜好への言及(全般)"] = true
  }

  // 共通点チェック（実プロフ: サウナ、服、美容、辛いもの、甘いもの、コーヒー、旅行、映画 + 自分: 美術館、カフェ、サウナ、お酒、猫）
  const commonKeywords = ["サウナ", "コーヒー", "カフェ", "美味しい", "甘い", "辛い", "旅行", "映画", "美術館", "お酒", "猫", "買い物", "服", "美容", "休日", "お出かけ"]
  const matchedCommon = commonKeywords.filter(k => lower.includes(k))
  if (matchedCommon.length > 0) {
    checks["共通点への言及"] = true
    checks["趣味/ライフスタイル共通点"] = true
  }

  // 求める条件の反映（楽しく話せる、切り替え、清潔、ペース）
  const reqKeywords = ["楽し", "お話", "会話", "切り替", "普段", "ペース", "清潔", "落ち着", "安心", "対等", "友達"]
  if (reqKeywords.some(k => lower.includes(k))) checks["求める条件の反映"] = true

  // テンプレ表現チェック
  const badTemplates = ["プロフィール拝見", "プロフィールを見て", "プロフ見ました", "いいねありがとう"]
  if (badTemplates.some(k => lower.includes(k))) checks["テンプレ表現なし"] = false

  // 問いかけチェック
  if (lower.includes("？") || lower.includes("?")) checks["問いかけで締め"] = true

  return checks
}

// === メイン実行 ===
const google = createGoogleGenerativeAI({ apiKey })
const prompt = buildPrompt()

console.log("=== プロンプト（先頭500文字） ===")
console.log(prompt.substring(0, 500) + "...\n")
console.log(`プロンプト全長: ${prompt.length}文字\n`)

const NUM_TRIALS = 5
const results = []

console.log(`--- ${NUM_TRIALS}回メッセージ生成して品質を検証 ---\n`)

for (let i = 1; i <= NUM_TRIALS; i++) {
  try {
    const { text } = await generateText({
      model: google("gemini-3-pro-preview", {
        safetySettings: [
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      }),
      prompt,
    })

    const checks = evaluateMessage(text)
    const passed = Object.values(checks).filter(v => v).length
    const total = Object.keys(checks).length

    console.log(`=== 試行 ${i}/${NUM_TRIALS} (${text.length}文字, ${passed}/${total}項目パス) ===`)
    console.log(text)
    console.log(`\n評価:`)
    for (const [k, v] of Object.entries(checks)) {
      console.log(`  ${v ? "✅" : "❌"} ${k}`)
    }
    console.log()

    results.push({ text, checks, passed, total, len: text.length })
  } catch (e) {
    console.error(`試行 ${i} エラー:`, e.message)
  }
}

// === サマリ ===
console.log("=== 総合サマリ ===")
const avgLen = Math.round(results.reduce((a, r) => a + r.len, 0) / results.length)
console.log(`平均文字数: ${avgLen}`)

const checkNames = Object.keys(results[0]?.checks || {})
for (const name of checkNames) {
  const passCount = results.filter(r => r.checks[name]).length
  console.log(`${name}: ${passCount}/${results.length} (${Math.round(passCount/results.length*100)}%)`)
}

const avgPassed = (results.reduce((a, r) => a + r.passed, 0) / results.length).toFixed(1)
console.log(`\n平均パス率: ${avgPassed}/${results[0]?.total}`)
