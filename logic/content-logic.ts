import { Storage } from "@plasmohq/storage"
import { addLog } from "../utils/logger"
import { collectCardNames, parseCardPage } from "../utils/cards"
import { extractProfileFromJSON } from "../utils/profile"

const storage = new Storage({ area: "local" })

/**
 * テキストエリアに文字列を挿入し、各種イベントを発火させる
 */
export function insertText(textarea: HTMLTextAreaElement, text: string) {
    textarea.value = text
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    textarea.dispatchEvent(new Event("change", { bubbles: true }))
    textarea.focus()
}

/**
 * 自分のプロフィールを取得する（ストレージ優先、フォールバックでAPI）
 */
export async function getMyProfile() {
    try {
        const storedProfile = await storage.get("myProfile")
        if (storedProfile && (storedProfile as string).length > 10) {
            return storedProfile as string
        }

        await addLog("info", "Fetching my profile from API fallback", null, "CONTENT")
        const res = await fetch("https://luna-matching.com/api/user/get/me")
        if (!res.ok) throw new Error("Fetch failed: " + res.status)

        const data = await res.json()
        const profileData = data.profile || data.user || data
        const text = extractProfileFromJSON(profileData, data)

        if (text && text.length > 10) {
            await storage.set("myProfile", text)
            await storage.set("myProfileRaw", JSON.stringify(profileData))
            const now = new Date()
            const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
            await storage.set("myProfileUpdatedAt", dateStr)
            await addLog("info", "My profile auto-saved from API fallback", null, "CONTENT")
        }

        return text || "プロフィールの取得に失敗しました。詳細な自己紹介を記入し、設定画面でプロフィールを更新してください。"
    } catch (e: any) {
        await addLog("error", "Failed to fetch my profile from API fallback", { error: e.toString() }, "CONTENT")
        return "自分のプロフィールの取得に失敗しました。設定画面でプロフィールを更新するか、ログインしてください。"
    }
}

/**
 * 自分のプロフィールraw JSONを取得する（ストレージ優先、フォールバックでAPI）
 * プロフィール改善機能が生成の事実根拠として使う。
 */
export async function getMyProfileRaw(): Promise<string | null> {
    try {
        const stored = await storage.get("myProfileRaw")
        if (stored && (stored as string).length > 2) return stored as string

        await addLog("info", "Fetching myProfileRaw from API fallback", null, "CONTENT")
        const res = await fetch("https://luna-matching.com/api/user/get/me")
        if (!res.ok) return null

        const data = await res.json()
        const profileData = data.profile || data.user || data
        // 他の書き込み経路と同様に、抽出可能な実データのときだけキャッシュする。
        // 無検証で保存すると異常ボディが恒久キャッシュされ、需給判定まで汚染する。
        const text = extractProfileFromJSON(profileData, data)
        if (!text || text.length <= 10) return null
        // area 表示名の解決（content.tsx のキャッシュ経路と同じ補完）
        if (data.area_list && profileData.area && !profileData.area_text) {
            profileData.area_text = data.area_list[String(profileData.area)]
        }
        const raw = JSON.stringify(profileData)
        await storage.set("myProfileRaw", raw)
        return raw
    } catch (e: any) {
        await addLog("error", "Failed to fetch myProfileRaw", { error: e.toString() }, "CONTENT")
        return null
    }
}

export interface PartnerProfile {
    /** 生成用に整形したプロフィールテキスト */
    text: string
    /** ユーザーオブジェクト */
    data: any
    /** レスポンス全体。age_list/area_list等のルックアップに使う */
    raw: any
}

/**
 * メッセージスレッドIDから相手のユーザーIDを引く
 *
 * スレッドのURL(`/user/message/6173238`)の数値はスレッドIDであって
 * ユーザーIDではないため、message/list の `user_info.id` を正とする。
 */
export async function resolvePartnerUserId(threadId: string): Promise<string | null> {
    try {
        const res = await fetch(`https://luna-matching.com/api/user/message/list/${threadId}`)
        if (!res.ok) throw new Error("Fetch failed: " + res.status)

        const data = await res.json()
        const id = data?.user_info?.id
        if (id === undefined || id === null) {
            await addLog("warn", "message/list returned no user_info.id", { threadId }, "CONTENT")
            return null
        }
        return String(id)
    } catch (e: any) {
        await addLog("error", "Failed to resolve partner user id from thread", { error: e.toString(), threadId }, "CONTENT")
        return null
    }
}

/**
 * 相手のプロフィールをユーザーIDで明示的に取得する
 *
 * @param userId 相手のユーザーID（スレッドIDではない）
 * @param isService サービス側のエンドポイントを使うか
 * @param threadId メッセージページ由来なら、そのスレッドID。キャッシュの照合に使う
 */
export async function getPartnerProfile(
    userId: string,
    isService: boolean = false,
    threadId: string | null = null
): Promise<PartnerProfile | null> {
    try {
        const endpoint = isService
            ? `https://luna-matching.com/api/user/service/show/${userId}`
            : `https://luna-matching.com/api/user/show/${userId}`

        await addLog("info", `Fetching partner profile explicitly: ${endpoint}`, null, "CONTENT")

        const res = await fetch(endpoint)
        if (!res.ok) throw new Error("Fetch failed: " + res.status)

        const data = await res.json()

        if (!data) {
            throw new Error("API returned empty data")
        }

        const targetData = data.user || data.profile || data.member || data

        // 次回のためにキャッシュする。どのスレッドの相手かも一緒に残さないと
        // 別スレッドに遷移したとき、この相手のものだと誤認してしまう。
        sessionStorage.setItem(
            "luna_last_viewed_user",
            JSON.stringify(threadId ? { ...data, threadId } : data)
        )

        const text = extractProfileFromJSON(targetData, data)

        if (!text || text.length < 10) {
            await addLog("warn", "Extracted partner profile is very short or empty", { text, data }, "CONTENT")
        }

        return { text, data: targetData, raw: data }
    } catch (e: any) {
        await addLog("error", "Failed to fetch partner profile", { error: e.toString(), userId }, "CONTENT")
        return null
    }
}


/** 好みのカードの取得結果 */
export interface PartnerCards {
    /** 相手が選んだカード（上限あり） */
    own: string[]
    /** 自分と共通のカード。サーバー側が計算したもの */
    common: string[]
}

/** 相手固有のカードを辿る上限ページ数（1ページ8枚）。24枚まで */
const MAX_OWN_CARD_PAGES = 3
/** 共通カードはそのまま需給マッチの主役になるので取りこぼさない */
const MAX_COMMON_CARD_PAGES = 10

/**
 * 相手の「好みのカード」を取得する。
 *
 * 2つのエンドポイントがあり、common は自分との共通カードだけを返す
 * （サーバーが計算済みの共通点なので、需給マッチにそのまま使える）。
 * 失敗しても生成は続けたいので、例外は投げず空配列を返す。
 */
export async function getPartnerCards(userId: string): Promise<PartnerCards> {
    const fetchFrom = (kind: "your" | "common") => async (page: number) => {
        try {
            const res = await fetch(
                `https://luna-matching.com/api/user/${kind}/card/get/${userId}?page=${page}`
            )
            if (!res.ok) return null
            return parseCardPage(await res.json())
        } catch {
            return null
        }
    }

    try {
        const [own, common] = await Promise.all([
            collectCardNames(fetchFrom("your"), MAX_OWN_CARD_PAGES),
            collectCardNames(fetchFrom("common"), MAX_COMMON_CARD_PAGES)
        ])
        await addLog("info", `Partner cards: own=${own.length} common=${common.length}`, null, "CONTENT")
        return { own, common }
    } catch (e) {
        await addLog("warn", "Failed to fetch partner cards", { error: String(e) }, "CONTENT")
        return { own: [], common: [] }
    }
}
