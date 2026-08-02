import { describe, expect, it } from "vitest"

import { replacementRules } from "./replacement_rules"

/**
 * 置換ルールは「相手の書いた文言をプロンプト上で書き換える」ので、
 * 一般語を入れると意味を壊す。実際に事故を起こした語を戻さないよう縛る。
 */
const MUST_NOT_INCLUDE = [
    "薬", // 「持病の薬」が消える
    "教育", // 「教育関係の仕事」が壊れる
    "出血", // NG欄の意味が反転する（実LLM評価で確認済み）
    "死に", // 「死にそう」等の慣用表現を壊す
    "日本酒",
    "十四代",
    "光栄菊",
    "年齢差",
    "SM",
    "拘束",
    "エッチ"
]

describe("replacementRules", () => {
    it("意味を壊す語・ノイズ語を含まない", () => {
        const froms = replacementRules.map((r) => r.from)
        for (const word of MUST_NOT_INCLUDE) {
            expect(froms, `「${word}」は意味を壊すため戻してはいけない`).not.toContain(word)
        }
    })

    it("from と to が両方とも空でない", () => {
        for (const rule of replacementRules) {
            expect(rule.from.length).toBeGreaterThan(0)
            // to が空だと「削除」になる。削除は元の文の意味を落とすので既定では使わない
            expect(rule.to.length, `「${rule.from}」の置換先が空`).toBeGreaterThan(0)
        }
    })

    it("from が重複していない", () => {
        const froms = replacementRules.map((r) => r.from)
        expect(new Set(froms).size).toBe(froms.length)
    })

    it("置換先が置換対象を含まない（再置換で壊れないこと）", () => {
        for (const rule of replacementRules) {
            expect(rule.to.includes(rule.from), `「${rule.from}」→「${rule.to}」が自己参照`).toBe(false)
        }
    })
})
