import type { ContextSourceKind } from "./types"

const DATA_SOURCE_KINDS: Record<string, ContextSourceKind[]> = {
  outline: ["outline"],
  chapterOutline: ["outline"],
  volumeContext: ["outline", "snapshot"],
  snapshots: ["snapshot"],
  recentChapterContents: ["chapter"],
  fallbackRecentSummaries: ["chapter"],
  fallbackPreviousEnding: ["chapter", "snapshot"],
  fallbackCharacterStates: ["entity"],
  fallbackForeshadowingStates: ["memory", "entity"],
  fallbackTimeline: ["memory"],
  relatedSettings: ["entity", "setting"],
  canonRules: ["setting"],
  writingStyle: ["setting"],
  bookAnalysisReferences: ["book-analysis"],
  searchResults: ["chapter", "outline", "memory", "setting", "entity", "snapshot"],
  graphSearchResults: ["chapter", "outline", "memory", "setting", "entity", "snapshot"],
  revisionFeedback: ["chapter", "snapshot"],
  cognitionText: ["entity"],
  soulDoc: ["soul"],
  sectionBriefing: ["outline", "snapshot"],
  storyFrameworkBinding: ["outline", "setting", "deduction"],
  retrieval: ["retrieval"],
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
  if (relative === ".qmai/book-analysis-context.json") return "book-analysis"
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
  if (relative.startsWith("retrieval/")) return "retrieval"
  return "other"
}

export function getDataSourceKinds(sourceName: string): ContextSourceKind[] {
  return [...(DATA_SOURCE_KINDS[sourceName] ?? ["other"])]
}

/**
 * 每个数据源的依赖路径前缀（项目相对路径，已归一化）。
 * 命中依赖戳时只哈希这些前缀下的文件，避免同类其它文件变化导致整类缓存失效。
 * 未列出的源回退到 `DATA_SOURCE_KINDS` 聚合（兜底，保持现有行为）。
 * 原则：宁可过覆盖、不可漏（漏了会命中过时缓存）。
 */
export const SOURCE_DEPENDENCY_PREFIXES: Record<string, string[]> = {
  soulDoc: ["soul.md", "wiki/soul.md"],
  cognitionText: [".novel/cognition-state.json"],
  writingStyle: ["wiki/settings/", "wiki/canon.md", "wiki/writing-style.md", ".qmai/writing-style.json"],
  relatedSettings: [
    "wiki/settings/", "wiki/canon.md", "wiki/writing-style.md",
    "wiki/entities/", "wiki/characters/", "wiki/memory/",
  ],
  canonRules: [
    "wiki/settings/", "wiki/canon.md", "wiki/writing-style.md",
    "wiki/memory/", "wiki/entities/", "wiki/characters/",
  ],
  storyFrameworkBinding: [
    "wiki/outlines/", "wiki/settings/", "wiki/canon.md", "wiki/writing-style.md",
    ".qmai/simulations/",
  ],
  outline: ["wiki/outlines/"],
  chapterOutline: ["wiki/outlines/"],
  volumeContext: ["wiki/outlines/", "wiki/settings/", "wiki/canon.md"],
  snapshots: [".novel/snapshots/", ".novel/community-summaries/", ".novel/revision-feedback.json"],
  recentChapterContents: ["wiki/chapters/"],
  fallbackRecentSummaries: ["wiki/chapters/"],
  fallbackPreviousEnding: ["wiki/chapters/", ".novel/snapshots/"],
  fallbackCharacterStates: ["wiki/entities/", "wiki/characters/"],
  fallbackForeshadowingStates: ["wiki/memory/", "wiki/entities/", "wiki/characters/"],
  fallbackTimeline: ["wiki/memory/", ".novel/timeline.json"],
  revisionFeedback: ["wiki/chapters/", ".novel/snapshots/", ".novel/revision-feedback.json"],
  retrieval: ["retrieval/"],
  sectionBriefing: ["wiki/outlines/", ".novel/snapshots/"],
}

/** 返回某数据源的依赖路径前缀；未声明则返回空（调用方回退到 kind 聚合）。 */
export function getSourceDependencyPrefixes(sourceName: string): string[] {
  return SOURCE_DEPENDENCY_PREFIXES[sourceName] ?? []
}

export function sortContextSourcePaths(paths: string[]): string[] {
  return paths
    .map(normalizeContextPath)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}
