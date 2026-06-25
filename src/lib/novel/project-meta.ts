/**
 * 小说项目元数据持久化模块
 * 管理 NovelProject 的完整元数据：标题、题材、目标字数等
 */

import { readFile, writeFile, createDirectory, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface NovelProjectMeta {
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

export function createDefaultNovelProjectMeta(title: string): NovelProjectMeta {
  const now = new Date().toISOString()
  return {
    id: `novel-${Date.now()}`,
    title,
    genre: "",
    targetWords: 0,
    novelMode: true,
    createdAt: now,
    updatedAt: now,
    currentChapter: 0,
    totalChapters: 0,
    totalWords: 0,
    volumes: 0,
    description: "",
  }
}

export async function saveNovelProjectMeta(
  projectPath: string,
  meta: NovelProjectMeta,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const dir = `${pp}/${NOVEL_META_DIR}`
  const filePath = `${dir}/${NOVEL_META_FILE}`
  await createDirectory(dir)
  const updated = { ...meta, updatedAt: new Date().toISOString() }
  await writeFile(filePath, JSON.stringify(updated, null, 2))
}

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

export async function updateNovelProjectStats(
  projectPath: string,
  stats: Partial<Pick<NovelProjectMeta, "currentChapter" | "totalChapters" | "totalWords" | "volumes">>,
): Promise<void> {
  const existing = await loadNovelProjectMeta(projectPath)
  if (!existing) return
  const updated: NovelProjectMeta = {
    ...existing,
    ...stats,
    updatedAt: new Date().toISOString(),
  }
  await saveNovelProjectMeta(projectPath, updated)
}
