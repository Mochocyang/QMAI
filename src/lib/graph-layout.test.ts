import { describe, expect, it } from "vitest"
import { GRAPH_LAYOUT_SETTINGS, GRAPH_VISUAL_SETTINGS } from "./graph-layout"

describe("图谱布局参数", () => {
  it("使用更分散的布局与更克制的视觉参数", () => {
    expect(GRAPH_LAYOUT_SETTINGS.scalingRatio).toBeGreaterThanOrEqual(4)
    expect(GRAPH_LAYOUT_SETTINGS.gravity).toBeLessThanOrEqual(0.22)
    expect(GRAPH_VISUAL_SETTINGS.baseNodeSize).toBeLessThanOrEqual(7)
    expect(GRAPH_VISUAL_SETTINGS.maxNodeSize).toBeLessThanOrEqual(22)
    expect(GRAPH_VISUAL_SETTINGS.maxEdgeSize).toBeLessThanOrEqual(2.2)
  })
})