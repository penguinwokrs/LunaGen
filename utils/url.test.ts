import { describe, expect, it } from "vitest"
import { getThreadIdFromMessageListUrl, getThreadIdFromUrl, getUserIdFromUrl } from "./url"

describe("getUserIdFromUrl", () => {
    it("プロフィールページからユーザーIDを取る", () => {
        expect(getUserIdFromUrl("https://luna-matching.com/user/show/159749")).toBe("159749")
        expect(getUserIdFromUrl("https://luna-matching.com/user/service/show/159749")).toBe("159749")
    })

    it("メッセージスレッドのURLからは取らない（スレッドIDでありユーザーIDではないため）", () => {
        expect(getUserIdFromUrl("https://luna-matching.com/user/message/6173238")).toBeNull()
    })

    it("IDが無いURLではnull", () => {
        expect(getUserIdFromUrl("https://luna-matching.com/user/message")).toBeNull()
    })
})

describe("getThreadIdFromUrl", () => {
    it("メッセージスレッドのURLからスレッドIDを取る", () => {
        expect(getThreadIdFromUrl("https://luna-matching.com/user/message/6173238")).toBe("6173238")
    })

    it("プロフィールページではnull", () => {
        expect(getThreadIdFromUrl("https://luna-matching.com/user/show/159749")).toBeNull()
    })
})

describe("getThreadIdFromMessageListUrl", () => {
    it("message/list APIのURLからスレッドIDを取る", () => {
        expect(getThreadIdFromMessageListUrl("https://luna-matching.com/api/user/message/list/6173238")).toBe("6173238")
    })

    it("無関係なAPIではnull", () => {
        expect(getThreadIdFromMessageListUrl("https://luna-matching.com/api/user/show/159749")).toBeNull()
    })
})
