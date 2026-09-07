import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "./wiki-graph"
import { buildGraphMindMap, buildGraphNodeRelationSummary, buildGraphRiskReport, buildGraphRiskSummaryItemsForGroup, filterGraphDocumentNodes, filterGraphDocumentNodesByIsolation, filterGraphDocumentNodesByRelations, filterGraphDocumentNodesByRiskState, filterGraphDocumentNodesBySearch, filterNonZeroRiskSummaryItems, getGraphDocumentIsolationStats, getGraphDocumentNodeTypeOptions, getGraphDocumentQuickRiskFilters, getGraphDocumentRiskStateOptions, getGraphDocumentSortOptions, getGraphNodeRelatedEdges, getGraphNodeRiskLabel, getGraphNodeRiskStateLabel, getGraphNodeRiskStateLabelColor, getGraphNodeTypeLabel, getGraphRelationLabel, getGraphRiskSummaryItemColor, getGraphRiskSummaryTotal, getNextGraphNodeRiskStateLabel, groupGraphDocumentNodes, setGraphNodeRiskStateInContent, sortGraphDocumentNodes } from "./graph-readable"

const nodes: GraphNode[] = [
  { id: "lin-mo", label: "林默", type: "character", path: "/wiki/entities/林默.md", linkCount: 2, community: 0 },
  { id: "chapter-001", label: "第001章", type: "chapter", path: "/wiki/chapters/chapter-001.md", linkCount: 1, community: 0 },
  { id: "river", label: "黄河旧堤", type: "location", path: "/wiki/entities/黄河旧堤.md", linkCount: 1, community: 1 },
  { id: "secret-001", label: "身世秘密", type: "secret", path: "/wiki/entities/身世秘密.md", linkCount: 1, community: 1 },
  { id: "unused-item", label: "无关玉佩", type: "item", path: "/wiki/entities/无关玉佩.md", linkCount: 0, community: 2 },
]

const edges: GraphEdge[] = [
  { source: "lin-mo", target: "chapter-001", weight: 3, relation: "APPEARS_IN" },
  { source: "chapter-001", target: "river", weight: 2, relation: "HAPPENS_IN" },
]

describe("图谱可读化转换", () => {
  it("将图谱转换为脑图层级", () => {
    const mindMap = buildGraphMindMap(nodes, edges)

    expect(mindMap[0]?.label).toBe("小说图谱")
    expect(mindMap[0]?.children.some((group) => group.label === "人物")).toBe(true)
    expect(mindMap[0]?.children.find((group) => group.label === "人物")?.children[0]?.children[0]?.label).toBe("第001章")
  })

  it("提供文档内编辑所需的结构化分组与关系辅助函数", () => {
    const grouped = groupGraphDocumentNodes(nodes)

    expect(grouped.map((group) => group.title)).toEqual(["剧情事件", "重要角色", "地点与场景", "关键物品"])
    expect(grouped[0]?.nodes.map((node) => node.label)).toEqual(["第001章", "身世秘密"])
    expect(grouped[1]?.nodes.map((node) => node.label)).toEqual(["林默"])
    expect(grouped[2]?.nodes.map((node) => node.label)).toEqual(["黄河旧堤"])
    expect(grouped[3]?.nodes.map((node) => node.label)).toEqual(["无关玉佩"])
    expect(getGraphNodeRelatedEdges(edges, "lin-mo")).toEqual([
      { source: "lin-mo", target: "chapter-001", weight: 3, relation: "APPEARS_IN" },
    ])
    expect(getGraphNodeTypeLabel("character")).toBe("人物")
    expect(getGraphRelationLabel("APPEARS_IN")).toBe("出场于")
    expect(getGraphRelationLabel(undefined)).toBe("关联")
  })

  it("支持按文档分组和节点类型筛选节点", () => {
    const grouped = groupGraphDocumentNodes(nodes)
    const eventGroup = grouped.find((group) => group.title === "剧情事件")

    expect(filterGraphDocumentNodes(eventGroup?.nodes ?? [], "all").map((node) => node.label)).toEqual(["第001章", "身世秘密"])
    expect(filterGraphDocumentNodes(eventGroup?.nodes ?? [], "secret").map((node) => node.label)).toEqual(["身世秘密"])
    expect(getGraphDocumentNodeTypeOptions(eventGroup?.nodes ?? [])).toEqual([
      { value: "all", label: "全部类型" },
      { value: "chapter", label: "章节" },
      { value: "secret", label: "秘密" },
    ])
  })

  it("支持按关键词搜索节点标题和来源路径", () => {
    expect(filterGraphDocumentNodesBySearch(nodes, "林默").map((node) => node.label)).toEqual(["林默"])
    expect(filterGraphDocumentNodesBySearch(nodes, "chapter-001").map((node) => node.label)).toEqual(["第001章"])
    expect(filterGraphDocumentNodesBySearch(nodes, " ").map((node) => node.label)).toEqual(nodes.map((node) => node.label))
  })

  it("支持隐藏没有关系的节点", () => {
    expect(filterGraphDocumentNodesByRelations(nodes, edges, false).map((node) => node.label)).toEqual(nodes.map((node) => node.label))
    expect(filterGraphDocumentNodesByRelations(nodes, edges, true).map((node) => node.label)).toEqual(["林默", "第001章", "黄河旧堤"])
  })

  it("支持统计和筛选孤立节点", () => {
    expect(getGraphDocumentIsolationStats(nodes, edges)).toEqual({ total: 5, isolated: 2 })
    expect(filterGraphDocumentNodesByIsolation(nodes, edges, false).map((node) => node.label)).toEqual(nodes.map((node) => node.label))
    expect(filterGraphDocumentNodesByIsolation(nodes, edges, true).map((node) => node.label)).toEqual(["身世秘密", "无关玉佩"])
  })

  it("为节点生成小说化关系摘要", () => {
    expect(buildGraphNodeRelationSummary(nodes[0], nodes, edges)).toEqual([
      { title: "出场于", items: ["第001章"] },
    ])
    expect(buildGraphNodeRelationSummary(nodes[1], nodes, edges)).toEqual([
      { title: "出场于", items: ["林默"] },
      { title: "发生于", items: ["黄河旧堤"] },
    ])
    expect(buildGraphNodeRelationSummary(nodes[4], nodes, edges)).toEqual([])
  })

  it("支持图谱文档节点排序", () => {
    expect(sortGraphDocumentNodes(nodes, "default").map((node) => node.label)).toEqual(nodes.map((node) => node.label))
    expect(sortGraphDocumentNodes(nodes, "links-desc").map((node) => node.label)).toEqual(["林默", "第001章", "黄河旧堤", "身世秘密", "无关玉佩"])
    expect(sortGraphDocumentNodes(nodes, "links-asc").map((node) => node.label)).toEqual(["无关玉佩", "第001章", "黄河旧堤", "身世秘密", "林默"])
    expect(sortGraphDocumentNodes([
      { id: "b", label: "B", type: "concept", path: "/wiki/entities/B.md", linkCount: 0, community: 0 },
      { id: "c", label: "C", type: "concept", path: "/wiki/entities/C.md", linkCount: 0, community: 0 },
      { id: "a", label: "A", type: "concept", path: "/wiki/entities/A.md", linkCount: 0, community: 0 },
    ], "title").map((node) => node.label)).toEqual(["A", "B", "C"])
    expect(getGraphDocumentSortOptions()).toEqual([
      { value: "default", label: "默认顺序" },
      { value: "links-desc", label: "关联最多" },
      { value: "links-asc", label: "关联最少" },
      { value: "title", label: "标题排序" },
    ])
  })

  it("为特定节点类型提供风险标签", () => {
    expect(getGraphNodeRiskLabel("foreshadowing")).toBe("需追踪")
    expect(getGraphNodeRiskLabel("secret")).toBe("需核对")
    expect(getGraphNodeRiskLabel("canon-rule")).toBe("不可违背")
    expect(getGraphNodeRiskLabel("timeline-point")).toBe("需校验")
    expect(getGraphNodeRiskLabel("conflict")).toBe("需推进")
    expect(getGraphNodeRiskLabel("character")).toBeNull()
  })

  it("为特定节点类型提供状态化风险标签", () => {
    expect(getGraphNodeRiskStateLabel("foreshadowing")).toBe("未回收")
    expect(getGraphNodeRiskStateLabel("secret")).toBe("未揭露")
    expect(getGraphNodeRiskStateLabel("canon-rule")).toBe("稳定")
    expect(getGraphNodeRiskStateLabel("timeline-point")).toBe("需校验")
    expect(getGraphNodeRiskStateLabel("conflict")).toBe("待推进")
    expect(getGraphNodeRiskStateLabel("character")).toBeNull()
  })

  it("支持状态标签选项与循环切换", () => {
    expect(getNextGraphNodeRiskStateLabel("foreshadowing", "未回收")).toBe("推进中")
    expect(getNextGraphNodeRiskStateLabel("foreshadowing", "推进中")).toBe("已回收")
    expect(getNextGraphNodeRiskStateLabel("foreshadowing", "已回收")).toBe("未回收")
    expect(getNextGraphNodeRiskStateLabel("secret", null)).toBe("未揭露")
    expect(getNextGraphNodeRiskStateLabel("character", null)).toBeNull()
  })

  it("支持将状态字段写回节点档案内容", () => {
    expect(setGraphNodeRiskStateInContent("# 身世秘密\n\n已有内容", "未揭露")).toBe("# 身世秘密\n\n状态：未揭露\n\n已有内容")
    expect(setGraphNodeRiskStateInContent("# 身世秘密\n\n状态：未揭露\n\n已有内容", "已揭露")).toBe("# 身世秘密\n\n状态：已揭露\n\n已有内容")
  })

  it("支持风险状态筛选选项与节点过滤", () => {
    expect(getGraphDocumentRiskStateOptions(nodes, {})).toEqual([
      { value: "all", label: "全部状态" },
      { value: "未揭露", label: "未揭露" },
    ])
    expect(filterGraphDocumentNodesByRiskState(nodes, {}, "all").map((node) => node.label)).toEqual(nodes.map((node) => node.label))
    expect(filterGraphDocumentNodesByRiskState(nodes, {}, "未揭露").map((node) => node.label)).toEqual(["身世秘密"])
    expect(filterGraphDocumentNodesByRiskState(nodes, { "secret-001": "已揭露" }, "已揭露").map((node) => node.label)).toEqual(["身世秘密"])
  })

  it("提供风险快捷筛选配置", () => {
    expect(getGraphDocumentQuickRiskFilters()).toEqual([
      { key: "secret-unrevealed", label: "未揭露秘密", nodeType: "secret", riskState: "未揭露" },
      { key: "foreshadowing-unresolved", label: "未回收伏笔", nodeType: "foreshadowing", riskState: "未回收" },
      { key: "canon-rule-conflict", label: "疑似冲突规则", nodeType: "canon-rule", riskState: "疑似冲突" },
      { key: "timeline-conflict", label: "疑似矛盾时间点", nodeType: "timeline-point", riskState: "疑似矛盾" },
      { key: "conflict-pending", label: "待推进冲突", nodeType: "conflict", riskState: "待推进" },
    ])
  })

  it("构建风险统计面板数据", () => {
    expect(buildGraphRiskSummaryItemsForGroup(nodes, {})).toEqual([
      { key: "secret-unrevealed", label: "未揭露秘密", count: 1, nodeType: "secret", riskState: "未揭露" },
      { key: "foreshadowing-unresolved", label: "未回收伏笔", count: 0, nodeType: "foreshadowing", riskState: "未回收" },
      { key: "canon-rule-conflict", label: "疑似冲突规则", count: 0, nodeType: "canon-rule", riskState: "疑似冲突" },
      { key: "timeline-conflict", label: "疑似矛盾时间点", count: 0, nodeType: "timeline-point", riskState: "疑似矛盾" },
      { key: "conflict-pending", label: "待推进冲突", count: 0, nodeType: "conflict", riskState: "待推进" },
    ])
  })

  it("支持按当前分组统计风险面板数据", () => {
    const grouped = groupGraphDocumentNodes(nodes)
    const eventGroup = grouped.find((group) => group.title === "剧情事件")

    expect(buildGraphRiskSummaryItemsForGroup(eventGroup?.nodes ?? [], {})).toEqual([
      { key: "secret-unrevealed", label: "未揭露秘密", count: 1, nodeType: "secret", riskState: "未揭露" },
      { key: "foreshadowing-unresolved", label: "未回收伏笔", count: 0, nodeType: "foreshadowing", riskState: "未回收" },
      { key: "canon-rule-conflict", label: "疑似冲突规则", count: 0, nodeType: "canon-rule", riskState: "疑似冲突" },
      { key: "timeline-conflict", label: "疑似矛盾时间点", count: 0, nodeType: "timeline-point", riskState: "疑似矛盾" },
      { key: "conflict-pending", label: "待推进冲突", count: 0, nodeType: "conflict", riskState: "待推进" },
    ])
  })

  it("支持过滤零计数风险统计项", () => {
    const allItems = buildGraphRiskSummaryItemsForGroup(nodes, {})
    const filtered = filterNonZeroRiskSummaryItems(allItems)
    expect(filtered).toEqual([
      { key: "secret-unrevealed", label: "未揭露秘密", count: 1, nodeType: "secret", riskState: "未揭露" },
    ])
  })

  it("为风险统计项提供颜色分级映射", () => {
    expect(getGraphRiskSummaryItemColor({ key: "canon-rule-conflict", label: "疑似冲突规则", count: 3, nodeType: "canon-rule", riskState: "疑似冲突" })).toEqual({
      bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500",
    })
    expect(getGraphRiskSummaryItemColor({ key: "timeline-conflict", label: "疑似矛盾时间点", count: 2, nodeType: "timeline-point", riskState: "疑似矛盾" })).toEqual({
      bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500",
    })
    expect(getGraphRiskSummaryItemColor({ key: "secret-unrevealed", label: "未揭露秘密", count: 1, nodeType: "secret", riskState: "未揭露" })).toEqual({
      bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500",
    })
    expect(getGraphRiskSummaryItemColor({ key: "foreshadowing-unresolved", label: "未回收伏笔", count: 4, nodeType: "foreshadowing", riskState: "未回收" })).toEqual({
      bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500",
    })
    expect(getGraphRiskSummaryItemColor({ key: "conflict-pending", label: "待推进冲突", count: 1, nodeType: "conflict", riskState: "待推进" })).toEqual({
      bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500",
    })
  })

  it("为状态标签提供颜色分级映射", () => {
    expect(getGraphNodeRiskStateLabelColor("疑似冲突")).toEqual({
      bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500",
    })
    expect(getGraphNodeRiskStateLabelColor("疑似矛盾")).toEqual({
      bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500",
    })
    expect(getGraphNodeRiskStateLabelColor("未回收")).toEqual({
      bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500",
    })
    expect(getGraphNodeRiskStateLabelColor("待推进")).toEqual({
      bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500",
    })
    expect(getGraphNodeRiskStateLabelColor("已回收")).toEqual({
      bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300", dotBg: "bg-emerald-500",
    })
  })

  it("计算风险统计面板汇总计数", () => {
    const items = [
      { key: "secret-unrevealed", label: "未揭露秘密", count: 3, nodeType: "secret", riskState: "未揭露" },
      { key: "foreshadowing-unresolved", label: "未回收伏笔", count: 0, nodeType: "foreshadowing", riskState: "未回收" },
      { key: "canon-rule-conflict", label: "疑似冲突规则", count: 2, nodeType: "canon-rule", riskState: "疑似冲突" },
    ]
    expect(getGraphRiskSummaryTotal(items)).toBe(5)
    expect(getGraphRiskSummaryTotal([])).toBe(0)
  })

  it("生成风险排查报告 Markdown", () => {
    const report = buildGraphRiskReport(nodes, {})
    expect(report).toContain("# 风险排查报告")
    expect(report).toContain("共 1 个风险追踪节点")
    expect(report).toContain("## 身世秘密")
    expect(report).toContain("- 类型：秘密")
    expect(report).toContain("- 状态：未揭露")
    expect(report).toContain("- 档案：/wiki/entities/身世秘密.md")
  })

  it("生成风险排查报告时反映覆盖状态", () => {
    const report = buildGraphRiskReport(nodes, { "secret-001": "已揭露" })
    expect(report).toContain("- 状态：已揭露")
    expect(report).toContain("- 变更：未揭露 → 已揭露")
  })
})