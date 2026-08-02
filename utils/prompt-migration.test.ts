import { describe, expect, it } from "vitest"

import { migratePrompt } from "./prompt-migration"

const LEGACY = "旧プロンプト本文"
const NEXT = "新プロンプト本文"

describe("migratePrompt", () => {
  // 未設定のユーザーは生成時の `storage.get() || DEFAULT_PROMPT` で常に最新を使う。
  // ここで書き込むと「常に最新」から「その時点で固定」に変わり、次回のデフォルト更新で
  // 取り残される。書き込まないのが正しい。
  it("未保存（undefined）なら書き込まない", () => {
    expect(migratePrompt(undefined, [LEGACY], NEXT)).toBeNull()
  })

  it("null なら書き込まない", () => {
    expect(migratePrompt(null, [LEGACY], NEXT)).toBeNull()
  })

  it("空文字なら書き込まない", () => {
    expect(migratePrompt("", [LEGACY], NEXT)).toBeNull()
  })

  it("旧プロンプトと完全一致なら新プロンプトを返す", () => {
    expect(migratePrompt(LEGACY, [LEGACY], NEXT)).toBe(NEXT)
  })

  it("ユーザーが編集していれば null を返す（上書きしない）", () => {
    expect(migratePrompt("旧プロンプト本文に一言足した", [LEGACY], NEXT)).toBeNull()
  })

  it("末尾の空白1つでも違えば編集済みとみなす", () => {
    expect(migratePrompt(LEGACY + " ", [LEGACY], NEXT)).toBeNull()
  })

  it("すでに新プロンプトなら null を返す（無駄な書き込みをしない）", () => {
    expect(migratePrompt(NEXT, [LEGACY], NEXT)).toBeNull()
  })
})

describe("migratePrompt: 複数世代", () => {
    const V1 = "第1世代のプロンプト"
    const V2 = "第2世代のプロンプト"

    it("どの世代と一致しても移行する", () => {
        expect(migratePrompt(V1, [V1, V2], NEXT)).toBe(NEXT)
        expect(migratePrompt(V2, [V1, V2], NEXT)).toBe(NEXT)
    })

    it("世代を1つしか見ないと取り残されることの回帰テスト", () => {
        // V2 を保存済みのユーザーが、V1 しか見ない実装では「編集済み」扱いになる
        expect(migratePrompt(V2, [V1], NEXT)).toBeNull()
        expect(migratePrompt(V2, [V1, V2], NEXT)).toBe(NEXT)
    })

    it("どの世代とも一致しなければ上書きしない", () => {
        expect(migratePrompt("自分で書いたプロンプト", [V1, V2], NEXT)).toBeNull()
    })
})
