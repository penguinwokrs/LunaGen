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
                    targetProfileText = extractProfileFromJSON(targetData, data)
                }
            }

            let targetName = ""
            if (cachedTarget) {
                 const data = JSON.parse(cachedTarget)
                 const targetData = data.user || data.profile || data
                 targetName = targetData.name || targetData.nickname || ""
            }

            // Fallback: Fetch if missing or invalid
            if ((!targetProfileText || targetProfileText.length < 10) && currentUserId) {
                await addLog("info", "Attempting fallback fetch for partner profile", { currentUserId }, "CONTENT")
                const isService = location.href.includes("/service/")
                const fetchedText = await getPartnerProfile(currentUserId, isService)
                if (fetchedText) {
                    targetProfileText = fetchedText
                    // Try to extract name from text if we don't have the object easily available from getPartnerProfile (which returns text)
                    // But getPartnerProfile seems to just return text.
                    // We might need to improve getPartnerProfile or just parse the text.
                    // For now, let's rely on the text parsing
                    const nameMatch = fetchedText.match(/名前: (.+)/)
                    if (nameMatch) {
                        targetName = nameMatch[1].trim()
                    }
                }
            }

            if (!targetProfileText || targetProfileText.length < 10) {
                await addLog("error", "Target Profile not found in API cache", null, "CONTENT")
                alert("相手のプロフィール情報の取得に失敗しました。ページを一度リロードしてから再度お試しください。")
                setLoading(false)
                return
            }

            // 2.5 Get Chat History
            let chatHistory = ""
            const cachedHistory = sessionStorage.getItem("luna_chat_history")
            const isMessagePage = location.href.includes("/message/") || location.href.includes("/matching/")

            if (cachedHistory && isMessagePage) {
                try {
                    const historyData = JSON.parse(cachedHistory)
                    const messages = historyData.messages || []
                    const partnerId = historyData.partnerId

                    // Use last 15 messages
                    const recentMessages = messages.slice(-15)
                    chatHistory = recentMessages
                        // biome-ignore lint/suspicious/noExplicitAny: Message type
                        .map((m: any) => {
                            const isPartner = String(m.user_id) === String(partnerId)
                            return `${isPartner ? "Partner" : "Me"}: ${m.message}`
                        })
                        .join("\n")
                } catch (e) {
                    console.error("Failed to parse chat history", e)
                }
            }

            // 3. Generate Message
            const isPremium = document.body.innerText.includes("プレミアムメッセージを送る")
            await addLog("info", `Requesting generation (Premium: ${isPremium})`, { hasHistory: !!chatHistory }, "CONTENT")

            const response = await chrome.runtime.sendMessage({
                action: "generate_message",
                myProfile: myProfileText,
                targetProfile: targetProfileText,
                targetName: targetName,
                chatHistory: chatHistory,
                isPremium: isPremium
            })

            if (response && response.error) {
                await addLog("error", `AI Generation Error: ${response.error}`, { error: response.error }, "CONTENT")
                setError(true)
            } else if (response && response.text) {
                await addLog("info", "AI Generation Success", null, "CONTENT")
                insertText(textarea, response.text)
                setError(false)
            } else {
                await addLog("error", "AI Generation Invalid Response", { response }, "CONTENT")
                setError(true)
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
