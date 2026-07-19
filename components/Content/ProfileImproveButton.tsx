import React, { useState } from "react"
import { createRoot } from "react-dom/client"

import { addLog } from "../../utils/logger"
import type { ProfileFieldType } from "../../utils/profile-field"
import { ProfileImprovePanel } from "./ProfileImprovePanel"

interface ProfileImproveButtonProps {
    textarea: HTMLTextAreaElement
    fieldType: ProfileFieldType
}

export const ProfileImproveButton = ({ textarea, fieldType }: ProfileImproveButtonProps) => {
    const [open, setOpen] = useState(false)
    const [adopted, setAdopted] = useState(false)

    // 注意: パネルはこのボタンのReactツリーの外（body直下の独立したシャドウDOM
    // ルート）に描画し、このコンポーネントのライフサイクルに連動させない。
    // Lunaの編集オーバーレイは自身のDOMを（このボタン注入先の親要素ごと）
    // クリックのたびに再レンダーすることがあり、その際このボタンは
    // unmount→再注入されるが、それに追従してパネルまで閉じると「パネル内の
    // どこをクリックしても消える」ように見えてしまう。パネル自身の生死は
    // ユーザー操作（キャンセル/背景クリック/採用）と、ProfileImprovePanel内の
    // ページ離脱監視だけで決める。
    const openPanel = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (open) return
        setOpen(true)
        setAdopted(false)
        await addLog("info", "Profile improve panel opened", { fieldType }, "CONTENT")

        // サイトCSSから隔離するためシャドウDOMのホストをbody直下に作る
        const host = document.createElement("div")
        host.id = "lunagen-profile-panel-host"
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: "open" })
        const mount = document.createElement("div")
        shadow.appendChild(mount)
        const root = createRoot(mount)

        // パネル内の操作をサイトに伝えない。
        // Lunaの編集オーバーレイは、開いたときに document へ pointerdown(bubble)の
        // 「外側クリックで閉じる」リスナーを登録する。シャドウDOM内のクリックは
        // リターゲティングによりサイトからは host（body直下＝オーバーレイの外）への
        // クリックに見えるため、何もしないとパネルを触るたびに編集画面が閉じてしまう。
        // 伝播経路は target → mount(Reactのハンドラ) → shadowRoot → host → body →
        // document なので、host で止めればサイトには届かず自分のUIは正常に動く。
        const swallow = (e: Event) => e.stopPropagation()
        const SWALLOWED_EVENTS = [
            "pointerdown", "pointerup", "mousedown", "mouseup", "click",
            "touchstart", "touchend", "focusin", "focusout"
        ]
        SWALLOWED_EVENTS.forEach((type) => host.addEventListener(type, swallow))

        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"

        let closed = false
        const close = (didAdopt: boolean) => {
            if (closed) return // 二重close防止
            closed = true
            document.body.style.overflow = prevOverflow
            // Reactのレンダー中unmountを避けるため次tickで破棄
            setTimeout(() => {
                root.unmount()
                host.remove()
            }, 0)
            setOpen(false)
            if (didAdopt) {
                setAdopted(true)
                setTimeout(() => setAdopted(false), 8000)
            }
        }

        root.render(<ProfileImprovePanel textarea={textarea} fieldType={fieldType} onClose={close} />)
    }

    return (
        <div style={{ marginTop: "8px" }}>
            <button
                onClick={openPanel}
                disabled={open}
                title="保存済みの内容をもとに、テイスト違いの改善案を3つ生成します"
                style={{
                    padding: "6px 12px",
                    backgroundColor: open ? "#ccc" : "#e91e63",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: open ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: "all 0.3s ease"
                }}>
                ✨ AIで改善
            </button>
            {adopted && (
                <p style={{ color: "#e91e63", fontSize: "11px", margin: "4px 0 0 2px", fontWeight: "bold" }}>
                    ⚠ サイトの「保存する」を押すと反映されます
                </p>
            )}
        </div>
    )
}
