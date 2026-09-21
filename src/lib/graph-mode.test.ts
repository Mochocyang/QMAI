import { describe, expect, it } from "vitest"
import { GRAPH_MODE_LABELS, GRAPH_MODE_PRESETS } from "./graph-mode"

describe("小说图谱模式配置", () => {
  it("为首批专题模式提供中文标签", () => {
    expect(GRAPH_MODE_LABELS.overview).toBe("总览")
    expect(GRAPH_MODE_LABELS.character).toBe("人物")
    expect(GRAPH_MODE_LABELS.chapter).toBe("章节")
    expect(GRAPH_MODE_LABELS.storyline).toBe("故事线")
    expect(GRAPH_MODE_LABELS.foreshadowing).toBe("伏笔")
  })

  it("总览模式默认启用强力减法", () => {
    expect(GRAPH_MODE_PRESETS.overview.hideIsolated).toBe(true)
    expect(GRAPH_MODE_PRESETS.overview.minimumEdgeWeight).toBeGreaterThanOrEqual(2)
    expect(GRAPH_MODE_PRESETS.overview.labelVisibility).toBe("focused")
  })

  it("专题模式为不同任务提供不同节点白名单", () => {
    expect(GRAPH_MODE_PRESETS.character.allowedNodeTypes).toContain("character")
    expect(GRAPH_MODE_PRESETS.chapter.allowedNodeTypes).toContain("chapter")
    expect(GRAPH_MODE_PRESETS.foreshadowing.allowedNodeTypes).toContain("foreshadowing")
  })
})