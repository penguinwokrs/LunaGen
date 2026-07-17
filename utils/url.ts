/**
 * URLからユーザーIDを抽出する
 *
 * 対象は `/show/` 系のプロフィールページのみ。メッセージスレッドのURL
 * (`/user/message/123`) の数値は**スレッドIDでありユーザーIDではない**ため、
 * ここでは意図的に拾わない。混同すると別人のプロフィールを取得してしまう。
 *
 * @param url URL文字列
 * @returns ユーザーID または null
 */
export function getUserIdFromUrl(url: string): string | null {
    const match = url.match(/\/show\/(\d+)/) || url.match(/\/user\/show\/(\d+)/) || url.match(/\/user\/service\/show\/(\d+)/)
    return match ? match[1] : null
}

/**
 * メッセージスレッドのページURLからスレッドIDを抽出する
 *
 * 返るのはスレッドIDであってユーザーIDではない。相手のユーザーIDは
 * `/api/user/message/list/{threadId}` の `user_info.id` から引く。
 *
 * @param url URL文字列
 * @returns スレッドID または null
 */
export function getThreadIdFromUrl(url: string): string | null {
    const match = url.match(/\/user\/message\/(\d+)/)
    return match ? match[1] : null
}

/**
 * message/list APIのURLからスレッドIDを抽出する
 *
 * @param url APIのURL文字列
 * @returns スレッドID または null
 */
export function getThreadIdFromMessageListUrl(url: string): string | null {
    const match = url.match(/\/api\/user\/message\/list\/(\d+)/)
    return match ? match[1] : null
}
