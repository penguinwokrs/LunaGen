import type React from "react"

/**
 * 設定画面のフォーム要素の共通スタイル。
 *
 * 各セクションが個別に padding や border を書いていたため、textarea や input が
 * ブラウザ既定のまま（枠線・角丸なし）のセクションと、枠線付きのセクションが
 * 混在していた。新しい入力欄を足すときはここを使うこと。
 */
export const fieldStyle: React.CSSProperties = {
    padding: "8px",
    borderRadius: "4px",
    border: "1px solid #ccc",
    outline: "none",
    fontSize: "0.9rem",
    boxSizing: "border-box",
    backgroundColor: "#fff"
}

/** 複数行の入力欄（プロンプト等）。等幅で行間を広めに取る。 */
export const textAreaStyle: React.CSSProperties = {
    ...fieldStyle,
    width: "100%",
    fontFamily: "monospace",
    lineHeight: 1.5
}

/** セクション内の説明文 */
export const descriptionStyle: React.CSSProperties = {
    fontSize: "0.85rem",
    color: "#666",
    lineHeight: 1.6,
    margin: "0 0 12px"
}

/** 「デフォルトに戻す」等の控えめなボタン */
export const subtleButtonStyle: React.CSSProperties = {
    padding: "4px 8px",
    backgroundColor: "#fff",
    border: "1px solid #ddd",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.8rem",
    color: "#666"
}
