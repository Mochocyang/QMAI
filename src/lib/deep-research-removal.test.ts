import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("deep research removal", () => {
  it("removes UI and action entry points from layout, review, and graph", () => {
    const iconSidebar = read("../components/layout/icon-sidebar.tsx")
    const appLayout = read("../components/layout/app-layout.tsx")
    const reviewView = read("../components/review/review-view.tsx")
    const graphView = read("../components/graph/graph-view.tsx")

    expect(iconSidebar).not.toContain("Deep Research")
    expect(iconSidebar).not.toContain("useResearchStore")
    expect(appLayout).not.toContain("ResearchPanel")
    expect(appLayout).not.toContain("useResearchStore")
    expect(reviewView).not.toContain("__deep_research__")
    expect(reviewView).not.toContain("queueResearch(")
    expect(graphView).not.toContain("queueResearch(")
    expect(graphView).not.toContain("optimizeResearchTopic(")
    expect(graphView).not.toContain("graph.deepResearch")
    expect(graphView).not.toContain("useResearchStore")
  })
})
