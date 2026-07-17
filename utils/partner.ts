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

/**
 * message/list で得た薄い user_info を、既存キャッシュに反映した文字列を返す。
 *
 * 同一ユーザーの詳細キャッシュ（`/api/user/show/` 由来、約200項目）が既にある場合、
 * 薄い user_info（7項目）で上書きすると情報が失われ、生成時に取得し直す羽目になる。
 * 同一ユーザーだと確認できたときは詳細を残し、threadId だけ足す。
 *
 * @param existingJson 既存キャッシュの生の文字列
 * @param userInfo message/list の user_info
 * @param threadId そのレスポンスのスレッドID
 * @returns sessionStorageに入れる文字列
 */
export function mergePartnerCache(
    existingJson: string | null,
    userInfo: any,
    threadId: string | null
): string {
    const incomingId = userInfo?.id ?? userInfo?.user_id

    if (existingJson && incomingId !== undefined && incomingId !== null) {
        try {
            const cached = JSON.parse(existingJson)
            const cachedData = cached?.user || cached?.profile || cached?.member || cached
            const cachedId = cachedData?.id ?? cachedData?.user_id

            if (cachedId !== undefined && cachedId !== null && String(cachedId) === String(incomingId)) {
                return JSON.stringify({ ...cached, threadId })
            }
        } catch {
            // 壊れたキャッシュは無視して作り直す
        }
    }

    return JSON.stringify({ user: userInfo, threadId })
}

export interface CachedHistory {
    messages: any[]
    /** 相手のユーザーID */
    partnerId: string
}

/**
 * 会話履歴キャッシュが「今の相手」のものか検証し、一致した場合だけ返す。
 *
 * プロフィールと同様、SPA遷移でキャッシュだけ古いまま残ると別人の会話履歴を
 * 元に生成してしまう。照合できないキャッシュは採用しない。
 *
 * @param cachedJson sessionStorageの生の文字列
 * @param currentUrl 現在のページURL
 * @param partnerUserId 確定済みの相手のユーザーID
 */
export function resolveCachedHistory(
    cachedJson: string | null,
    currentUrl: string,
    partnerUserId: string | null
): CachedHistory | null {
    if (!cachedJson) return null

    let raw: any
    try {
        raw = JSON.parse(cachedJson)
    } catch {
        return null
    }
    if (!raw || typeof raw !== "object") return null

    const cachedPartnerId =
        raw.partnerId === undefined || raw.partnerId === null ? null : String(raw.partnerId)

    // 相手が一致しない履歴は使わない
    if (!cachedPartnerId || !partnerUserId || cachedPartnerId !== partnerUserId) return null

    // スレッドIDでも照合できるなら重ねて確認する
    const threadId = getThreadIdFromUrl(currentUrl)
    if (threadId) {
        const cachedThreadId = raw.threadId ? String(raw.threadId) : null
        if (cachedThreadId !== threadId) return null
    }

    const messages = Array.isArray(raw.messages) ? raw.messages : []
    return { messages, partnerId: cachedPartnerId }
}

/**
 * 会話履歴をプロンプト用のテキストに整形する
 *
 * @param messages メッセージ配列
 * @param partnerId 相手のユーザーID。発言者の判定に使う
 * @param limit 直近何件を使うか
 */
export function formatChatHistory(messages: any[], partnerId: string, limit = 15): string {
    return messages
        .slice(-limit)
        .map((m: any) => {
            const isPartner = String(m.user_id) === String(partnerId)
            return `${isPartner ? "Partner" : "Me"}: ${m.message}`
        })
        .join("\n")
}
