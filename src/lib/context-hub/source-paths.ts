import type { ContextSourceKind } from "./types"

const DATA_SOURCE_KINDS: Record<string, ContextSourceKind[]> = {
  outline: ["outline"],
  chapterOutline: ["outline"],
  volumeContext: ["outline", "snapshot"],
  snapshots: ["snapshot"],
  recentChapterContents: ["chapter"],
  fallbackRecentSummaries: ["chapter", "snapshot"],
  fallbackPreviousEnding: ["chapter", "snapshot"],
  fallbackCharacterStates: ["entity", "snapshot"],
  fallbackForeshadowingStates: ["memory", "snapshot"],
  fallbackTimeline: ["memory", "snapshot"],
  relatedSettings: ["entity", "setting"],
  canonRules: ["setting"],
  writingStyle: ["setting"],
  searchResults: ["chapter", "outline", "memory", "setting", "entity"],
  graphSearchResults: ["chapter", "outline", "memory", "setting", "entity"],
  revisionFeedback: ["chapter", "snapshot"],
  cognitionText: ["entity"],
  soulDoc: ["soul"],
  characterAuras: ["entity"],
  sectionBriefing: ["outline", "snapshot"],
  storyFrameworkBinding: ["outline", "setting", "deduction"],
  retrieval: ["chapter", "outline", "memory", "setting", "entity", "snapshot"],
}

export function normalizeContextPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "")
}

export function classifyContextSourcePath(projectPath: string, path: string): ContextSourceKind {
  const project = normalizeContextPath(projectPath).toLowerCase()
  const normalized = normalizeContextPath(path)
  const lower = normalized.toLowerCase()
  const relative = lower.startsWith(`${project}/`) ? lower.slice(project.length + 1) : lower

  if (relative === ".qmai/context-cache" || relative.startsWith(".qmai/context-cache/")) return "ignored"
  if (relative === ".qmai/writing-style.json") return "setting"
  if (relative === ".qmai/character-aura.json") return "entity"
  if (relative.startsWith("wiki/chapters/")) return "chapter"
  if (relative.startsWith("wiki/outlines/")) return "outline"
  if (relative.startsWith("wiki/memory/")) return "memory"
  if (relative.startsWith("wiki/entities/") || relative.startsWith("wiki/characters/")) return "entity"
  if (relative.startsWith("wiki/settings/") || relative === "wiki/canon.md" || relative === "wiki/writing-style.md") return "setting"
  if (relative === "soul.md" || relative === "wiki/soul.md") return "soul"
  if (relative === ".novel/cognition-state.json") return "entity"
  if (relative === ".novel/revision-feedback.json") return "snapshot"
  if (relative === ".novel/timeline.json") return "memory"
  if (relative.startsWith(".novel/snapshots/") || relative.startsWith(".novel/community-summaries/")) return "snapshot"
  if (relative.startsWith(".qmai/simulations/")) return "deduction"
  return "other"
}

export function getDataSourceKinds(sourceName: string): ContextSourceKind[] {
  return [...(DATA_SOURCE_KINDS[sourceName] ?? ["other"])]
}

export function sortContextSourcePaths(paths: string[]): string[] {
  return paths
    .map(normalizeContextPath)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}
