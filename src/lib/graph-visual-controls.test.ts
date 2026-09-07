import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("图谱可视控制", () => {
  it("提供标签、线条颜色和关系文字可读性控制", () => {
    const graphView = read("../components/graph/graph-view.tsx")
    const sidebar = read("../components/layout/graph-sidebar-panel.tsx")

    expect(sidebar).toContain('t("graph.edgeColor")')
    expect(sidebar).toContain('type="color"')
    expect(graphView).toContain("labelDisplayMode")
    expect(graphView).toContain("edgeStrengthPercent")
    expect(graphView).toContain("edgeLabelSize: 14")
    expect(graphView).toContain('edgeLabelColor: { color: "#334155" }')
  })

  it("supports node dragging and opening the real profile page in the outline editing area", () => {
    const graphView = read("../components/graph/graph-view.tsx")

    expect(graphView).toContain("downNode")
    expect(graphView).toContain("mousemovebody")
    expect(graphView).toContain("viewportToGraph")
    expect(graphView).toContain("positionCache.set(node")
    expect(graphView).toContain("handleOpenNodeProfilePage")
    expect(graphView).toContain('setActiveView("sources")')
    expect(graphView).toContain("writeFileAtomic(page.path")
  })

  it("offers curved and node-avoiding edge styles", () => {
    const graphView = read("../components/graph/graph-view.tsx")
    const sidebar = read("../components/layout/graph-sidebar-panel.tsx")

    expect(graphView).toContain("edgeStyle")
    expect(graphView).toContain("EdgeArrowProgram")
    expect(graphView).toContain("EdgeCurveProgram")
    expect(sidebar).toContain('value="curve"')
    expect(sidebar).toContain('value="arrow"')
    expect(graphView).toContain("defaultEdgeType")
  })
})
