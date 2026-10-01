import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { CLAUDE_CODE_NATIVE_HOST } from "../constants"

// install.sh はリリース zip 単体で動くよう拡張IDを固定値で持つ。
// manifest.key を変えたらここで落ちる（ホストが拡張を拒否するようになるため）。
describe("native-host/install.sh", () => {
  const script = readFileSync("native-host/install.sh", "utf8")

  it("EXT_ID が manifest.key から算出した拡張IDと一致する", () => {
    const key = JSON.parse(readFileSync("package.json", "utf8")).manifest.key
    const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("")
    expect(script).toContain(`EXT_ID="${id}"`)
  })

  it("ホスト名が拡張側の定数と一致する", () => {
    expect(script).toContain(`HOST_NAME="${CLAUDE_CODE_NATIVE_HOST}"`)
  })
})
