import { getThreadIdFromUrl, getUserIdFromUrl } from "./url"

export interface CachedPartner {
    /** ユーザーオブジェクト（user_info 相当） */
    data: any
    /** レスポンス全体。age_list/area_list等のルックアップに使う */
    raw: any
    /** 相手のユーザーID。取れなければ null */
    userId: string | null
}

/**
 * sessionStorageの相手プロフィールキャッシュが「今見ているページの相手」の
 * ものか検証し、一致した場合だけ返す。
 *
 * SPA遷移でキャッシュだけ古いまま残ると別人のプロフィールで生成してしまうため、
 * 照合できる手段があるときは必ず照合する:
 *  - `/show/` ページ: URL上のユーザーIDと突き合わせる
 *  - メッセージページ: キャッシュに記録したスレッドIDと突き合わせる。
 *    スレッドIDを持たないキャッシュ（別ページ由来）はこの相手のものと確認できない
 *    ため採用しない。
 *
 * @param cachedJson sessionStorageの生の文字列
 * @param currentUrl 現在のページURL
 * @returns 検証を通ったキャッシュ、なければ null
 */
export function resolveCachedPartner(cachedJson: string | null, currentUrl: string): CachedPartner | null {
    if (!cachedJson) return null

    let raw: any
    try {
        raw = JSON.parse(cachedJson)
    } catch {
        return null
    }
    if (!raw || typeof raw !== "object") return null

    const data = raw.user || raw.profile || raw.member || raw
    if (!data || typeof data !== "object") return null

    const cachedId = data.id ?? data.user_id
    const userId = cachedId === undefined || cachedId === null ? null : String(cachedId)

    const urlUserId = getUserIdFromUrl(currentUrl)
    if (urlUserId && userId && userId !== urlUserId) return null

    const threadId = getThreadIdFromUrl(currentUrl)
    if (threadId) {
        const cachedThreadId = raw.threadId ? String(raw.threadId) : null
        if (cachedThreadId !== threadId) return null
    }

    return { data, raw, userId }
}
