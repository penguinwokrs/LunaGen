import react from "@vitejs/plugin-react"
import { defaultExclude, defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./setup-tests.ts"],
    // e2e は Playwright で実行する。vitest では拾わない。
    exclude: [...defaultExclude, "e2e/**"]
  }
})
