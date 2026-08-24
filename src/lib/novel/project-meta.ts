/**
 * 小说项目元数据持久化模块
 * 管理 NovelProject 的完整元数据：标题、题材、目标字数等
 */

import { readFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

interface NovelProjectMeta {
  id: string
  title: string
  genre: string
  targetWords: number
  novelMode: boolean
  createdAt: string
  updatedAt: string
  currentChapter: number
  totalChapters: number
  totalWords: number
  volumes: number
  description: string
}

const NOVEL_META_DIR = ".novel"
const NOVEL_META_FILE = "project-meta.json"

export async function loadNovelProjectMeta(
  projectPath: string,
): Promise<NovelProjectMeta | null> {
  const pp = normalizePath(projectPath)
  const filePath = `${pp}/${NOVEL_META_DIR}/${NOVEL_META_FILE}`
  const exists = await fileExists(filePath)
  if (!exists) return null
  try {
    const raw = await readFile(filePath)
    return JSON.parse(raw) as NovelProjectMeta
  } catch {
    return null
  }
}
