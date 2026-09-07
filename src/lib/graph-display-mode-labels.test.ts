import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("图谱视图模式标签", () => {
  it("使用 i18n 键而非硬编码中文标签", () => {
    const graphSidebarPanel = read("../components/layout/graph-sidebar-panel.tsx")

    expect(graphSidebarPanel).toContain('t("novel.graph.displayModeGraph")')
    expect(graphSidebarPanel).toContain('t("novel.graph.displayModeDocument")')
    expect(graphSidebarPanel).toContain('t("novel.graph.displayModeMindmap")')
    expect(graphSidebarPanel).not.toContain('t("graph.displayModes.graph")')
    expect(graphSidebarPanel).not.toContain('t("graph.displayModes.document")')
    expect(graphSidebarPanel).not.toContain('t("graph.displayModes.mindmap")')
  })
})
