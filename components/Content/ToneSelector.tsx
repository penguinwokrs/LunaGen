import React, { useEffect, useRef, useState } from "react"

import { NO_TONE, selectableTones, type TonePreset } from "../../utils/tone"
import { readActiveToneId, readTonePresets, writeActiveToneId } from "./tone-storage"

interface ToneSelectorProps {
    disabled: boolean
}

/**
 * 生成ボタンの横に置く口調セレクタ。
 *
 * 口調を切り替えるだけで、生成は従来どおり AI ボタンが行う。
 * 選択は相手ごとに記憶し、キーが取れない画面では保存しない。
 *
 * このコンポーネントは表示と保存だけを担当する。**生成に使う口調は
 * GenerateButton がクリック時に storage から読み直す**（ここの state を
 * 生成に使うと、SPA遷移で同じ textarea が使い回されたときに前の相手の
 * 口調で生成してしまうため）。
 *
 * Luna のページへ直接注入されるため、サイト側のCSS・イベントと干渉しないよう
 * インラインスタイルと stopPropagation で閉じている。
 */
export const ToneSelector = ({ disabled }: ToneSelectorProps) => {
    const [presets, setPresets] = useState<TonePreset[]>([])
    const [toneId, setToneId] = useState<string>(NO_TONE)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    /** アンマウント後の setState と、古い refresh の後着を防ぐ */
    const mountedRef = useRef(true)
    const generationRef = useRef(0)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    /** 現在の相手キーと保存済みの口調を読み直す */
    const refresh = async () => {
        const generation = ++generationRef.current
        const [loadedPresets, resolved] = await Promise.all([readTonePresets(), readActiveToneId()])
        // 後から始まった refresh が既に着地していたら、古い結果で上書きしない
        if (!mountedRef.current || generation !== generationRef.current) return
        setPresets(loadedPresets)
        setToneId(resolved)
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
        // 選択を最新の世代として確定させる。これをしないと、開くときに走らせた
        // refresh が後から着地して選択を巻き戻す。
        generationRef.current++
        setToneId(id)
        setOpen(false)
        await writeActiveToneId(id)
    }

    const options = selectableTones(presets)
    const currentLabel =
        toneId === NO_TONE
            ? "指定なし"
            : options.find((t) => t.id === toneId)?.label?.trim() || "（名前なし）"

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <button
                onClick={async (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (disabled) return
                    if (open) {
                        setOpen(false)
                        return
                    }
                    // 開く前に読み直す。SPA遷移で相手が変わっている場合があるため、
                    // また読み込み前のメニューを操作させないため await する。
                    await refresh()
                    if (mountedRef.current) setOpen(true)
                }}
                disabled={disabled}
                title="この相手に使う口調を選ぶ（相手ごとに記憶されます）"
                style={{
                    padding: "6px 12px",
                    backgroundColor: "#607d8b",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }}
            >
                口調: {currentLabel} ▾
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: "4px",
                        zIndex: 2147483647,
                        background: "white",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        minWidth: "160px",
                        overflow: "hidden"
                    }}
                >
                    {[{ id: NO_TONE, label: "指定なし" }, ...options].map((t) => (
                        <button
                            key={t.id}
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                select(t.id)
                            }}
                            style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 12px",
                                border: "none",
                                background: t.id === toneId ? "#eceff1" : "white",
                                cursor: "pointer",
                                fontSize: "12px",
                                color: "#333"
                            }}
                        >
                            {t.label.trim() || "（名前なし）"}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
