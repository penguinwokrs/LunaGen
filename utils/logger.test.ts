import { describe, expect, it } from "vitest"

import { DETAIL_MAX_LENGTH, formatLogDetail } from "./logger"

describe("formatLogDetail", () => {
    it("オブジェクトはJSON文字列にする", () => {
        expect(formatLogDetail({ text: "こんばんは", length: 5 })).toBe(
            '{"text":"こんばんは","length":5}'
        )
    })

    it("文字列はそのまま", () => {
        expect(formatLogDetail("プレーンな文字列")).toBe("プレーンな文字列")
    })

    it("null/undefined/数値はそのまま返す", () => {
        expect(formatLogDetail(null)).toBeNull()
        expect(formatLogDetail(undefined)).toBeUndefined()
        expect(formatLogDetail(42)).toBe(42)
    })

    // 生成メッセージはプレミアムで最大500字、プロフィール改善案は400字。
    // 旧実装の1000字上限だと、他のフィールドと合わせて切れる恐れがあった。
    it("生成メッセージ500字は切り詰めずに丸ごと残す", () => {
        const text = "あ".repeat(500)
        const out = formatLogDetail({ text, fallbackUsed: "cloudflare" }) as string
        expect(out).toContain(text)
        expect(out).not.toContain("省略")
    })

    it("上限を超えたら切り詰めて、省略した文字数を添える", () => {
        const out = formatLogDetail("x".repeat(DETAIL_MAX_LENGTH + 123)) as string
        expect(out.startsWith("x".repeat(DETAIL_MAX_LENGTH))).toBe(true)
        expect(out).toContain("残り123文字を省略")
    })

    it("ちょうど上限なら切り詰めない", () => {
        const out = formatLogDetail("x".repeat(DETAIL_MAX_LENGTH)) as string
        expect(out).toHaveLength(DETAIL_MAX_LENGTH)
        expect(out).not.toContain("省略")
    })

    // ここで例外が出るとログ自体が丸ごと失われる
    it("循環参照でも例外を投げない", () => {
        const circular: any = { name: "loop" }
        circular.self = circular
        expect(formatLogDetail(circular)).toBe("[detailを文字列化できませんでした]")
    })
})
