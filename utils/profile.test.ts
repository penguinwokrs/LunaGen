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

    it("ageが表示用文字列（例: 30代前半）ならそのまま表示する", () => {
        // get/me は年齢を "30代前半" のような表示文字列で返す。
        // 従来は age_list に無いと「非公開」へ潰れていた。
        const text = extractProfileFromJSON({
            id: 1,
            name: "A",
            age: "30代前半",
            profile: "はじめまして、よろしくお願いします"
        })
        expect(text).toContain("年齢: 30代前半")
    })

    it("ageが数値コードでage_listに無い場合は従来どおり非公開", () => {
        const text = extractProfileFromJSON({
            id: 1,
            name: "A",
            age: 3,
            profile: "はじめまして、よろしくお願いします"
        })
        expect(text).toContain("年齢: 非公開")
    })

    it("area_listが無くてもarea_text（キャッシュ時に解決済みの表示名）があれば居住地を出す", () => {
        const text = extractProfileFromJSON({
            id: 1,
            name: "A",
            area: 18,
            area_text: "神奈川県",
            profile: "はじめまして、よろしくお願いします"
        })
        expect(text).toContain("居住地: 神奈川県")
    })

    it("空・null では空文字を返す", () => {
        expect(extractProfileFromJSON(null)).toBe("")
        expect(extractProfileFromJSON(undefined)).toBe("")
    })
})

describe("extractProfileFromJSON: 職業", () => {
    it("occupation の数値コードを表示名に解決して出力する", () => {
        const text = extractProfileFromJSON({ name: "テスト", occupation: 20, profile: "よろしく" })
        expect(text).toContain("職業: IT関連")
    })

    it("APIが occupation_list を返した場合はそちらを優先する", () => {
        const text = extractProfileFromJSON(
            { name: "テスト", occupation: 20, profile: "よろしく" },
            { occupation_list: { "20": "情報通信" } }
        )
        expect(text).toContain("職業: 情報通信")
    })

    it("occupation が未設定なら職業行を出さない", () => {
        const text = extractProfileFromJSON({ name: "テスト", occupation: null, profile: "よろしく" })
        expect(text).not.toContain("職業:")
    })

    it("対応表に無いコードは職業行を出さない（番号をそのまま出さない）", () => {
        const text = extractProfileFromJSON({ name: "テスト", occupation: 999, profile: "よろしく" })
        expect(text).not.toContain("職業:")
        expect(text).not.toContain("999")
    })

    it("work_text があればそちらを優先する", () => {
        const text = extractProfileFromJSON({ name: "テスト", occupation: 20, work_text: "自営業", profile: "よろしく" })
        expect(text).toContain("職業: 自営業")
    })
})
