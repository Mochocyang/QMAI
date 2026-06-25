import type { GraphEdge, GraphNode } from "./wiki-graph"

export interface MindMapNode {
  id: string
  label: string
  children: MindMapNode[]
}

export interface GraphNodeRelationSummary {
  title: string
  items: string[]
}

export interface GraphDocumentIsolationStats {
  total: number
  isolated: number
}

export interface GraphDocumentQuickRiskFilter {
  key: string
  label: string
  nodeType: string
  riskState: string
}

export interface GraphRiskSummaryItem extends GraphDocumentQuickRiskFilter {
  count: number
}

export interface GraphRiskSummaryItemColor {
  bg: string
  border: string
  text: string
  dotBg: string
}

export type GraphDocumentSortMode = "default" | "links-desc" | "links-asc" | "title"

const TYPE_LABELS: Record<string, string> = {
  character: "人物",
  location: "地点",
  organization: "组织",
  item: "物品",
  event: "事件",
  chapter: "章节",
  outline: "大纲",
  foreshadowing: "伏笔",
  secret: "秘密",
  conflict: "冲突",
  "timeline-point": "时间点",
  "canon-rule": "正史规则",
  entity: "实体",
  concept: "概念",
  source: "素材",
  query: "问答记录",
  synthesis: "综合整理",
  overview: "总览",
  comparison: "对比",
  other: "其他",
}

const RELATION_LABELS: Record<string, string> = {
  APPEARS_IN: "出场于",
  HAPPENS_IN: "发生于",
  KNOWS: "知晓",
  OWNS: "持有",
  BELONGS_TO: "隶属于",
  OPPOSES: "对立",
  SUPPORTS: "支持",
  AFFECTS: "影响",
  CAUSED_BY: "源于",
  FORESHADOWS: "伏笔指向",
  REVEALS: "揭示",
}

const RISK_LABELS: Record<string, string> = {
  foreshadowing: "需追踪",
  secret: "需核对",
  "canon-rule": "不可违背",
  "timeline-point": "需校验",
  conflict: "需推进",
}

const RISK_STATE_LABELS: Record<string, string> = {
  foreshadowing: "未回收",
  secret: "未揭露",
  "canon-rule": "稳定",
  "timeline-point": "需校验",
  conflict: "待推进",
}

const RISK_STATE_OPTIONS: Record<string, string[]> = {
  foreshadowing: ["未回收", "推进中", "已回收"],
  secret: ["未揭露", "部分揭露", "已揭露"],
  "canon-rule": ["稳定", "疑似冲突"],
  "timeline-point": ["正常", "疑似矛盾"],
  conflict: ["待推进", "推进中", "已解决"],
}

const DOCUMENT_GROUPS = [
  { title: "剧情事件", types: ["event", "conflict", "foreshadowing", "secret", "timeline-point", "canon-rule", "chapter", "outline", "source"] },
  { title: "重要角色", types: ["character"] },
  { title: "地点与场景", types: ["location"] },
  { title: "组织与势力", types: ["organization"] },
  { title: "关键物品", types: ["item"] },
  { title: "其他节点", types: ["entity", "concept", "query", "synthesis", "overview", "comparison", "other"] },
]

export function getGraphNodeTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export function getGraphRelationLabel(relation: string | undefined): string {
  return relation ? RELATION_LABELS[relation] ?? relation : "关联"
}

export function getGraphNodeRiskLabel(type: string): string | null {
  return RISK_LABELS[type] ?? null
}

export function getGraphNodeRiskStateLabel(type: string): string | null {
  return RISK_STATE_LABELS[type] ?? null
}

export function getGraphNodeRiskStateOptions(type: string): string[] {
  return RISK_STATE_OPTIONS[type] ?? []
}

export function getNextGraphNodeRiskStateLabel(type: string, current: string | null): string | null {
  const options = getGraphNodeRiskStateOptions(type)
  if (options.length === 0) return null
  if (!current) return options[0] ?? null
  const index = options.indexOf(current)
  if (index === -1) return options[0] ?? null
  return options[(index + 1) % options.length] ?? null
}

export function setGraphNodeRiskStateInContent(content: string, state: string): string {
  if (/^状态：.*$/m.test(content)) {
    return content.replace(/^状态：.*$/m, `状态：${state}`)
  }
  const titleMatch = content.match(/^# .*(?:\r?\n)+/)
  if (titleMatch) {
    return content.replace(titleMatch[0], `${titleMatch[0]}状态：${state}\n\n`)
  }
  return `状态：${state}\n\n${content}`
}

function typeLabel(type: string): string {
  return getGraphNodeTypeLabel(type)
}

function relationLabel(relation: string | undefined): string {
  return getGraphRelationLabel(relation)
}

function wikiLink(label: string): string {
  return `[[${label}]]`
}

function nodeLabel(nodes: GraphNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id
}

export function getGraphNodeRelatedEdges(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
}

function relatedEdges(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return getGraphNodeRelatedEdges(edges, nodeId)
}

export function groupGraphDocumentNodes(nodes: GraphNode[]): Array<{ title: string; nodes: GraphNode[] }> {
  const used = new Set<string>()
  const groups: Array<{ title: string; nodes: GraphNode[] }> = []

  for (const group of DOCUMENT_GROUPS) {
    const matched = nodes.filter((node) => group.types.includes(node.type))
    if (matched.length === 0) continue
    groups.push({ title: group.title, nodes: matched })
    for (const node of matched) used.add(node.id)
  }

  const remaining = nodes.filter((node) => !used.has(node.id))
  if (remaining.length > 0) groups.push({ title: "其他节点", nodes: remaining })

  return groups
}

export function filterGraphDocumentNodes(nodes: GraphNode[], nodeType: string): GraphNode[] {
  if (nodeType === "all") return nodes
  return nodes.filter((node) => node.type === nodeType)
}

export function filterGraphDocumentNodesBySearch(nodes: GraphNode[], query: string): GraphNode[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return nodes
  return nodes.filter((node) => `${node.label} ${node.path ?? ""}`.toLowerCase().includes(keyword))
}

export function filterGraphDocumentNodesByRiskState(nodes: GraphNode[], riskStateOverrides: Record<string, string>, selectedRiskState: string): GraphNode[] {
  if (selectedRiskState === "all") return nodes
  return nodes.filter((node) => (riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)) === selectedRiskState)
}

export function filterGraphDocumentNodesByRelations(nodes: GraphNode[], edges: GraphEdge[], hideUnrelated: boolean): GraphNode[] {
  if (!hideUnrelated) return nodes
  return nodes.filter((node) => edges.some((edge) => edge.source === node.id || edge.target === node.id))
}

export function filterGraphDocumentNodesByIsolation(nodes: GraphNode[], edges: GraphEdge[], showOnlyIsolated: boolean): GraphNode[] {
  if (!showOnlyIsolated) return nodes
  return nodes.filter((node) => !edges.some((edge) => edge.source === node.id || edge.target === node.id))
}

export function getGraphDocumentIsolationStats(nodes: GraphNode[], edges: GraphEdge[]): GraphDocumentIsolationStats {
  return {
    total: nodes.length,
    isolated: filterGraphDocumentNodesByIsolation(nodes, edges, true).length,
  }
}

export function getGraphDocumentNodeTypeOptions(nodes: GraphNode[]): Array<{ value: string; label: string }> {
  const types = Array.from(new Set(nodes.map((node) => node.type)))
  return [
    { value: "all", label: "全部类型" },
    ...types.map((type) => ({ value: type, label: getGraphNodeTypeLabel(type) })),
  ]
}

export function getGraphDocumentRiskStateOptions(nodes: GraphNode[], riskStateOverrides: Record<string, string>): Array<{ value: string; label: string }> {
  const states = Array.from(new Set(nodes.map((node) => riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)).filter(Boolean) as string[]))
  return [
    { value: "all", label: "全部状态" },
    ...states.map((state) => ({ value: state, label: state })),
  ]
}

export function getGraphDocumentSortOptions(): Array<{ value: GraphDocumentSortMode; label: string }> {
  return [
    { value: "default", label: "默认顺序" },
    { value: "links-desc", label: "关联最多" },
    { value: "links-asc", label: "关联最少" },
    { value: "title", label: "标题排序" },
  ]
}

export function getGraphDocumentQuickRiskFilters(): GraphDocumentQuickRiskFilter[] {
  return [
    { key: "secret-unrevealed", label: "未揭露秘密", nodeType: "secret", riskState: "未揭露" },
    { key: "foreshadowing-unresolved", label: "未回收伏笔", nodeType: "foreshadowing", riskState: "未回收" },
    { key: "canon-rule-conflict", label: "疑似冲突规则", nodeType: "canon-rule", riskState: "疑似冲突" },
    { key: "timeline-conflict", label: "疑似矛盾时间点", nodeType: "timeline-point", riskState: "疑似矛盾" },
    { key: "conflict-pending", label: "待推进冲突", nodeType: "conflict", riskState: "待推进" },
  ]
}

export function buildGraphRiskSummaryItems(nodes: GraphNode[], riskStateOverrides: Record<string, string>): GraphRiskSummaryItem[] {
  return getGraphDocumentQuickRiskFilters().map((filter) => ({
    ...filter,
    count: nodes.filter((node) => node.type === filter.nodeType && (riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)) === filter.riskState).length,
  }))
}

export function buildGraphRiskSummaryItemsForGroup(nodes: GraphNode[], riskStateOverrides: Record<string, string>): GraphRiskSummaryItem[] {
  return buildGraphRiskSummaryItems(nodes, riskStateOverrides)
}

export function filterNonZeroRiskSummaryItems(items: GraphRiskSummaryItem[]): GraphRiskSummaryItem[] {
  return items.filter((item) => item.count > 0)
}

export function getGraphRiskSummaryItemColor(item: GraphRiskSummaryItem): GraphRiskSummaryItemColor {
  if (item.key === "canon-rule-conflict" || item.key === "timeline-conflict") {
    return { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500" }
  }
  return { bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500" }
}

export function getGraphNodeRiskStateLabelColor(state: string): GraphRiskSummaryItemColor {
  if (state === "疑似冲突" || state === "疑似矛盾") {
    return { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-700 dark:text-red-300", dotBg: "bg-red-500" }
  }
  if (state === "未回收" || state === "推进中" || state === "未揭露" || state === "部分揭露" || state === "待推进") {
    return { bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-700 dark:text-orange-300", dotBg: "bg-orange-500" }
  }
  return { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300", dotBg: "bg-emerald-500" }
}

export function getGraphRiskSummaryTotal(items: GraphRiskSummaryItem[]): number {
  return items.reduce((sum, item) => sum + item.count, 0)
}

export function buildGraphRiskReport(nodes: GraphNode[], riskStateOverrides: Record<string, string>): string {
  const riskNodeTypes = new Set(["foreshadowing", "secret", "canon-rule", "timeline-point", "conflict"])
  const riskNodes = nodes.filter((node) => riskNodeTypes.has(node.type))
  const lines: string[] = []

  lines.push("# 风险排查报告", "")
  lines.push(`生成时间：${new Date().toISOString().slice(0, 10)}`, "")
  lines.push(`共 ${riskNodes.length} 个风险追踪节点。`, "")

  for (const node of riskNodes) {
    const state = riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)
    const stateLabel = state ?? "未知"
    lines.push(`## ${node.label}`, "")
    lines.push(`- 类型：${getGraphNodeTypeLabel(node.type)}`, "")
    lines.push(`- 状态：${stateLabel}`, "")

    const defaultState = getGraphNodeRiskStateLabel(node.type)
    const isOverridden = riskStateOverrides[node.id] !== undefined
    if (isOverridden && defaultState !== stateLabel) {
      lines.push(`- 变更：${defaultState} → ${stateLabel}`, "")
    }

    if (node.path) {
      lines.push(`- 档案：${node.path}`, "")
    }

    lines.push("")
  }

  return lines.join("\n")
}

export function sortGraphDocumentNodes(nodes: GraphNode[], mode: GraphDocumentSortMode): GraphNode[] {
  if (mode === "default") return nodes
  const sorted = [...nodes]
  if (mode === "links-desc") {
    sorted.sort((a, b) => (b.linkCount - a.linkCount) || a.label.localeCompare(b.label, "zh-CN"))
    return sorted
  }
  if (mode === "links-asc") {
    sorted.sort((a, b) => (a.linkCount - b.linkCount) || a.label.localeCompare(b.label, "zh-CN"))
    return sorted
  }
  sorted.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
  return sorted
}

export function buildGraphNodeRelationSummary(node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): GraphNodeRelationSummary[] {
  const summary = new Map<string, string[]>()
  for (const edge of relatedEdges(edges, node.id)) {
    const otherId = edge.source === node.id ? edge.target : edge.source
    const label = relationLabel(edge.relation)
    summary.set(label, [...(summary.get(label) ?? []), nodeLabel(nodes, otherId)])
  }
  return Array.from(summary.entries()).map(([title, items]) => ({ title, items }))
}

function groupNodes(nodes: GraphNode[]): Array<{ title: string; nodes: GraphNode[] }> {
  return groupGraphDocumentNodes(nodes)
}

function pushNodeDocument(lines: string[], node: GraphNode, nodes: GraphNode[], edges: GraphEdge[], headingNumber: string): void {
  const nodeEdges = relatedEdges(edges, node.id)
  const eventEdges = nodeEdges.filter((edge) => {
    const otherId = edge.source === node.id ? edge.target : edge.source
    const otherNode = nodes.find((item) => item.id === otherId)
    return otherNode?.type === "event" || otherNode?.type === "chapter" || otherNode?.type === "outline"
  })

  lines.push(`### ${headingNumber} ${wikiLink(node.label)}`, "")
  lines.push("#### 基础信息", "")
  lines.push(`- 节点类型：${typeLabel(node.type)}`)
  lines.push(`- 关联数量：${node.linkCount}`)
  lines.push(`- 来源路径：${node.path || "暂无"}`, "")
  lines.push("#### 关系网络", "")

  if (nodeEdges.length === 0) {
    lines.push("暂无已记录关系。", "")
  } else {
    lines.push("| 关联对象 | 关系 | 方向 | 权重 |")
    lines.push("| --- | --- | --- | --- |")
    for (const edge of nodeEdges.slice(0, 12)) {
      const isSource = edge.source === node.id
      const otherId = isSource ? edge.target : edge.source
      lines.push(`| ${wikiLink(nodeLabel(nodes, otherId))} | ${relationLabel(edge.relation)} | ${isSource ? "指向对方" : "来自对方"} | ${edge.weight} |`)
    }
    lines.push("")
  }

  lines.push("#### 相关事件", "")
  if (eventEdges.length === 0) {
    lines.push("暂无直接关联事件。", "")
  } else {
    for (const edge of eventEdges.slice(0, 8)) {
      const otherId = edge.source === node.id ? edge.target : edge.source
      lines.push(`- ${wikiLink(nodeLabel(nodes, otherId))}：${relationLabel(edge.relation)}`)
    }
    lines.push("")
  }

  lines.push("#### 可补充设定", "")
  lines.push("- 经用户确认后，可在该节点对应的真实档案页中补充事件、关系、状态与设定。", "")
}

export function buildGraphDocument(nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines = ["# 小说图谱文档", ""]
  lines.push("本文档由当前小说档案页自动生成，用于阅读图谱结构；需要长期生效的修改应写入具体节点档案页。", "")

  groupNodes(nodes).forEach((group, groupIndex) => {
    const sectionNumber = groupIndex + 1
    lines.push(`## ${sectionNumber}. ${group.title}`, "")
    group.nodes.forEach((node, nodeIndex) => {
      pushNodeDocument(lines, node, nodes, edges, `${sectionNumber}.${nodeIndex + 1}`)
    })
  })

  lines.push(`## ${groupNodes(nodes).length + 1}. 全部关系`, "")
  if (edges.length === 0) {
    lines.push("暂无关系。")
  } else {
    lines.push("| 起点 | 关系 | 终点 | 权重 |")
    lines.push("| --- | --- | --- | --- |")
    for (const edge of edges) {
      lines.push(`| ${wikiLink(nodeLabel(nodes, edge.source))} | ${relationLabel(edge.relation)} | ${wikiLink(nodeLabel(nodes, edge.target))} | ${edge.weight} |`)
    }
  }

  return lines.join("\n")
}

export function buildGraphMindMap(nodes: GraphNode[], edges: GraphEdge[]): MindMapNode[] {
  const groups = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const label = typeLabel(node.type)
    groups.set(label, [...(groups.get(label) ?? []), node])
  }

  const root: MindMapNode = { id: "root", label: "小说图谱", children: [] }
  for (const [groupLabel, groupNodes] of groups) {
    root.children.push({
      id: `group:${groupLabel}`,
      label: groupLabel,
      children: groupNodes.map((node) => ({
        id: node.id,
        label: node.label,
        children: relatedEdges(edges, node.id).slice(0, 8).map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source
          return {
            id: `${node.id}:${otherId}`,
            label: nodeLabel(nodes, otherId),
            children: [],
          }
        }),
      })),
    })
  }

  return [root]
}
