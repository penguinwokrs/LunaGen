function IndexPopup() {
  // 設定画面を開く。chrome.runtime.openOptionsPage() は一部ブラウザ
  // (Edge Canary の Android 拡張対応など)で無反応なため、tabs.create →
  // window.open の順にフォールバックして確実にタブを開く。
  const openSettings = () => {
    const url = chrome.runtime.getURL("options.html")
    try {
      if (chrome.tabs?.create) {
        chrome.tabs.create({ url })
        return
      }
    } catch {}
    try {
      if (chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage()
        return
      }
    } catch {}
    window.open(url, "_blank")
  }

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
        onClick={openSettings}
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