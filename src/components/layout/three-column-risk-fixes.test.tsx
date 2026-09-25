import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const storeSource = readFileSync(resolve(__dirname, "../../stores/wiki-store.ts"), "utf8")
const graphViewSource = readFileSync(resolve(__dirname, "../graph/graph-view.tsx"), "utf8")
const graphSidebarSource = readFileSync(resolve(__dirname, "graph-sidebar-panel.tsx"), "utf8")
const reviewCenterSource = readFileSync(resolve(__dirname, "../review/review-center-view.tsx"), "utf8")

describe("three-column risk fixes", () => {
  it("keeps graph control preferences compatible with existing localStorage keys", () => {
    expect(storeSource).toContain('const GRAPH_LABEL_MODE_KEY = "lk-graph-label-display-mode"')
    expect(storeSource).toContain('const GRAPH_EDGE_COLOR_KEY = "lk-graph-edge-color"')
    expect(storeSource).toContain('const GRAPH_EDGE_STRENGTH_KEY = "lk-graph-edge-strength"')
    expect(storeSource).toContain('const GRAPH_EDGE_STYLE_KEY = "lk-graph-edge-style"')
    expect(storeSource).toContain("readStoredGraphLabelDisplayMode()")
    expect(storeSource).toContain("readStoredGraphEdgeColorHex()")
    expect(storeSource).toContain("readStoredGraphEdgeStrengthPercent()")
    expect(storeSource).toContain("readStoredGraphEdgeStyle()")
  })

  it("lets the graph sidebar trigger GraphView refresh through the shared store", () => {
    expect(storeSource).toContain("refreshGraph: (() => void) | null")
    expect(storeSource).toContain("setRefreshGraph: (refreshGraph: (() => void) | null) => void")
    expect(graphViewSource).toContain("setRefreshGraph(() => loadGraph)")
    expect(graphViewSource).toContain("setRefreshGraph(null)")
    expect(graphSidebarSource).toContain("const refreshGraph = useWikiStore((s) => s.refreshGraph)")
    expect(graphSidebarSource).toContain("onClick={() => refreshGraph?.()}")
  })

  it("keeps non-novel review center compatible with the existing dashboard view", () => {
    expect(reviewCenterSource).toContain("!novelMode")
    expect(reviewCenterSource).toContain("renderReview(<DashboardView headerActions={<ReviewStartButton />} />)")
  })
})
