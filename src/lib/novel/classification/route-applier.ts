import type { ContextPack } from "../context-engine"
import type { RouteRule, DataSourceCategory } from "./types"

const CATEGORY_TO_FIELDS: Record<DataSourceCategory, Array<keyof ContextPack>> = {
  outline: ["outline", "chapterGoal"],
  recent_summaries: ["recentSummaries"],
  chapter_content: ["recentChapterContents", "previousChapterEnding"],
  character_states: ["characterStates", "characterAuras", "cognitionStates"],
  foreshadowing: ["foreshadowingStates"],
  timeline: ["timeline"],
  settings: ["relatedSettings", "canonRules"],
  soul: ["soulDoc"],
  memory: ["searchResults"],
  graph: ["graphSearchResults"],
  plot_tools: ["nextChapterAdvice"],
  revision: ["revisionDirectives"],
}

export interface ApplyRouteResult {
  pack: ContextPack
  blockedSources: DataSourceCategory[]
  keptSources: DataSourceCategory[]
}

export function applyRouteRules(pack: ContextPack, rule: RouteRule): ApplyRouteResult {
  const result: ContextPack = { ...pack }
  const blockedSources: DataSourceCategory[] = []
  const keptSources: DataSourceCategory[] = []

  const allCategories = Object.keys(CATEGORY_TO_FIELDS) as DataSourceCategory[]

  for (const category of allCategories) {
    if (rule.required.includes(category)) {
      keptSources.push(category)
      continue
    }

    if (rule.forbidden.includes(category)) {
      blockedSources.push(category)
      clearCategoryFields(result, category)
      continue
    }

    if (rule.optional.includes(category)) {
      keptSources.push(category)
      continue
    }

    blockedSources.push(category)
    clearCategoryFields(result, category)
  }

  if (blockedSources.includes("outline")) {
    result.mustDo = clearFieldByCategory(result.mustDo, "outline")
  }
  if (blockedSources.includes("foreshadowing")) {
    result.mustDo = clearFieldByCategory(result.mustDo, "foreshadowing")
    result.nextChapterAdvice = clearFieldByCategory(result.nextChapterAdvice, "foreshadowing")
  }
  if (blockedSources.includes("chapter_content")) {
    result.mustDo = clearFieldByCategory(result.mustDo, "chapter_content")
    result.nextChapterAdvice = clearFieldByCategory(result.nextChapterAdvice, "chapter_content")
  }
  if (blockedSources.includes("timeline")) {
    result.mustAvoid = clearFieldByCategory(result.mustAvoid, "timeline")
    result.nextChapterAdvice = clearFieldByCategory(result.nextChapterAdvice, "timeline")
  }
  if (blockedSources.includes("settings")) {
    result.mustAvoid = clearFieldByCategory(result.mustAvoid, "settings")
  }
  if (blockedSources.includes("character_states")) {
    result.mustAvoid = clearFieldByCategory(result.mustAvoid, "character_states")
  }
  if (blockedSources.includes("recent_summaries")) {
    result.nextChapterAdvice = clearFieldByCategory(result.nextChapterAdvice, "recent_summaries")
  }
  if (blockedSources.includes("memory")) {
    result.nextChapterAdvice = clearFieldByCategory(result.nextChapterAdvice, "memory")
  }

  return {
    pack: result,
    blockedSources,
    keptSources,
  }
}

function clearCategoryFields(pack: ContextPack, category: DataSourceCategory): void {
  const fields = CATEGORY_TO_FIELDS[category] || []
  for (const field of fields) {
    const value = pack[field]
    if (Array.isArray(value)) {
      ;(pack as any)[field] = []
    } else if (typeof value === "string") {
      ;(pack as any)[field] = ""
    }
  }
}

function clearFieldByCategory(fieldValue: string, _category: DataSourceCategory): string {
  if (!fieldValue) return ""
  return fieldValue
}

export function getCategoryFields(category: DataSourceCategory): Array<keyof ContextPack> {
  return CATEGORY_TO_FIELDS[category] || []
}

export function getAllCategories(): DataSourceCategory[] {
  return Object.keys(CATEGORY_TO_FIELDS) as DataSourceCategory[]
}

export function hasCategoryContent(pack: ContextPack, category: DataSourceCategory): boolean {
  const fields = CATEGORY_TO_FIELDS[category] || []
  for (const field of fields) {
    const value = pack[field]
    if (Array.isArray(value)) {
      if (value.length > 0) return true
    } else if (typeof value === "string") {
      if (value.trim().length > 0) return true
    }
  }
  return false
}

export function getLoadedCategories(pack: ContextPack): DataSourceCategory[] {
  const all = getAllCategories()
  return all.filter((cat) => hasCategoryContent(pack, cat))
}
