import { describe, expect, it } from "vitest"

import { DEFAULT_TONE_PRESETS } from "../constants"
import {
  NO_TONE,
  buildToneBlock,
  injectToneBlock,
  lookupPartnerTone,
  rememberPartnerTone,
  resolvePartnerToneKey,
  resolveToneInstruction,
  selectableTones,
  type PartnerTones,
  type TonePreset
} from "./tone"

const PRESETS: TonePreset[] = [
  { id: "tone1", label: "丁寧", instruction: "敬体で書く" },
  { id: "tone2", label: "フレンドリー", instruction: "砕けた言い回しで" },
  { id: "tone3", label: "クール", instruction: "" }
]

describe("resolvePartnerToneKey", () => {
  it("プロフィールページはURLのユーザーIDを使う", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/user/show/123", null)).toBe("u:123")
  })

  it("URLで取れなければキャッシュのユーザーIDを使う", () => {
    const cached = JSON.stringify({ user: { id: 456 }, threadId: "789" })
    expect(resolvePartnerToneKey("https://luna-matching.com/user/message/789", cached)).toBe("u:456")
  })

  it("ユーザーIDが取れなければスレッドIDを使う", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/user/message/789", null)).toBe("t:789")
  })

  it("どれも取れなければ null", () => {
    expect(resolvePartnerToneKey("https://luna-matching.com/search", null)).toBeNull()
  })
})

describe("selectableTones", () => {
  it("指示文が空の枠はメニューに出さない", () => {
    expect(selectableTones(PRESETS).map((t) => t.id)).toEqual(["tone1", "tone2"])
  })

  it("空白だけの指示文も出さない", () => {
    expect(selectableTones([{ id: "tone1", label: "x", instruction: "   " }])).toEqual([])
  })
})

describe("resolveToneInstruction", () => {
  it("IDから指示文を引く", () => {
    expect(resolveToneInstruction("tone2", PRESETS)).toBe("砕けた言い回しで")
  })

  it("ラベルを変えてもIDで引ける", () => {
    const renamed = [{ id: "tone2", label: "別名にした", instruction: "砕けた言い回しで" }]
    expect(resolveToneInstruction("tone2", renamed)).toBe("砕けた言い回しで")
  })

  it("指定なし・未知のID・空・未指定は null", () => {
    expect(resolveToneInstruction(NO_TONE, PRESETS)).toBeNull()
    expect(resolveToneInstruction("tone9", PRESETS)).toBeNull()
    expect(resolveToneInstruction("", PRESETS)).toBeNull()
    expect(resolveToneInstruction(undefined, PRESETS)).toBeNull()
  })

  it("指示文が空の枠を指定されても null", () => {
    expect(resolveToneInstruction("tone3", PRESETS)).toBeNull()
  })
})

describe("rememberPartnerTone", () => {
  it("キーがあれば記録する", () => {
    const out = rememberPartnerTone({}, "u:1", "tone1", "2026-08-02T00:00:00.000Z")
    expect(out["u:1"]).toEqual({ toneId: "tone1", updatedAt: "2026-08-02T00:00:00.000Z" })
  })

  it("キーが null なら何も記録しない", () => {
    expect(rememberPartnerTone({}, null, "tone1", "2026-08-02T00:00:00.000Z")).toEqual({})
  })

  it("上限300件を超えたら updatedAt の古い順に捨てる", () => {
    const tones: PartnerTones = {}
    for (let i = 0; i < 300; i++) {
      tones[`u:${i}`] = { toneId: "tone1", updatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }
    }
    const out = rememberPartnerTone(tones, "u:new", "tone2", "2026-08-02T00:00:00.000Z")
    expect(Object.keys(out)).toHaveLength(300)
    expect(out["u:new"]).toBeTruthy()
    expect(out["u:0"]).toBeUndefined() // 一番古いものが消える
    expect(out["u:299"]).toBeTruthy()
  })

  it("既存キーの更新では件数が増えない", () => {
    const tones: PartnerTones = { "u:1": { toneId: "tone1", updatedAt: "2026-01-01T00:00:00.000Z" } }
    const out = rememberPartnerTone(tones, "u:1", "tone2", "2026-08-02T00:00:00.000Z")
    expect(Object.keys(out)).toHaveLength(1)
    expect(out["u:1"].toneId).toBe("tone2")
  })
})

describe("lookupPartnerTone", () => {
  it("記憶があればそれを返す", () => {
    const tones: PartnerTones = { "u:1": { toneId: "tone2", updatedAt: "2026-01-01T00:00:00.000Z" } }
    expect(lookupPartnerTone(tones, "u:1", NO_TONE)).toBe("tone2")
  })

  it("初めての相手は既定の口調", () => {
    expect(lookupPartnerTone({}, "u:9", "tone1")).toBe("tone1")
  })

  it("キーが null でも既定の口調", () => {
    expect(lookupPartnerTone({}, null, "tone1")).toBe("tone1")
  })
})

describe("buildToneBlock / injectToneBlock", () => {
  it("指示文をブロックに埋め込む", () => {
    const block = buildToneBlock("敬体で書く")
    expect(block).toContain("敬体で書く")
    expect(block).toContain("# 口調の指定")
  })

  it("{tone_instruction} があればその位置に差し込む", () => {
    const out = injectToneBlock("前\n{tone_instruction}\n後", "敬体で書く")
    expect(out).toContain("敬体で書く")
    expect(out).not.toContain("{tone_instruction}")
    expect(out.indexOf("敬体で書く")).toBeLessThan(out.indexOf("後"))
  })

  it("プレースホルダが無ければ末尾に足す", () => {
    const out = injectToneBlock("本文", "敬体で書く")
    expect(out.startsWith("本文")).toBe(true)
    expect(out).toContain("敬体で書く")
  })

  it("指示文が null ならプロンプトを変えない", () => {
    expect(injectToneBlock("本文", null)).toBe("本文")
  })

  it("プレースホルダがあって指示文が null なら、プレースホルダを取り除く", () => {
    expect(injectToneBlock("前\n{tone_instruction}\n後", null)).not.toContain("{tone_instruction}")
  })
})

describe("DEFAULT_TONE_PRESETS", () => {
  it("3枠で、IDは tone1/tone2/tone3", () => {
    expect(DEFAULT_TONE_PRESETS.map((t) => t.id)).toEqual(["tone1", "tone2", "tone3"])
  })

  it("すべて label と instruction が埋まっている", () => {
    for (const t of DEFAULT_TONE_PRESETS) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.instruction.length).toBeGreaterThan(0)
    }
  })
})
