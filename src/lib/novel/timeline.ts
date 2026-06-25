import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface TimelineEntry {
  chapterNumber: number
  event: string
}

interface TimelineFile {
  version: 1
  entries: TimelineEntry[]
  serial: number
  updatedAt: string
}

function timelinePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.novel/timeline.json`
}

export async function loadTimeline(projectPath: string): Promise<TimelineFile> {
  const path = timelinePath(projectPath)
  try {
    const raw = await readFile(path)
    const data = JSON.parse(raw)
    if (data.version === 1 && Array.isArray(data.entries)) {
      return data as TimelineFile
    }
  } catch {}
  return { version: 1, entries: [], serial: 0, updatedAt: "" }
}

async function saveTimeline(projectPath: string, data: TimelineFile): Promise<void> {
  const path = timelinePath(projectPath)
  data.updatedAt = new Date().toISOString()
  await writeFile(path, JSON.stringify(data, null, 2))
}

export async function mergeSnapshotTimeline(
  projectPath: string,
  chapterNumber: number,
  timelineEvents: string[],
): Promise<void> {
  if (!timelineEvents || timelineEvents.length === 0) return

  const tl = await loadTimeline(projectPath)

  const existing = new Set(tl.entries.map((e) => `${e.chapterNumber}:${e.event}`))

  for (const event of timelineEvents) {
    const key = `${chapterNumber}:${event}`
    if (!existing.has(key)) {
      tl.serial++
      tl.entries.push({ chapterNumber, event })
      existing.add(key)
    }
  }

  await saveTimeline(projectPath, tl)
}

export async function getTimelineEvents(
  projectPath: string,
): Promise<TimelineEntry[]> {
  const tl = await loadTimeline(projectPath)
  return tl.entries.sort((a, b) => a.chapterNumber - b.chapterNumber)
}