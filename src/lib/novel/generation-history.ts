import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import type { LintResult } from "@/lib/lint"
import { normalizePath } from "@/lib/path-utils"
import { moveFileToTrash } from "@/lib/trash"
import type { NovelReviewResult } from "./review-adapter"
import type { DimensionReviewResult, SixReviewDimensionKey } from "./dimension-review-adapter"

export type GenerationHistoryKind = "lint" | "review"

export type GenerationHistoryResult = LintResult | NovelReviewResult

export interface GenerationHistoryEntry {
  id: string
  kind: GenerationHistoryKind
  title: string
  chapterNumber?: number
  sourcePath?: string
  results: GenerationHistoryResult[]
  dimensionResults?: Partial<Record<SixReviewDimensionKey, DimensionReviewResult>>
  createdAt: string
  filePath: string
}

export interface SaveGenerationHistoryInput {
  kind: GenerationHistoryKind
  title: string
  chapterNumber?: number
  sourcePath?: string
  results: GenerationHistoryResult[]
  dimensionResults?: Partial<Record<SixReviewDimensionKey, DimensionReviewResult>>
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function formatDateTime(value: number): string {
  const date = new Date(value)
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("")
}

function makeHistoryId(now: number): string {
  return `${formatDateTime(now)}-${Math.random().toString(36).slice(2, 8)}`
}

function historyRoot(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/generation-history`
}

function historyKindDir(projectPath: string, kind: GenerationHistoryKind): string {
  return `${historyRoot(projectPath)}/${kind}`
}

async function ensureHistoryDirs(projectPath: string, kind: GenerationHistoryKind): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.qmai`)
  await createDirectory(historyRoot(pp))
  await createDirectory(historyKindDir(pp, kind))
}

function isHistoryEntry(value: unknown): value is GenerationHistoryEntry {
  const entry = value as Partial<GenerationHistoryEntry>
  return Boolean(
    entry &&
      typeof entry.id === "string" &&
      (entry.kind === "lint" || entry.kind === "review") &&
      typeof entry.title === "string" &&
      Array.isArray(entry.results) &&
      typeof entry.createdAt === "string" &&
      typeof entry.filePath === "string",
  )
}

export async function saveGenerationHistoryEntry(
  projectPath: string,
  input: SaveGenerationHistoryInput,
): Promise<GenerationHistoryEntry> {
  const pp = normalizePath(projectPath)
  const now = Date.now()
  const id = makeHistoryId(now)
  const filePath = `${historyKindDir(pp, input.kind)}/${id}.json`
  const entry: GenerationHistoryEntry = {
    id,
    kind: input.kind,
    title: input.title,
    chapterNumber: input.chapterNumber,
    sourcePath: input.sourcePath ? normalizePath(input.sourcePath) : undefined,
    results: input.results,
    dimensionResults: input.dimensionResults,
    createdAt: new Date(now).toISOString(),
    filePath,
  }

  await ensureHistoryDirs(pp, input.kind)
  await writeFile(filePath, JSON.stringify(entry, null, 2))
  return entry
}

export async function listGenerationHistory(
  projectPath: string,
  kind: GenerationHistoryKind,
): Promise<GenerationHistoryEntry[]> {
  const dir = historyKindDir(projectPath, kind)
  let files: Awaited<ReturnType<typeof listDirectory>>
  try {
    files = await listDirectory(dir)
  } catch {
    return []
  }

  const entries: GenerationHistoryEntry[] = []
  for (const file of files) {
    if (file.is_dir || !file.name.endsWith(".json")) continue
    try {
      const parsed = JSON.parse(await readFile(file.path))
      if (isHistoryEntry(parsed) && parsed.kind === kind) {
        entries.push({ ...parsed, filePath: normalizePath(parsed.filePath) })
      }
    } catch {
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function deleteGenerationHistoryEntry(
  projectPath: string,
  filePath: string,
): Promise<void> {
  await moveFileToTrash(projectPath, normalizePath(filePath), "history")
}
