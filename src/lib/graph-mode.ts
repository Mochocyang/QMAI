export type GraphMode = "overview" | "character" | "chapter" | "storyline" | "foreshadowing"
export type GraphLabelVisibility = "all" | "focused" | "minimal"

export interface GraphModePreset {
  allowedNodeTypes?: ReadonlySet<string>
  hiddenNodeTypes?: ReadonlySet<string>
  hideIsolated: boolean
  hideStructural: boolean
  minimumEdgeWeight: number
  labelVisibility: GraphLabelVisibility
}

export const GRAPH_MODE_LABELS: Record<GraphMode, string> = {
  overview: "总览",
  character: "人物",
  chapter: "章节",
  storyline: "故事线",
  foreshadowing: "伏笔",
}

export const GRAPH_MODE_PRESETS: Record<GraphMode, GraphModePreset> = {
  overview: {
    allowedNodeTypes: new Set(["character", "chapter", "event", "location", "item", "organization", "foreshadowing", "secret", "conflict"]),
    hiddenNodeTypes: new Set(["outline", "source", "query", "comparison"]),
    hideIsolated: true,
    hideStructural: true,
    minimumEdgeWeight: 2,
    labelVisibility: "focused",
  },
  character: {
    allowedNodeTypes: new Set(["character", "organization", "location", "event", "chapter", "conflict", "secret"]),
    hiddenNodeTypes: new Set(["outline", "source", "query"]),
    hideIsolated: true,
    hideStructural: true,
    minimumEdgeWeight: 1,
    labelVisibility: "focused",
  },
  chapter: {
    allowedNodeTypes: new Set(["chapter", "character", "location", "event", "foreshadowing", "conflict"]),
    hiddenNodeTypes: new Set(["outline", "source", "query"]),
    hideIsolated: true,
    hideStructural: true,
    minimumEdgeWeight: 1,
    labelVisibility: "focused",
  },
  storyline: {
    allowedNodeTypes: new Set(["event", "chapter", "character", "conflict", "secret", "foreshadowing"]),
    hiddenNodeTypes: new Set(["item", "source", "query"]),
    hideIsolated: true,
    hideStructural: true,
    minimumEdgeWeight: 2,
    labelVisibility: "minimal",
  },
  foreshadowing: {
    allowedNodeTypes: new Set(["foreshadowing", "chapter", "character", "event", "secret"]),
    hiddenNodeTypes: new Set(["source", "query", "comparison"]),
    hideIsolated: true,
    hideStructural: true,
    minimumEdgeWeight: 1,
    labelVisibility: "focused",
  },
}