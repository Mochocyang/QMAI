import type { NovelTaskIntent } from "../task-router"

export type DataSourceCategory =
  | "outline"
  | "recent_summaries"
  | "chapter_content"
  | "character_states"
  | "foreshadowing"
  | "timeline"
  | "settings"
  | "soul"
  | "memory"
  | "graph"
  | "plot_tools"
  | "revision"

export const ALL_DATA_SOURCE_CATEGORIES: DataSourceCategory[] = [
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
]

export interface RouteRule {
  intent: NovelTaskIntent
  required: DataSourceCategory[]
  optional: DataSourceCategory[]
  forbidden: DataSourceCategory[]
}

export interface ClassificationConfig {
  routes: RouteRule[]
  version?: string
}

export type RouteSource = "default" | "project" | "project_with_feature"

export interface ClassificationVersionCheckResult {
  upToDate: boolean
  currentVersion: string
  latestVersion: string
  needsUpgrade: boolean
  canUpgrade: boolean
}

export interface LoadClassificationResult {
  config: ClassificationConfig
  source: RouteSource
  fallbackReason?: string
  versionInfo?: ClassificationVersionCheckResult
}

export const DATA_SOURCE_CATEGORY_LABELS: Record<DataSourceCategory, string> = {
  outline: "大纲结构",
  recent_summaries: "最近剧情摘要",
  chapter_content: "章节正文",
  character_states: "人物状态",
  foreshadowing: "伏笔状态",
  timeline: "时间线",
  settings: "设定与正史",
  soul: "作品灵魂",
  memory: "记忆中心",
  graph: "图谱检索",
  plot_tools: "剧情工具",
  revision: "修订反馈",
}
