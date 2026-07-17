import { describe, expect, it } from "vitest"
import { formatChatHistory, mergePartnerCache, resolveCachedHistory, resolveCachedPartner } from "./partner"

const MESSAGE_URL = "https://luna-matching.com/user/message/6173238"
const SHOW_URL = "https://luna-matching.com/user/show/159749"

// 実データ形状: message/list の user_info は薄い
const userInfo = { id: 159749, name: "あゆみ", profile: null, is_suspended: false }

describe("resolveCachedPartner", () => {
    it("スレッドIDが一致すればキャッシュを採用する", () => {
        const cached = JSON.stringify({ user: userInfo, threadId: "6173238" })
        const result = resolveCachedPartner(cached, MESSAGE_URL)
        expect(result?.userId).toBe("159749")
        expect(result?.data.name).toBe("あゆみ")
    })

    it("別スレッドのキャッシュは採用しない（別人で生成するのを防ぐ）", () => {
        const cached = JSON.stringify({ user: userInfo, threadId: "9999999" })
        expect(resolveCachedPartner(cached, MESSAGE_URL)).toBeNull()
    })

    it("スレッドIDを持たないキャッシュはメッセージページでは採用しない", () => {
        const cached = JSON.stringify({ user: userInfo })
        expect(resolveCachedPartner(cached, MESSAGE_URL)).toBeNull()
    })

    it("プロフィールページではURLのユーザーIDと突き合わせる", () => {
        const cached = JSON.stringify({ user: userInfo })
        expect(resolveCachedPartner(cached, SHOW_URL)?.userId).toBe("159749")
    })

    it("プロフィールページでIDが食い違うキャッシュは採用しない", () => {
        const cached = JSON.stringify({ user: { id: 111111, name: "別人" } })
        expect(resolveCachedPartner(cached, SHOW_URL)).toBeNull()
    })

    it("キャッシュが無い/壊れている場合はnull", () => {
        expect(resolveCachedPartner(null, MESSAGE_URL)).toBeNull()
        expect(resolveCachedPartner("{壊れたJSON", MESSAGE_URL)).toBeNull()
    })
})

describe("mergePartnerCache", () => {
    // /api/user/show/ 由来の詳細キャッシュ（実際は約200項目）
    const richCache = JSON.stringify({
        code: 200,
        age_list: { "5": "30代前半" },
        user: { id: 159749, name: "あゆみ", q_1: "3", area: "14" }
    })

    it("同一ユーザーの詳細キャッシュは薄いuser_infoで潰さず、threadIdだけ足す", () => {
        const merged = JSON.parse(mergePartnerCache(richCache, userInfo, "6173238"))
        expect(merged.threadId).toBe("6173238")
        expect(merged.user.q_1).toBe("3") // 詳細情報が残っている
        expect(merged.age_list).toEqual({ "5": "30代前半" }) // ルックアップも残る
    })

    it("別ユーザーのキャッシュは残さず作り直す", () => {
        const merged = JSON.parse(mergePartnerCache(richCache, { id: 999999, name: "別人" }, "6173238"))
        expect(merged.user.id).toBe(999999)
        expect(merged.age_list).toBeUndefined()
    })

    it("キャッシュが無い/壊れている場合はuser_infoから作る", () => {
        expect(JSON.parse(mergePartnerCache(null, userInfo, "6173238")).user.id).toBe(159749)
        expect(JSON.parse(mergePartnerCache("{壊れたJSON", userInfo, "6173238")).user.id).toBe(159749)
    })
})

describe("resolveCachedHistory", () => {
    const messages = [{ user_id: 149587, message: "こんにちは" }]
    const cached = JSON.stringify({ messages, partnerId: 159749, threadId: "6173238" })

    it("相手とスレッドが一致すれば履歴を採用する", () => {
        expect(resolveCachedHistory(cached, MESSAGE_URL, "159749")?.messages).toEqual(messages)
    })

    it("別の相手の履歴は採用しない", () => {
        expect(resolveCachedHistory(cached, MESSAGE_URL, "999999")).toBeNull()
    })

    it("別スレッドの履歴は採用しない", () => {
        const other = JSON.stringify({ messages, partnerId: 159749, threadId: "9999999" })
        expect(resolveCachedHistory(other, MESSAGE_URL, "159749")).toBeNull()
    })

    it("相手を照合できない履歴は採用しない", () => {
        const noPartner = JSON.stringify({ messages, threadId: "6173238" })
        expect(resolveCachedHistory(noPartner, MESSAGE_URL, "159749")).toBeNull()
        expect(resolveCachedHistory(cached, MESSAGE_URL, null)).toBeNull()
    })

    it("キャッシュが無い/壊れている場合はnull", () => {
        expect(resolveCachedHistory(null, MESSAGE_URL, "159749")).toBeNull()
        expect(resolveCachedHistory("{壊れたJSON", MESSAGE_URL, "159749")).toBeNull()
    })
})

describe("formatChatHistory", () => {
    const messages = [
        { user_id: 149587, message: "はじめまして" },
        { user_id: 159749, message: "よろしくね" }
    ]

    it("相手の発言をPartner、それ以外をMeとして整形する", () => {
        expect(formatChatHistory(messages, "159749")).toBe("Me: はじめまして\nPartner: よろしくね")
    })

    it("直近N件だけ使う", () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ user_id: 159749, message: `m${i}` }))
        const lines = formatChatHistory(many, "159749", 15).split("\n")
        expect(lines).toHaveLength(15)
        expect(lines[0]).toBe("Partner: m5")
    })
})
