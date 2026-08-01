import { describe, expect, it } from "vitest"

import { migratePrompt } from "./prompt-migration"

const LEGACY = "旧プロンプト本文"
const NEXT = "新プロンプト本文"

describe("migratePrompt", () => {
  it("未保存（undefined）なら新プロンプトを返す", () => {
    expect(migratePrompt(undefined, LEGACY, NEXT)).toBe(NEXT)
  })

  it("null なら新プロンプトを返す", () => {
    expect(migratePrompt(null, LEGACY, NEXT)).toBe(NEXT)
  })

  it("空文字なら新プロンプトを返す", () => {
    expect(migratePrompt("", LEGACY, NEXT)).toBe(NEXT)
  })

  it("旧プロンプトと完全一致なら新プロンプトを返す", () => {
    expect(migratePrompt(LEGACY, LEGACY, NEXT)).toBe(NEXT)
  })

  it("ユーザーが編集していれば null を返す（上書きしない）", () => {
    expect(migratePrompt("旧プロンプト本文に一言足した", LEGACY, NEXT)).toBeNull()
  })

  it("末尾の空白1つでも違えば編集済みとみなす", () => {
    expect(migratePrompt(LEGACY + " ", LEGACY, NEXT)).toBeNull()
  })

  it("すでに新プロンプトなら null を返す（無駄な書き込みをしない）", () => {
    expect(migratePrompt(NEXT, LEGACY, NEXT)).toBeNull()
  })
})
