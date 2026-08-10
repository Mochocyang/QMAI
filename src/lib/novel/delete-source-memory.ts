import { normalizePath } from "@/lib/path-utils"
import { deleteFile, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { parseSources, writeSources } from "@/lib/sources-merge"
import { parseFrontmatter } from "@/lib/frontmatter"
import { clearGraphCache } from "@/lib/graph-relevance"
import { mapWithConcurrency } from "@/lib/async-pool"
import { useWikiStore } from "@/stores/wiki-store"
import { isChapterPage, isFinalChapter, parseChapterNumber } from "./chapter-meta"
import type { FileNode } from "@/types/wiki"

export type NovelSourceKind = "chapter" | "outline"

export interface DeleteNovelSourceMemoryInput {
  kind: NovelSourceKind
  pagePath: string
  content?: string
}

interface PendingChapterCleanup {
  chapterNumber: number
  pagePath: string
}

const ENTITY_CLEANUP_CONCURRENCY = 16
const BACKGROUND_CLEANUP_DEBOUNCE_MS = 50
const pendingChapterCleanups = new Map<string, Map<number, PendingChapterCleanup>>()
let cleanupTimer: ReturnType<typeof setTimeout> | null = null
let cleanupWorker: Promise<void> | null = null

export function getOutlineSnapshotNumberFromPath(outlinePath: string): number {
  const normalizedPath = normalizePath(outlinePath)
  const fileName = normalizedPath.split("/").pop() ?? "outline"
  const outlineName = fileName.replace(/\.\w+$/, "")
  let hash = 0
  for (let i = 0; i < outlineName.length; i += 1) {
    hash = ((hash << 5) - hash + outlineName.charCodeAt(i)) | 0
  }
  return -(Math.abs(hash % 999) + 1)
}

export function getChapterSnapshotNumberFromDeletedSource(input: DeleteNovelSourceMemoryInput): number | null {
  if (input.kind === "outline") {
    return getOutlineSnapshotNumberFromPath(input.pagePath)
  }

  const frontmatterNumber = input.content?.match(/^chapter_number:\s*(\d+)\s*$/m)?.[1]
  if (frontmatterNumber) {
    const parsed = Number.parseInt(frontmatterNumber, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const fileName = normalizePath(input.pagePath).split("/").pop() ?? ""
  const pathNumber = fileName.match(/(\d+)/)?.[1]
  if (!pathNumber) return null
  const parsed = Number.parseInt(pathNumber, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function flattenEntityFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenEntityFiles(node.children))
      continue
    }
    if (!node.is_dir && node.name.toLowerCase().endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function flattenMarkdownFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMarkdownFiles(node.children))
      continue
    }
    if (!node.is_dir && node.name.toLowerCase().endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function snapshotSourceFileNameCandidates(snapshotNumber: number): string[] {
  if (snapshotNumber < 0) {
    const absolute = Math.abs(snapshotNumber)
    return [
      `outline-${String(absolute).padStart(3, "0")}.snapshot.json`,
      `outline-${absolute}.snapshot.json`,
    ]
  }
  return [
    `${String(snapshotNumber).padStart(3, "0")}.snapshot.json`,
    `${snapshotNumber}.snapshot.json`,
  ]
}

async function cleanupDeletedSourceEntities(projectPath: string, snapshotNumbers: readonly number[]): Promise<void> {
  const pp = normalizePath(projectPath)
  const deletedSources = new Set(snapshotNumbers.flatMap(snapshotSourceFileNameCandidates))
  let entityFiles: FileNode[] = []

  try {
    entityFiles = flattenEntityFiles(await listDirectory(`${pp}/wiki/entities`))
  } catch {
    return
  }

  await mapWithConcurrency(entityFiles, ENTITY_CLEANUP_CONCURRENCY, async (file) => {
    try {
      const content = await readFile(file.path)
      const sources = parseSources(content)
      const remainingSources = sources.filter((source) => !deletedSources.has(source))
      if (remainingSources.length === sources.length) return

      if (remainingSources.length === 0) {
        await deleteFile(file.path)
        return
      }

      await writeFileAtomic(file.path, writeSources(content, remainingSources))
    } catch (error) {
      console.error("[delete-source-memory] failed to clean entity source:", file.path, error)
    }
  })
}

async function listCurrentChapterNumbers(projectPath: string): Promise<Set<number> | null> {
  let chapterFiles: FileNode[] = []
  try {
    chapterFiles = flattenMarkdownFiles(await listDirectory(`${normalizePath(projectPath)}/wiki/chapters`))
  } catch {
    return null
  }

  const chapterNumbers = await mapWithConcurrency(
    chapterFiles,
    ENTITY_CLEANUP_CONCURRENCY,
    async (file): Promise<number | null> => {
      try {
        const parsed = parseFrontmatter(await readFile(file.path))
        const frontmatter = parsed.frontmatter as Record<string, unknown> | null
        if (!frontmatter || !isChapterPage(frontmatter)) return null
        return parseChapterNumber(frontmatter.chapter_number)
      } catch {
        return null
      }
    },
  )

  return new Set(chapterNumbers.filter((chapterNumber): chapterNumber is number => chapterNumber !== null))
}

export function shouldCleanupDeletedChapterMemory(content?: string): boolean {
  if (!content) return false
  try {
    const parsed = parseFrontmatter(content)
    const frontmatter = parsed.frontmatter as Record<string, unknown> | null
    return Boolean(frontmatter && isChapterPage(frontmatter) && isFinalChapter(frontmatter))
  } catch {
    return false
  }
}

async function runDeletedChapterCleanupBatch(
  projectPath: string,
  entries: readonly PendingChapterCleanup[],
): Promise<void> {
  const restoredPaths = await mapWithConcurrency(
    entries,
    ENTITY_CLEANUP_CONCURRENCY,
    async (entry) => {
      try {
        return await fileExists(entry.pagePath)
      } catch {
        return false
      }
    },
  )
  const missingEntries = entries.filter((_, index) => !restoredPaths[index])
  if (missingEntries.length === 0) return

  const currentChapterNumbers = await listCurrentChapterNumbers(projectPath)
  if (!currentChapterNumbers) {
    console.error("[delete-source-memory] failed to verify current chapters; cleanup skipped:", projectPath)
    return
  }
  const activeEntries = missingEntries.filter((entry) => !currentChapterNumbers.has(entry.chapterNumber))
  if (activeEntries.length === 0) return

  const snapshotNumbers = [...new Set(activeEntries.map((entry) => entry.chapterNumber))]
  const {
    deleteChapterSnapshotArtifacts,
    rebuildDerivedMemoryFromSnapshots,
  } = await import("@/lib/novel/chapter-ingest")

  await mapWithConcurrency(
    snapshotNumbers,
    ENTITY_CLEANUP_CONCURRENCY,
    async (chapterNumber) => deleteChapterSnapshotArtifacts(projectPath, chapterNumber),
  )

  try {
    await rebuildDerivedMemoryFromSnapshots(projectPath)
  } catch (error) {
    console.error("[delete-source-memory] failed to rebuild derived memory:", projectPath, error)
  }

  await cleanupDeletedSourceEntities(projectPath, snapshotNumbers)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()
}

async function processPendingChapterCleanups(): Promise<void> {
  while (pendingChapterCleanups.size > 0) {
    const next = pendingChapterCleanups.entries().next().value as
      | [string, Map<number, PendingChapterCleanup>]
      | undefined
    if (!next) return

    const [projectPath, pending] = next
    pendingChapterCleanups.delete(projectPath)
    try {
      await runDeletedChapterCleanupBatch(projectPath, [...pending.values()])
    } catch (error) {
      console.error("[delete-source-memory] background cleanup failed:", projectPath, error)
    }
  }
}

function startCleanupWorker(): void {
  if (cleanupWorker) return
  cleanupWorker = processPendingChapterCleanups().finally(() => {
    cleanupWorker = null
    if (pendingChapterCleanups.size > 0) scheduleCleanupWorker()
  })
}

function scheduleCleanupWorker(): void {
  if (cleanupTimer || cleanupWorker) return
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null
    startCleanupWorker()
  }, BACKGROUND_CLEANUP_DEBOUNCE_MS)
}

export function enqueueDeletedChapterMemoryCleanup(
  projectPath: string,
  chapterNumber: number,
  pagePath: string,
): void {
  const pp = normalizePath(projectPath)
  const pending = pendingChapterCleanups.get(pp) ?? new Map<number, PendingChapterCleanup>()
  pending.set(chapterNumber, { chapterNumber, pagePath: normalizePath(pagePath) })
  pendingChapterCleanups.set(pp, pending)
  scheduleCleanupWorker()
}

export async function flushDeletedChapterMemoryCleanup(): Promise<void> {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer)
    cleanupTimer = null
    startCleanupWorker()
  }
  if (cleanupWorker) await cleanupWorker
  if (pendingChapterCleanups.size > 0 || cleanupTimer || cleanupWorker) {
    await flushDeletedChapterMemoryCleanup()
  }
}

export async function deleteNovelSourceMemory(
  projectPath: string,
  input: DeleteNovelSourceMemoryInput,
): Promise<void> {
  const snapshotNumber = getChapterSnapshotNumberFromDeletedSource(input)
  if (snapshotNumber === null) return

  if (input.kind === "chapter") {
    if (!shouldCleanupDeletedChapterMemory(input.content)) return
    enqueueDeletedChapterMemoryCleanup(projectPath, snapshotNumber, input.pagePath)
    return
  }

  const { deleteChapterSnapshots } = await import("@/lib/novel/chapter-ingest")
  await deleteChapterSnapshots(projectPath, snapshotNumber)
  await cleanupDeletedSourceEntities(projectPath, [snapshotNumber])
}
