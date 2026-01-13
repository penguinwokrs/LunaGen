import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import Options from "./options"

// Fetchのモック
global.fetch = vi.fn()

describe("Options Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ストレージのモック（メモリ）をリセットする必要があるが、
    // 今回の簡易モックではsetup-tests側でMapを使っているので
    // 厳密にはリセットされていない。
    // コンポーネントが再レンダリングされるときに初期値が使われる挙動を
    // 正しくテストするには、モックの実装をもう少し洗練させる必要がありますが、
    // まずは基本的な動作確認を行います。
  })

  it("renders the settings page", () => {
    render(<Options />)
    expect(screen.getByText("Luna Extension 設定")).toBeTruthy()
    expect(screen.getByText("0. 自分のプロフィール")).toBeTruthy()
  })

  it("handles profile fetch success", async () => {
    // Fetchの成功レスポンスをモック
    const mockProfileText = "これは私のテストプロフィールです。\n趣味はプログラミングです。"
    const mockHtml = `<html><body>${mockProfileText}</body></html>`
    
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
      status: 200
    })

    render(<Options />)

    // 更新ボタンを探してクリック
    // ボタンは "🔄" または title="プロフィールをLunaから取得して更新"
    const updateButton = screen.getByTitle("プロフィールをLunaから取得して更新")
    expect(updateButton).toBeTruthy()
    
    fireEvent.click(updateButton)

    // ローディング状態（スピン）になるか（実装上、一瞬で終わる可能性もあるが）
    // waitForで完了後の状態を待つ
    
    await waitFor(() => {
      // 成功トーストが表示されるか
      expect(screen.getByText("プロフィールを更新しました！")).toBeTruthy()
    })

    // Fetchが正しいURLで呼ばれたか
    expect(global.fetch).toHaveBeenCalledWith("https://luna-matching.com/profile")
  })

  it("handles profile fetch failure", async () => {
    // Fetchの失敗レスポンスをモック
    ;(global.fetch as any).mockRejectedValue(new Error("Network Error"))

    render(<Options />)

    const updateButton = screen.getByTitle("プロフィールをLunaから取得して更新")
    fireEvent.click(updateButton)

    await waitFor(() => {
      expect(screen.getByText("Network Error")).toBeTruthy()
    })
  })
})
