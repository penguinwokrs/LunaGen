import { Storage } from "@plasmohq/storage"
import { addLog } from "../utils/logger"
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
 * 相手のプロフィールをIDで明示的に取得する
 */
export async function getPartnerProfile(userId: string, isService: boolean = false) {
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

        // Cache this for next time
        sessionStorage.setItem("luna_last_viewed_user", JSON.stringify(data))

        const targetData = data.user || data.profile || data.member || data
        const text = extractProfileFromJSON(targetData, data)

        if (!text || text.length < 10) {
            await addLog("warn", "Extracted partner profile is very short or empty", { text, data }, "CONTENT")
        }

        return text
    } catch (e: any) {
        await addLog("error", "Failed to fetch partner profile", { error: e.toString(), userId }, "CONTENT")
        return null
    }
}
