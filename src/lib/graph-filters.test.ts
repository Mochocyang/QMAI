// 注：isStructuralGraphNode 并未被删除，只是自 01aab5f（refactor(cleanup): 收口测试专用旧模块和
// 未使用导出）起不再是导出符号——其实现完全未变，仍位于 src/lib/graph-filters.ts，并被
// applyGraphFilters 内部调用（该函数唯一的使用点）。仓库中不存在其它等价的公开判定。
// 为遵守「只能改测试文件」，这里改为经由公开 API applyGraphFilters 等价地验证同一判定：
// 在 hideStructural: true 且其余全部过滤条件停用时，节点被隐藏 ⇔ isStructuralGraphNode(node) === true。
// 原有断言（toBe(true) / toBe(false)）与测试意图均保持不变。
import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@/lib/wiki-graph"
import { applyGraphFilters, DEFAULT_GRAPH_FILTERS, type GraphFilterState } from "./graph-filters"

const nodes: GraphNode[] = [
  { id: "index", label: "Index", type: "other", path: "/p/wiki/index.md", linkCount: 4, community: 0 },
  { id: "concept-a", label: "Concept A", type: "concept", path: "/p/wiki/concepts/a.md", linkCount: 2, community: 0 },
  { id: "entity-b", label: "Entity B", type: "entity", path: "/p/wiki/entities/b.md", linkCount: 3, community: 0 },
  { id: "source-c", label: "Source C", type: "source", path: "/p/wiki/sources/c.md", linkCount: 1, community: 1 },
  { id: "isolated", label: "Isolated", type: "concept", path: "/p/wiki/concepts/isolated.md", linkCount: 0, community: 2 },
]

const edges: GraphEdge[] = [
  { source: "index", target: "concept-a", weight: 1 },
  { source: "index", target: "entity-b", weight: 1 },
  { source: "concept-a", target: "entity-b", weight: 2 },
  { source: "source-c", target: "entity-b", weight: 3 },
]

function makeFilters(overrides: Partial<GraphFilterState> = {}): GraphFilterState {
  return {
    ...DEFAULT_GRAPH_FILTERS,
    hiddenTypes: new Set<string>(),
    hiddenNodeIds: new Set<string>(),
    ...overrides,
  }
}

/**
 * 等价替代已不再导出的 isStructuralGraphNode：通过其唯一调用点 applyGraphFilters 观察结果。
 * makeFilters() 默认 hideStructural: true，且 hiddenTypes / hiddenNodeIds 为空、
 * hideIsolated 为 false、maxLinks / minimumEdgeWeight / allowedNodeTypes 均未设置，
 * 因此单节点输入下「被隐藏」只能由结构性判定造成，与直接调用谓词语义等价。
 */
function isHiddenAsStructural(node: GraphNode): boolean {
  return applyGraphFilters([node], [], makeFilters()).hiddenNodeIds.has(node.id)
}

describe("graph filters", () => {
  it("detects structural graph nodes by id, type, and path", () => {
    expect(isHiddenAsStructural(nodes[0])).toBe(true)
    expect(isHiddenAsStructural({ ...nodes[1], id: "overview", path: "/p/wiki/concepts/overview.md" })).toBe(true)
    expect(isHiddenAsStructural({ ...nodes[1], type: "overview" })).toBe(true)
    expect(isHiddenAsStructural(nodes[1])).toBe(false)
  })

  it("hides structural nodes and their connected edges by default", () => {
    const out = applyGraphFilters(nodes, edges, makeFilters())

    expect(out.nodes.map((n) => n.id)).not.toContain("index")
    expect(out.edges).toEqual([
      { source: "concept-a", target: "entity-b", weight: 2 },
      { source: "source-c", target: "entity-b", weight: 3 },
    ])
  })

  it("hides selected node types", () => {
    const out = applyGraphFilters(nodes, edges, makeFilters({
      hideStructural: false,
      hiddenTypes: new Set(["source"]),
    }))

    expect(out.nodes.map((n) => n.id)).not.toContain("source-c")
    expect(out.edges.some((e) => e.source === "source-c" || e.target === "source-c")).toBe(false)
  })

  it("hides manually selected nodes", () => {
    const out = applyGraphFilters(nodes, edges, makeFilters({
      hideStructural: false,
      hiddenNodeIds: new Set(["entity-b"]),
    }))

    expect(out.nodes.map((n) => n.id)).not.toContain("entity-b")
    expect(out.edges).toEqual([{ source: "index", target: "concept-a", weight: 1 }])
  })

  it("hides hub nodes above the max link threshold", () => {
    const out = applyGraphFilters(nodes, edges, makeFilters({
      hideStructural: false,
      maxLinks: 2,
    }))

    expect(out.nodes.map((n) => n.id)).not.toContain("index")
    expect(out.nodes.map((n) => n.id)).not.toContain("entity-b")
    expect(out.edges).toEqual([])
  })

  it("hides isolated nodes when requested", () => {
    const out = applyGraphFilters(nodes, edges, makeFilters({
      hideStructural: false,
      hideIsolated: true,
    }))

    expect(out.nodes.map((n) => n.id)).not.toContain("isolated")
  })

  it("keeps isolated nodes visible when hideIsolated would blank the whole graph", () => {
    const out = applyGraphFilters(
      [
        { id: "chapter-1", label: "第1章", type: "chapter", path: "/p/wiki/chapters/1.md", linkCount: 0, community: 0 },
        { id: "chapter-2", label: "第2章", type: "chapter", path: "/p/wiki/chapters/2.md", linkCount: 0, community: 0 },
      ],
      [],
      makeFilters({
        hideStructural: false,
        hideIsolated: true,
      }),
    )

    expect(out.nodes.map((n) => n.id).sort()).toEqual(["chapter-1", "chapter-2"])
    expect(out.hiddenNodeIds.size).toBe(0)
  })

  it("keeps allowed isolated novel nodes visible when only disallowed types would remain hidden", () => {
    const out = applyGraphFilters(
      [
        { id: "chapter-1", label: "第1章", type: "chapter", path: "/p/wiki/chapters/1.md", linkCount: 0, community: 0 },
        { id: "chapter-2", label: "第2章", type: "chapter", path: "/p/wiki/chapters/2.md", linkCount: 0, community: 0 },
        { id: "outline-1", label: "大纲1", type: "outline", path: "/p/wiki/outlines/1.md", linkCount: 0, community: 0 },
      ],
      [],
      {
        ...makeFilters({
          hideStructural: false,
          hideIsolated: true,
        }),
        allowedNodeTypes: new Set(["chapter"]),
      },
    )

    expect(out.nodes.map((n) => n.id).sort()).toEqual(["chapter-1", "chapter-2"])
    expect(out.hiddenNodeIds.has("outline-1")).toBe(true)
  })

  it("minimumEdgeWeight 过滤弱关系边，且 allowedNodeTypes 过滤非白名单节点", () => {
    const out = applyGraphFilters(
      [
        { id: "hero", label: "主角", type: "character", path: "/p/wiki/entities/hero.md", linkCount: 4, community: 0 },
        { id: "king", label: "国王", type: "character", path: "/p/wiki/entities/king.md", linkCount: 3, community: 0 },
        { id: "chapter-1", label: "第1章", type: "chapter", path: "/p/wiki/chapters/1.md", linkCount: 2, community: 0 },
        { id: "trivial-item", label: "路边木棍", type: "item", path: "/p/wiki/entities/stick.md", linkCount: 1, community: 1 },
        { id: "outline-x", label: "大纲X", type: "outline", path: "/p/wiki/outlines/x.md", linkCount: 1, community: 2 },
      ],
      [
        { source: "hero", target: "king", weight: 3 },
        { source: "hero", target: "chapter-1", weight: 1 },
        { source: "king", target: "trivial-item", weight: 1 },
        { source: "chapter-1", target: "outline-x", weight: 2 },
      ],
      {
        ...makeFilters({ hideStructural: false, hideIsolated: false }),
        minimumEdgeWeight: 2,
        allowedNodeTypes: new Set(["character", "chapter", "event", "location", "item"]),
      },
    )

    const nodeIds = out.nodes.map((node) => node.id).sort()
    expect(nodeIds).toEqual(["chapter-1", "hero", "king", "trivial-item"])
    expect(out.edges).toEqual([{ source: "hero", target: "king", weight: 3 }])
  })
})
