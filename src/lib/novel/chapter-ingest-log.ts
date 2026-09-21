import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export const CHAPTER_INGEST_LOG_REL = ".qmai/chapter-ingest.log"
const OUTPUT_PREVIEW_CHARS = 4_000
const MAX_LOG_BYTES = 512 * 1024

export type ChapterIngestLogEvent = "start" | "ok" | "fail"

export interface ChapterIngestLogEntry {
  at: string
  event: ChapterIngestLogEvent
  chapterNumber?: number
  chapterPath?: string
  failReason?: string
  error?: string
  model?: string
  provider?: string
  elapsedMs?: number
  outputChars?: number
  outputPreview?: string
}

let writeQueue: Promise<void> = Promise.resolve()

export function chapterIngestLogPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${CHAPTER_INGEST_LOG_REL}`
}

export function previewLlmOutput(raw: string, maxChars = OUTPUT_PREVIEW_CHARS): string {
  const trimmed = raw.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}…[truncated ${trimmed.length - maxChars} chars]`
}

export function formatChapterIngestLogLine(entry: ChapterIngestLogEntry): string {
  return `${JSON.stringify(entry)}\n`
}

async function writeLogFile(projectPath: string, line: string): Promise<void> {
  const dir = `${normalizePath(projectPath)}/.qmai`
  const path = chapterIngestLogPath(projectPath)
  await createDirectory(dir).catch(() => {})
  let prev = ""
  if (await fileExists(path)) {
    prev = await readFile(path)
  }
  if (prev.length > MAX_LOG_BYTES) {
    prev = prev.slice(prev.length - MAX_LOG_BYTES / 2)
    const cut = prev.indexOf("\n")
    if (cut >= 0) prev = prev.slice(cut + 1)
  }
  await writeFileAtomic(path, `${prev}${line}`)
}

export async function appendChapterIngestLog(
  projectPath: string,
  entry: Omit<ChapterIngestLogEntry, "at"> & { at?: string },
): Promise<void> {
  const line = formatChapterIngestLogLine({
    at: entry.at ?? new Date().toISOString(),
    ...entry,
  })
  const next = writeQueue.then(() => writeLogFile(projectPath, line))
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  try {
    await next
  } catch (error) {
    console.error("[Chapter Ingest] failed to write log:", error)
  }
}
