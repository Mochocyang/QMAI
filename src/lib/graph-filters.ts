import type { GraphEdge, GraphNode } from "@/lib/wiki-graph"
import { shouldHideNodeType } from "@/lib/graph-visibility"

export interface GraphFilterState {
  hiddenTypes: ReadonlySet<string>
  hiddenNodeIds: ReadonlySet<string>
  hideStructural: boolean
  hideIsolated: boolean
  maxLinks?: number
  minimumEdgeWeight?: number
  allowedNodeTypes?: ReadonlySet<string>
}

export interface FilteredGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  hiddenNodeIds: Set<string>
}

export const DEFAULT_GRAPH_FILTERS: GraphFilterState = {
  hiddenTypes: new Set(),
  hiddenNodeIds: new Set(),
  hideStructural: true,
  hideIsolated: false,
  maxLinks: undefined,
}

const STRUCTURAL_IDS = new Set(["index", "overview", "log", "schema", "purpose"])

export function isStructuralGraphNode(node: Pick<GraphNode, "id" | "path" | "type">): boolean {
  const id = node.id.toLowerCase()
  if (STRUCTURAL_IDS.has(id)) return true
  if (node.type === "overview") return true

  const normalizedPath = node.path.replace(/\\/g, "/").toLowerCase()
  return (
    normalizedPath.endsWith("/wiki/index.md") ||
    normalizedPath.endsWith("/wiki/overview.md") ||
    normalizedPath.endsWith("/wiki/log.md") ||
    normalizedPath.endsWith("/purpose.md") ||
    normalizedPath.endsWith("/schema.md")
  )
}

export function applyGraphFilters(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  filters: GraphFilterState,
): FilteredGraph {
  const hiddenNodeIds = new Set<string>()
  const hiddenByIsolation = new Set<string>()

  for (const node of nodes) {
    if (filters.hiddenNodeIds.has(node.id)) {
      hiddenNodeIds.add(node.id)
      continue
    }
    if (filters.allowedNodeTypes && !filters.allowedNodeTypes.has(node.type)) {
      hiddenNodeIds.add(node.id)
      continue
    }
    if (shouldHideNodeType(node.type, filters.hiddenTypes)) {
      hiddenNodeIds.add(node.id)
      continue
    }
    if (filters.hideStructural && isStructuralGraphNode(node)) {
      hiddenNodeIds.add(node.id)
      continue
    }
    if (filters.hideIsolated && node.linkCount <= 0) {
      hiddenNodeIds.add(node.id)
      hiddenByIsolation.add(node.id)
      continue
    }
    if (filters.maxLinks !== undefined && node.linkCount > filters.maxLinks) {
      hiddenNodeIds.add(node.id)
    }
  }

  if (filters.hideIsolated && nodes.length > 0 && hiddenByIsolation.size > 0) {
    const visibleWithoutFallback = nodes.filter((node) => !hiddenNodeIds.has(node.id))
    if (visibleWithoutFallback.length === 0) {
      for (const nodeId of hiddenByIsolation) {
        hiddenNodeIds.delete(nodeId)
      }
    }
  }

  const visibleNodes = nodes.filter((node) => !hiddenNodeIds.has(node.id))
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = edges.filter(
    (edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return false
      if (filters.minimumEdgeWeight !== undefined && edge.weight < filters.minimumEdgeWeight) return false
      return true
    },
  )

  return { nodes: visibleNodes, edges: visibleEdges, hiddenNodeIds }
}

export function hasActiveGraphFilters(filters: GraphFilterState): boolean {
  return (
    filters.hideStructural ||
    filters.hideIsolated ||
    filters.hiddenTypes.size > 0 ||
    filters.hiddenNodeIds.size > 0 ||
    filters.maxLinks !== undefined ||
    filters.minimumEdgeWeight !== undefined ||
    filters.allowedNodeTypes !== undefined
  )
}
