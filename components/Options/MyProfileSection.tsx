import React from "react"

interface MyProfileSectionProps {
    myProfile: string
    myProfileUpdatedAt: string
    isLoadingProfile: boolean
    onFetchProfile: () => void
}

export const MyProfileSection = ({
    myProfile,
    myProfileUpdatedAt,
    isLoadingProfile,
    onFetchProfile
}: MyProfileSectionProps) => {
    return (
        <section style={{
            marginBottom: "30px",
            padding: "15px",
            backgroundColor: "#fff0f5",
            borderRadius: "8px",
            border: "1px solid #ffcce0"
        }}>
            <h2 style={{ fontSize: "1.2rem", marginTop: 0, display: "flex", alignItems: "center" }}>
                0. 自分のプロフィール
            </h2>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                    <p style={{ margin: "0 0 5px 0", fontSize: "0.9rem", color: "#666" }}>
                        AIに学習させる自分のプロフィール情報を保存します。<br />
                        Lunaにログインした状態で取得ボタンを押してください。
                    </p>
                    {myProfileUpdatedAt ? (
                        <>
                            <div style={{ display: "flex", alignItems: "center", color: "green", fontWeight: "bold", marginTop: "8px" }}>
                                <span style={{ fontSize: "1.2rem", marginRight: "5px" }}>✅</span>
                                <span>保存済み ({myProfileUpdatedAt})</span>
                            </div>
                            <details style={{ marginTop: "10px", backgroundColor: "white", padding: "8px", borderRadius: "4px", border: "1px solid #ffcce0" }}>
                                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#e91e63", fontWeight: "bold" }}>
                                    保存内容を確認
                                </summary>
                                <pre style={{
                                    whiteSpace: "pre-wrap",
                                    fontSize: "0.8rem",
                                    marginTop: "8px",
                                    padding: "8px",
                                    backgroundColor: "#f9f9f9",
                                    borderRadius: "4px",
                                    maxHeight: "200px",
                                    overflowY: "auto",
                                    margin: 0
                                }}>
                                    {myProfile}
                                </pre>
                            </details>
                        </>
                    ) : (
                        <div style={{ color: "#888", marginTop: "8px", fontStyle: "italic" }}>
                            未保存
                        </div>
                    )}
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <button
                        onClick={onFetchProfile}
                        disabled={isLoadingProfile}
                        title="プロフィールをLunaから取得して更新"
                        style={{
                            backgroundColor: "white",
                            border: "1px solid #e91e63",
                            borderRadius: "50%",
                            width: "48px",
                            height: "48px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: isLoadingProfile ? "not-allowed" : "pointer",
                            boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                            transition: "all 0.2s"
                        }}
                    >
                        {isLoadingProfile ? (
                            <div style={{
                                border: "3px solid #f3f3f3",
                                borderTop: "3px solid #e91e63",
                                borderRadius: "50%",
                                width: "20px",
                                height: "20px",
                                animation: "spin 1s linear infinite"
                            }} />
                        ) : (
                            <span style={{ fontSize: "1.5rem" }}>🔄</span>
                        )}
                    </button>
                </div>
            </div>
        </section>
    )
}
