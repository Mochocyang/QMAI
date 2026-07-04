import { useEffect, useRef, useMemo } from "react"
import cytoscape from "cytoscape"
import type { NovelAgent } from "@/lib/novel/story-simulation/types"

interface RelationshipGraphPanelProps {
  agents: Map<string, NovelAgent>
}

function getSentimentInfo(sentiment: number) {
  if (sentiment >= 60) {
    return { color: "#15803d", label: "亲密盟友", width: 5 }
  }
  if (sentiment >= 20) {
    return { color: "#86efac", label: "友好", width: 3 }
  }
  if (sentiment > -20) {
    return { color: "#9ca3af", label: "中立", width: 1.5 }
  }
  if (sentiment > -60) {
    return { color: "#fca5a5", label: "敌对", width: 3 }
  }
  return { color: "#dc2626", label: "死敌", width: 5 }
}

export function RelationshipGraphPanel({ agents }: RelationshipGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const graphData = useMemo(() => {
    const nodes: Array<{ id: string; name: string }> = []
    const edges: Array<{ source: string; target: string; sentiment: number }> = []

    for (const [id, agent] of agents) {
      nodes.push({ id, name: agent.name })
    }

    const edgeSet = new Set<string>()
    for (const [sourceId, sourceAgent] of agents) {
      const sentiments = sourceAgent.memory.sentiments
      for (const [targetId] of sentiments) {
        if (!agents.has(targetId)) continue
        const edgeKey = [sourceId, targetId].sort().join("-")
        if (edgeSet.has(edgeKey)) continue
        edgeSet.add(edgeKey)

        const s1 = sourceAgent.memory.sentiments.get(targetId) ?? 0
        const s2 = agents.get(targetId)!.memory.sentiments.get(sourceId) ?? 0
        const avgSentiment = (s1 + s2) / 2

        edges.push({
          source: sourceId < targetId ? sourceId : targetId,
          target: sourceId < targetId ? targetId : sourceId,
          sentiment: avgSentiment,
        })
      }
    }

    return { nodes, edges }
  }, [agents])

  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#3b82f6",
            "label": "data(name)",
            "color": "#1f2937",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "12px",
            "font-weight": 500,
            "text-outline-width": 2,
            "text-outline-color": "#ffffff",
            "width": "50px",
            "height": "50px",
            "border-width": 2,
            "border-color": "#ffffff",
            "overlay-padding": "6px",
            "z-index": 10,
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "width": "data(width)",
            "line-color": "data(color)",
            "target-arrow-shape": "none",
            "label": "data(label)",
            "font-size": "10px",
            "color": "#6b7280",
            "text-rotation": "autorotate",
            "text-margin-y": -8,
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "z-index": 5,
          },
        },
      ],
      layout: {
        name: "cose",
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 30,
        nodeRepulsion: 4000,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 2500,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      },
      wheelSensitivity: 0.3,
    })

    cyRef.current = cy

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!cyRef.current) return

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      const cy = cyRef.current
      if (!cy) return

      cy.elements().remove()

      const elements: cytoscape.ElementDefinition[] = []

      for (const node of graphData.nodes) {
        elements.push({
          data: { id: node.id, name: node.name },
        })
      }

      for (const edge of graphData.edges) {
        const info = getSentimentInfo(edge.sentiment)
        elements.push({
          data: {
            id: `${edge.source}-${edge.target}`,
            source: edge.source,
            target: edge.target,
            color: info.color,
            label: info.label,
            width: info.width,
          },
        })
      }

      cy.add(elements)

      if (elements.length > 0) {
        cy.layout({
          name: "cose",
          animate: true,
          animationDuration: 300,
          fit: true,
          padding: 30,
          nodeRepulsion: 4000,
          idealEdgeLength: 100,
          edgeElasticity: 100,
          nestingFactor: 5,
          gravity: 80,
          numIter: 2500,
          initialTemp: 200,
          coolingFactor: 0.95,
          minTemp: 1.0,
        }).run()
      }
    }, 200)
  }, [graphData])

  if (agents.size === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        暂无角色数据
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-8 rounded" style={{ backgroundColor: "#15803d" }} />
          <span className="text-muted-foreground">亲密盟友</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-8 rounded" style={{ backgroundColor: "#86efac" }} />
          <span className="text-muted-foreground">友好</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-8 rounded" style={{ backgroundColor: "#9ca3af" }} />
          <span className="text-muted-foreground">中立</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-8 rounded" style={{ backgroundColor: "#fca5a5" }} />
          <span className="text-muted-foreground">敌对</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-8 rounded" style={{ backgroundColor: "#dc2626" }} />
          <span className="text-muted-foreground">死敌</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="min-h-0 flex-1 rounded-md border bg-background/70"
        style={{ minHeight: "300px" }}
      />
    </div>
  )
}
