import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "App.tsx"), "utf8")

describe("App MCP config startup loading", () => {
  it("loads saved MCP config into wiki store during startup", () => {
    expect(source).toContain("loadMcpConfig")
    expect(source).toContain("setMcpConfig(savedMcpConfig)")
  })
})
