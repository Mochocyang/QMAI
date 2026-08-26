/**
 * 故事导图历史管理（chaishugushidaotu 分支）
 *
 * 需求：每次故事 Skill 生成的导图都要完整保留，不能覆盖之前生成的。
 *
 * 落盘策略：
 * 1. 历史版：story-maps/story-map-<createdAt>/story-map.{json,html}
 *    —— 每次生成新增一份，永不覆盖。
 * 2. 最新引用：根目录 story-map.{json,html}
 *    —— 始终指向最近一次，供验证引擎 / 「打开故事导图」/ 旧数据兼容使用。
 */

import {
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory,
  readFile,
  writeFile,
} from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { moveFileToTrash } from "@/lib/trash"
import { renderStoryMapHtml } from "./story-map-renderer"
import type { StoryMap } from "./story-map-types"

/** 历史导图存放目录名（位于 bookPath 下） */
export const STORY_MAPS_DIR = "story-maps"

export interface StoryMapHistoryEntry {
  /** 历史目录名，如 story-map-1756100000000 */
  dirName: string
  /** 该版本的导图数据 */
  map: StoryMap
  /** 该版本的 story-map.json 绝对路径 */
  jsonPath: string
  /** 该版本的 story-map.html 绝对路径 */
  htmlPath: string
}

function historyRoot(bookPath: string): string {
  return normalizePath(joinPath(bookPath, STORY_MAPS_DIR))
}

function historyDirName(createdAt: number, index: number): string {
  return index === 0 ? `story-map-${createdAt}` : `story-map-${createdAt}-${index}`
}

/**
 * 写入故事导图（历史版 + 最新引用）。
 * 历史版目录按 createdAt 命名，若同毫秒重复生成则追加序号，确保互不覆盖。
 */
export async function writeStoryMapFiles(bookPath: string, map: StoryMap): Promise<void> {
  const json = JSON.stringify(map, null, 2)
  const html = renderStoryMapHtml(map)

  const root = historyRoot(bookPath)
  await createDirectory(root)
  let dirName = historyDirName(map.createdAt, 0)
  let index = 1
  while (await fileExists(joinPath(root, dirName))) {
    dirName = historyDirName(map.createdAt, index++)
  }
  const dirPath = normalizePath(joinPath(root, dirName))
  await createDirectory(dirPath)
  await writeFile(normalizePath(joinPath(dirPath, "story-map.json")), json)
  await writeFile(normalizePath(joinPath(dirPath, "story-map.html")), html)

  // 最新引用：根目录固定两份，验证引擎与「打开故事导图」继续使用
  await writeFile(normalizePath(joinPath(bookPath, "story-map.json")), json)
  await writeFile(normalizePath(joinPath(bookPath, "story-map.html")), html)
}

/** 列出全部历史导图（按生成时间升序，旧的在前；调用方可自行倒序）。损坏目录自动跳过。 */
export async function listStoryMapHistory(bookPath: string): Promise<StoryMapHistoryEntry[]> {
  const root = historyRoot(bookPath)
  let entries
  try {
    entries = await listDirectory(root)
  } catch {
    return []
  }

  const result: StoryMapHistoryEntry[] = []
  for (const entry of entries) {
    if (!entry.is_dir) continue
    const jsonPath = normalizePath(joinPath(entry.path, "story-map.json"))
    try {
      const raw = await readFile(jsonPath)
      const map = JSON.parse(raw) as StoryMap
      if (!map || typeof map !== "object" || !Array.isArray(map.chapters)) continue
      result.push({
        dirName: entry.name,
        map,
        jsonPath,
        htmlPath: normalizePath(joinPath(entry.path, "story-map.html")),
      })
    } catch {
      // 跳过损坏 / 不完整的历史目录
    }
  }

  result.sort((left, right) => left.map.createdAt - right.map.createdAt)
  return result
}

/** 历史导图目录名校验：仅允许本仓库生成的 story-map-<createdAt>[-<index>] 目录 */
const STORY_MAP_DIR_PATTERN = /^story-map-\d+(-\d+)?$/

/**
 * 删除指定历史导图目录，并刷新根目录最新引用。
 *
 * @param bookPath 拆书库作品目录
 * @param dirName 历史目录名（story-map-<createdAt>，会被校验）
 * @param projectPath 可选的项目根目录；传入时删除的导图目录会移入应用内回收站（.trash）而非永久删除
 */
export async function deleteStoryMapHistory(bookPath: string, dirName: string, projectPath?: string): Promise<void> {
  if (!STORY_MAP_DIR_PATTERN.test(dirName)) {
    throw new Error("故事导图目录名不合法，已取消删除")
  }
  const dirPath = normalizePath(joinPath(historyRoot(bookPath), dirName))
  if (!(await fileExists(dirPath))) return

  if (projectPath) {
    // 移入应用内回收站，可恢复
    await moveFileToTrash(projectPath, dirPath, "storymap")
  } else {
    await deleteFile(dirPath)
  }

  // 刷新根目录最新引用
  const remaining = await listStoryMapHistory(bookPath)
  const latest = remaining[remaining.length - 1] // listStoryMapHistory 按生成时间升序
  const rootJsonPath = normalizePath(joinPath(bookPath, "story-map.json"))
  const rootHtmlPath = normalizePath(joinPath(bookPath, "story-map.html"))
  if (latest) {
    const json = await readFile(latest.jsonPath)
    const html = await readFile(latest.htmlPath)
    await writeFile(rootJsonPath, json)
    await writeFile(rootHtmlPath, html)
  } else {
    if (await fileExists(rootJsonPath)) await deleteFile(rootJsonPath)
    if (await fileExists(rootHtmlPath)) await deleteFile(rootHtmlPath)
  }
}
