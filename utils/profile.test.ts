import { describe, expect, it } from "vitest"
import { extractProfileFromJSON } from "./profile"

describe("extractProfileFromJSON", () => {
    it("ユーザーオブジェクトの profile(自己紹介文字列)でネスト展開を誤爆しない", () => {
        // 実データ回帰: user.profile は自己紹介の文字列。
        // かつて `u.user || u.profile || ...` でこの文字列を data に採用してしまい、
        // name/age 等を含む本体が失われて抽出結果が自己紹介だけに退化していた。
        // 短い自己紹介だと 10文字未満になり「プロフィール取得失敗」を引き起こした。
        const user = {
            id: 145895,
            name: "Hinano",
            age: 28,
            profile: "お友達が欲しい"
        }

        const text = extractProfileFromJSON(user)

        expect(text).toContain("名前: Hinano")
        expect(text).toContain("年齢: 28歳")
        expect(text).toContain("お友達が欲しい")
        expect(text.length).toBeGreaterThan(10)
    })

    it("短い自己紹介でも構造化フィールドから10文字超のテキストになる", () => {
        const user = { id: 1, name: "A", area: 17, profile: "よろ" }
        const text = extractProfileFromJSON(user, { area_list: { "17": "東京都" } })

        expect(text).toContain("居住地: 東京都")
        expect(text.length).toBeGreaterThan(10)
    })

    it("本物のネスト(user が オブジェクト)は展開する", () => {
        const res = { user: { name: "Bob", profile: "はじめまして、よろしくお願いします" } }
        const text = extractProfileFromJSON(res)

        expect(text).toContain("名前: Bob")
        expect(text).toContain("はじめまして")
    })

    it("空・null では空文字を返す", () => {
        expect(extractProfileFromJSON(null)).toBe("")
        expect(extractProfileFromJSON(undefined)).toBe("")
    })
})
