import { describe, expect, it } from "vitest"

import { collectCardNames, formatCardsSection, parseCardPage } from "./cards"

const page = (names: string[], lastPage = 1, key: "user_card_list" | "card_list" = "card_list") => ({
    [key]: { current_page: 1, last_page: lastPage, per_page: 8, total: names.length, data: names.map((n, i) => ({ id: i, name: n })) }
})

describe("parseCardPage", () => {
    it("card_list 形式を読める", () => {
        expect(parseCardPage(page(["猫が好き", "映画好き"]))?.names).toEqual(["猫が好き", "映画好き"])
    })

    it("user_card_list 形式も読める（エンドポイントによってキーが違う）", () => {
        expect(parseCardPage(page(["首輪が好き"], 1, "user_card_list"))?.names).toEqual(["首輪が好き"])
    })

    it("最終ページ番号を取り出す", () => {
        expect(parseCardPage(page(["a"], 7))?.lastPage).toBe(7)
    })

    it("last_page が壊れていても1として扱う", () => {
        const j: any = page(["a"])
        j.card_list.last_page = "なにか"
        expect(parseCardPage(j)?.lastPage).toBe(1)
    })

    it("名前が空のカードは落とす", () => {
        const j: any = page(["猫が好き"])
        j.card_list.data.push({ id: 99, name: "   " }, { id: 100 })
        expect(parseCardPage(j)?.names).toEqual(["猫が好き"])
    })

    it("形が違えば null", () => {
        expect(parseCardPage({})).toBeNull()
        expect(parseCardPage(null)).toBeNull()
        expect(parseCardPage({ card_list: {} })).toBeNull()
    })
})

describe("collectCardNames", () => {
    it("最終ページまで辿って集める", async () => {
        const pages: Record<number, string[]> = { 1: ["a", "b"], 2: ["c"] }
        const out = await collectCardNames(
            async (p) => (pages[p] ? { names: pages[p], lastPage: 2 } : null),
            5
        )
        expect(out).toEqual(["a", "b", "c"])
    })

    it("上限ページ数で打ち切る", async () => {
        const out = await collectCardNames(
            async (p) => ({ names: [`p${p}`], lastPage: 7 }),
            3
        )
        expect(out).toEqual(["p1", "p2", "p3"])
    })

    it("途中で失敗しても、集まった分は返す", async () => {
        const out = await collectCardNames(
            async (p) => (p === 1 ? { names: ["a"], lastPage: 3 } : null),
            3
        )
        expect(out).toEqual(["a"])
    })

    it("1ページ目が取れなければ空", async () => {
        expect(await collectCardNames(async () => null, 3)).toEqual([])
    })

    it("重複は登場順で1つにまとめる", async () => {
        const out = await collectCardNames(
            async (p) => ({ names: p === 1 ? ["a", "b"] : ["b", "c"], lastPage: 2 }),
            2
        )
        expect(out).toEqual(["a", "b", "c"])
    })
})

describe("formatCardsSection", () => {
    it("プロフィール本文の【…】形式に合わせる", () => {
        const s = formatCardsSection(["猫が好き", "映画好き"])
        expect(s).toContain("【好みのカード")
        expect(s).toContain("猫が好き / 映画好き")
    })

    it("0枚なら何も出さない", () => {
        expect(formatCardsSection([])).toBe("")
    })
})
