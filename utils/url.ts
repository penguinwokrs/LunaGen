/**
 * URLからユーザーIDを抽出する
 * @param url URL文字列
 * @returns ユーザーID または null
 */
export function getUserIdFromUrl(url: string): string | null {
    const match = url.match(/\/show\/(\d+)/) || url.match(/\/user\/show\/(\d+)/) || url.match(/\/user\/service\/show\/(\d+)/)
    return match ? match[1] : null
}
