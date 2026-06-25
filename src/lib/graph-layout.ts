export const GRAPH_VISUAL_SETTINGS = {
  baseNodeSize: 6,
  maxNodeSize: 20,
  minEdgeSize: 0.35,
  maxEdgeSize: 2,
  minEdgeAlpha: 0.12,
  maxEdgeAlpha: 0.42,
} as const

export const GRAPH_LAYOUT_SETTINGS = {
  gravity: 0.2,
  scalingRatio: 4.6,
  slowDown: 2.2,
  adjustSizes: true,
  strongGravityMode: false,
} as const

export interface GraphVisualTier {
  baseNodeSize: number
  maxNodeSize: number
  minEdgeSize: number
  maxEdgeSize: number
  minEdgeAlpha: number
  maxEdgeAlpha: number
}

export function getGraphVisualSettings(nodeCount: number): GraphVisualTier {
  if (nodeCount >= 500) {
    return {
      baseNodeSize: 4,
      maxNodeSize: 14,
      minEdgeSize: 0.2,
      maxEdgeSize: 1.2,
      minEdgeAlpha: 0.06,
      maxEdgeAlpha: 0.25,
    }
  }
  if (nodeCount >= 100) {
    return {
      baseNodeSize: 5,
      maxNodeSize: 17,
      minEdgeSize: 0.28,
      maxEdgeSize: 1.6,
      minEdgeAlpha: 0.09,
      maxEdgeAlpha: 0.34,
    }
  }
  return {
    baseNodeSize: GRAPH_VISUAL_SETTINGS.baseNodeSize,
    maxNodeSize: GRAPH_VISUAL_SETTINGS.maxNodeSize,
    minEdgeSize: GRAPH_VISUAL_SETTINGS.minEdgeSize,
    maxEdgeSize: GRAPH_VISUAL_SETTINGS.maxEdgeSize,
    minEdgeAlpha: GRAPH_VISUAL_SETTINGS.minEdgeAlpha,
    maxEdgeAlpha: GRAPH_VISUAL_SETTINGS.maxEdgeAlpha,
  }
}

export const GRAPH_LAYOUT_ITERATIONS = 220