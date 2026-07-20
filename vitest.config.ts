import react from "@vitejs/plugin-react"
import { defaultExclude, defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./setup-tests.ts"],
    // e2e は Playwright で実行する。vitest では拾わない。
    // .claude/worktrees は作業用ワークツリーの複製なので対象外
    // （中の e2e/** を拾うと Playwright スペックが vitest で失敗する）
    exclude: [...defaultExclude, "e2e/**", ".claude/worktrees/**"]
  }
})
