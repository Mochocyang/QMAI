import type { GraphNode, GraphEdge, CommunityInfo } from "./wiki-graph"

const TYPE_LABELS: Record<string, string> = {
  character: "角色",
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
  source: "素材",
  concept: "概念",
  entity: "实体",
  query: "问答记录",
  synthesis: "综合整理",
  overview: "总览",
  comparison: "对比",
  other: "其他",
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function formatNodeList(nodes: GraphNode[], total: number): string {
  const labels = nodes.map((n) => n.label).join("、")
  return total > nodes.length ? `${labels}，以及另外 ${total - nodes.length} 个页面` : labels
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurprisingConnection {
  source: GraphNode
  target: GraphNode
  score: number
  reasons: string[]
  key: string // stable ID for dismiss tracking
}

export interface KnowledgeGap {
  type: "isolated-node" | "sparse-community" | "bridge-node"
  title: string
  description: string
  nodeIds: string[]
  suggestion: string
}

// ---------------------------------------------------------------------------
// Surprising Connections
// ---------------------------------------------------------------------------

/**
 * Find edges that are "surprising" — connecting nodes across communities,
 * across types, or linking peripheral nodes to hubs.
 */
export function findSurprisingConnections(
  nodes: GraphNode[],
  edges: GraphEdge[],
  _communities: CommunityInfo[],
  limit: number = 5,
): SurprisingConnection[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const degreeMap = new Map(nodes.map((n) => [n.id, n.linkCount]))
  const maxDegree = Math.max(...nodes.map((n) => n.linkCount), 1)

  // Structural pages that link to everything — exclude from analysis
  const STRUCTURAL_IDS = new Set(["index", "log", "overview"])

  const scored: SurprisingConnection[] = []

  for (const edge of edges) {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (STRUCTURAL_IDS.has(source.id) || STRUCTURAL_IDS.has(target.id)) continue

    let score = 0
    const reasons: string[] = []

    // Signal 1: Cross-community edge (+3)
    if (source.community !== target.community) {
      score += 3
      reasons.push("跨社群关联")
    }

    // Signal 2: Cross-type edge (+2 for distant types)
    if (source.type !== target.type) {
      const distantPairs = new Set([
        "source-concept", "concept-source",
        "source-synthesis", "synthesis-source",
        "query-entity", "entity-query",
      ])
      const pair = `${source.type}-${target.type}`
      if (distantPairs.has(pair)) {
        score += 2
        reasons.push(`${typeLabel(source.type)}连接到${typeLabel(target.type)}`)
      } else {
        score += 1
        reasons.push("不同类型节点相连")
      }
    }

    // Signal 3: Peripheral-to-hub coupling (+2)
    const sourceDeg = degreeMap.get(source.id) ?? 0
    const targetDeg = degreeMap.get(target.id) ?? 0
    const minDeg = Math.min(sourceDeg, targetDeg)
    const maxDeg = Math.max(sourceDeg, targetDeg)
    if (minDeg <= 2 && maxDeg >= maxDegree * 0.5) {
      score += 2
      reasons.push("边缘节点连接到核心节点")
    }

    // Signal 4: Low-weight edge between connected nodes (+1)
    if (edge.weight < 2 && edge.weight > 0) {
      score += 1
      reasons.push("弱关联但已形成连接")
    }

    if (score >= 3 && reasons.length > 0) {
      const key = [source.id, target.id].sort().join(":::")
      scored.push({ source, target, score, reasons, key })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Knowledge Gaps
// ---------------------------------------------------------------------------

/**
 * Detect knowledge gaps based on graph structure:
 * - Isolated nodes (degree ≤ 1)
 * - Sparse communities (cohesion < 0.15 with ≥ 3 nodes)
 * - Bridge nodes (high betweenness — connected to multiple communities)
 */
export function detectKnowledgeGaps(
  nodes: GraphNode[],
  edges: GraphEdge[],
  communities: CommunityInfo[],
  limit: number = 8,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // 1. Isolated nodes (degree ≤ 1, exclude overview/index)
  const isolatedNodes = nodes.filter(
    (n) => n.linkCount <= 1 && n.type !== "overview" && n.id !== "index" && n.id !== "log",
  )
  if (isolatedNodes.length > 0) {
    const topIsolated = isolatedNodes.slice(0, 5)
    gaps.push({
      type: "isolated-node",
      title: `${isolatedNodes.length} 个孤立页面`,
      description: formatNodeList(topIsolated, isolatedNodes.length),
      nodeIds: isolatedNodes.map((n) => n.id),
      suggestion: "这些页面关联较少或暂无关联。建议添加 [[双链]] 连接到相关页面，或通过深度研究补充内容。",
    })
  }

  // 2. Sparse communities (low cohesion)
  for (const comm of communities) {
    if (comm.cohesion < 0.15 && comm.nodeCount >= 3) {
      gaps.push({
        type: "sparse-community",
        title: `稀疏簇：${comm.topNodes[0] ?? `社群 ${comm.id}`}`,
        description: `${comm.nodeCount} 个页面，凝聚度 ${comm.cohesion.toFixed(2)}，内部连接偏弱。`,
        nodeIds: nodes.filter((n) => n.community === comm.id).map((n) => n.id),
        suggestion: "该知识区域缺少内部交叉引用。建议在这些页面之间添加链接，或通过研究补足设定缺口。",
      })
    }
  }

  // 3. Bridge nodes (connected to multiple communities)
  const communityNeighbors = new Map<string, Set<number>>()
  for (const node of nodes) {
    communityNeighbors.set(node.id, new Set())
  }
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (sourceNode && targetNode) {
      communityNeighbors.get(edge.source)?.add(targetNode.community)
      communityNeighbors.get(edge.target)?.add(sourceNode.community)
    }
  }

  const STRUCTURAL_IDS = new Set(["index", "log", "overview"])

  const bridgeNodes = nodes
    .filter((n) => {
      if (STRUCTURAL_IDS.has(n.id)) return false
      const neighborComms = communityNeighbors.get(n.id)
      return neighborComms && neighborComms.size >= 3
    })
    .sort((a, b) => {
      const aComms = communityNeighbors.get(a.id)?.size ?? 0
      const bComms = communityNeighbors.get(b.id)?.size ?? 0
      return bComms - aComms
    })
    .slice(0, 3)

  for (const bridge of bridgeNodes) {
    const commCount = communityNeighbors.get(bridge.id)?.size ?? 0
    gaps.push({
      type: "bridge-node",
      title: `关键桥梁：${bridge.label}`,
      description: `连接 ${commCount} 个不同知识簇，是当前图谱中的关键交汇点。`,
      nodeIds: [bridge.id],
      suggestion: "该页面连接多个知识区域。建议持续维护；如果内容较薄，扩写它会增强整个小说图谱。",
    })
  }

  return gaps.slice(0, limit)
}
