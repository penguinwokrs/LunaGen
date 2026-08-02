import React from "react"

import { ImeSafeField } from "../Common/ImeSafeField"

import { NO_TONE, type TonePreset } from "../../utils/tone"

interface TonePresetSectionProps {
    presets: TonePreset[]
    setPresets: (val: TonePreset[] | ((prev: TonePreset[]) => TonePreset[])) => void
    defaultToneId: string
    setDefaultToneId: (val: string) => void
    onReset: () => void
}

export const TonePresetSection = ({
    presets,
    setPresets,
    defaultToneId,
    setDefaultToneId,
    onReset
}: TonePresetSectionProps) => {

    // 常に最新の値を基準に更新する。props を基準にすると、storage の読み込みが
    // 着地する前に編集したとき、編集していない他の枠が既定値へ巻き戻る。
    const update = (id: string, patch: Partial<TonePreset>) => {
        setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    }

    return (
        <section style={{ marginBottom: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "1.2rem" }}>3. 口調プリセット</h2>
                <button
                    onClick={onReset}
                    style={{
                        padding: "4px 8px", backgroundColor: "#f8f9fa", border: "1px solid #ddd",
                        borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "#666"
                    }}
                >
                    デフォルトに戻す
                </button>
            </div>

            <div style={{ fontSize: "0.85em", color: "#666", marginBottom: "10px", lineHeight: 1.6 }}>
                メッセージ生成時に、入力欄の横のボタンから選べる口調です。指定できるのは<strong>文体だけ</strong>で、
                禁止事項・文字数・話題の選び方はプロンプトテンプレート側のルールがそのまま適用されます。<br />
                口調は<strong>相手ごとに記憶</strong>されます。初めての相手には下の「既定の口調」が使われます。<br />
                指示文が空の枠はメニューに出ません。
            </div>

            {presets.map((preset, i) => (
                <div key={preset.id} style={{ marginBottom: "12px", padding: "10px", border: "1px solid #eee", borderRadius: "4px" }}>
                    <ImeSafeField
                        value={preset.label}
                        onChange={(v) => update(preset.id, { label: v })}
                        placeholder={`口調${i + 1}の名前`}
                        style={{ width: "200px", padding: "6px", marginBottom: "6px", boxSizing: "border-box" }}
                    />
                    <ImeSafeField
                        multiline
                        value={preset.instruction}
                        onChange={(v) => update(preset.id, { instruction: v })}
                        placeholder="口調の指示文（空にするとこの枠はメニューに出ません）"
                        rows={3}
                        style={{ width: "100%", padding: "8px", boxSizing: "border-box", fontFamily: "monospace", lineHeight: 1.4 }}
                    />
                </div>
            ))}

            <div style={{ marginTop: "10px" }}>
                <label style={{ fontSize: "0.9rem", marginRight: "8px" }}>既定の口調（初めての相手に使う）:</label>
                <select
                    value={defaultToneId}
                    onChange={(e) => setDefaultToneId(e.target.value)}
                    style={{ padding: "6px" }}
                >
                    <option value={NO_TONE}>指定なし</option>
                    {presets
                        .filter((p) => p.instruction.trim().length > 0)
                        .map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label || p.id}
                            </option>
                        ))}
                </select>
            </div>
        </section>
    )
}
