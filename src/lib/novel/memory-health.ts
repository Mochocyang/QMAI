/**
 * 记忆体检：找出「记忆快照还在，但对应的章节/大纲文件已经没了」的孤儿来源。
 *
 * 为什么必须体检：`wiki/memory/*.md` 会被注入写作提示词（`readSnapshotContext`），
 * AI 也能用 `read_memory` 读到。删除文件时软件会顺手清理，但两种情况会漏：
 * 1. 用户在资源管理器里直接删文件；
 * 2. 删除时清理失败（文件占用、异步中断）。
 * 漏掉的摘要会继续"描述"已经不存在的大纲/章节 —— 这就是用户担心的资料污染。
 *
 * 判定方式（确定性，不调模型）：
 * - 现有快照编号来自 `.novel/snapshots`（`listSnapshots`）；
 * - 合法编号 = 现有章节的 `chapter_number`/文件名数字 ∪ 现有大纲的哈希编号；
 * - 两头都不在 → 孤儿。
 */

import { listDirectory, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { isChapterPage, parseChapterNumber } from "./chapter-meta"
import { listSnapshots } from "./chapter-ingest"
import { getOutlineSnapshotNumberFromPath } from "./delete-source-memory"
import type { FileNode } from "@/types/wiki"

export interface OrphanMemorySource {
  snapshotNumber: number
  /** 负数编号来自大纲（文件名哈希），正数来自章节号。 */
  kind: "chapter" | "outline"
  /** 给用户看的说明，例如「第 23 章」/「大纲快照 #-57」。 */
  label: string
}

export interface MemoryHealthReport {
  scannedAt: number
  /** 现有快照总数。 */
  snapshotCount: number
  /** 现有章节数 / 大纲数，用于解释"为什么判成孤儿"。 */
  chapterCount: number
  outlineCount: number
  orphans: OrphanMemorySource[]
}

function flattenMarkdown(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      files.push(...flattenMarkdown(node.children ?? []))
      continue
    }
    if (node.name.toLowerCase().endsWith(".md")) files.push(node)
  }
  return files
}

async function listMarkdownFiles(dir: string): Promise<FileNode[]> {
  try {
    return flattenMarkdown(await listDirectory(dir))
  } catch {
    return []
  }
}

/** 现有章节编号：优先 frontmatter 的 chapter_number，回退文件名里的数字。 */
async function collectChapterNumbers(projectPath: string): Promise<Set<number>> {
  const files = await listMarkdownFiles(`${normalizePath(projectPath)}/wiki/chapters`)
  const numbers = new Set<number>()
  for (const file of files) {
    try {
      const parsed = parseFrontmatter(await readFile(file.path))
      const frontmatter = parsed.frontmatter as Record<string, unknown> | null
      if (frontmatter && isChapterPage(frontmatter)) {
        const fromFrontmatter = parseChapterNumber(frontmatter.chapter_number)
        if (fromFrontmatter !== null) {
          numbers.add(fromFrontmatter)
          continue
        }
      }
    } catch {
      // 读失败就退回文件名
    }
    const digits = file.name.match(/(\d+)/)?.[1]
    if (digits) {
      const parsedNumber = Number.parseInt(digits, 10)
      if (Number.isFinite(parsedNumber) && parsedNumber > 0) numbers.add(parsedNumber)
    }
  }
  return numbers
}

/** 现有大纲编号（负数的文件名哈希），与删除时的算法保持一致。 */
async function collectOutlineNumbers(projectPath: string): Promise<Set<number>> {
  const files = await listMarkdownFiles(`${normalizePath(projectPath)}/wiki/outlines`)
  return new Set(files.map((file) => getOutlineSnapshotNumberFromPath(file.path)))
}

export async function scanMemoryHealth(projectPath: string): Promise<MemoryHealthReport> {
  const [snapshots, chapterNumbers, outlineNumbers] = await Promise.all([
    listSnapshots(projectPath),
    collectChapterNumbers(projectPath),
    collectOutlineNumbers(projectPath),
  ])

  const orphans: OrphanMemorySource[] = []
  for (const snapshotNumber of [...snapshots].sort((a, b) => a - b)) {
    if (snapshotNumber >= 0 && chapterNumbers.has(snapshotNumber)) continue
    if (snapshotNumber < 0 && outlineNumbers.has(snapshotNumber)) continue
    // 大纲的记忆也可能挂在正数编号上（大纲→章纲→章节共用编号），所以正数编号
    // 只有在"既不是现有章节、也不是现有大纲"时才算孤儿。
    orphans.push({
      snapshotNumber,
      kind: snapshotNumber < 0 ? "outline" : "chapter",
      label: snapshotNumber < 0 ? `大纲快照 #${snapshotNumber}` : `第 ${snapshotNumber} 章`,
    })
  }

  return {
    scannedAt: Date.now(),
    snapshotCount: snapshots.length,
    chapterCount: chapterNumbers.size,
    outlineCount: outlineNumbers.size,
    orphans,
  }
}
