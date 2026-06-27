import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { listSnapshots, loadSnapshot, type ChapterSnapshot } from "./chapter-ingest"
import { loadDismantlingLibrary } from "./dismantling"

export interface MemoryCenterGroup {
  title: string
  items: string[]
}

export interface MemoryCenterSection {
  title: string
  groups: MemoryCenterGroup[]
  items: string[]
}

export interface MemoryCenterFilePreview {
  key: string
  title: string
  path: string
  sections: MemoryCenterSection[]
}

export interface MemoryCenterSnapshotCard {
  chapterNumber: number
  chapterTitle?: string
  summary: string
  endingHook: string
  memorySynced: boolean
  memorySyncedAt?: string
  snapshotPath: string
  characterStateChanges: string[]
  knowledgeChanges: string[]
  foreshadowingChanges: string[]
  timelineEvents: string[]
  hasMoreCharacterStateChanges: boolean
  hasMoreKnowledgeChanges: boolean
  hasMoreForeshadowingChanges: boolean
  hasMoreTimelineEvents: boolean
}

export interface MemoryCenterStats {
  snapshotCount: number
  syncedSnapshotCount: number
  characterCount: number
  activeForeshadowingCount: number
  memoryFileCount: number
}

export interface MemoryCenterDismantlingProjectPreview {
  id: string
  title: string
  chapterCount: number
  analysisCount: number
  structureMemoryCount: number
  useInChat: boolean
  structureMemory: string[]
}

export interface MemoryCenterData {
  stats: MemoryCenterStats
  snapshots: MemoryCenterSnapshotCard[]
  allChapterNumbers: number[]
  files: MemoryCenterFilePreview[]
  dismantlingProjects: MemoryCenterDismantlingProjectPreview[]
}

const MEMORY_FILE_CONFIGS = [
  { key: "character-states", title: "character-states", fileName: "character-states.md" },
  { key: "character-cognition", title: "character-cognition", fileName: "character-cognition.md" },
  { key: "foreshadowing-tracker", title: "foreshadowing-tracker", fileName: "foreshadowing-tracker.md" },
  { key: "timeline", title: "timeline", fileName: "timeline.md" },
  { key: "canon-facts", title: "canon-facts", fileName: "canon-facts.md" },
  { key: "conflicts", title: "conflicts", fileName: "conflicts.md" },
] as const

const RECENT_SNAPSHOT_CARD_LIMIT = 10

function trimList(items: string[], maxItems: number): { items: string[]; hasMore: boolean } {
  return {
    items: items.slice(0, maxItems),
    hasMore: items.length > maxItems,
  }
}

function isMemoryCenterFilePreview(file: MemoryCenterFilePreview | null): file is MemoryCenterFilePreview {
  return file !== null
}

function snapshotMarkdownPath(projectPath: string, chapterNumber: number): string {
  const prefix = chapterNumber < 0
    ? `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}`
    : String(chapterNumber).padStart(3, "0")
  return `${projectPath}/.novel/snapshots/${prefix}.snapshot.md`
}

function hasSectionContent(section: MemoryCenterSection | null): section is MemoryCenterSection {
  return Boolean(
    section &&
      (section.items.length > 0 ||
        section.groups.some((group) => group.title.trim() || group.items.length > 0)),
  )
}

function stripFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) return normalized

  const lines = normalized.split(/\r?\n/)
  if (lines[0].trim() !== "---") return normalized

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return lines.slice(index + 1).join("\n")
    }
  }
  return normalized
}

export function parseMemoryMarkdownPreview(
  markdown: string,
  maxSections = 3,
  maxGroupsPerSection = 4,
  maxItemsPerGroup = 3,
): MemoryCenterSection[] {
  const sections: MemoryCenterSection[] = []
  const lines = stripFrontmatter(markdown).split(/\r?\n/)

  let currentSection: MemoryCenterSection | null = null
  let currentGroup: MemoryCenterGroup | null = null

  const flushGroup = () => {
    if (!currentSection || !currentGroup) return
    if (currentGroup.title.trim() || currentGroup.items.length > 0) {
      currentSection.groups.push(currentGroup)
    }
    currentGroup = null
  }

  const flushSection = () => {
    flushGroup()
    if (hasSectionContent(currentSection)) {
      sections.push(currentSection)
    }
    currentSection = null
  }

  const ensureSection = () => {
    if (!currentSection) {
      currentSection = {
        title: "概览",
        groups: [],
        items: [],
      }
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("# ")) continue

    if (trimmed.startsWith("## ")) {
      flushSection()
      currentSection = {
        title: trimmed.slice(3).trim(),
        groups: [],
        items: [],
      }
      continue
    }

    if (trimmed.startsWith("### ")) {
      ensureSection()
      flushGroup()
      currentGroup = {
        title: trimmed.slice(4).trim(),
        items: [],
      }
      continue
    }

    if (!trimmed.startsWith("- ")) continue

    ensureSection()
    if (!currentSection) continue
    const item = trimmed.slice(2).trim()
    if (!item) continue

    if (currentGroup) {
      currentGroup.items.push(item)
    } else {
      currentSection.items.push(item)
    }
  }

  flushSection()

  return sections.slice(0, maxSections).map((section) => ({
    title: section.title,
    items: section.items.slice(0, maxItemsPerGroup),
    groups: section.groups.slice(0, maxGroupsPerSection).map((group) => ({
      title: group.title,
      items: group.items.slice(0, maxItemsPerGroup),
    })),
  }))
}

export function buildMemoryCenterSnapshotCards(
  snapshots: ChapterSnapshot[],
  limit = 6,
  maxItemsPerList = 3,
): MemoryCenterSnapshotCard[] {
  // 分离章节快照（正数）和大纲快照（负数），章节快照降序排列在前
  const chapterSnapshots = snapshots.filter((s) => s.chapterNumber > 0)
  const outlineSnapshots = snapshots.filter((s) => s.chapterNumber < 0)
  chapterSnapshots.sort((a, b) => b.chapterNumber - a.chapterNumber)
  outlineSnapshots.sort((a, b) => b.chapterNumber - a.chapterNumber)
  const sorted = [...chapterSnapshots, ...outlineSnapshots]
  return sorted
    .slice(0, limit)
    .map((snapshot) => {
      const characterStateChanges = trimList(snapshot.characterStateChanges, maxItemsPerList)
      const knowledgeChanges = trimList(snapshot.knowledgeChanges, maxItemsPerList)
      const foreshadowingChanges = trimList(snapshot.foreshadowingChanges, maxItemsPerList)
      const timelineEvents = trimList(snapshot.timelineEvents, maxItemsPerList)

      return {
        chapterNumber: snapshot.chapterNumber,
        chapterTitle: snapshot.chapterTitle,
        summary: snapshot.summary.trim(),
        endingHook: snapshot.endingHook.trim(),
        memorySynced: Boolean(snapshot.memorySyncedAt),
        memorySyncedAt: snapshot.memorySyncedAt,
        snapshotPath: snapshotMarkdownPath("", snapshot.chapterNumber).replace(/^\//, ""),
        characterStateChanges: characterStateChanges.items,
        knowledgeChanges: knowledgeChanges.items,
        foreshadowingChanges: foreshadowingChanges.items,
        timelineEvents: timelineEvents.items,
        hasMoreCharacterStateChanges: characterStateChanges.hasMore,
        hasMoreKnowledgeChanges: knowledgeChanges.hasMore,
        hasMoreForeshadowingChanges: foreshadowingChanges.hasMore,
        hasMoreTimelineEvents: timelineEvents.hasMore,
      }
    })
}

export function buildMemoryCenterStats(
  snapshots: MemoryCenterSnapshotCard[],
  files: MemoryCenterFilePreview[],
): MemoryCenterStats {
  const characterFile = files.find((file) => file.key === "character-states")
  const foreshadowingFile = files.find((file) => file.key === "foreshadowing-tracker")
  const activeForeshadowingSection =
    foreshadowingFile?.sections.find((section) => /进行中|in progress|active/i.test(section.title)) ??
    foreshadowingFile?.sections[0]

  return {
    snapshotCount: snapshots.length,
    syncedSnapshotCount: snapshots.filter((snapshot) => snapshot.memorySynced).length,
    characterCount: characterFile?.sections.reduce((sum, section) => sum + section.groups.length, 0) ?? 0,
    activeForeshadowingCount: activeForeshadowingSection?.groups.length ?? 0,
    memoryFileCount: files.length,
  }
}

export async function loadMemoryCenterData(projectPath: string): Promise<MemoryCenterData> {
  const pp = normalizePath(projectPath)
  const snapshotNumbers = await listSnapshots(pp)
  const loadedSnapshots = await Promise.all(snapshotNumbers.map((chapterNumber) => loadSnapshot(pp, chapterNumber)))
  const snapshots = loadedSnapshots.filter((snapshot): snapshot is ChapterSnapshot => Boolean(snapshot))

  const allSnapshotCards = buildMemoryCenterSnapshotCards(
    snapshots.map((snapshot) => ({
      ...snapshot,
      chapterId: snapshot.chapterId,
    })),
    snapshots.length || 1,
  ).map((card) => ({
    ...card,
    snapshotPath: snapshotMarkdownPath(pp, card.chapterNumber),
  }))

  const files = (
    await Promise.all(
      MEMORY_FILE_CONFIGS.map(async (config): Promise<MemoryCenterFilePreview | null> => {
        const path = `${pp}/wiki/memory/${config.fileName}`
        try {
          const markdown = await readFile(path)
          return {
            key: config.key,
            title: config.title,
            path,
            sections: parseMemoryMarkdownPreview(markdown),
          } satisfies MemoryCenterFilePreview
        } catch {
          return null
        }
      }),
    )
  ).filter(isMemoryCenterFilePreview)

  const dismantlingLibrary = await loadDismantlingLibrary(pp).catch(() => ({ version: 1 as const, projects: [], selectedProjectId: null }))
  const dismantlingProjects = dismantlingLibrary.projects.map((project) => ({
    id: project.id,
    title: project.title,
    chapterCount: project.chapters.length,
    analysisCount: project.analyses.length,
    structureMemoryCount: project.structureMemory.length,
    useInChat: Boolean(project.useInChat),
    structureMemory: project.structureMemory.slice(0, 5),
  }))

  const allChapterNumbers = allSnapshotCards
    .filter((c) => c.chapterNumber > 0)
    .map((c) => c.chapterNumber)

  return {
    stats: buildMemoryCenterStats(allSnapshotCards, files),
    snapshots: allSnapshotCards.slice(0, RECENT_SNAPSHOT_CARD_LIMIT),
    allChapterNumbers,
    files,
    dismantlingProjects,
  }
}
