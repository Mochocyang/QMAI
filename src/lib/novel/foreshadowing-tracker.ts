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