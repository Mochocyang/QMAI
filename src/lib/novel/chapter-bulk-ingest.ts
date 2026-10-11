import { fileExists, listDirectory, readFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { chapterSnapshotJsonPath, ingestChapter } from "./chapter-ingest"
import { extractChapterNumber, flattenMdFiles } from "./chapter-utils"

export type BulkChapterIngestMode = "all" | "pending"

/** 调用方（章节右键菜单）手里已经算好的章节页。 */
export interface BulkChapterTarget {
  path: string
  title?: string
  chapterNumber?: number
}

export interface RunBulkChapterIngestOptions {
  /**
   * `all` 连已提取过的一起重提取；`pending`（默认）只处理还没有快照的章节。
   *
   * 默认是 pending：一键提取的常见用法是「把还没建档的补上」，全量重提取
   * 会白烧一遍模型额度。需要修坏档时由界面显式选 `all`。
   */
  mode?: BulkChapterIngestMode
  /** 给了就不再扫盘：右键菜单那条路用的是树里已经加载好的章节页。 */
  chapters?: BulkChapterTarget[]
}

export interface BulkChapterIngestResult {
  total: number
  succeeded: number
  failed: number
  /** 用户在提取途中取消。此时 total 是计划数，succeeded 是实际完成数。 */
  cancelled: boolean
  emptyReason?: "no_chapters" | "already_extracted"
  failures: Array<{ name: string; reason: string }>
}

export function formatBulkChapterIngestResult(result: BulkChapterIngestResult): string {
  if (result.cancelled) {
    return `已取消章节记忆提取：计划 ${result.total} 个，已完成 ${result.succeeded} 个。`
  }
  if (result.total === 0) {
    return result.emptyReason === "already_extracted"
      ? "所有章节都已提取过，没有需要处理的未提取章节。"
      : "当前章节列表里没有可提取的章节。"
  }
  if (result.failed === 0) return `一键提取完成：共 ${result.total} 个章节，成功 ${result.succeeded} 个。`
  const preview = result.failures.slice(0, 3).map((item) => `${item.name}：${item.reason}`).join("；")
  return `一键提取完成：共 ${result.total} 个章节，成功 ${result.succeeded} 个，失败 ${result.failed} 个。${preview}`
}

interface ResolvedChapter {
  path: string
  /** 显示用名字，不带 `.md`。 */
  name: string
  /** 原始文件名，用来从命名里认章节号。 */
  fileName: string
  title?: string
  chapterNumber?: number
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, "")
}

function baseName(path: string): string {
  return stripMarkdownExtension(path.slice(path.lastIndexOf("/") + 1))
}

function chapterNumberOf(fileName: string, content: string): number | null {
  const parsed = parseFrontmatter(content)
  const value = parsed.frontmatter?.chapter_number
  const fromMeta = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta
  return extractChapterNumber(fileName)
}

function emptyResult(emptyReason: BulkChapterIngestResult["emptyReason"]): BulkChapterIngestResult {
  return { total: 0, succeeded: 0, failed: 0, cancelled: false, failures: [], emptyReason }
}

/**
 * 批量提取章节记忆。
 *
 * 章节与大纲两条「一键提取」入口共用这里的进度与取消语义：进度任务写进
 * `useImportProgressStore`，树里的进度条、取消按钮、章节行的「提取中」灰点
 * 全部读同一份状态 —— 界面上一秒的反馈都必须来自真实任务，不另做一套。
 */
export async function runBulkChapterIngest(
  projectPath: string,
  options: RunBulkChapterIngestOptions = {},
): Promise<BulkChapterIngestResult> {
  const root = normalizePath(projectPath)
  const mode: BulkChapterIngestMode = options.mode ?? "pending"

  let candidates: ResolvedChapter[]
  if (options.chapters) {
    candidates = options.chapters.map((chapter) => ({
      path: normalizePath(chapter.path),
      name: chapter.title?.trim() || baseName(chapter.path),
      fileName: baseName(chapter.path),
      title: chapter.title,
      chapterNumber: chapter.chapterNumber,
    }))
  } else {
    let files: Array<{ name: string; path: string }> = []
    try {
      files = flattenMdFiles(
        await listDirectory(`${root}/wiki/chapters`) as Array<{ name: string; path: string; is_dir: boolean; children?: unknown[] }>,
      )
    } catch {
      return emptyResult("no_chapters")
    }
    candidates = files.map((file) => ({
      path: file.path,
      name: stripMarkdownExtension(file.name),
      fileName: file.name,
    }))
  }

  const pending: ResolvedChapter[] = []
  for (const chapter of candidates) {
    try {
      let chapterNumber = chapter.chapterNumber
      if (typeof chapterNumber !== "number" || !(chapterNumber > 0)) {
        chapterNumber = chapterNumberOf(chapter.fileName, await readFile(chapter.path)) ?? undefined
      }
      if (!chapterNumber) continue
      if (mode === "pending" && await fileExists(chapterSnapshotJsonPath(root, chapterNumber))) continue
      pending.push({ ...chapter, chapterNumber })
    } catch {
      // 单个不可读文件不阻断其余章节。
    }
  }

  if (pending.length === 0) {
    return emptyResult(candidates.length > 0 ? "already_extracted" : "no_chapters")
  }

  const abortController = new AbortController()
  const taskId = useImportProgressStore.getState().startTask({
    projectPath: root,
    kind: "chapter",
    total: pending.length,
    currentTitle: pending[0].title ?? pending[0].name,
    message: "正在一键提取章节记忆",
    abortController,
  })

  let succeeded = 0
  const failures: BulkChapterIngestResult["failures"] = []

  /*
   * 取消有两种来源：用户点界面上的「取消」（store 的 cancelTask 已经把任务
   * 结算成 cancelled），或 AbortController 被别处 abort。第一种不能再调
   * finishTask —— 那会把用户刚看到的「已取消」覆盖成 done/error。
   */
  function settleCancelled(): BulkChapterIngestResult {
    const task = useImportProgressStore.getState().tasks.find((item) => item.id === taskId)
    if (task?.status === "running") {
      useImportProgressStore.getState().finishTask(taskId, "cancelled", {
        completed: succeeded,
        total: pending.length,
        currentTitle: "",
        message: `已取消章节记忆提取：已完成 ${succeeded}/${pending.length} 个章节。`,
      })
    }
    return { total: pending.length, succeeded, failed: failures.length, cancelled: true, failures }
  }

  for (const chapter of pending) {
    if (abortController.signal.aborted) return settleCancelled()

    useImportProgressStore.getState().updateTask(taskId, {
      completed: succeeded,
      total: pending.length,
      currentTitle: chapter.title ?? chapter.name,
      // 章节目录的「提取中」灰点按路径点亮：标题会重名，路径不会。
      activeChapterPaths: [chapter.path],
    })

    try {
      const result = await ingestChapter(root, chapter.path, undefined, abortController.signal, chapter.chapterNumber, {
        allowDraft: true,
      })
      if (result.snapshot) succeeded += 1
      else failures.push({ name: chapter.name, reason: result.error ?? result.failReason ?? "提取失败" })
    } catch (error) {
      failures.push({ name: chapter.name, reason: error instanceof Error ? error.message : "提取失败" })
    }
  }

  if (abortController.signal.aborted) return settleCancelled()

  useImportProgressStore.getState().finishTask(taskId, failures.length > 0 ? "error" : "done", {
    completed: succeeded,
    total: pending.length,
    currentTitle: "",
    message: failures.length > 0
      ? `章节记忆提取完成：成功 ${succeeded} 个，失败 ${failures.length} 个。${failures[0]?.reason ? ` 最近错误：${failures[0].reason}` : ""}`
      : `章节记忆提取完成：成功 ${succeeded} 个章节。`,
  })

  return { total: pending.length, succeeded, failed: failures.length, cancelled: false, failures }
}
