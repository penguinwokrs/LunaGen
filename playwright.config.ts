import { defineConfig } from "@playwright/test"

/**
 * Playwright 設定。
 *
 * Chrome 拡張(MV3)を扱うため、各テストは fixtures.ts の
 * launchPersistentContext で拡張をロードする。通常の
 * projects/devices は使わず、コンテキスト生成は fixture 側に委ねる。
 *
 * 事前に `pnpm build`(= plasmo build)で build/chrome-mv3-prod を
 * 生成しておくこと。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // 拡張ロードは persistent context を共有するため直列実行が安全
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "https://luna-matching.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  }
})
