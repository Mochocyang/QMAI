import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

interface CapabilityConfig {
  permissions: Array<string | { identifier: string }>
}

describe("Tauri 窗口标题权限", () => {
  it("允许前端更新最顶层窗口标题", () => {
    const config = JSON.parse(
      readFileSync(resolve(__dirname, "../src-tauri/capabilities/default.json"), "utf8")
    ) as CapabilityConfig

    expect(config.permissions).toContain("core:window:allow-set-title")
  })
})
