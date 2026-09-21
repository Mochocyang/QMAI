import { describe, expect, it } from "vitest"
import type { CommunityInfo } from "./wiki-graph"
import type { GraphEdge, GraphNode } from "./wiki-graph"
import { detectKnowledgeGaps, findSurprisingConnections } from "./graph-insights"

const nodes: GraphNode[] = [
  { id: "chapter-1", label: "第1章", type: "source", path: "/wiki/chapters/1.md", linkCount: 1, community: 0 },
  { id: "concept-1", label: "无我", type: "concept", path: "/wiki/entities/无我.md", linkCount: 4, community: 1 },
  { id: "event-1", label: "黑雨之夜", type: "event", path: "/wiki/entities/黑雨之夜.md", linkCount: 0, community: 2 },
  { id: "role-1", label: "杨津芒", type: "character", path: "/wiki/entities/杨津芒.md", linkCount: 2, community: 2 },
  { id: "place-1", label: "旧堤", type: "location", path: "/wiki/entities/旧堤.md", linkCount: 2, community: 3 },
]

const edges: GraphEdge[] = [
  { source: "chapter-1", target: "concept-1", weight: 1, relation: "AFFECTS" },
  { source: "concept-1", target: "event-1", weight: 1, relation: "AFFECTS" },
  { source: "concept-1", target: "role-1", weight: 1, relation: "AFFECTS" },
  { source: "concept-1", target: "place-1", weight: 1, relation: "AFFECTS" },
]

const communities: CommunityInfo[] = [
  { id: 0, nodeCount: 3, cohesion: 0.1, topNodes: ["第1章"] },
]

describe("图谱洞察中文文案", () => {
  it("意外连接原因使用中文", () => {
    const [connection] = findSurprisingConnections(nodes, edges, communities)

    expect(connection?.reasons.join("，")).toContain("跨社群关联")
    expect(connection?.reasons.join("，")).toContain("素材连接到概念")
    expect(connection?.reasons.join("，")).not.toMatch(/[a-zA-Z]/)
  })

  it("知识缺口标题、描述和建议使用中文", () => {
    const gaps = detectKnowledgeGaps(nodes, edges, communities)
    const text = gaps.map((gap) => `${gap.title}\n${gap.description}\n${gap.suggestion}`).join("\n")

    expect(text).toContain("孤立页面")
    expect(text).toContain("这些页面关联较少或暂无关联")
    expect(text).toContain("关键桥梁")
    expect(text).not.toMatch(/isolated|pages|Sparse|cluster|Key bridge|Consider|knowledge/i)
  })
})
