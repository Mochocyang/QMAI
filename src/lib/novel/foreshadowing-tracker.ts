import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type {
  ForeshadowingImportance,
  ForeshadowingStatus,
} from "./tracking-types"

export interface Foreshadowing {
  id: string
  name: string
  description: string
  status: ForeshadowingStatus
  plantedChapter: number
  advancedChapters: number[]
  resolvedChapter?: number
  relatedCharacters: string[]
  relatedEvents: string[]
  notes: string
  /** 预计回收章节 */
  expectedResolveChapter?: number
  /** 重要度 */
  importance?: ForeshadowingImportance
}

export interface ForeshadowingStore {
  items: Foreshadowing[]
  lastUpdated: string
}

export function createEmptyForeshadowingStore(): ForeshadowingStore {
  return { items: [], lastUpdated: new Date().toISOString() }
}

/**
 * 从伏笔台账撤掉某一个章节号。只改引用了该编号的条目，其余原样保留。
 * 仅由该编号种下、且没有其它章节推进或回收的条目会被删除。
 */
export function retractChapterFromForeshadowingStore(
  store: ForeshadowingStore,
  chapterNumber: number,
): { store: ForeshadowingStore; changed: boolean } {
  let changed = false
  const items: Foreshadowing[] = []

  for (const item of store.items) {
    const advancedChapters = item.advancedChapters.filter((chapter) => chapter !== chapterNumber)
    const resolvedHere = item.resolvedChapter === chapterNumber
    const plantedHere = item.plantedChapter === chapterNumber
    const remainingChapters = [
      ...advancedChapters,
      ...(!resolvedHere && item.resolvedChapter != null ? [item.resolvedChapter] : []),
    ]
    const advancedChanged = advancedChapters.length !== item.advancedChapters.length

    if (plantedHere && remainingChapters.length === 0) {
      changed = true
      continue
    }
    if (!plantedHere && !resolvedHere && !advancedChanged) {
      items.push(item)
      continue
    }

    let next: Foreshadowing = { ...item, advancedChapters }
    if (plantedHere) {
      next = { ...next, plantedChapter: Math.min(...remainingChapters) }
    }
    if (resolvedHere) {
      const status = next.status === "abandoned"
        ? "abandoned"
        : advancedChapters.length > 0
          ? "advanced"
          : "planted"
      const rest: Foreshadowing = { ...next, status, advancedChapters }
      delete rest.resolvedChapter
      next = rest
    }
    changed = true
    items.push(next)
  }

  if (!changed) return { store, changed: false }
  return { changed: true, store: { ...store, items } }
}

export async function retractForeshadowingChapter(
  projectPath: string,
  chapterNumber: number,
): Promise<boolean> {
  const existing = await loadForeshadowingTracker(projectPath)
  const retracted = retractChapterFromForeshadowingStore(existing, chapterNumber)
  if (!retracted.changed) return false
  await saveForeshadowingTracker(projectPath, {
    ...retracted.store,
    lastUpdated: new Date().toISOString(),
  })
  return true
}

export async function saveForeshadowingTracker(
  projectPath: string,
  store: ForeshadowingStore,
): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.novel`)
  await writeFile(
    `${pp}/.novel/foreshadowing-tracker.json`,
    JSON.stringify(store, null, 2),
  )
}

export async function loadForeshadowingTracker(
  projectPath: string,
): Promise<ForeshadowingStore> {
  const pp = normalizePath(projectPath)
  try {
    const raw = await readFile(`${pp}/.novel/foreshadowing-tracker.json`)
    return JSON.parse(raw)
  } catch {
    return createEmptyForeshadowingStore()
  }
}

let _foreshadowingSerialCounter = 0

/**
 * 自动生成 F001/F002... 格式的伏笔ID
 */
export function generateForeshadowingId(store: ForeshadowingStore): string {
  // 从现有ID中提取最大序号
  let maxSerial = 0
  for (const item of store.items) {
    const match = item.id.match(/^F(\d+)$/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxSerial) maxSerial = num
    }
  }
  if (_foreshadowingSerialCounter <= maxSerial) {
    _foreshadowingSerialCounter = maxSerial + 1
  }
  const id = `F${String(_foreshadowingSerialCounter).padStart(3, "0")}`
  _foreshadowingSerialCounter++
  return id
}