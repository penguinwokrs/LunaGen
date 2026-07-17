import { describe, expect, it } from "vitest"
import { resolveCachedPartner } from "./partner"

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
