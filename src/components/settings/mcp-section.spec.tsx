import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import zh from "@/i18n/zh.json"
import en from "@/i18n/en.json"

const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
const mcpSectionPath = resolve(__dirname, "sections/mcp-section.tsx")

describe("MCP settings section", () => {
  it("adds MCP as an independent settings category", () => {
    expect(settingsViewSource).toContain('| "mcp"')
    expect(settingsViewSource).toContain('{ id: "mcp", labelKey: "settings.categories.mcp", icon: Network }')
    expect(settingsViewSource).toContain('case "mcp":')
    expect(settingsViewSource).toContain("return <McpSection />")
  })

  it("provides Chinese and English settings copy", () => {
    expect(zh.settings.categories.mcp).toBe("MCP 工具")
    expect(zh.settings.sections.mcp.title).toBe("MCP 工具")
    expect(zh.settings.sections.mcp.addSample).toBe("添加示例图谱 MCP")
    expect(en.settings.categories.mcp).toBe("MCP Tools")
    expect(en.settings.sections.mcp.title).toBe("MCP Tools")
  })

  it("supports sample add, JSON editing, runtime warnings, and persistence", () => {
    expect(existsSync(mcpSectionPath)).toBe(true)
    const source = readFileSync(mcpSectionPath, "utf8")

    expect(source).toContain("createSampleGraphMcpServer")
    expect(source).toContain("buildMcpRuntime")
    expect(source).toContain("saveMcpConfig")
    expect(source).toContain("setMcpConfig")
    expect(source).toContain("toolJsonDrafts")
    expect(source).toContain("JSON.stringify(server.tools")
    expect(source).toContain("textarea")
    expect(source).toContain("window.confirm")
  })
})
