import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Options from "./options"

// fetch をモック（プロフィール取得は is_auth → get/me の2段）
global.fetch = vi.fn()

describe("Options Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the settings page", () => {
    render(<Options />)
    expect(screen.getByText("LunaGen 設定")).toBeTruthy()
    expect(screen.getByText("0. 自分のプロフィール")).toBeTruthy()
  })

  it("handles profile fetch success", async () => {
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/user/is_auth")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ is_atuh: true }) })
      }
      if (url.includes("/api/user/get/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            name: "テスト太郎",
            profile: "これは私のテストプロフィールです。趣味はプログラミングです。"
          })
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(<Options />)

    const updateButton = screen.getByTitle("プロフィールをLunaから取得して更新")
    fireEvent.click(updateButton)

    // 成功トースト（絵文字付きで描画されるため部分一致で検証）
    await waitFor(() => {
      expect(screen.getByText(/プロフィールを更新しました/)).toBeTruthy()
    })

    // get/me に正しいURLで問い合わせている
    expect(global.fetch).toHaveBeenCalledWith("https://luna-matching.com/api/user/get/me")
  })

  it("handles profile fetch failure", async () => {
    ;(global.fetch as any).mockRejectedValue(new Error("Network Error"))

    render(<Options />)

    fireEvent.click(screen.getByTitle("プロフィールをLunaから取得して更新"))

    await waitFor(() => {
      expect(screen.getByText(/Network Error/)).toBeTruthy()
    })
  })
})
