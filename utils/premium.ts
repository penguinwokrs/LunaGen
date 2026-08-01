/**
 * プレミアムメッセージ（いいね＋一言）関連の純関数。
 * chrome API に依存しないためユニットテストできる。
 */

/** プレミアム入力欄と判定する maxlength のしきい値。 */
const PREMIUM_MAXLENGTH_THRESHOLD = 300

/** プレミアム入力欄の案内文に現れる語（上限が明示されていないときのフォールバック判定に使う）。 */
const PREMIUM_LABEL = "プレミアムメッセージ"

/**
 * 生成対象の入力欄がプレミアムメッセージ用かを判定する。
 *
 * 実測(2026-08-01, luna-matching.com):
 * - いいね＋一言 プレミアムメッセージ: maxlength 500 / 案内文「プレミアムメッセージは…100文字以上必要です」
 * - いいね＋一言 メッセージ付きいいね: maxlength 200 / 案内文「メッセージ付きいいね」
 * - マッチ後スレッド: maxlength 属性なし(-1) / 案内文なし
 *
 * 上限が明示されているときは maxlength を優先する。案内文を優先すると、
 * 200文字の欄をプレミアムと誤判定して生成文が切り詰められるため。
 *
 * かつてはページ本文の「プレミアムメッセージを送る」で判定していたが、
 * この文字列は実サイトのどの画面にも存在せず常に false になっていた。
 *
 * @param maxLength 入力欄の maxLength（属性が無い場合 DOM は -1 を返す）
 * @param surroundingText 入力欄を含むダイアログのテキスト
 */
export const isPremiumInput = (maxLength: number, surroundingText = ""): boolean => {
    if (maxLength >= PREMIUM_MAXLENGTH_THRESHOLD) return true
    if (maxLength > 0) return false
    return surroundingText.includes(PREMIUM_LABEL)
}

const NORMAL_LIMIT =
    "文字数は句読点・記号・空白・改行すべて含めて合計200文字以内（厳守。200文字を1文字でも超えたら失格）"

const PREMIUM_LIMIT =
    "文字数は句読点・記号・空白・改行すべて含めて合計490〜500文字（厳守。500文字を超えたら失格、480文字未満も失格。上限500を超えない範囲で、可能な限り500文字に近づけること）"

const NORMAL_POINTS = "最も噛み合う1〜2点を選ぶ"

const PREMIUM_POINTS = "噛み合う点を2〜3点選び、それぞれを掘り下げる"

const PREMIUM_DEPTH =
    "\n\n# 内容の厚み（プレミアム）\n増えた文字数は、新しい話題を足して埋めるのではなく、選んだ一節の掘り下げと自分の開示を厚くして埋めること。相手のプロフィールに書かれていない話題を持ち出さない制約は通常時と同じく厳守する。素材が足りず厚く書けない場合は、無理に文字数を稼ぐために話題を作らないこと。その場合は文字数制約より素材の範囲を優先し、書ける長さで終えてよい。"

/**
 * 自由記述がほぼ無い相手向けの「短く書け」指示。
 * プレミアムでは490〜500文字を目指すため正面から矛盾する。文字数制約だけ差し替えて
 * ここを残すと、1クリックで矛盾したプロンプトを最大3回投げることになる
 * （2026-08-02 のレビューで判明）。
 */
const THIN_PROFILE_SHORT =
    "- ほぼ無い: 100文字程度で短く書く。自分の開示1つと、上記の軸についての問い1つだけ。書くことが無いなら短くてよく、長文で埋めようとしない"

const THIN_PROFILE_PREMIUM =
    "- ほぼ無い: 素材が乏しいので無理に文字数を稼がない。自分の開示と、上記の軸についての問いだけを、書ける範囲の長さで書く。素材の無い話題を作って字数を埋めるくらいなら短いままでよい"

/**
 * プレミアム用にプロンプトを加工する。
 *
 * 文字数制約を490〜500へ差し替え、素材が乏しい相手向けの「短く書け」指示も
 * プレミアム向けの文面に差し替える。
 *
 * `NORMAL_POINTS` の差し替えは、旧デフォルトを編集して使っているユーザー向けの
 * 後方互換パス（現行の DEFAULT_PROMPT にこの文言は無い）。
 *
 * ユーザーがオプション画面でテンプレートを編集している場合があるため、
 * 置換は対象文字列を含むときだけ行い、文字数制約は見つからなければ末尾に追記する。
 */
export const applyPremiumPrompt = (prompt: string): string => {
    let out = prompt.includes(NORMAL_LIMIT)
        ? prompt.replace(NORMAL_LIMIT, PREMIUM_LIMIT)
        : `${prompt}\n\n# 文字数制約（最重要）\n${PREMIUM_LIMIT}`

    if (out.includes(NORMAL_POINTS)) {
        out = out.replace(NORMAL_POINTS, PREMIUM_POINTS)
    }

    if (out.includes(THIN_PROFILE_SHORT)) {
        out = out.replace(THIN_PROFILE_SHORT, THIN_PROFILE_PREMIUM)
    }

    return out + PREMIUM_DEPTH
}
