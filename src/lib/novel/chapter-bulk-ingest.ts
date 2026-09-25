import { fileExists, listDirectory, readFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import { chapterSnapshotJsonPath, ingestChapter } from "./chapter-ingest"
import { extractChapterNumber, flattenMdFiles } from "./chapter-utils"

export interface BulkChapterIngestResult {
  total: number
  succeeded: number
  failed: number
  emptyReason?: "no_chapters" | "already_extracted"
  failures: Array<{ name: string; reason: string }>
}

export function formatBulkChapterIngestResult(result: BulkChapterIngestResult): string {
  if (result.total === 0) {
    return result.emptyReason === "already_extracted"
      ? "所有章节都已提取过，没有需要处理的未提取章节。"
      : "当前章节列表里没有可提取的章节。"
  }
  if (result.failed === 0) return `一键提取完成：共 ${result.total} 个章节，成功 ${result.succeeded} 个。`
  const preview = result.failures.slice(0, 3).map((item) => `${item.name}：${item.reason}`).join("；")
  return `一键提取完成：共 ${result.total} 个章节，成功 ${result.succeeded} 个，失败 ${result.failed} 个。${preview}`
}

function chapterNumberOf(name: string, content: string): number | null {
  const parsed = parseFrontmatter(content)
  const value = parsed.frontmatter?.chapter_number
  const fromMeta = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta
  return extractChapterNumber(name)
}

/** 只处理尚未生成章节记忆快照的章节，已提取章节保持不变。 */
export async function runBulkChapterIngest(projectPath: string): Promise<BulkChapterIngestResult> {
  const root = normalizePath(projectPath)
  let files: Array<{ name: string; path: string }> = []
  try {
    files = flattenMdFiles(await listDirectory(`${root}/wiki/chapters`) as Array<{ name: string; path: string; is_dir: boolean; children?: unknown[] }>)
  } catch {
    return { total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: "no_chapters" }
  }
  const pending: Array<{ name: string; path: string; chapterNumber: number }> = []
  for (const file of files) {
    try {
      const content = await readFile(file.path)
      const chapterNumber = chapterNumberOf(file.name, content)
      if (!chapterNumber || await fileExists(chapterSnapshotJsonPath(root, chapterNumber))) continue
      pending.push({ ...file, chapterNumber })
    } catch {
      // 单个不可读文件不阻断其余章节。
    }
  }
  if (pending.length === 0) return { total: 0, succeeded: 0, failed: 0, failures: [], emptyReason: files.length ? "already_extracted" : "no_chapters" }

  let succeeded = 0
  const failures: BulkChapterIngestResult["failures"] = []
  for (const chapter of pending) {
    try {
      const result = await ingestChapter(root, chapter.path, undefined, undefined, chapter.chapterNumber, { allowDraft: true })
      if (result.snapshot) succeeded += 1
      else failures.push({ name: chapter.name, reason: result.error ?? "提取失败" })
    } catch (error) {
      failures.push({ name: chapter.name, reason: error instanceof Error ? error.message : "提取失败" })
    }
  }
  return { total: pending.length, succeeded, failed: failures.length, failures }
}
