import React, { useEffect, useRef, useState } from "react"
import { Storage } from "@plasmohq/storage"

import { DEFAULT_TONE_PRESETS } from "../../constants"
import {
    NO_TONE,
    lookupPartnerTone,
    rememberPartnerTone,
    resolvePartnerToneKey,
    selectableTones,
    type PartnerTones,
    type TonePreset
} from "../../utils/tone"

const storage = new Storage({ area: "local" })

interface ToneSelectorProps {
    disabled: boolean
    /** 選択中の口調IDを親に伝える（生成時に送るため） */
    onChange: (toneId: string) => void
}

export const ToneSelector = ({ disabled, onChange }: ToneSelectorProps) => {
    const [presets, setPresets] = useState<TonePreset[]>(DEFAULT_TONE_PRESETS as TonePreset[])
    const [toneId, setToneId] = useState<string>(NO_TONE)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

    /** 現在の相手キーと保存済みの口調を読み直す */
    const refresh = async () => {
        const loadedPresets =
            (await storage.get<TonePreset[]>("tonePresets")) || (DEFAULT_TONE_PRESETS as TonePreset[])
        const defaultToneId = (await storage.get<string>("defaultToneId")) || NO_TONE
        const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
        const key = resolvePartnerToneKey(location.href, sessionStorage.getItem("luna_last_viewed_user"))
        const resolved = lookupPartnerTone(tones, key, defaultToneId)
        setPresets(loadedPresets)
        setToneId(resolved)
        onChange(resolved)
    }

    useEffect(() => {
        refresh()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 外側クリックと Esc で閉じる
    useEffect(() => {
        if (!open) return
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("mousedown", onDocClick)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDocClick)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    const select = async (id: string) => {
        setToneId(id)
        onChange(id)
        setOpen(false)
        // キーが取れない画面では保存しない（その入力欄が生きている間だけ有効）
        const key = resolvePartnerToneKey(location.href, sessionStorage.getItem("luna_last_viewed_user"))
        if (!key) return
        const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
        await storage.set("partnerTones", rememberPartnerTone(tones, key, id, new Date().toISOString()))
    }

    const options = selectableTones(presets)
    const currentLabel =
        toneId === NO_TONE ? "指定なし" : options.find((t) => t.id === toneId)?.label || "指定なし"

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <button
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (disabled) return
                    // 開く直前に読み直す。SPA遷移で相手が変わっている場合があるため
                    refresh()
                    setOpen((v) => !v)
                }}
                disabled={disabled}
                title="この相手に使う口調を選ぶ（相手ごとに記憶されます）"
                style={{
                    padding: "6px 12px", backgroundColor: "#607d8b", color: "white", border: "none",
                    borderRadius: "4px", fontSize: "12px", cursor: disabled ? "not-allowed" : "pointer",
                    fontWeight: "bold", whiteSpace: "nowrap", boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }}
            >
                口調: {currentLabel} ▾
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute", top: "100%", left: 0, marginTop: "4px", zIndex: 2147483647,
                        background: "white", border: "1px solid #ccc", borderRadius: "4px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: "160px", overflow: "hidden"
                    }}
                >
                    {[{ id: NO_TONE, label: "指定なし", instruction: "x" } as TonePreset, ...options].map((t) => (
                        <button
                            key={t.id}
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                select(t.id)
                            }}
                            style={{
                                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                                border: "none", background: t.id === toneId ? "#eceff1" : "white",
                                cursor: "pointer", fontSize: "12px", color: "#333"
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
