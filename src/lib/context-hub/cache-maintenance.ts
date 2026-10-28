/**
 * 上下文缓存（`.qmai/context-cache`）的统计与清理。
 *
 * 为什么提供「清空缓存」：缓存里放着快照与稳定上下文副本（每次生成 45–128 KB），
 * 用户删掉大纲/章节后，这些文件仍会留在磁盘上。它们**不会**进入提示词（每轮都从
 * 磁盘重建上下文），但会占空间、也会让"我明明删了，怎么还有"的疑虑挥之不去。
 * 所以给维护工具一个显式入口：可查看占用，也可一键清空（派生数据，删了会自动重建）。
 */

import { deleteFile, fileExists, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

import { disposeAllContextHubs } from "./context-hub"

export interface ContextCacheStat {
  exists: boolean
  fileCount: number
  totalBytes: number
}

export function contextCachePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/context-cache`
}

function countTree(nodes: readonly { is_dir: boolean; size?: number; children?: unknown }[]): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  for (const node of nodes) {
    const typed = node as { is_dir: boolean; size?: number; children?: typeof nodes }
    if (typed.is_dir) {
      const nested = countTree(typed.children ?? [])
      files += nested.files
      bytes += nested.bytes
      continue
    }
    files += 1
    bytes += typed.size ?? 0
  }
  return { files, bytes }
}

/** 统计缓存占用；目录不存在时返回 exists=false。 */
export async function measureContextCache(projectPath: string): Promise<ContextCacheStat> {
  const root = contextCachePath(projectPath)
  if (!(await fileExists(root))) return { exists: false, fileCount: 0, totalBytes: 0 }
  try {
    const tree = await listDirectory(root)
    const counted = countTree(tree)
    return { exists: true, fileCount: counted.files, totalBytes: counted.bytes }
  } catch {
    return { exists: true, fileCount: 0, totalBytes: 0 }
  }
}

export interface ClearContextCacheResult {
  existed: boolean
  removedFiles: number
}

/**
 * 清空缓存目录，并丢弃内存里的 hub 实例。
 *
 * 必须 dispose：控制器里既有 manifest 也有文件内容缓存，只删盘不 dispose 的话，
 * 当前会话还会拿内存里的旧副本继续用，直到重启。
 */
export async function clearContextCache(projectPath: string): Promise<ClearContextCacheResult> {
  const root = contextCachePath(projectPath)
  const stat = await measureContextCache(projectPath)
  disposeAllContextHubs()
  if (!stat.exists) return { existed: false, removedFiles: 0 }
  try {
    await deleteFile(root)
  } catch (error) {
    console.warn("[context-cache] 清空失败:", root, error)
    throw error
  }
  return { existed: true, removedFiles: stat.fileCount }
}
