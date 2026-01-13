import { useState } from "react"

function IndexPopup() {
  return (
    <div
      style={{
        padding: 16,
        minWidth: 250,
        fontFamily: "sans-serif"
      }}>
      <h2 style={{ margin: "0 0 10px 0", color: "#e91e63" }}>LunaGen</h2>
      <p style={{ fontSize: "0.9rem", color: "#666" }}>
        メッセージ自動生成拡張機能です。
      </p>

      <button
        onClick={() => chrome.runtime.openOptionsPage()}
        style={{
          width: "100%",
          padding: "10px",
          backgroundColor: "#e91e63",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontWeight: "bold",
          marginTop: "10px"
        }}>
        設定画面を開く
      </button>
    </div>
  )
}

export default IndexPopup