import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { ChapterSnapshot } from "./chapter-ingest"

export const MEMORY_FIELDS = ["knowledgeChanges", "characterStateChanges", "foreshadowingChanges", "timelineEvents", "newCanonFacts", "conflicts"] as const
export type MemoryField = typeof MEMORY_FIELDS[number]
export const MEMORY_LABELS: Record<MemoryField, string> = {
  knowledgeChanges: "人物认知", characterStateChanges: "人物状态", foreshadowingChanges: "伏笔",
  timelineEvents: "时间线", newCanonFacts: "正式事实", conflicts: "冲突",
}
export interface MemoryRemoval { chapterNumber: number; field: MemoryField; text: string }
export interface MemoryCleanupPolicy { version: 1; removed: MemoryRemoval[]; kept: string[] }

export function normalizeMemoryText(text: string): string { return text.normalize("NFKC").replace(/\s+/gu, "").trim() }
export function memoryRemovalKey(value: MemoryRemoval): string {
  return JSON.stringify([value.chapterNumber, value.field, normalizeMemoryText(value.text)])
}
export function memoryPolicyPath(projectPath: string): string { return `${normalizePath(projectPath)}/.novel/memory-cleanup.json` }

// Missing is allowed; corrupt decisions must never silently reactivate deleted memories.
export async function loadMemoryCleanupPolicy(projectPath: string): Promise<MemoryCleanupPolicy> {
  const path = memoryPolicyPath(projectPath)
  if (!await fileExists(path)) return { version: 1, removed: [], kept: [] }
  const data = JSON.parse(await readFile(path)) as MemoryCleanupPolicy
  if (data.version !== 1 || !Array.isArray(data.removed) || !Array.isArray(data.kept)
    || data.removed.some((r) => !r || !Number.isFinite(r.chapterNumber) || !MEMORY_FIELDS.includes(r.field) || typeof r.text !== "string")
    || data.kept.some((key) => typeof key !== "string")) throw new Error("记忆清理记录损坏，请先恢复备份。")
  return data
}
export async function saveMemoryCleanupPolicy(projectPath: string, policy: MemoryCleanupPolicy): Promise<void> {
  await createDirectory(`${normalizePath(projectPath)}/.novel`)
  await writeFileAtomic(memoryPolicyPath(projectPath), JSON.stringify(policy, null, 2))
}

export function filterRemovedMemories(snapshot: ChapterSnapshot, policy: MemoryCleanupPolicy): ChapterSnapshot {
  const removed = new Set(policy.removed.filter((r) => r.chapterNumber === snapshot.chapterNumber).map(memoryRemovalKey))
  if (!removed.size) return snapshot
  const next = { ...snapshot }
  const deleted: string[] = []
  for (const field of MEMORY_FIELDS) {
    next[field] = snapshot[field].filter((text) => {
      if (!removed.has(memoryRemovalKey({ chapterNumber: snapshot.chapterNumber, field, text }))) return true
      deleted.push(text)
      return false
    })
  }
  // A deleted recognition may also have a derived graph edge. Remove only an
  // edge whose subject and object both occur in that exact removed fact.
  next.graphEdges = snapshot.graphEdges.filter((edge) => {
    const [subject, relation, object] = edge.split("->").map((s) => s.trim())
    if (!subject || !object || !/知道|不知道|KNOWS|DOES_NOT_KNOW|伏笔/.test(relation ?? "")) return true
    return !deleted.some((text) => text.includes(subject) && text.includes(object))
  })
  return next
}

// Serialize maintenance with snapshot commits so an in-flight extraction cannot
// overwrite cleaned facts. The commit reads the decisions after obtaining the lock.
const locks = new Map<string, Promise<unknown>>()
export async function withMemoryWriteLock<T>(projectPath: string, run: () => Promise<T>): Promise<T> {
  const key = normalizePath(projectPath).replace(/\/+$/, "")
  const previous = locks.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  locks.set(key, current)
  try { return await current } finally { if (locks.get(key) === current) locks.delete(key) }
}
