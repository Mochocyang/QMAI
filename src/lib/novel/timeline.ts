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

export function replaceChapterTimelineEntries(
  entries: TimelineEntry[],
  chapterNumber: number,
  timelineEvents: string[] | undefined,
): TimelineEntry[] {
  const kept = entries.filter((entry) => entry.chapterNumber !== chapterNumber)
  const seen = new Set<string>()
  const next: TimelineEntry[] = []
  for (const raw of timelineEvents ?? []) {
    const event = raw.trim()
    if (!event || seen.has(event)) continue
    seen.add(event)
    next.push({ chapterNumber, event })
  }
  return [...kept, ...next]
}

export function timelineEntriesFromSnapshots(
  snapshots: Array<{ chapterNumber: number; timelineEvents?: string[] }>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const snapshot of snapshots) {
    const seen = new Set<string>()
    for (const raw of snapshot.timelineEvents ?? []) {
      const event = raw.trim()
      if (!event || seen.has(event)) continue
      seen.add(event)
      entries.push({ chapterNumber: snapshot.chapterNumber, event })
    }
  }
  return entries
}

/**
 * 用本章最新提取结果覆盖该章时间线，而不是按原文去重后追加。
 * 重新提取时措辞会变，追加会留下重复行。
 */
export async function mergeSnapshotTimeline(
  projectPath: string,
  chapterNumber: number,
  timelineEvents: string[],
): Promise<void> {
  const tl = await loadTimeline(projectPath)
  tl.entries = replaceChapterTimelineEntries(tl.entries, chapterNumber, timelineEvents)
  tl.serial = tl.entries.length
  await saveTimeline(projectPath, tl)
}

export async function rebuildTimelineFromSnapshots(
  projectPath: string,
  snapshots: Array<{ chapterNumber: number; timelineEvents?: string[] }>,
): Promise<void> {
  const entries = timelineEntriesFromSnapshots(snapshots)
  await saveTimeline(projectPath, {
    version: 1,
    entries,
    serial: entries.length,
    updatedAt: "",
  })
}

export async function getTimelineEvents(
  projectPath: string,
): Promise<TimelineEntry[]> {
  const tl = await loadTimeline(projectPath)
  return tl.entries.sort((a, b) => a.chapterNumber - b.chapterNumber)
}