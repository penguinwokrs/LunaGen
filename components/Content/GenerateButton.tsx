import React, { useEffect, useState } from "react"
import { getMyProfile, insertText, getPartnerProfile } from "../../logic/content-logic"
import { addLog } from "../../utils/logger"
import { extractProfileFromJSON } from "../../utils/profile"
import { getUserIdFromUrl } from "../../utils/url"

interface GenerateButtonProps {
    textarea: HTMLTextAreaElement
}

export const GenerateButton = ({ textarea }: GenerateButtonProps) => {
    const [loading, setLoading] = useState(false)
    const [slow, setSlow] = useState(false)
    const [error, setError] = useState(false)

    useEffect(() => {
        let timer: NodeJS.Timeout
        if (loading) {
            setSlow(false)
            setError(false)
            timer = setTimeout(() => {
                setSlow(true)
            }, 5000)
        }
        return () => clearTimeout(timer)
    }, [loading])

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setLoading(true)
        setError(false)

        await addLog("info", "AI Generate Button Clicked", null, "CONTENT")

        try {
            // 1. Get My Profile
            const myProfileText = await getMyProfile()

            // 2. Get Target Profile
            let targetProfileText = ""
            const cachedTarget = sessionStorage.getItem("luna_last_viewed_user")

            // Current User ID from URL
            const currentUserId = getUserIdFromUrl(location.href)

            if (cachedTarget) {
                const data = JSON.parse(cachedTarget)

                // Validate ID matches
                const targetData = data.user || data.profile || data
                const cachedId = targetData.id || targetData.user_id

                if (currentUserId && cachedId && String(cachedId) !== String(currentUserId)) {
                    await addLog("warn", "Cached profile ID mismatch", { cachedId, currentUserId }, "CONTENT")
                    targetProfileText = "" // invalidate
                } else {
                    targetProfileText = extractProfileFromJSON(data)
                }
            }

            // Fallback: Fetch if missing or invalid
            if ((!targetProfileText || targetProfileText.length < 10) && currentUserId) {
                await addLog("info", "Attempting fallback fetch for partner profile", { currentUserId }, "CONTENT")
                const isService = location.href.includes("/service/")
                const fetchedText = await getPartnerProfile(currentUserId, isService)
                if (fetchedText) {
                    targetProfileText = fetchedText
                }
            }

            if (!targetProfileText || targetProfileText.length < 10) {
                await addLog("error", "Target Profile not found in API cache", null, "CONTENT")
                alert("相手のプロフィール情報の取得に失敗しました。ページを一度リロードしてから再度お試しください。")
                setLoading(false)
                return
            }

            // 3. Generate Message
            const isPremium = document.body.innerText.includes("プレミアムメッセージを送る")
            await addLog("info", `Requesting generation (Premium: ${isPremium})`, null, "CONTENT")

            const response = await chrome.runtime.sendMessage({
                action: "generate_message",
                myProfile: myProfileText,
                targetProfile: targetProfileText,
                isPremium: isPremium
            })

            if (response.error) {
                await addLog("error", "AI Generation Error Response", { error: response.error }, "CONTENT")
                setError(true)
            } else if (response.text) {
                await addLog("info", "AI Generation Success", null, "CONTENT")
                insertText(textarea, response.text)
                setError(false)
            }
        } catch (err: any) {
            await addLog("error", "AI Generation Exception", { error: err.toString() }, "CONTENT")
            setError(true)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ marginTop: "8px" }}>
            <button
                onClick={handleClick}
                disabled={loading}
                style={{
                    padding: "6px 12px",
                    backgroundColor: loading ? "#ccc" : (error ? "#f44336" : "#e91e63"),
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: "all 0.3s ease"
                }}
            >
                {loading ? (slow ? "⌛ お待ち下さい..." : "🪄 AI生成中...") : (error ? "⚠️ エラー再試行" : "✨ AIでメッセージ生成")}
            </button>
            {error && !loading && (
                <p style={{ color: "#f44336", fontSize: "10px", margin: "4px 0 0 4px", fontWeight: "bold" }}>
                    通信エラーが発生した可能性があります。
                </p>
            )}
        </div>
    )
}
