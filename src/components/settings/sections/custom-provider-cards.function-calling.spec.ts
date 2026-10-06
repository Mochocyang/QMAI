import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// 新版自定义提供方卡片在 uitest/models/provider-custom.tsx 中渲染
// FunctionCallingControls 开关，旧版的 custom-provider-cards.tsx 已是薄封装。
const source = readFileSync(
  resolve(__dirname, "../../uitest/models/provider-custom.tsx"),
  "utf8",
)

describe("custom provider Function Calling toggle", () => {
  it("wires FunctionCallingControls into custom provider cards", () => {
    expect(source).toContain("FunctionCallingControls")
    expect(source).toContain("functionCallingEnabled: true")
    expect(source).toContain("onChange={functionCallingEnabled => void saveSwitch({ functionCallingEnabled })}")
  })
})
