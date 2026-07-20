import React, { useEffect, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { getMyProfile, insertText, getPartnerProfile, resolvePartnerUserId } from "../../logic/content-logic"
import { addLog } from "../../utils/logger"
import { extractProfileFromJSON } from "../../utils/profile"
import { extractLookups, generateDemandSupplyHint } from "../../utils/demand-supply"
import { formatChatHistory, resolveCachedHistory, resolveCachedPartner } from "../../utils/partner"
import { getThreadIdFromUrl, getUserIdFromUrl } from "../../utils/url"

const storage = new Storage({ area: "local" })

interface GenerateButtonProps {
    textarea: HTMLTextAreaElement
}

export const GenerateButton = ({ textarea }: GenerateButtonProps) => {
    const [loading, setLoading] = useState(false)
    const [slow, setSlow] = useState(false)
    // エラーは「有無」ではなく実際のメッセージを保持する。
    // 固定文言だと安全フィルタのブロックなのかキー不備なのか切り分けられない。
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let timer: NodeJS.Timeout
        if (loading) {
            setSlow(false)
            setError(null)
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
        setError(null)

        // メッセージ入力欄に書かれた内容を「優先して掘り下げたい話題」として拾う。
        // 生成結果で上書きされる前に読み取っておく。
        const focusTopic = textarea.value.trim()

        await addLog("info", "AI Generate Button Clicked", { hasFocusTopic: !!focusTopic }, "CONTENT")

        try {
            // 1. Get My Profile
            const myProfileText = await getMyProfile()

            // 2. Get Target Profile
            const urlUserId = getUserIdFromUrl(location.href)
            const threadId = getThreadIdFromUrl(location.href)
            const isService = location.href.includes("/service/")

            const cached = resolveCachedPartner(
                sessionStorage.getItem("luna_last_viewed_user"),
                location.href
            )

            let targetData: any = cached?.data ?? null
            let targetRaw: any = cached?.raw ?? null
            let targetProfileText = targetData ? extractProfileFromJSON(targetData, targetRaw) : ""

            // キャッシュが無い/薄い場合はプロフィール本体を取り直す。
            // メッセージページで拾える user_info は id/name/自己紹介 程度しか無いため、
            // 自己紹介が未記入の相手では必ずここに落ちてくる。
            if (!targetProfileText || targetProfileText.length < 10) {
                const partnerUserId =
                    urlUserId ??
                    cached?.userId ??
                    (threadId ? await resolvePartnerUserId(threadId) : null)

                if (partnerUserId) {
                    await addLog("info", "Attempting fallback fetch for partner profile", { partnerUserId, threadId }, "CONTENT")
                    const fetched = await getPartnerProfile(partnerUserId, isService, threadId)
                    if (fetched?.text) {
                        targetProfileText = fetched.text
                        targetData = fetched.data
                        targetRaw = fetched.raw
                    }
                } else {
                    await addLog("warn", "Could not determine partner user id", { url: location.href }, "CONTENT")
                }
            }

            if (!targetProfileText || targetProfileText.length < 10) {
                await addLog("error", "Target Profile not found", { threadId, urlUserId }, "CONTENT")
                alert("相手のプロフィール情報の取得に失敗しました。ページを一度リロードしてから再度お試しください。")
                setLoading(false)
                return
            }

            const targetName = targetData?.name || targetData?.nickname || ""

            // 自分と相手のraw dataから双方向の需給マッチを生成
            let demandSupplyHint = ""
            const myRawJson = await storage.get("myProfileRaw")
            if (myRawJson && targetData) {
                try {
                    const myRawData = JSON.parse(myRawJson as string)
                    demandSupplyHint = generateDemandSupplyHint(myRawData, targetData, extractLookups(targetRaw))
                } catch (e) {
                    await addLog("warn", "Failed to parse myProfileRaw for demand-supply", null, "CONTENT")
                }
            }

            // 2.5 Get Chat History
            let chatHistory = ""
            const cachedHistory = sessionStorage.getItem("luna_chat_history")
            const isMessagePage = location.href.includes("/message/") || location.href.includes("/matching/")

            if (cachedHistory && isMessagePage) {
                // 履歴もプロフィールと同様に相手が一致するか検証する。
                // 検証しないとSPA遷移で別人の会話履歴を元に生成しかねない。
                const partnerId = targetData?.id ?? targetData?.user_id
                const history = resolveCachedHistory(
                    cachedHistory,
                    location.href,
                    partnerId === undefined || partnerId === null ? null : String(partnerId)
                )

                if (history) {
                    chatHistory = formatChatHistory(history.messages, history.partnerId)
                } else {
                    await addLog("warn", "Chat history cache did not match current partner; ignored", { partnerId, threadId }, "CONTENT")
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
                isPremium: isPremium,
                demandSupplyHint: demandSupplyHint,
                focusTopic: focusTopic
            })

            if (response && response.error) {
                await addLog("error", `AI Generation Error: ${response.error}`, { error: response.error }, "CONTENT")
                setError(response.error)
            } else if (response && response.text) {
                await addLog("info", "AI Generation Success", null, "CONTENT")
                insertText(textarea, response.text)
                setError(null)
            } else {
                await addLog("error", "AI Generation Invalid Response", { response }, "CONTENT")
                setError("AIから応答がありませんでした。設定画面のログをご確認ください。")
            }
        } catch (err: any) {
            // 拡張の更新直後などは sendMessage 自体が失敗する
            const msg = /context invalidated/i.test(err?.message || "")
                ? "拡張機能が更新されました。ページを再読み込みしてからお試しください。"
                : (err?.message || String(err))
            await addLog("error", "AI Generation Exception", { error: err?.toString() }, "CONTENT")
            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (loading) return
        // 各種イベントを発火させてサイト側の状態も空にする
        insertText(textarea, "")
        setError(null)
    }

    return (
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                    onClick={handleClick}
                    disabled={loading}
                    title="入力欄の内容を優先話題として掘り下げてメッセージを生成"
                    style={{
                        padding: "6px 12px",
                        backgroundColor: loading ? "#ccc" : (error ? "#f44336" : "#e91e63"),
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                        transition: "all 0.3s ease"
                    }}
                >
                    {loading ? (slow ? "⌛ お待ち下さい..." : "🪄 生成中...") : (error ? "⚠️ 再試行" : "AI")}
                </button>
                <button
                    onClick={handleClear}
                    disabled={loading}
                    title="入力欄をクリア"
                    style={{
                        padding: "6px 12px",
                        backgroundColor: "#9e9e9e",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                        transition: "all 0.3s ease"
                    }}
                >
                    クリア
                </button>
            </div>
            {error && !loading && (
                <p
                    style={{
                        color: "#f44336",
                        fontSize: "11px",
                        margin: "4px 0 0 4px",
                        fontWeight: "bold",
                        maxWidth: "420px",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap"
                    }}>
                    ⚠️ {error}
                </p>
            )}
        </div>
    )
}
