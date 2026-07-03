import type { RouteRule, ClassificationConfig } from "./types"

export const DEFAULT_CLASSIFICATION_ROUTES: RouteRule[] = [
  {
    intent: "write_chapter",
    required: ["outline", "soul", "character_states", "foreshadowing"],
    optional: [
      "recent_summaries",
      "chapter_content",
      "timeline",
      "settings",
      "memory",
      "graph",
      "plot_tools",
    ],
    forbidden: ["revision"],
  },
  {
    intent: "continue_chapter",
    required: ["outline", "chapter_content", "character_states", "soul"],
    optional: [
      "recent_summaries",
      "foreshadowing",
      "timeline",
      "settings",
      "memory",
      "graph",
      "plot_tools",
    ],
    forbidden: ["revision"],
  },
  {
    intent: "rewrite_chapter",
    required: ["outline", "chapter_content", "character_states", "soul"],
    optional: [
      "recent_summaries",
      "foreshadowing",
      "timeline",
      "settings",
      "memory",
      "graph",
      "revision",
    ],
    forbidden: [],
  },
  {
    intent: "polish_chapter",
    required: ["chapter_content", "soul"],
    optional: [
      "outline",
      "recent_summaries",
      "character_states",
      "foreshadowing",
      "timeline",
      "settings",
    ],
    forbidden: ["memory", "graph", "plot_tools", "revision"],
  },
  {
    intent: "review_chapter",
    required: ["chapter_content", "outline", "character_states", "foreshadowing"],
    optional: [
      "recent_summaries",
      "timeline",
      "settings",
      "soul",
      "memory",
      "graph",
      "revision",
    ],
    forbidden: ["plot_tools"],
  },
  {
    intent: "lint_chapter",
    required: ["chapter_content", "character_states", "foreshadowing", "timeline"],
    optional: ["outline", "recent_summaries", "settings", "memory", "graph"],
    forbidden: ["plot_tools", "revision", "soul"],
  },
  {
    intent: "generate_outline",
    required: ["soul", "settings"],
    optional: [
      "outline",
      "character_states",
      "foreshadowing",
      "timeline",
      "memory",
      "graph",
      "plot_tools",
    ],
    forbidden: ["chapter_content", "recent_summaries", "revision"],
  },
  {
    intent: "search_plot",
    required: ["graph", "recent_summaries"],
    optional: [
      "outline",
      "chapter_content",
      "character_states",
      "foreshadowing",
      "timeline",
      "settings",
      "memory",
    ],
    forbidden: ["plot_tools", "revision", "soul"],
  },
  {
    intent: "extract_memory",
    required: ["chapter_content"],
    optional: ["outline", "character_states", "foreshadowing", "timeline", "settings"],
    forbidden: ["soul", "memory", "graph", "plot_tools", "revision", "recent_summaries"],
  },
  {
    intent: "character_query",
    required: ["character_states", "memory"],
    optional: [
      "outline",
      "recent_summaries",
      "chapter_content",
      "foreshadowing",
      "timeline",
      "settings",
      "graph",
    ],
    forbidden: ["plot_tools", "revision", "soul"],
  },
  {
    intent: "foreshadowing_query",
    required: ["foreshadowing"],
    optional: [
      "outline",
      "recent_summaries",
      "chapter_content",
      "character_states",
      "timeline",
      "memory",
      "graph",
    ],
    forbidden: ["settings", "soul", "plot_tools", "revision"],
  },
  {
    intent: "timeline_query",
    required: ["timeline"],
    optional: [
      "outline",
      "recent_summaries",
      "chapter_content",
      "character_states",
      "foreshadowing",
      "memory",
      "graph",
    ],
    forbidden: ["settings", "soul", "plot_tools", "revision"],
  },
  {
    intent: "setting_query",
    required: ["settings"],
    optional: ["outline", "memory", "graph", "soul"],
    forbidden: [
      "recent_summaries",
      "chapter_content",
      "character_states",
      "foreshadowing",
      "timeline",
      "plot_tools",
      "revision",
    ],
  },
  {
    intent: "general_chat",
    required: [],
    optional: [
      "outline",
      "recent_summaries",
      "chapter_content",
      "character_states",
      "foreshadowing",
      "timeline",
      "settings",
      "soul",
      "memory",
      "graph",
      "plot_tools",
      "revision",
    ],
    forbidden: [],
  },
]

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  routes: DEFAULT_CLASSIFICATION_ROUTES,
  version: "1.0.0",
}

export function getDefaultRoute(intent: string): RouteRule | undefined {
  return DEFAULT_CLASSIFICATION_ROUTES.find((r) => r.intent === intent)
}

export function hasDefaultRoute(intent: string): boolean {
  return DEFAULT_CLASSIFICATION_ROUTES.some((r) => r.intent === intent)
}
