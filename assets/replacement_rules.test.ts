import { describe, expect, it } from "vitest"

import { replacementRules } from "./replacement_rules"

/**
 * 置換ルールは「相手の書いた文言をプロンプト上で書き換える」ので、
 * 一般語を入れると意味を壊す。実際に事故を起こした語を戻さないよう縛る。
 */
const MUST_NOT_INCLUDE = [
    "薬", // 「持病の薬」が消える
    "教育", // 「教育関係の仕事」が壊れる（職業マスタにも「教育関連」がある）
    "出血", // NG欄の意味が反転する（実LLM評価で確認済み）
    "死に", // 「死にそう」等の慣用表現を壊す
    "日本酒",
    "十四代",
    "光栄菊",
    "年齢差",
    "SM", // このサイトの中核語。全置換すると文脈が崩れる
    "拘束" // 「物理的な拘束」は嗜好の中核。「固定」では意味が変わる
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

describe("好みのカードで実測されたブロック語", () => {
    // 2026-08-02、カードを素材に入れた20件×2腕の対照でブロックが 0/20 → 4/20 に増えた。
    // そのとき実際に現れた語を必ずカバーする。
    const OBSERVED_IN_BLOCKED_CARDS = ["首絞め", "痴漢", "メスオナホ", "髪鷲掴み"]

    it("実測でブロックを起こした語を置換対象に含む", () => {
        const froms = replacementRules.map((r) => r.from)
        for (const word of OBSERVED_IN_BLOCKED_CARDS) {
            expect(froms, `「${word}」がカバーされていない`).toContain(word)
        }
    })
})
