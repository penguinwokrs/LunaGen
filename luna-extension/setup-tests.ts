import { vi } from "vitest"

// Mock Chrome API
global.chrome = {
  runtime: {
    openOptionsPage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    },
    sendMessage: vi.fn()
  }
} as any

// Mock Plasmo Storage Hook
// シンプルなメモリ上のストアとしてモック化
const memoryStore = new Map()

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: (key, initialValue) => {
    // 実際の実装に近い挙動を簡易的に再現
    // ここではテストごとにリセットされない簡易実装ですが、
    // 今回のテストケース（ボタンクリックで値が変わるか）には十分です
    const val = memoryStore.has(key) ? memoryStore.get(key) : initialValue
    const setVal = (newVal) => {
      memoryStore.set(key, newVal)
    }
    return [val, setVal]
  }
}))
