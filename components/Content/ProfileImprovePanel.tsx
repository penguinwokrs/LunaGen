import React, { useEffect, useRef, useState } from "react"

import { getMyProfileRaw, insertText } from "../../logic/content-logic"
import { PROFILE_FIELD_LABELS, PROFILE_TASTES } from "../../profile-prompts"
import { addLog } from "../../utils/logger"
import type { ProfileFieldType, TasteId } from "../../utils/profile-field"

type CardState =
    | { status: "loading" }
    | { status: "done"; text: string; warning?: string }
    | { status: "error"; message: string }

interface ProfileImprovePanelProps {
    textarea: HTMLTextAreaElement
    fieldType: ProfileFieldType
    onClose: (didAdopt: boolean) => void
}

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog { background: #faf9fc; border-radius: 12px; width: min(1080px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #e5e0ee; }
.title { font-size: 15px; font-weight: 700; color: #333; }
.close { border: none; background: none; font-size: 18px; cursor: pointer; color: #888; padding: 4px 8px; }
.cards { display: flex; gap: 12px; padding: 14px 18px; overflow: auto; flex-wrap: wrap; }
.card { flex: 1 1 280px; min-width: 260px; background: white; border: 1px solid #e5e0ee; border-radius: 10px; display: flex; flex-direction: column; max-height: 62vh; }
.cardHead { padding: 10px 12px 6px; border-bottom: 1px solid #f0edf6; }
.tasteName { font-size: 14px; font-weight: 700; color: #e91e63; }
.tagline { font-size: 11px; color: #888; margin-top: 2px; }
.body { padding: 10px 12px; font-size: 12.5px; line-height: 1.7; color: #333; white-space: pre-wrap; overflow-y: auto; flex: 1; min-height: 120px; }
.foot { padding: 8px 12px 12px; border-top: 1px solid #f0edf6; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.count { font-size: 11px; color: #666; margin-right: auto; }
.count.over { color: #f44336; font-weight: 700; }
.warn { font-size: 11px; color: #ef6c00; padding: 0 12px 8px; }
.err { font-size: 12px; color: #f44336; padding: 12px; }
.btn { border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; padding: 7px 12px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.adopt { background: #e91e63; color: white; }
.regen { background: #f0f0f0; color: #444; }
.cancel { align-self: center; margin: 0 0 14px; background: none; border: none; color: #777; font-size: 12px; cursor: pointer; text-decoration: underline; }
.spinner { padding: 24px 12px; text-align: center; color: #888; font-size: 12px; }
`

export const ProfileImprovePanel = ({ textarea, fieldType, onClose }: ProfileImprovePanelProps) => {
    const [cards, setCards] = useState<Record<TasteId, CardState>>({
        solid: { status: "loading" },
        story: { status: "loading" },
        light: { status: "loading" }
    })
    // モーダルを開いた瞬間の入力値を素材として固定する
    const currentTextRef = useRef(textarea.value)

    const generate = async (tasteId: TasteId) => {
        setCards((prev) => ({ ...prev, [tasteId]: { status: "loading" } }))
        try {
            const myProfileRaw = await getMyProfileRaw()
            if (!myProfileRaw) {
                setCards((prev) => ({
                    ...prev,
                    [tasteId]: {
                        status: "error",
                        message:
                            "プロフィールデータを取得できません。Lunaにログインした状態でページを再読み込みしてください。"
                    }
                }))
                return
            }
            const response = await chrome.runtime.sendMessage({
                action: "generate_profile",
                fieldType,
                taste: tasteId,
                currentText: currentTextRef.current,
                myProfileRaw
            })
            if (response?.text) {
                setCards((prev) => ({
                    ...prev,
                    [tasteId]: { status: "done", text: response.text, warning: response.warning }
                }))
            } else {
                const msg = response?.error || "生成に失敗しました"
                const hint = /API Key/i.test(msg)
                    ? "（拡張機能のオプション画面でAPIキーを設定してください）"
                    : ""
                setCards((prev) => ({ ...prev, [tasteId]: { status: "error", message: msg + hint } }))
            }
        } catch (e: any) {
            setCards((prev) => ({
                ...prev,
                [tasteId]: { status: "error", message: e?.message || String(e) }
            }))
        }
    }

    useEffect(() => {
        PROFILE_TASTES.forEach((t) => {
            generate(t.id)
        })
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose(false)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const adopt = async (tasteId: TasteId) => {
        const card = cards[tasteId]
        if (card.status !== "done") return
        insertText(textarea, card.text)
        await addLog("info", "Profile suggestion adopted", { fieldType, taste: tasteId }, "CONTENT")
        onClose(true)
    }

    return (
        <>
            <style>{PANEL_CSS}</style>
            <div
                className="backdrop"
                onMouseDown={(e) => {
                    if (e.target === e.currentTarget) onClose(false)
                }}>
                <div className="dialog" role="dialog" aria-modal="true">
                    <div className="header">
                        <span className="title">✨ {PROFILE_FIELD_LABELS[fieldType]}の改善案（3テイスト）</span>
                        <button className="close" onClick={() => onClose(false)} title="閉じる">
                            ✕
                        </button>
                    </div>
                    <div className="cards">
                        {PROFILE_TASTES.map((t) => {
                            const card = cards[t.id]
                            return (
                                <div className="card" key={t.id}>
                                    <div className="cardHead">
                                        <div className="tasteName">{t.label}</div>
                                        <div className="tagline">{t.tagline}</div>
                                    </div>
                                    {card.status === "loading" && <div className="spinner">🪄 生成中...</div>}
                                    {card.status === "error" && <div className="err">⚠️ {card.message}</div>}
                                    {card.status === "done" && <div className="body">{card.text}</div>}
                                    {card.status === "done" && card.warning && (
                                        <div className="warn">⚠ {card.warning}</div>
                                    )}
                                    <div className="foot">
                                        {card.status === "done" && (
                                            <span className={`count${card.text.length > 400 ? " over" : ""}`}>
                                                {card.text.length}/400
                                            </span>
                                        )}
                                        <button
                                            className="btn regen"
                                            disabled={card.status === "loading"}
                                            onClick={() => generate(t.id)}>
                                            ♻ 再生成
                                        </button>
                                        <button
                                            className="btn adopt"
                                            disabled={card.status !== "done"}
                                            onClick={() => adopt(t.id)}>
                                            この案を使う
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <button className="cancel" onClick={() => onClose(false)}>
                        キャンセル（元の文のまま）
                    </button>
                </div>
            </div>
        </>
    )
}
