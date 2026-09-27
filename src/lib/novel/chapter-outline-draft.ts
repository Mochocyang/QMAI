/**
 * 章纲分批草稿。
 *
 * 17 节章纲按批生成，中途关闭软件 / 对话被打断时已完成的批次会丢失，下次只能从第 1 批重写。
 * 这里把已完成的批次落到项目 .qmai 目录，重新触发章纲生成时可以直接接着生成下一批。
 */

import { createDirectory, deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  buildChapterBatchPrompt,
  mergeChapterBatches,
  nextChapterBatchRange,
  normalizeChapterOutlineData,
  type ChapterOutlineData,
} from "./chapter-outline-template"

export interface ChapterOutlineDraftBatch {
  data: ChapterOutlineData
  md: string
}

export interface ChapterOutlineDraft {
  conversationId: string
  title: string
  batches: ChapterOutlineDraftBatch[]
  updatedAt: number
}

const DRAFT_DIR = ".qmai"
const DRAFT_FILE = "章纲草稿.json"

function draftFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${DRAFT_DIR}/${DRAFT_FILE}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** 读取项目里的章纲草稿；文件不存在 / 内容不可用时返回 null。 */
export async function readChapterOutlineDraft(
  projectPath: string | null | undefined,
): Promise<ChapterOutlineDraft | null> {
  if (!projectPath?.trim()) return null
  try {
    const path = draftFilePath(projectPath)
    if (!(await fileExists(path))) return null
    const raw: unknown = JSON.parse(await readFile(path))
    if (!isRecord(raw) || !Array.isArray(raw.batches)) return null
    const conversationId = typeof raw.conversationId === "string" ? raw.conversationId : ""
    if (!conversationId) return null
    const batches: ChapterOutlineDraftBatch[] = []
    for (const item of raw.batches) {
      if (!isRecord(item)) continue
      const data = normalizeChapterOutlineData(item.data)
      if (!data) continue
      batches.push({ data, md: typeof item.md === "string" ? item.md : "" })
    }
    if (batches.length === 0) return null
    return {
      conversationId,
      title: typeof raw.title === "string" ? raw.title : batches[0].data.title,
      batches,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    }
  } catch {
    return null
  }
}

/** 写入章纲草稿；写失败不影响正常生成。 */
export async function writeChapterOutlineDraft(
  projectPath: string | null | undefined,
  draft: ChapterOutlineDraft,
): Promise<void> {
  if (!projectPath?.trim()) return
  try {
    await createDirectory(`${normalizePath(projectPath)}/${DRAFT_DIR}`)
    await writeFile(draftFilePath(projectPath), JSON.stringify(draft, null, 2))
  } catch {
    // 草稿只是续跑用的缓存，写不进去也不该打断生成
  }
}

/** 删除章纲草稿（合并保存成功后调用）。 */
export async function clearChapterOutlineDraft(
  projectPath: string | null | undefined,
): Promise<void> {
  if (!projectPath?.trim()) return
  try {
    const path = draftFilePath(projectPath)
    if (await fileExists(path)) await deleteFile(path)
  } catch {
    // 忽略
  }
}

/** 草稿对应的下一批提示词；草稿已覆盖全部批次时返回 null。 */
export function buildChapterOutlineResumePrompt(draft: ChapterOutlineDraft): string | null {
  if (draft.batches.length === 0) return null
  const data = mergeChapterBatches(draft.batches.map((item) => item.data))
  const batch = nextChapterBatchRange(data)
  if (!batch) return null
  return buildChapterBatchPrompt({ data, batch })
}