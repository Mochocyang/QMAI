import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type {
  ForeshadowingImportance,
  ForeshadowingStatus,
  ResolvedForeshadowingRecord,
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

export function foreshadowingToContextText(store: ForeshadowingStore): string {
  const unresolved = store.items.filter(
    (f) => f.status !== "resolved" && f.status !== "abandoned",
  )
  if (unresolved.length === 0) return ""
  return unresolved
    .map(
      (f) =>
        `- [${f.status === "planted" ? "已埋设" : "推进中"}] ${f.name}：${f.description}（第${f.plantedChapter}章埋设）`,
    )
    .join("\n")
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

/**
 * 标记伏笔推进
 */
export function markForeshadowingAdvanced(
  foreshadowing: Foreshadowing,
  chapter: number,
): void {
  if (foreshadowing.status === "resolved" || foreshadowing.status === "abandoned") return
  foreshadowing.status = "advanced"
  if (!foreshadowing.advancedChapters.includes(chapter)) {
    foreshadowing.advancedChapters.push(chapter)
  }
}

/**
 * 标记伏笔回收并记录
 */
export function markForeshadowingResolved(
  foreshadowing: Foreshadowing,
  chapter: number,
): ResolvedForeshadowingRecord {
  foreshadowing.status = "resolved"
  foreshadowing.resolvedChapter = chapter
  return {
    id: foreshadowing.id,
    resolvedInChapter: chapter,
    resolution: `伏笔「${foreshadowing.name}」在第${chapter}章回收`,
  }
}

/**
 * 获取本章相关伏笔列表
 */
export function getForeshadowingForChapter(
  store: ForeshadowingStore,
  chapterNumber: number,
): Foreshadowing[] {
  return store.items.filter((f) => {
    // 本章埋设的伏笔
    if (f.plantedChapter === chapterNumber) return true
    // 本章推进的伏笔
    if (f.advancedChapters.includes(chapterNumber)) return true
    // 本章回收的伏笔
    if (f.resolvedChapter === chapterNumber) return true
    return false
  })
}

/**
 * 重置伏笔ID计数器（仅用于测试）
 */
export function resetForeshadowingSerialCounter(): void {
  _foreshadowingSerialCounter = 0
}