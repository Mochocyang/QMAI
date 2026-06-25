import { useEffect, useCallback, useMemo, useState, useRef } from "react"
import Graph from "graphology"
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from "@react-sigma/core"
import "@react-sigma/core/lib/style.css"
import type { MouseCoords, SigmaNodeEventPayload, TouchCoords } from "sigma/types"
import {
  EdgeArrowProgram,
  EdgeClampedProgram,
  EdgeLineProgram,
} from "sigma/rendering"
import EdgeCurveProgram from "@sigma/edge-curve"
import forceAtlas2 from "graphology-layout-forceatlas2"
import { Network, RefreshCw, ZoomIn, ZoomOut, Maximize, Lightbulb, AlertTriangle, Link2, X, Filter, EyeOff, FileText } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFileAtomic, createDirectory, fileExists } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type GraphEdge, type CommunityInfo } from "@/lib/wiki-graph"
import { buildEditableGraphNodePage } from "@/lib/graph-node-page"
import { findSurprisingConnections, detectKnowledgeGaps, type SurprisingConnection, type KnowledgeGap } from "@/lib/graph-insights"
import { normalizePath } from "@/lib/path-utils"
import { applyGraphFilters, DEFAULT_GRAPH_FILTERS, type GraphFilterState } from "@/lib/graph-filters"
import { groupGraphDocumentNodes, buildGraphNodeRelationSummary, buildGraphRiskReport, buildGraphRiskSummaryItemsForGroup, filterGraphDocumentNodes, filterGraphDocumentNodesByIsolation, filterGraphDocumentNodesByRelations, filterGraphDocumentNodesByRiskState, filterGraphDocumentNodesBySearch, filterNonZeroRiskSummaryItems, getGraphDocumentIsolationStats, getGraphDocumentNodeTypeOptions, getGraphDocumentQuickRiskFilters, getGraphDocumentRiskStateOptions, getGraphDocumentSortOptions, getGraphNodeRelatedEdges, getGraphNodeRiskLabel, getGraphNodeRiskStateLabel, getGraphNodeRiskStateLabelColor, getGraphNodeTypeLabel, getGraphRelationLabel, getGraphRiskSummaryItemColor, getGraphRiskSummaryTotal, getNextGraphNodeRiskStateLabel, setGraphNodeRiskStateInContent, sortGraphDocumentNodes, buildGraphMindMap, type MindMapNode } from "@/lib/graph-readable"
import { NOVEL_NODE_TYPE_LABELS, NOVEL_RELATION_LABELS } from "@/lib/novel/graph-adapter"
import { loadForeshadowingTracker, type ForeshadowingStore } from "@/lib/novel/foreshadowing-tracker"
import { GRAPH_LAYOUT_ITERATIONS, GRAPH_LAYOUT_SETTINGS, getGraphVisualSettings, type GraphVisualTier } from "@/lib/graph-layout"
import { GRAPH_MODE_LABELS, GRAPH_MODE_PRESETS, type GraphMode } from "@/lib/graph-mode"
import { useTranslation } from "react-i18next"

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",    // blue-400
  concept: "#c084fc",   // purple-400
  source: "#fb923c",    // orange-400
  query: "#4ade80",     // green-400
  synthesis: "#f87171", // red-400
  overview: "#facc15",  // yellow-400
  comparison: "#2dd4bf", // teal-400
  other: "#94a3b8",     // slate-400
  character: "#f472b6",  // pink-400
  location: "#34d399",   // emerald-400
  organization: "#a78bfa", // violet-400
  item: "#fbbf24",       // amber-400
  event: "#38bdf8",      // sky-400
  chapter: "#818cf8",    // indigo-400
  outline: "#2dd4bf",    // teal-400
  foreshadowing: "#fb923c", // orange-400
  secret: "#e879f9",     // fuchsia-400
  conflict: "#f87171",   // red-400
  "timeline-point": "#67e8f9", // cyan-300
  "canon-rule": "#a3e635", // lime-400
}

const COMMUNITY_COLORS = [
  "#60a5fa",  // blue-400
  "#4ade80",  // green-400
  "#fb923c",  // orange-400
  "#c084fc",  // purple-400
  "#f87171",  // red-400
  "#2dd4bf",  // teal-400
  "#facc15",  // yellow-400
  "#f472b6",  // pink-400
  "#a78bfa",  // violet-400
  "#38bdf8",  // sky-400
  "#34d399",  // emerald-400
  "#fbbf24",  // amber-400
]

type ColorMode = "type" | "community"
type GraphDisplayMode = "graph" | "document" | "mindmap"
type GraphLabelDisplayMode = "all" | "auto" | "focused"
type GraphEdgeStyle = "curve" | "arrow" | "line"

const GRAPH_LABEL_MODE_KEY = "lk-graph-label-display-mode"
const GRAPH_EDGE_COLOR_KEY = "lk-graph-edge-color"
const GRAPH_EDGE_STRENGTH_KEY = "lk-graph-edge-strength"
const GRAPH_EDGE_STYLE_KEY = "lk-graph-edge-style"

const FORESHADOWING_STATUS_FILL: Record<string, string> = {
  planted: "#f59e0b",
  advanced: "#3b82f6",
  resolved: "#22c55e",
}

function nodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other
}

function safeNodeLabel(node: GraphNode): string {
  const trimmed = node.label.trim()
  if (trimmed) return trimmed
  const fallback = node.id.split(":").slice(1).join(":").trim()
  return fallback || node.id
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function mixColor(color1: string, color2: string, ratio: number): string {
  const hex = (c: string) => parseInt(c, 16)
  const r1 = hex(color1.slice(1, 3)), g1 = hex(color1.slice(3, 5)), b1 = hex(color1.slice(5, 7))
  const r2 = hex(color2.slice(1, 3)), g2 = hex(color2.slice(3, 5)), b2 = hex(color2.slice(5, 7))
  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function nodeSize(linkCount: number, maxLinks: number, visualSettings: GraphVisualTier): number {
  if (maxLinks === 0) return visualSettings.baseNodeSize
  const ratio = linkCount / maxLinks
  return visualSettings.baseNodeSize + Math.sqrt(ratio) * (visualSettings.maxNodeSize - visualSettings.baseNodeSize)
}

function edgeTypeForStyle(edgeStyle: GraphEdgeStyle): string {
  if (edgeStyle === "curve") return "curve"
  if (edgeStyle === "arrow") return "arrow"
  return "clamped"
}

// --- Inner components ---

// Cache computed node positions so re-renders don't re-layout
const positionCache = new Map<string, { x: number; y: number }>()
let lastLayoutDataKey = ""

function initialGraphPosition(node: GraphNode, index: number, total: number): { x: number; y: number } {
  const community = Number.isFinite(node.community) ? node.community : 0
  const communityAngle = community * 2.399963229728653
  const communityRadius = 25 + community * 6
  const centerX = Math.cos(communityAngle) * communityRadius
  const centerY = Math.sin(communityAngle) * communityRadius
  const nodeAngle = ((index / Math.max(total, 1)) * Math.PI * 2) + communityAngle
  const nodeRadius = 8 + (index % 11) * 2.5
  return {
    x: centerX + Math.cos(nodeAngle) * nodeRadius,
    y: centerY + Math.sin(nodeAngle) * nodeRadius,
  }
}

function shouldShowNodeLabel(node: GraphNode, maxLinks: number, mode: GraphMode, labelDisplayMode: GraphLabelDisplayMode): boolean {
  if (labelDisplayMode === "all") return true
  if (labelDisplayMode === "focused") {
    return node.linkCount >= Math.max(2, Math.ceil(maxLinks * 0.35))
  }
  const preset = GRAPH_MODE_PRESETS[mode]
  if (preset.labelVisibility === "all") return true
  if (preset.labelVisibility === "minimal") {
    return node.linkCount >= Math.max(2, Math.ceil(maxLinks * 0.35))
  }
  return node.linkCount >= Math.max(1, Math.ceil(maxLinks * 0.2))
}

function GraphLoader({
  nodes,
  edges,
  colorMode,
  novelMode,
  graphMode,
  labelDisplayMode,
  edgeColorHex,
  edgeStrengthPercent,
  edgeLabelsAlwaysVisible,
  visualSettings,
  foreshadowingStatusMap,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  colorMode: ColorMode
  novelMode: boolean
  graphMode: GraphMode
  labelDisplayMode: GraphLabelDisplayMode
  edgeColorHex: string
  edgeStrengthPercent: number
  edgeLabelsAlwaysVisible: boolean
  visualSettings: GraphVisualTier
  foreshadowingStatusMap: Map<string, string>
}) {
  const loadGraph = useLoadGraph()

  useEffect(() => {
    const dataKey = nodes.map((n) => `${n.id}:${n.community}:${n.linkCount}`).sort().join(",") + "|" + edges.map((edge) => `${edge.source}->${edge.target}:${edge.weight}`).sort().join(",")
    const needsLayout = dataKey !== lastLayoutDataKey

    const graph = new Graph()
    const maxLinks = Math.max(...nodes.map((n) => n.linkCount), 1)

    for (const [index, node] of nodes.entries()) {
      const cached = positionCache.get(node.id)
      const initialPosition = initialGraphPosition(node, index, nodes.length)
      let assignedColor = colorMode === "community"
        ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
        : nodeColor(node.type)
      if (graphMode === "foreshadowing" && node.type === "foreshadowing") {
        const status = foreshadowingStatusMap.get(node.label)
        if (status && FORESHADOWING_STATUS_FILL[status]) {
          assignedColor = FORESHADOWING_STATUS_FILL[status]
        }
      }
      graph.addNode(node.id, {
        x: cached?.x ?? initialPosition.x,
        y: cached?.y ?? initialPosition.y,
        size: nodeSize(node.linkCount, maxLinks, visualSettings),
        color: assignedColor,
        label: shouldShowNodeLabel(node, maxLinks, graphMode, labelDisplayMode) ? safeNodeLabel(node) : "",
        nodeType: node.type,
        nodePath: node.path,
        community: node.community,
      })
    }

    // Calculate max weight for normalization
    const maxWeight = Math.max(...edges.map((e) => e.weight), 1)

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        const edgeKey = `${edge.source}->${edge.target}`
        if (!graph.hasEdge(edgeKey) && !graph.hasEdge(`${edge.target}->${edge.source}`)) {
          const normalizedWeight = edge.weight / maxWeight
          const strengthScale = edgeStrengthPercent / 100
          const size = (visualSettings.minEdgeSize + normalizedWeight * (visualSettings.maxEdgeSize - visualSettings.minEdgeSize)) * strengthScale
          const baseAlpha = visualSettings.minEdgeAlpha + normalizedWeight * (visualSettings.maxEdgeAlpha - visualSettings.minEdgeAlpha)
          const alpha = Math.max(0.14, Math.min(0.95, baseAlpha * strengthScale))
          const color = hexToRgba(edgeColorHex, alpha)
          const relationLabel = edgeLabelsAlwaysVisible && novelMode && edge.relation
            ? NOVEL_RELATION_LABELS[edge.relation as keyof typeof NOVEL_RELATION_LABELS] ?? edge.relation
            : undefined
          graph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
            color,
            size,
            weight: edge.weight,
            relation: edge.relation ?? "",
            label: relationLabel,
            curvature: 0.25,
          })
        }
      }
    }

    // Only run expensive ForceAtlas2 layout when data actually changed
    if (needsLayout && nodes.length > 1) {
      const settings = forceAtlas2.inferSettings(graph)
      forceAtlas2.assign(graph, {
        iterations: GRAPH_LAYOUT_ITERATIONS,
        settings: {
          ...settings,
          ...GRAPH_LAYOUT_SETTINGS,
          barnesHutOptimize: nodes.length > 50,
        },
      })
      lastLayoutDataKey = dataKey

      // Cache computed positions
      graph.forEachNode((nodeId, attrs) => {
        positionCache.set(nodeId, { x: attrs.x, y: attrs.y })
      })
    }

    loadGraph(graph)
  }, [loadGraph, nodes, edges, colorMode, novelMode, graphMode, labelDisplayMode, edgeColorHex, edgeStrengthPercent, edgeLabelsAlwaysVisible, visualSettings, foreshadowingStatusMap])

  return null
}

function HighlightManager({ highlightedNodes }: { highlightedNodes: Set<string> }) {
  const sigma = useSigma()

  useEffect(() => {
    const graph = sigma.getGraph()
    if (highlightedNodes.size === 0) {
      graph.forEachNode((n) => {
        graph.removeNodeAttribute(n, "insightHighlight")
        graph.removeNodeAttribute(n, "dimmed")
      })
      graph.forEachEdge((e) => {
        graph.removeEdgeAttribute(e, "dimmed")
        graph.removeEdgeAttribute(e, "highlighted")
      })
    } else {
      graph.forEachNode((n) => {
        if (highlightedNodes.has(n)) {
          graph.setNodeAttribute(n, "insightHighlight", true)
          graph.removeNodeAttribute(n, "dimmed")
        } else {
          graph.setNodeAttribute(n, "dimmed", true)
          graph.removeNodeAttribute(n, "insightHighlight")
        }
      })
      graph.forEachEdge((e, _attrs, source, target) => {
        if (highlightedNodes.has(source) && highlightedNodes.has(target)) {
          graph.setEdgeAttribute(e, "highlighted", true)
          graph.removeEdgeAttribute(e, "dimmed")
        } else {
          graph.setEdgeAttribute(e, "dimmed", true)
          graph.removeEdgeAttribute(e, "highlighted")
        }
      })
    }
    sigma.refresh()
  }, [sigma, highlightedNodes])

  return null
}

function EventHandler({
  onNodeClick,
  onNodeContextMenu,
}: {
  onNodeClick: (nodeId: string) => void
  onNodeContextMenu: (nodeId: string, x: number, y: number) => void
}) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const draggedNodeRef = useRef<string | null>(null)
  const draggedMovedRef = useRef(false)

  const moveDraggedNode = useCallback((coordinates: MouseCoords | { x: number; y: number }) => {
    const node = draggedNodeRef.current
    if (!node) return
    const graph = sigma.getGraph()
    if (!graph.hasNode(node)) return

    const nextPosition = sigma.viewportToGraph({ x: coordinates.x, y: coordinates.y })
    graph.setNodeAttribute(node, "x", nextPosition.x)
    graph.setNodeAttribute(node, "y", nextPosition.y)
    graph.setNodeAttribute(node, "dragging", true)
    positionCache.set(node, nextPosition)
    draggedMovedRef.current = true
    sigma.refresh()
  }, [sigma])

  const releaseDraggedNode = useCallback(() => {
    const node = draggedNodeRef.current
    if (!node) return
    const graph = sigma.getGraph()
    if (graph.hasNode(node)) {
      graph.removeNodeAttribute(node, "dragging")
    }
    draggedNodeRef.current = null
    sigma.setSetting("enableCameraPanning", true)
    sigma.getContainer().style.cursor = "default"
    sigma.refresh()
  }, [sigma])

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        if (draggedMovedRef.current) {
          draggedMovedRef.current = false
          return
        }
        onNodeClick(node)
      },
      downNode: (payload: SigmaNodeEventPayload) => {
        // 只响应左键，右键只用于打开菜单，不触发拖拽
        if ((payload.event.original as MouseEvent).button !== 0) return
        const node = nodeIdFromPayload(payload)
        payload.preventSigmaDefault()
        payload.event.original.preventDefault()
        draggedNodeRef.current = node
        draggedMovedRef.current = false
        sigma.getGraph().setNodeAttribute(node, "dragging", true)
        sigma.setSetting("enableCameraPanning", false)
        sigma.getContainer().style.cursor = "grabbing"
      },
      mousemovebody: (coordinates: MouseCoords) => moveDraggedNode(coordinates),
      mouseup: releaseDraggedNode,
      touchmovebody: (coordinates: TouchCoords) => {
        const touch = coordinates.touches[0] ?? coordinates.previousTouches[0]
        if (touch) moveDraggedNode(touch)
      },
      touchup: releaseDraggedNode,
      rightClickNode: (payload: SigmaNodeEventPayload) => {
        payload.preventSigmaDefault()
        payload.event.original.preventDefault()
        const point = clientPointFromEvent(payload.event.original)
        onNodeContextMenu(nodeIdFromPayload(payload), point.x, point.y)
      },
      rightClickStage: () => onNodeContextMenu("", 0, 0),
      enterNode: ({ node }) => {
        const container = sigma.getContainer()
        container.style.cursor = "pointer"
        const graph = sigma.getGraph()
        graph.setNodeAttribute(node, "hovering", true)
        const neighbors = new Set(graph.neighbors(node))
        neighbors.add(node)
        graph.forEachNode((n) => {
          if (!neighbors.has(n)) graph.setNodeAttribute(n, "dimmed", true)
        })
        graph.forEachEdge((e, _attrs, source, target) => {
          if (source !== node && target !== node) {
            graph.setEdgeAttribute(e, "dimmed", true)
          } else {
            graph.setEdgeAttribute(e, "highlighted", true)
          }
        })
        sigma.refresh()
      },
      leaveNode: () => {
        if (draggedNodeRef.current) return
        const container = sigma.getContainer()
        container.style.cursor = "default"
        const graph = sigma.getGraph()
        graph.forEachNode((n) => {
          graph.removeNodeAttribute(n, "hovering")
          graph.removeNodeAttribute(n, "dimmed")
        })
        graph.forEachEdge((e) => {
          graph.removeEdgeAttribute(e, "dimmed")
          graph.removeEdgeAttribute(e, "highlighted")
        })
        sigma.refresh()
      },
    })
  }, [registerEvents, sigma, onNodeClick, onNodeContextMenu, moveDraggedNode, releaseDraggedNode])

  return null
}

function nodeIdFromPayload(payload: SigmaNodeEventPayload): string {
  return payload.node
}

function clientPointFromEvent(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY }
  const touch = event.touches[0] ?? event.changedTouches[0]
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
}

function MindMapBranch({ node, level = 0 }: { node: MindMapNode; level?: number }) {
  return (
    <div className={level === 0 ? "space-y-2" : "ml-4 border-l border-border pl-3"}>
      <div className="rounded border bg-background px-3 py-2 text-sm shadow-sm">
        {node.label}
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <MindMapBranch key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function graphDocumentNodeDomId(nodeId: string): string {
  return `graph-doc-node-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

function graphNodeLabel(nodes: GraphNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id
}

function graphDocumentButtonClass(active: boolean): string {
  return active
    ? "border-primary bg-primary text-primary-foreground shadow-sm"
    : "border-border bg-background text-foreground hover:bg-muted"
}

function DocumentGraphView({
  nodes,
  edges,
  editingNode,
  editingPath,
  editingContent,
  editStatus,
  savingNode,
  onEditNode,
  onChangeEditingContent,
  onSaveNodeEdit,
  onCancelNodeEdit,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  editingNode: GraphNode | null
  editingPath: string
  editingContent: string
  editStatus: string | null
  savingNode: boolean
  onEditNode: (node: GraphNode) => void
  onChangeEditingContent: (content: string) => void
  onSaveNodeEdit: () => void
  onCancelNodeEdit: () => void
}) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupGraphDocumentNodes(nodes), [nodes])
  const [activeGroupTitle, setActiveGroupTitle] = useState(groups[0]?.title ?? "")
  const [selectedNodeType, setSelectedNodeType] = useState("all")
  const [selectedRiskState, setSelectedRiskState] = useState("all")
  const [activeQuickRiskFilterKey, setActiveQuickRiskFilterKey] = useState("")
  const [documentSortMode, setDocumentSortMode] = useState<"default" | "links-desc" | "links-asc" | "title">("default")
  const [documentSearchQuery, setDocumentSearchQuery] = useState("")
  const [hideUnrelatedNodes, setHideUnrelatedNodes] = useState(false)
  const [showOnlyIsolatedNodes, setShowOnlyIsolatedNodes] = useState(false)
  const [riskStateOverrides, setRiskStateOverrides] = useState<Record<string, string>>({})
  const [riskStateHistory, setRiskStateHistory] = useState<Array<{ nodeId: string; from: string; to: string; timestamp: number }>>([])
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
  const activeGroup = groups.find((group) => group.title === activeGroupTitle) ?? groups[0]
  const nodeTypeOptions = useMemo(() => getGraphDocumentNodeTypeOptions(activeGroup?.nodes ?? []), [activeGroup])
  const riskStateOptions = useMemo(() => getGraphDocumentRiskStateOptions(activeGroup?.nodes ?? [], riskStateOverrides), [activeGroup, riskStateOverrides])
  const sortOptions = useMemo(() => getGraphDocumentSortOptions(), [])
  const quickRiskFilters = useMemo(() => getGraphDocumentQuickRiskFilters(), [])
  const riskSummaryItems = useMemo(() => buildGraphRiskSummaryItemsForGroup(activeGroup?.nodes ?? [], riskStateOverrides), [activeGroup, riskStateOverrides])
  const filteredRiskSummaryItems = useMemo(() => filterNonZeroRiskSummaryItems(riskSummaryItems), [riskSummaryItems])
  const totalRiskCount = useMemo(() => getGraphRiskSummaryTotal(riskSummaryItems), [riskSummaryItems])
  const isolationStats = useMemo(() => getGraphDocumentIsolationStats(activeGroup?.nodes ?? [], edges), [activeGroup, edges])
  const visibleNodes = useMemo(() => {
    const byType = filterGraphDocumentNodes(activeGroup?.nodes ?? [], selectedNodeType)
    const byRiskState = filterGraphDocumentNodesByRiskState(byType, riskStateOverrides, selectedRiskState)
    const bySearch = filterGraphDocumentNodesBySearch(byRiskState, documentSearchQuery)
    const byRelations = filterGraphDocumentNodesByRelations(bySearch, edges, hideUnrelatedNodes)
    const byIsolation = filterGraphDocumentNodesByIsolation(byRelations, edges, showOnlyIsolatedNodes)
    return sortGraphDocumentNodes(byIsolation, documentSortMode)
  }, [activeGroup, documentSearchQuery, documentSortMode, edges, hideUnrelatedNodes, riskStateOverrides, selectedNodeType, selectedRiskState, showOnlyIsolatedNodes])
  const activeGroupIndex = groups.findIndex((group) => group.title === activeGroup?.title)

  useEffect(() => {
    if (groups.length === 0) return
    if (!groups.some((group) => group.title === activeGroupTitle)) {
      setActiveGroupTitle(groups[0]?.title ?? "")
    }
  }, [activeGroupTitle, groups])

  useEffect(() => {
    if (!nodeTypeOptions.some((option) => option.value === selectedNodeType)) {
      setSelectedNodeType("all")
    }
  }, [nodeTypeOptions, selectedNodeType])

  useEffect(() => {
    if (!riskStateOptions.some((option) => option.value === selectedRiskState)) {
      setSelectedRiskState("all")
    }
  }, [riskStateOptions, selectedRiskState])

  useEffect(() => {
    if (!editingNode) return
    setExpandedNodeIds((current) => new Set(current).add(editingNode.id))
    document.getElementById(graphDocumentNodeDomId(editingNode.id))?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [editingNode])

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const expandAllVisibleNodes = useCallback(() => {
    setExpandedNodeIds(new Set(visibleNodes.map((node) => node.id)))
  }, [visibleNodes])

  const collapseAllVisibleNodes = useCallback(() => {
    setExpandedNodeIds((current) => {
      const next = new Set(current)
      for (const node of visibleNodes) next.delete(node.id)
      return next
    })
  }, [visibleNodes])

  const cycleRiskStateLabel = useCallback((node: GraphNode) => {
    setRiskStateOverrides((current) => {
      const currentLabel = current[node.id] ?? getGraphNodeRiskStateLabel(node.type)
      const nextLabel = getNextGraphNodeRiskStateLabel(node.type, currentLabel)
      if (!nextLabel) return current
      setRiskStateHistory((history) => [...history, { nodeId: node.id, from: currentLabel, to: nextLabel, timestamp: Date.now() }])
      return { ...current, [node.id]: nextLabel }
    })
    if (editingNode?.id === node.id) {
      const currentLabel = riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)
      const nextLabel = getNextGraphNodeRiskStateLabel(node.type, currentLabel)
      if (nextLabel) {
        onChangeEditingContent(setGraphNodeRiskStateInContent(editingContent, nextLabel))
      }
    }
  }, [editingContent, editingNode, onChangeEditingContent, riskStateOverrides])

  const applyQuickRiskFilter = useCallback((filterKey: string, nodeType: string, riskState: string) => {
    setActiveQuickRiskFilterKey((current) => {
      if (current === filterKey) {
        setSelectedNodeType("all")
        setSelectedRiskState("all")
        return ""
      }
      setSelectedNodeType(nodeType)
      setSelectedRiskState(riskState)
      return filterKey
    })
  }, [])

  const clearQuickRiskFilter = useCallback(() => {
    setActiveQuickRiskFilterKey("")
    setSelectedNodeType("all")
    setSelectedRiskState("all")
  }, [])

  const handleExportRiskReport = useCallback(async () => {
    const projectPath = useWikiStore.getState().project?.path
    if (!projectPath) return
    const report = buildGraphRiskReport(nodes, riskStateOverrides)
    const reportPath = normalizePath(`${projectPath}/wiki/risk-report.md`)
    await writeFileAtomic(reportPath, report)
  }, [nodes, riskStateOverrides])

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <h1 className="text-xl font-semibold">小说图谱文档</h1>
          <p className="mt-2 text-sm text-muted-foreground">本文档由当前小说档案页自动生成；需要长期生效的修改，可在对应节点段落内直接编辑真实档案页。</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              当前分类风险统计
              {totalRiskCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">（共 {totalRiskCount} 项待处理）</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeQuickRiskFilterKey && (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={clearQuickRiskFilter}
                >
                  清除筛选
                </button>
              )}
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={handleExportRiskReport}
              >
                导出报告
              </button>
            </div>
          </div>
          {filteredRiskSummaryItems.length === 0 ? (
            <div className="mt-3 text-sm text-muted-foreground">当前分类暂无待处理风险项。</div>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {filteredRiskSummaryItems.map((item) => {
                const color = getGraphRiskSummaryItemColor(item)
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`rounded-md border p-3 text-left transition-colors ${color.bg} ${color.border} ${graphDocumentButtonClass(activeQuickRiskFilterKey === item.key)}`}
                    onClick={() => applyQuickRiskFilter(item.key, item.nodeType, item.riskState)}
                  >
                    <div className={`text-xs ${color.text}`}>{item.label}</div>
                    <div className={`mt-1 text-lg font-semibold ${color.text}`}>{item.count}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <button
                key={group.title}
                type="button"
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${graphDocumentButtonClass(group.title === activeGroup?.title)}`}
                onClick={() => {
                  setActiveGroupTitle(group.title)
                  setSelectedNodeType("all")
                  setSelectedRiskState("all")
                  setActiveQuickRiskFilterKey("")
                  setShowOnlyIsolatedNodes(false)
                }}
              >
                {group.title} {group.nodes.length}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">节点类型</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={selectedNodeType}
              onChange={(event) => setSelectedNodeType(event.target.value)}
            >
              {nodeTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className="text-muted-foreground">状态</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={selectedRiskState}
              onChange={(event) => setSelectedRiskState(event.target.value)}
            >
              {riskStateOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className="text-muted-foreground">排序方式</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={documentSortMode}
              onChange={(event) => setDocumentSortMode(event.target.value as "default" | "links-desc" | "links-asc" | "title")}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              className="h-8 min-w-56 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={documentSearchQuery}
              onChange={(event) => setDocumentSearchQuery(event.target.value)}
              placeholder="搜索节点标题或来源路径"
            />
            <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={hideUnrelatedNodes}
                onChange={(event) => {
                  setHideUnrelatedNodes(event.target.checked)
                  if (event.target.checked) setShowOnlyIsolatedNodes(false)
                }}
              />
              隐藏无关系节点
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>当前显示 {visibleNodes.length} / {activeGroup?.nodes.length ?? 0} 个节点</span>
            <span>·</span>
            <span>孤立节点 {isolationStats.isolated} 个</span>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
              onClick={expandAllVisibleNodes}
              disabled={visibleNodes.length === 0}
            >
              全部展开
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
              onClick={collapseAllVisibleNodes}
              disabled={visibleNodes.length === 0}
            >
              全部收起
            </button>
            <button
              type="button"
              className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${graphDocumentButtonClass(showOnlyIsolatedNodes)}`}
              disabled={isolationStats.isolated === 0}
              onClick={() => {
                setShowOnlyIsolatedNodes((current) => !current)
                setHideUnrelatedNodes(false)
              }}
            >
              只看孤立节点
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">风险快捷筛选</span>
            {quickRiskFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${graphDocumentButtonClass(activeQuickRiskFilterKey === filter.key)}`}
                onClick={() => applyQuickRiskFilter(filter.key, filter.nodeType, filter.riskState)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        {activeGroup && (
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">{activeGroupIndex + 1}. {activeGroup.title}</h2>
            {visibleNodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{showOnlyIsolatedNodes ? "当前分类暂无孤立节点。" : "当前筛选下暂无节点。"}</p>
            ) : (
              <div className="space-y-3">
                {visibleNodes.map((node, nodeIndex) => {
                  const nodeEdges = getGraphNodeRelatedEdges(edges, node.id)
                  const eventEdges = nodeEdges.filter((edge) => {
                    const otherId = edge.source === node.id ? edge.target : edge.source
                    const otherNode = nodes.find((item) => item.id === otherId)
                    return otherNode?.type === "event" || otherNode?.type === "chapter" || otherNode?.type === "outline"
                  })
                  const riskLabel = getGraphNodeRiskLabel(node.type)
                  const riskStateLabel = riskStateOverrides[node.id] ?? getGraphNodeRiskStateLabel(node.type)
                  const isEditing = editingNode?.id === node.id
                  const isExpanded = expandedNodeIds.has(node.id) || isEditing
                  const relationSummary = buildGraphNodeRelationSummary(node, nodes, edges)
                  const isDangerNode = riskStateLabel === "疑似冲突" || riskStateLabel === "疑似矛盾"
                  return (
                    <article key={node.id} id={graphDocumentNodeDomId(node.id)} className={`scroll-mt-4 rounded-md border bg-background p-4 ${isDangerNode ? "border-l-4 border-l-red-500 bg-red-500/[0.03]" : ""}`}>
                      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => toggleNode(node.id)}>
                        <div>
                          <h3 className="break-words text-base font-semibold">{activeGroupIndex + 1}.{nodeIndex + 1} {node.label}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{getGraphNodeTypeLabel(node.type)} · {t("graph.contextNodeLinks", { count: node.linkCount })}</span>
                            {riskLabel && <span className="rounded border border-amber-300 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300">{riskLabel}</span>}
                            {riskStateLabel && (() => {
                            const labelColor = getGraphNodeRiskStateLabelColor(riskStateLabel)
                            return (
                              <button
                                type="button"
                                className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${labelColor.bg} ${labelColor.border} ${labelColor.text}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  cycleRiskStateLabel(node)
                                }}
                              >
                                {riskStateLabel}
                              </button>
                            )
                          })()}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground">{isExpanded ? "收起" : "展开"}</span>
                      </button>

                      {isExpanded && (
                        <>
                          <div className="mt-4 flex justify-end">
                            <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={() => onEditNode(node)}>
                              {t("graph.editProfileInline")}
                            </Button>
                          </div>

                          <div className="mt-4 space-y-3 text-sm">
                            <div>
                              <div className="mb-2 font-medium">关系摘要</div>
                              {relationSummary.length === 0 ? (
                                <p className="text-muted-foreground">暂无可用于写作参考的关系摘要。</p>
                              ) : (
                                <div className="space-y-2">
                                  {relationSummary.map((summary) => (
                                    <div key={summary.title} className="rounded-md border bg-muted/20 px-3 py-2">
                                      <div className="text-xs font-medium text-muted-foreground">{summary.title}</div>
                                      <div className="mt-1 text-sm">{summary.items.join("、")}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="mb-1 font-medium">相关事件</div>
                              {eventEdges.length === 0 ? (
                                <p className="text-muted-foreground">{t("graph.noRelatedEvents")}</p>
                              ) : (
                                <ul className="space-y-1 text-muted-foreground">
                                  {eventEdges.slice(0, 8).map((edge, index) => {
                                    const otherId = edge.source === node.id ? edge.target : edge.source
                                    return <li key={`${edge.source}-${edge.target}-${index}`}>{graphNodeLabel(nodes, otherId)}：{getGraphRelationLabel(edge.relation)}</li>
                                  })}
                                </ul>
                              )}
                            </div>

                            {(() => {
                              const nodeHistory = riskStateHistory.filter((h) => h.nodeId === node.id)
                              if (nodeHistory.length === 0) return null
                              return (
                                <div>
                                  <div className="mb-1 font-medium">状态变更记录</div>
                                  <ul className="space-y-1 text-muted-foreground text-xs">
                                    {nodeHistory.slice(-10).reverse().map((entry, index) => {
                                      const time = new Date(entry.timestamp)
                                      const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`
                                      return (
                                        <li key={index}>
                                          <span className="text-muted-foreground/60">{timeStr}</span>{" "}
                                          {entry.from} → {entry.to}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                </div>
                              )
                            })()}

                            <details className="rounded-md border bg-muted/20 p-3">
                              <summary className="cursor-pointer text-sm font-medium">技术信息</summary>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <div className="mb-1 font-medium">基础信息</div>
                                  <ul className="space-y-1 text-muted-foreground">
                                    <li>节点类型：{getGraphNodeTypeLabel(node.type)}</li>
                                    <li>关联数量：{node.linkCount}</li>
                                    <li>来源路径：{node.path || "暂无"}</li>
                                  </ul>
                                </div>
                                <div>
                                  <div className="mb-1 font-medium">关系网络</div>
                                  {nodeEdges.length === 0 ? (
                                    <p className="text-muted-foreground">{t("graph.noRelations")}</p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full border-collapse text-xs">
                                        <thead>
                                          <tr className="border-b text-left text-muted-foreground">
                                            <th className="py-1 pr-3">关联对象</th>
                                            <th className="py-1 pr-3">关系</th>
                                            <th className="py-1 pr-3">方向</th>
                                            <th className="py-1">权重</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {nodeEdges.slice(0, 12).map((edge, index) => {
                                            const isSource = edge.source === node.id
                                            const otherId = isSource ? edge.target : edge.source
                                            return (
                                              <tr key={`${edge.source}-${edge.target}-${index}`} className="border-b last:border-0">
                                                <td className="py-1 pr-3">{graphNodeLabel(nodes, otherId)}</td>
                                                <td className="py-1 pr-3">{getGraphRelationLabel(edge.relation)}</td>
                                                <td className="py-1 pr-3">{isSource ? "指向对方" : "来自对方"}</td>
                                                <td className="py-1">{edge.weight}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </details>
                          </div>

                          {isEditing && (
                            <div className="mt-4 rounded-md border bg-muted/30 p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium">{t("graph.editingProfileFor", { label: node.label })}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">{t("graph.profilePath")}：{editingPath}</div>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancelNodeEdit}>
                                  {t("graph.cancelProfileInline")}
                                </Button>
                              </div>
                              <textarea
                                className="h-72 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                                value={editingContent}
                                onChange={(event) => onChangeEditingContent(event.target.value)}
                              />
                              <div className="mt-2 flex items-center justify-between gap-3">
                                <div className="text-xs text-muted-foreground">{editStatus ?? t("graph.editNodeStatusDefault")}</div>
                                <Button size="sm" className="h-8 text-xs" onClick={onSaveNodeEdit} disabled={savingNode}>
                                  {savingNode ? t("graph.savingNode") : t("graph.saveProfileInline")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function MindMapGraphView({ mindMap }: { mindMap: MindMapNode[] }) {
  return (
    <div className="h-full overflow-auto bg-slate-50 p-6 dark:bg-slate-950">
      <div className="min-w-[720px] space-y-3">
        {mindMap.map((node) => (
          <MindMapBranch key={node.id} node={node} />
        ))}
      </div>
    </div>
  )
}

function ZoomControls() {
  const sigma = useSigma()

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedZoom({ duration: 200 })
        }}
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedUnzoom({ duration: 200 })
        }}
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedReset({ duration: 300 })
        }}
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// --- Main component ---

export function GraphView() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [surprisingConns, setSurprisingConns] = useState<SurprisingConnection[]>([])
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredType, setHoveredType] = useState<string | null>(null)
  const colorMode = useWikiStore((s) => s.graphColorMode) as ColorMode
  const displayMode = useWikiStore((s) => s.graphDisplayMode) as GraphDisplayMode
  const graphMode = useWikiStore((s) => s.graphMode) as GraphMode
  const labelDisplayMode = useWikiStore((s) => s.graphLabelDisplayMode) as GraphLabelDisplayMode
  const edgeColorHex = useWikiStore((s) => s.graphEdgeColorHex)
  const edgeStrengthPercent = useWikiStore((s) => s.graphEdgeStrengthPercent)
  const edgeStyle = useWikiStore((s) => s.graphEdgeStyle) as GraphEdgeStyle
  const edgeLabelsAlwaysVisible = useWikiStore((s) => s.graphEdgeLabelsAlwaysVisible)
  const showFilters = useWikiStore((s) => s.graphShowFilters)
  const setGraphStats = useWikiStore((s) => s.setGraphStats)
  const setRefreshGraph = useWikiStore((s) => s.setRefreshGraph)
  const [showInsights, setShowInsights] = useState(false)
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set())
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(new Set())
  const [sigmaKey, setSigmaKey] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const [filters, setFilters] = useState<GraphFilterState>(() => ({
    ...DEFAULT_GRAPH_FILTERS,
    hiddenTypes: new Set(),
    hiddenNodeIds: new Set(),
  }))
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null)
  const [editingPath, setEditingPath] = useState("")
  const [editingContent, setEditingContent] = useState("")
  const [editStatus, setEditStatus] = useState<string | null>(null)
  const [savingNode, setSavingNode] = useState(false)
  const graphContainerRef = useRef<HTMLDivElement>(null)
  // i18n node type labels (populated after mount to support language switching)
  const [nodeTypeLabels, setNodeTypeLabels] = useState<Record<string, string>>({})

  const [foreshadowingStore, setForeshadowingStore] = useState<ForeshadowingStore | null>(null)

  useEffect(() => {
    if (!project) return
    loadForeshadowingTracker(project.path)
      .then(setForeshadowingStore)
      .catch(() => setForeshadowingStore(null))
  }, [project])

  useEffect(() => {
    localStorage.setItem(GRAPH_LABEL_MODE_KEY, labelDisplayMode)
  }, [labelDisplayMode])

  useEffect(() => {
    localStorage.setItem(GRAPH_EDGE_COLOR_KEY, edgeColorHex)
  }, [edgeColorHex])

  useEffect(() => {
    localStorage.setItem(GRAPH_EDGE_STRENGTH_KEY, String(edgeStrengthPercent))
  }, [edgeStrengthPercent])

  useEffect(() => {
    localStorage.setItem(GRAPH_EDGE_STYLE_KEY, edgeStyle)
  }, [edgeStyle])

  const lastLoadedVersion = useRef(-1)

  const loadGraph = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const result = await buildWikiGraph(normalizePath(project.path))
      setNodes(result.nodes)
      setEdges(result.edges)
      setCommunities(result.communities)
      setSurprisingConns(findSurprisingConnections(result.nodes, result.edges, result.communities))
      setKnowledgeGaps(detectKnowledgeGaps(result.nodes, result.edges, result.communities))
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      const message = err instanceof Error ? err.message : t("graph.buildFailed")
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    setRefreshGraph(() => loadGraph)
    return () => setRefreshGraph(null)
  }, [loadGraph, setRefreshGraph])

  // Initialize node type labels when i18n is ready
  useEffect(() => {
    if (novelMode) {
      setNodeTypeLabels({
        entity: t("graph.nodeTypeLabels.entity"),
        concept: t("novel.graph.nodeTypeLabels.concept"),
        source: t("graph.nodeTypeLabels.source"),
        query: t("graph.nodeTypeLabels.query"),
        synthesis: t("graph.nodeTypeLabels.synthesis"),
        overview: t("graph.nodeTypeLabels.overview"),
        comparison: t("graph.nodeTypeLabels.comparison"),
        other: t("graph.nodeTypeLabels.other"),
        character: t("novel.graph.nodeTypeLabels.character"),
        location: t("novel.graph.nodeTypeLabels.location"),
        organization: t("novel.graph.nodeTypeLabels.organization"),
        item: t("novel.graph.nodeTypeLabels.item"),
        event: t("novel.graph.nodeTypeLabels.event"),
        chapter: t("novel.graph.nodeTypeLabels.chapter"),
        outline: t("novel.graph.nodeTypeLabels.outline"),
        foreshadowing: t("novel.graph.nodeTypeLabels.foreshadowing"),
        secret: t("novel.graph.nodeTypeLabels.secret"),
        conflict: t("novel.graph.nodeTypeLabels.conflict"),
        "timeline-point": t("novel.graph.nodeTypeLabels.timeline-point"),
        "canon-rule": t("novel.graph.nodeTypeLabels.canon-rule"),
      })
    } else {
      setNodeTypeLabels({
        entity: t("graph.nodeTypeLabels.entity"),
        concept: t("graph.nodeTypeLabels.concept"),
        source: t("graph.nodeTypeLabels.source"),
        query: t("graph.nodeTypeLabels.query"),
        synthesis: t("graph.nodeTypeLabels.synthesis"),
        overview: t("graph.nodeTypeLabels.overview"),
        comparison: t("graph.nodeTypeLabels.comparison"),
        other: t("graph.nodeTypeLabels.other"),
      })
    }
  }, [t, novelMode])

  useEffect(() => {
    if (dataVersion !== lastLoadedVersion.current) {
      loadGraph()
    }
  }, [loadGraph, dataVersion])

  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      try {
        const content = await readFile(node.path)
        setSelectedFile(node.path)
        setFileContent(content)
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    },
    [nodes, setSelectedFile, setFileContent],
  )

  const handleEditNode = useCallback(
    async (node: GraphNode) => {
      if (!project) return
      const page = buildEditableGraphNodePage(project.path, node)
      let content = page.content
      try {
        if (await fileExists(page.path)) {
          content = await readFile(page.path)
        }
      } catch {
        content = page.content
      }
      setEditingNode(node)
      setEditingPath(page.path)
      setEditingContent(content)
      setEditStatus(null)
      setNodeMenu(null)
    },
    [project],
  )

  const handleOpenNodeProfilePage = useCallback(
    async (node: GraphNode) => {
      if (!project) return
      const page = buildEditableGraphNodePage(project.path, node)
      let content = page.content
      let created = false
      try {
        if (await fileExists(page.path)) {
          content = await readFile(page.path)
        } else {
          const dir = page.path.split(/[/\\]/).slice(0, -1).join("/")
          if (dir) await createDirectory(dir)
          await writeFileAtomic(page.path, content)
          created = true
        }
        setSelectedFile(page.path)
        setFileContent(content)
        setActiveView("sources")
        setNodeMenu(null)
        if (created) bumpDataVersion()
      } catch (err) {
        console.error("Failed to open graph node profile page:", err)
      }
    },
    [project, setSelectedFile, setFileContent, setActiveView, bumpDataVersion],
  )

  const handleSaveNodeEdit = useCallback(async () => {
    if (!project || !editingNode || !editingPath) return
    setSavingNode(true)
    setEditStatus(null)
    try {
      const dir = editingPath.split(/[/\\]/).slice(0, -1).join("/")
      if (dir) await createDirectory(dir)
      await writeFileAtomic(editingPath, editingContent)
      const page = buildEditableGraphNodePage(project.path, editingNode)
      const embCfg = useWikiStore.getState().embeddingConfig
      if (embCfg.enabled && embCfg.model) {
        const { embedPage } = await import("@/lib/embedding")
        await embedPage(project.path, page.pageId, page.title, editingContent, embCfg)
      }
      setSelectedFile(editingPath)
      setFileContent(editingContent)
      bumpDataVersion()
      setEditStatus(embCfg.enabled && embCfg.model ? t("graph.savedRealProfileWithEmbedding") : t("graph.savedRealProfile"))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("graph.saveNodeFailed")
      setEditStatus(message)
    } finally {
      setSavingNode(false)
    }
  }, [project, editingNode, editingPath, editingContent, setSelectedFile, setFileContent, bumpDataVersion])

  const handleNodeContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    if (!nodeId) {
      setNodeMenu(null)
      return
    }
    const rect = graphContainerRef.current?.getBoundingClientRect()
    setNodeMenu({
      nodeId,
      x: rect ? x - rect.left : x,
      y: rect ? y - rect.top : y,
    })
  }, [])

  const resetFilters = useCallback(() => {
    setFilters({
      ...DEFAULT_GRAPH_FILTERS,
      hiddenTypes: new Set(),
      hiddenNodeIds: new Set(),
    })
    setNodeMenu(null)
  }, [])

  const handleCancelNodeEdit = useCallback(() => {
    setEditingNode(null)
    setEditingPath("")
    setEditingContent("")
    setEditStatus(null)
  }, [])

  // Unmount sigma when panels resize or toggle to prevent WebGL crash.
  // Sigma crashes with "could not find suitable program for node type circle"
  // when its canvas is resized by external layout changes.

  // 1. Detect panel open/close (selectedFile, insights)
  const selectedFileForLayout = useWikiStore((s) => s.selectedFile)
  const layoutKey = `${!!selectedFileForLayout}-${showInsights}`
  const prevLayoutKey = useRef(layoutKey)

  useEffect(() => {
    if (prevLayoutKey.current !== layoutKey) {
      prevLayoutKey.current = layoutKey
      setIsResizing(true)
      const timer = setTimeout(() => {
        setSigmaKey((k) => k + 1)
        setIsResizing(false)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [layoutKey])

  // 2. Detect panel drag resize via data-panel-resizing attribute on body
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dragging = document.body.dataset.panelResizing === "true"
      if (dragging && !isResizing) {
        setIsResizing(true)
      }
      if (!dragging && isResizing) {
        // Drag ended — remount sigma after a tick
        setTimeout(() => {
          setSigmaKey((k) => k + 1)
          setIsResizing(false)
        }, 50)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-panel-resizing"] })
    return () => observer.disconnect()
  }, [isResizing])

  useEffect(() => {
    setHighlightedNodes(new Set())
    setNodeMenu(null)
    setSigmaKey((current) => current + 1)
  }, [graphMode])

  // Count nodes by type for legend
  const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  const effectiveFilters = useMemo<GraphFilterState>(() => {
    const modePreset = GRAPH_MODE_PRESETS[graphMode]
    const combinedHiddenTypes = new Set(filters.hiddenTypes)
    if (modePreset.hiddenNodeTypes) {
      for (const t of modePreset.hiddenNodeTypes) {
        combinedHiddenTypes.add(t)
      }
    }
    return {
      ...filters,
      hideStructural: modePreset.hideStructural,
      hideIsolated: modePreset.hideIsolated,
      hiddenTypes: combinedHiddenTypes,
      allowedNodeTypes: modePreset.allowedNodeTypes,
      minimumEdgeWeight: modePreset.minimumEdgeWeight,
    }
  }, [filters, graphMode])

  const filteredGraph = useMemo(
    () => applyGraphFilters(nodes, edges, effectiveFilters),
    [nodes, edges, effectiveFilters],
  )
  const visualSettings = useMemo(() => getGraphVisualSettings(nodes.length), [nodes.length])
  const foreshadowingStatusMap = useMemo(() => {
    const map = new Map<string, string>()
    if (!foreshadowingStore) return map
    for (const item of foreshadowingStore.items) {
      if (item.name) map.set(item.name, item.status)
    }
    return map
  }, [foreshadowingStore])
  const graphMindMap = useMemo(
    () => buildGraphMindMap(filteredGraph.nodes, filteredGraph.edges),
    [filteredGraph.nodes, filteredGraph.edges],
  )
  const hiddenCount = nodes.length - filteredGraph.nodes.length
  const modePreset = GRAPH_MODE_PRESETS[graphMode]

  useEffect(() => {
    setGraphStats({
      nodeCount: nodes.length,
      edgeCount: edges.length,
      hiddenCount,
      filteredNodeCount: filteredGraph.nodes.length,
      filteredEdgeCount: filteredGraph.edges.length,
    })
  }, [nodes.length, edges.length, hiddenCount, filteredGraph.nodes.length, filteredGraph.edges.length, setGraphStats])
  const modeControlsStructural = modePreset.hideStructural
  const modeControlsIsolated = modePreset.hideIsolated
  const contextNode = nodeMenu ? nodes.find((node) => node.id === nodeMenu.nodeId) : null

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("graph.openProject")}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">{t("graph.buildingGraph")}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadGraph}>{t("graph.retry")}</Button>
      </div>
    )
  }

  if (!loading && nodes.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("graph.noPages")}</p>
        <p className="text-xs">{t(novelMode ? "novel.graph.importSourcesHint" : "graph.importSourcesHint")}</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Graph canvas + Insights side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Graph canvas */}
        <div
          ref={graphContainerRef}
          className="relative flex-1 min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setNodeMenu(null)}
        >
          {displayMode === "document" ? (
            <DocumentGraphView
              nodes={filteredGraph.nodes}
              edges={filteredGraph.edges}
              editingNode={editingNode}
              editingPath={editingPath}
              editingContent={editingContent}
              editStatus={editStatus}
              savingNode={savingNode}
              onEditNode={handleEditNode}
              onChangeEditingContent={setEditingContent}
              onSaveNodeEdit={() => void handleSaveNodeEdit()}
              onCancelNodeEdit={handleCancelNodeEdit}
            />
          ) : displayMode === "mindmap" ? (
            <MindMapGraphView mindMap={graphMindMap} />
          ) : isResizing ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("graph.resizing")}
            </div>
          ) : (
            <ErrorBoundary>
              <SigmaContainer
                key={`${sigmaKey}-${edgeStyle}`}
                style={{ width: "100%", height: "100%", background: "transparent" }}
                settings={{
                  renderEdgeLabels: true,
                  defaultEdgeColor: edgeColorHex,
                  defaultEdgeType: edgeTypeForStyle(edgeStyle),
                  edgeProgramClasses: {
                    line: EdgeLineProgram,
                    clamped: EdgeClampedProgram,
                    curve: EdgeCurveProgram,
                    arrow: EdgeArrowProgram,
                  },
                  defaultNodeColor: "#94a3b8",
                  labelSize: 13,
                  labelWeight: "bold",
                  labelColor: { color: "#1e293b" },
                  edgeLabelSize: 14,
                  edgeLabelWeight: "600",
                  edgeLabelColor: { color: "#334155" },
                  labelDensity: labelDisplayMode === "all" ? 1 : labelDisplayMode === "focused" ? 0.25 : 0.4,
                  labelRenderedSizeThreshold: labelDisplayMode === "all" ? 0 : labelDisplayMode === "focused" ? 8 : 6,
                  stagePadding: 30,
                  nodeReducer: (_node, attrs) => {
                    const result = { ...attrs }
                    if (attrs.insightHighlight) {
                      result.size = (attrs.size ?? visualSettings.baseNodeSize) * 1.5
                      result.zIndex = 10
                      result.forceLabel = true
                    }
                    if (attrs.hovering) {
                      result.size = (attrs.size ?? visualSettings.baseNodeSize) * 1.4
                      result.zIndex = 10
                      result.forceLabel = true
                    }
                    if (attrs.dragging) {
                      result.size = (attrs.size ?? visualSettings.baseNodeSize) * 1.35
                      result.zIndex = 12
                      result.forceLabel = true
                    }
                    if (attrs.dimmed) {
                      result.color = mixColor(attrs.color ?? "#94a3b8", "#e2e8f0", 0.75)
                      result.label = ""
                      result.size = (attrs.size ?? visualSettings.baseNodeSize) * 0.6
                    }
                    return result
                  },
                  edgeReducer: (edge, attrs) => {
                    const result = { ...attrs }
                    if (attrs.dimmed) {
                      result.color = mixColor(edgeColorHex, "#e2e8f0", 0.75)
                      result.size = 0.3
                    }
                    if (attrs.highlighted) {
                      result.color = "#1e293b"
                      result.size = Math.max(2, (attrs.size ?? 1) * 1.5)
                      // 显示关系描述而非相关度数字
                      const relation = attrs.relation as string | undefined
                      if (relation) {
                        const relationLabel = NOVEL_RELATION_LABELS[relation as keyof typeof NOVEL_RELATION_LABELS] ?? relation
                        result.label = relationLabel
                      } else {
                        // 从 edge key (source->target) 提取节点名显示关系
                        const parts = edge.split("->")
                        if (parts.length === 2) {
                          result.label = `${parts[0]} \u2194 ${parts[1]}`
                        }
                      }
                      result.forceLabel = true
                    }
                    return result
                  },
                }}
              >
                <GraphLoader
                  nodes={filteredGraph.nodes}
                  edges={filteredGraph.edges}
                  colorMode={colorMode}
                  novelMode={novelMode}
                  graphMode={graphMode}
                  labelDisplayMode={labelDisplayMode}
                  edgeColorHex={edgeColorHex}
                  edgeStrengthPercent={edgeStrengthPercent}
                  edgeLabelsAlwaysVisible={edgeLabelsAlwaysVisible}
                  visualSettings={visualSettings}
                  foreshadowingStatusMap={foreshadowingStatusMap}
                />
                <EventHandler onNodeClick={handleNodeClick} onNodeContextMenu={handleNodeContextMenu} />
                <HighlightManager highlightedNodes={highlightedNodes} />
                <ZoomControls />
              </SigmaContainer>
            </ErrorBoundary>
          )}

          {showFilters && (
            <div className="absolute top-3 left-3 w-72 rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Filter className="h-3.5 w-3.5" />
                  {t("graph.graphFilters")}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={resetFilters}
                >
                  {t("graph.reset")}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.quickFilters")}</div>
                  <label className={`flex items-center gap-2 ${modeControlsStructural ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="checkbox"
                      checked={effectiveFilters.hideStructural}
                      disabled={modeControlsStructural}
                      onChange={(e) => setFilters((prev) => ({ ...prev, hideStructural: e.target.checked }))}
                    />
                    <span>{t("graph.hideIndexOverview")}</span>
                    {modeControlsStructural && (
                      <span className="text-[10px] text-muted-foreground">
                        ({t("novel.graph.modeControlHint", {
                          mode: t(`novel.graph.modeLabels.${graphMode}`, { defaultValue: GRAPH_MODE_LABELS[graphMode] }),
                        })})
                      </span>
                    )}
                  </label>
                  <label className={`flex items-center gap-2 ${modeControlsIsolated ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="checkbox"
                      checked={effectiveFilters.hideIsolated}
                      disabled={modeControlsIsolated}
                      onChange={(e) => setFilters((prev) => ({ ...prev, hideIsolated: e.target.checked }))}
                    />
                    <span>{t("graph.hideIsolated")}</span>
                    {modeControlsIsolated && (
                      <span className="text-[10px] text-muted-foreground">
                        ({t("novel.graph.modeControlHint", {
                          mode: t(`novel.graph.modeLabels.${graphMode}`, { defaultValue: GRAPH_MODE_LABELS[graphMode] }),
                        })})
                      </span>
                    )}
                  </label>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.maxLinks")}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="h-7 w-20 rounded border bg-background px-2 text-xs"
                      value={filters.maxLinks ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim()
                        const value = Number(raw)
                        setFilters((prev) => ({
                          ...prev,
                          maxLinks: raw === "" || !Number.isFinite(value) ? undefined : Math.max(0, value),
                        }))
                      }}
                      placeholder={t("graph.allPlaceholder")}
                    />
                    <span className="text-muted-foreground">{t("graph.maxLinksHint")}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.nodeTypes")}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(nodeTypeLabels)
                      .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                      .map(([type, label]) => (
                        <label key={type} className="flex min-w-0 items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={!filters.hiddenTypes.has(type)}
                            onChange={(e) => {
                              setFilters((prev) => {
                                const next = new Set(prev.hiddenTypes)
                                if (e.target.checked) next.delete(type)
                                else next.add(type)
                                return { ...prev, hiddenTypes: next }
                              })
                            }}
                          />
                          <span className="truncate">{label}</span>
                          <span className="text-muted-foreground/60">{typeCounts[type]}</span>
                        </label>
                      ))}
                  </div>
                </div>

                {filters.hiddenNodeIds.size > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-medium text-muted-foreground">{t("graph.hiddenNodes")}</div>
                    <div className="max-h-24 space-y-1 overflow-y-auto">
                      {[...filters.hiddenNodeIds].map((nodeId) => {
                        const node = nodes.find((n) => n.id === nodeId)
                        return (
                          <div key={nodeId} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                            <span className="truncate">{node?.label ?? nodeId}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => setFilters((prev) => {
                                const next = new Set(prev.hiddenNodeIds)
                                next.delete(nodeId)
                                return { ...prev, hiddenNodeIds: next }
                              })}
                            >
                              {t("graph.show")}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded bg-muted/50 px-2 py-1.5 text-muted-foreground">
                  {t("graph.showingStats", { pages: filteredGraph.nodes.length, total: nodes.length, links: filteredGraph.edges.length, totalLinks: edges.length })}
                </div>
              </div>
            </div>
          )}

          {nodeMenu && contextNode && (
            <div
              className="absolute z-20 w-56 rounded-md border bg-background py-1 text-xs shadow-lg"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b px-3 py-2">
                <div className="truncate font-medium text-foreground">{contextNode.label}</div>
                <div className="text-muted-foreground">{t("graph.contextNodeLinks", { count: contextNode.linkCount })}</div>
                {novelMode && NOVEL_NODE_TYPE_LABELS[contextNode.type as keyof typeof NOVEL_NODE_TYPE_LABELS] && (
                  <span
                    className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: hexToRgba(NODE_TYPE_COLORS[contextNode.type] ?? "#94a3b8", 0.15),
                      color: NODE_TYPE_COLORS[contextNode.type] ?? "#94a3b8",
                    }}
                  >
                    {NOVEL_NODE_TYPE_LABELS[contextNode.type as keyof typeof NOVEL_NODE_TYPE_LABELS]}
                  </span>
                )}
              </div>
              {novelMode && (() => {
                const nodeEdges = edges.filter(
                  (e) => e.source === contextNode.id || e.target === contextNode.id,
                )
                if (nodeEdges.length === 0) return null
                return (
                  <div className="border-b px-3 py-2 max-h-32 overflow-y-auto">
                    <div className="text-muted-foreground mb-1">{t("novel.graph.relations")}</div>
                    {nodeEdges.slice(0, 8).map((edge, i) => {
                      const isSource = edge.source === contextNode.id
                      const otherId = isSource ? edge.target : edge.source
                      const otherNode = nodes.find((n) => n.id === otherId)
                      return (
                        <div key={i} className="text-muted-foreground/80 truncate">
                          {isSource ? "→" : "←"} {otherNode?.label ?? otherId}
                        </div>
                      )
                    })}
                    {nodeEdges.length > 8 && (
                      <div className="text-muted-foreground/60">+{nodeEdges.length - 8}</div>
                    )}
                  </div>
                )
              })()}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => void handleOpenNodeProfilePage(contextNode)}
              >
                <FileText className="h-3.5 w-3.5" />
                {t("graph.editRealProfilePage")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => {
                  setFilters((prev) => ({
                    ...prev,
                    hiddenNodeIds: new Set([...prev.hiddenNodeIds, contextNode.id]),
                  }))
                  setNodeMenu(null)
                }}
              >
                <EyeOff className="h-3.5 w-3.5" />
                {t("graph.hideThisNode")}
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 rounded-lg border bg-background/90 backdrop-blur-sm px-3 py-2 text-xs shadow-sm max-w-[260px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-foreground">
                {colorMode === "type" ? t("graph.nodeTypesLabel") : t("graph.communitiesLabel")}
              </span>
              <div className="flex items-center gap-1">
                {colorMode === "type" && filters.hiddenTypes.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1"
                    onClick={() => setFilters((prev) => ({ ...prev, hiddenTypes: new Set() }))}
                    title={t("graph.showAllTypes")}
                  >
                    {t("graph.showAll")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setLegendCollapsed(!legendCollapsed)}
                  title={legendCollapsed ? t("graph.expandLegend") : t("graph.collapseLegend")}
                >
                  {legendCollapsed ? "▶" : "▼"}
                </Button>
              </div>
            </div>
            {!legendCollapsed && (
              colorMode === "type" ? (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto legend-scroll" style={{ direction: "rtl" }}>
                  <div className="flex flex-col gap-0.5" style={{ direction: "ltr" }}>
                    {novelMode
                      ? (() => {
                          const novelTypes = ["character", "location", "organization", "item", "event", "chapter", "outline", "foreshadowing", "secret", "conflict", "timeline-point", "canon-rule"]
                          const baseTypes = ["entity", "concept", "source", "query", "synthesis", "overview", "comparison", "other"]
                          const renderTypeItem = (type: string, label: string) => {
                            const isHidden = filters.hiddenTypes.has(type)
                            return (
                              <div
                                key={type}
                                className={`flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50 ${isHidden ? "opacity-40" : ""}`}
                                onMouseEnter={() => setHoveredType(type)}
                                onMouseLeave={() => setHoveredType(null)}
                                onDoubleClick={() => {
                                  setFilters((prev) => {
                                    const next = new Set(prev.hiddenTypes)
                                    if (next.has(type)) {
                                      next.delete(type)
                                    } else {
                                      next.add(type)
                                    }
                                    return { ...prev, hiddenTypes: next }
                                  })
                                }}
                                title={t("graph.doubleClickToggleVisibility")}
                              >
                                <span
                                  className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                                  style={{
                                    backgroundColor: isHidden ? "#94a3b8" : NODE_TYPE_COLORS[type],
                                    boxShadow: `0 0 4px ${hexToRgba(isHidden ? "#94a3b8" : NODE_TYPE_COLORS[type] ?? "#94a3b8", 0.4)}`,
                                  }}
                                />
                                <span className={hoveredType === type ? "text-foreground font-medium" : "text-muted-foreground"}>
                                  {label}
                                </span>
                                <span className="text-muted-foreground/60 ml-auto">{typeCounts[type]}</span>
                                {isHidden && <span className="text-muted-foreground/60 text-[10px]">{t("graph.hidden")}</span>}
                              </div>
                            )
                          }
                          return (
                            <>
                              {novelTypes.some((t) => (typeCounts[t] ?? 0) > 0) && (
                                <>
                                  <div className="text-muted-foreground/70 text-[10px] font-semibold px-1 pt-1 border-t border-border/50 mt-0.5">
                                    {t("novel.graph.novelNodeTypes")}
                                  </div>
                                  {novelTypes.filter((t) => (typeCounts[t] ?? 0) > 0).map((type) =>
                                    renderTypeItem(type, nodeTypeLabels[type] ?? type)
                                  )}
                                </>
                              )}
                              {baseTypes.some((t) => (typeCounts[t] ?? 0) > 0) && (
                                <>
                                  <div className="text-muted-foreground/70 text-[10px] font-semibold px-1 pt-1 border-t border-border/50 mt-0.5">
                                    {t("novel.graph.baseNodeTypes")}
                                  </div>
                                  {baseTypes.filter((t) => (typeCounts[t] ?? 0) > 0).map((type) =>
                                    renderTypeItem(type, nodeTypeLabels[type] ?? type)
                                  )}
                                </>
                              )}
                            </>
                          )
                        })()
                      : Object.entries(nodeTypeLabels)
                          .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                          .map(([type, label]) => {
                            const isHidden = filters.hiddenTypes.has(type)
                            return (
                              <div
                                key={type}
                                className={`flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50 ${isHidden ? "opacity-40" : ""}`}
                                onMouseEnter={() => setHoveredType(type)}
                                onMouseLeave={() => setHoveredType(null)}
                                onDoubleClick={() => {
                                  setFilters((prev) => {
                                    const next = new Set(prev.hiddenTypes)
                                    if (next.has(type)) {
                                      next.delete(type)
                                    } else {
                                      next.add(type)
                                    }
                                    return { ...prev, hiddenTypes: next }
                                  })
                                }}
                                title={t("graph.doubleClickToggleVisibility")}
                              >
                                <span
                                  className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                                  style={{
                                    backgroundColor: isHidden ? "#94a3b8" : NODE_TYPE_COLORS[type],
                                    boxShadow: `0 0 4px ${hexToRgba(isHidden ? "#94a3b8" : NODE_TYPE_COLORS[type] ?? "#94a3b8", 0.4)}`,
                                  }}
                                />
                                <span className={hoveredType === type ? "text-foreground font-medium" : "text-muted-foreground"}>
                                  {label}
                                </span>
                                <span className="text-muted-foreground/60 ml-auto">{typeCounts[type]}</span>
                                {isHidden && <span className="text-muted-foreground/60 text-[10px]">{t("graph.hidden")}</span>}
                              </div>
                            )
                          })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto legend-scroll" style={{ direction: "rtl" }}>
                  <div className="flex flex-col gap-0.5" style={{ direction: "ltr" }}>
                    {communities.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{
                          backgroundColor: COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length],
                          boxShadow: `0 0 4px ${hexToRgba(COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length], 0.4)}`,
                        }}
                      />
                      <span className="text-muted-foreground truncate" title={c.topNodes.join(", ")}>
                        {c.topNodes[0] ?? `${t("graph.cluster", { id: c.id })}`}
                      </span>
                      <span className="text-muted-foreground/60 ml-auto shrink-0">{c.nodeCount}</span>
                      {c.cohesion < 0.15 && c.nodeCount >= 3 && (
                        <span className="text-amber-500 shrink-0" title={t("graph.lowCohesion", { value: c.cohesion.toFixed(2) })}>!</span>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* Insights Side Panel */}
        {showInsights && (
          <div className="w-80 shrink-0 border-l bg-background overflow-y-auto">
            <div className="px-4 py-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">{t("graph.insights")}</span>
                </div>
                <button
                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                  onClick={() => {
                    setShowInsights(false)
                    setHighlightedNodes(new Set())
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-4">
              {/* Surprising Connections */}
              {surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <Link2 className="h-3.5 w-3.5 text-blue-500" />
                    {t("graph.surprisingConnections")}
                  </div>
                  <div className="flex flex-col gap-2">
                    {surprisingConns
                      .filter((conn) => !dismissedInsights.has(conn.key))
                      .map((conn, i) => {
                        const ids = new Set([conn.source.id, conn.target.id])
                        const isActive = highlightedNodes.size === ids.size &&
                          [...ids].every((id) => highlightedNodes.has(id))
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-blue-500/10 border-blue-500/40" : "hover:bg-muted/50"}`}
                            onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-medium text-foreground text-xs">
                                {conn.source.label} ↔ {conn.target.label}
                              </span>
                              <button
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDismissedInsights((prev) => new Set([...prev, conn.key]))
                                  if (isActive) setHighlightedNodes(new Set())
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {conn.reasons.join("，")}
                            </p>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Knowledge Gaps */}
              {knowledgeGaps.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    {t("graph.knowledgeGaps")}
                  </div>
                  <div className="flex flex-col gap-2">
                    {knowledgeGaps.map((gap, i) => {
                      const ids = new Set(gap.nodeIds)
                      const isActive = highlightedNodes.size > 0 &&
                        [...ids].every((id) => highlightedNodes.has(id)) &&
                        [...highlightedNodes].every((id) => ids.has(id))
                      return (
                        <div
                          key={i}
                          className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-amber-500/10 border-amber-500/40" : "hover:bg-muted/50"}`}
                          onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                        >
                          <div className="font-medium text-xs text-foreground mb-1">{gap.title}</div>
                          <p className="text-xs text-muted-foreground mb-2">{gap.description}</p>
                          <p className="text-xs text-muted-foreground/80 italic mb-2">{gap.suggestion}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
