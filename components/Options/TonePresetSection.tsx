import React from "react"

import { ImeSafeField } from "../Common/ImeSafeField"
import { Section } from "../Common/Section"
import { descriptionStyle, fieldStyle, subtleButtonStyle, textAreaStyle } from "../Common/formStyles"

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
        <Section title="">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ fontSize: "1.2rem", margin: 0 }}>3. 口調プリセット</h2>
                <button onClick={onReset} style={subtleButtonStyle}>
                    デフォルトに戻す
                </button>
            </div>

            <p style={descriptionStyle}>
                メッセージ生成時に、入力欄の横のボタンから選べる口調です。指定できるのは<strong>文体だけ</strong>で、
                禁止事項・文字数・話題の選び方はプロンプトテンプレート側のルールがそのまま適用されます。<br />
                口調は<strong>相手ごとに記憶</strong>されます。初めての相手には下の「既定の口調」が使われます。<br />
                指示文が空の枠はメニューに出ません。
            </p>

            {presets.map((preset, i) => (
                <div
                    key={preset.id}
                    style={{
                        marginBottom: "10px",
                        padding: "12px",
                        border: "1px solid #e0e0e0",
                        borderRadius: "6px",
                        backgroundColor: "#fff"
                    }}
                >
                    <div style={{ fontSize: "0.8rem", color: "#999", fontWeight: "bold", marginBottom: "6px" }}>
                        口調{i + 1}
                    </div>
                    <ImeSafeField
                        value={preset.label}
                        onChange={(v) => update(preset.id, { label: v })}
                        placeholder="名前（ボタンのメニューに出ます）"
                        style={{ ...fieldStyle, width: "240px", marginBottom: "8px" }}
                    />
                    <ImeSafeField
                        multiline
                        value={preset.instruction}
                        onChange={(v) => update(preset.id, { instruction: v })}
                        placeholder="口調の指示文（空にするとこの枠はメニューに出ません）"
                        rows={3}
                        style={textAreaStyle}
                    />
                </div>
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
                <label style={{ fontSize: "0.9rem", color: "#666" }}>
                    既定の口調（初めての相手に使う）
                </label>
                <select
                    value={defaultToneId}
                    onChange={(e) => setDefaultToneId(e.target.value)}
                    style={{ ...fieldStyle, minWidth: "160px" }}
                >
                    <option value={NO_TONE}>指定なし</option>
                    {presets
                        .filter((p) => p.instruction.trim().length > 0)
                        .map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label.trim() || "（名前なし）"}
                            </option>
                        ))}
                </select>
            </div>
        </Section>
    )
}
