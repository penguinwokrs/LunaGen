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

        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"

        const close = (didAdopt: boolean) => {
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
