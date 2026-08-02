/**
 * 好みのカード（Lunaの「性癖カード」）の解析
 *
 * 相手が選択式で登録している好み・趣味のカード。「猫が好き」「においフェチ」
 * 「ボンデージ&拘束具」のように、本人が自分で選んだ具体的な項目が並ぶ。
 * 自由記述より具体的で、しかも取りこぼしが少ない。
 *
 * API（2026-08-02 実測）:
 *   GET /api/user/your/card/get/{userId}   → その相手が選んだカード全部
 *   GET /api/user/common/card/get/{userId} → 自分と共通のカードだけ
 * どちらも `?page=N` のページング（1ページ8枚固定。per_page/limit は効かない）。
 * レスポンスの本体キーが `user_card_list` / `card_list` と異なる点に注意。
 */

/** ページ1件分のパース結果 */
export interface CardPage {
    names: string[]
    lastPage: number
}

/**
 * カードAPIのレスポンスから名前一覧と最終ページ番号を取り出す。
 * 形が違う（キー名が2種類ある / データが無い）場合は null。
 */
export function parseCardPage(json: any): CardPage | null {
    const list = json?.user_card_list ?? json?.card_list
    if (!list || !Array.isArray(list.data)) return null
    const names = list.data
        .map((c: any) => (typeof c?.name === "string" ? c.name.trim() : ""))
        .filter((n: string) => n.length > 0)
    const lastPage = Number(list.last_page)
    return { names, lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : 1 }
}

/**
 * ページを辿ってカード名を集める。
 *
 * @param fetchPage ページ番号を受け取り、パース済みのページを返す。失敗時は null
 * @param maxPages 辿る上限ページ数。1ページ8枚なので、24枚なら3
 * @returns 重複を除いたカード名（登場順）
 */
export async function collectCardNames(
    fetchPage: (page: number) => Promise<CardPage | null>,
    maxPages: number
): Promise<string[]> {
    const seen = new Set<string>()
    const out: string[] = []

    const first = await fetchPage(1)
    if (!first) return out
    for (const n of first.names) if (!seen.has(n)) { seen.add(n); out.push(n) }

    const limit = Math.min(first.lastPage, Math.max(1, maxPages))
    for (let page = 2; page <= limit; page++) {
        const p = await fetchPage(page)
        // 途中で失敗したらそこまでで打ち切る。集まった分は使う
        if (!p) break
        for (const n of p.names) if (!seen.has(n)) { seen.add(n); out.push(n) }
    }
    return out
}

/**
 * 相手のプロフィール本文へ足す「好みのカード」セクション。
 * `extractProfileFromJSON` が出す【…】形式に合わせているので、
 * プロンプトの「素材の範囲」ルールがそのまま働く。
 */
export function formatCardsSection(names: string[]): string {
    if (names.length === 0) return ""
    return `\n【好みのカード（本人が選択式で登録した好み）】\n${names.join(" / ")}\n`
}
