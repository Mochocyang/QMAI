/**
 * 模型配置合并（并集优先，不做价值判断）。
 *
 * 用户口径：
 * - 本地有、云端没有 → **加进云端**；
 * - 云端有、本地没有 → **拉到本地**；
 * - 两边都有且内容相同 → 什么都不做（指纹一致就不打扰用户）；
 * - 两边都有但内容不同 → 取「更新时间较新」的那份，并把它记进 `conflicts`，
 *   由界面提示「有 N 项两边都改过，已保留较新的那份」，让用户自己去设置页调整。
 *
 * 同步过程**永不删除**任何一方的 provider：删除只发生在用户显式操作时。
 */

import { canonicalJson } from "./canonical"

export interface SyncProviderEntry {
  key: string
  value: unknown
  /** 该条最后一次改动时间（毫秒）。缺省 0 视为「很旧」。 */
  updatedAt: number
}

export interface MergeConflictDetail {
  key: string
  /** 本地那一版（含 API Key，只在内存里给界面比对用，不落盘、不上云）。 */
  localValue: unknown
  cloudValue: unknown
  /** 合并时先按更新时间选中的那一份，用户可以在界面上改成另一份。 */
  chosen: "local" | "cloud"
}

export interface MergeOutcome {
  merged: Record<string, SyncProviderEntry>
  /** 只在云端存在、被补进本地的 key。 */
  addedToLocal: string[]
  /** 只在本地存在、需要推到云端的 key。 */
  addedToCloud: string[]
  /** 两边内容不同、按更新时间取了其中一份的 key。 */
  conflicts: string[]
  /** 冲突明细：界面用它让用户自己决定保留哪一份。 */
  conflictDetails: MergeConflictDetail[]
  /** 合并结果是否与本地完全一致（一致就不必推送）。 */
  changedLocally: boolean
}

function newerFirst(a: SyncProviderEntry, b: SyncProviderEntry): SyncProviderEntry {
  if (a.updatedAt === b.updatedAt) return a
  return a.updatedAt > b.updatedAt ? a : b
}

export function mergeProviderConfigs(
  local: Record<string, SyncProviderEntry>,
  cloud: Record<string, SyncProviderEntry>,
): MergeOutcome {
  const merged: Record<string, SyncProviderEntry> = {}
  const addedToLocal: string[] = []
  const addedToCloud: string[] = []
  const conflicts: string[] = []
  const conflictDetails: MergeConflictDetail[] = []

  for (const key of Object.keys(local)) {
    const localEntry = local[key]
    const cloudEntry = cloud[key]
    if (!cloudEntry) {
      merged[key] = localEntry
      addedToCloud.push(key)
      continue
    }
    if (canonicalJson(localEntry.value) === canonicalJson(cloudEntry.value)) {
      // 内容一致：保留本地对象，时间戳取两者较大者，避免来回抖动。
      merged[key] = {
        key,
        value: localEntry.value,
        updatedAt: Math.max(localEntry.updatedAt, cloudEntry.updatedAt),
      }
      continue
    }
    merged[key] = newerFirst(localEntry, cloudEntry)
    conflicts.push(key)
    conflictDetails.push({
      key,
      localValue: localEntry.value,
      cloudValue: cloudEntry.value,
      chosen: newerFirst(localEntry, cloudEntry) === localEntry ? "local" : "cloud",
    })
  }

  for (const key of Object.keys(cloud)) {
    if (local[key]) continue
    merged[key] = cloud[key]
    addedToLocal.push(key)
  }

  const changedLocally =
    addedToLocal.length > 0 ||
    conflicts.some((key) => canonicalJson(merged[key].value) !== canonicalJson(local[key]?.value))

  return { merged, addedToLocal, addedToCloud, conflicts, conflictDetails, changedLocally }
}
