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
    "\n\n# 内容の厚み（プレミアム）\n噛み合う点を2〜3個取り上げ、各点に自分の具体的な体験やエピソードを添えて掘り下げ、文字数が500に届く手前まで厚く書くこと。"

/**
 * プレミアム用にプロンプトを加工する。
 *
 * 文字数制約を490〜500へ差し替え、取り上げる噛み合い点の数も増やす。
 * 後者を直さないと「1〜2点を選ぶ」と「2〜3個取り上げ」が衝突して出力が短くなる。
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

    return out + PREMIUM_DEPTH
}
