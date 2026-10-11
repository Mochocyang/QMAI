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
  /**
   * 文件名里的数字。树推不出 `chapterNumber` 时会带这个兜底
   * （见 `WikiPageInfo.fileChapterNumber` 的说明）：不兜的话，这类章节
   * 会因为「算不出章号」被整章跳过，用户按了「提取全部」却什么都没发生。
   */
  fileChapterNumber?: number
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
  fileChapterNumber?: number
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, "")
}

function baseName(path: string): string {
  return stripMarkdownExtension(path.slice(path.lastIndexOf("/") + 1))
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function chapterNumberOf(fileName: string, content: string): number | undefined {
  const parsed = parseFrontmatter(content)
  const value = parsed.frontmatter?.chapter_number
  const fromMeta = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta
  return extractChapterNumber(fileName) ?? undefined
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
      chapterNumber: positiveNumber(chapter.chapterNumber),
      fileChapterNumber: positiveNumber(chapter.fileChapterNumber),
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

  if (candidates.length === 0) return emptyResult("no_chapters")

  const abortController = new AbortController()
  /*
   * 进度任务在「筛出待提取章节」之前就开。
   *
   * 为什么要提前：筛选要对每个候选章节 readFile + fileExists，书一大就是
   * 几百次磁盘往返、几秒钟。那几秒同样是「用户已经按下按钮」的时间 ——
   * 不先开任务，那段时间图标是静的、取消是灰的，正是用户报的「点了没反应」。
   */
  const taskId = useImportProgressStore.getState().startTask({
    projectPath: root,
    kind: "chapter",
    total: candidates.length,
    currentTitle: candidates[0].title ?? candidates[0].name,
    message: "正在检查待提取章节",
    abortController,
  })

  let succeeded = 0
  const failures: BulkChapterIngestResult["failures"] = []
  let plannedTotal = candidates.length
  let settled = false

  /*
   * 取消有两种来源：用户点界面上的「取消」（store 的 cancelTask 已经把任务
   * 结算成 cancelled 并 abort），或别处直接 abort。
   *
   * 第一种情况不能再指望「任务还在 running」这个前提：store 早就把 status
   * 改成 cancelled 了，只在 running 时才补结算的话，恰恰会把「已取消，完成了
   * N 个」这句话漏掉，任务栏会一直停在「正在一键提取章节记忆」的旧文案上。
   * 只有 done / error 才是不该覆盖的终态。
   */
  function settleCancelled(): BulkChapterIngestResult {
    const task = useImportProgressStore.getState().tasks.find((item) => item.id === taskId)
    if (task && task.status !== "done" && task.status !== "error") {
      settled = true
      useImportProgressStore.getState().finishTask(taskId, "cancelled", {
        completed: succeeded,
        total: plannedTotal,
        currentTitle: "",
        message: `已取消章节记忆提取：已完成 ${succeeded}/${plannedTotal} 个章节。`,
      })
    }
    return { total: plannedTotal, succeeded, failed: failures.length, cancelled: true, failures }
  }

  /** 章号：调用方给的 → 调用方给的「文件名数字」→ 正文 frontmatter → 文件名。 */
  async function resolveChapterNumber(chapter: ResolvedChapter): Promise<number | undefined> {
    if (chapter.chapterNumber) return chapter.chapterNumber
    if (chapter.fileChapterNumber) return chapter.fileChapterNumber
    return chapterNumberOf(chapter.fileName, await readFile(chapter.path))
  }

  const pending: ResolvedChapter[] = []
  for (const chapter of candidates) {
    if (abortController.signal.aborted) return settleCancelled()
    try {
      const chapterNumber = await resolveChapterNumber(chapter)
      // 算不出章号就没法查快照；这种情况仍然放行，让 ingestChapter 明确报
      // 「章节号无效」并被计成一次失败 —— 悄悄跳过会让用户以为全书都提完了。
      if (mode === "pending" && chapterNumber && await fileExists(chapterSnapshotJsonPath(root, chapterNumber))) {
        continue
      }
      pending.push({ ...chapter, chapterNumber })
    } catch {
      // 单个不可读文件不阻断其余章节。
    }
  }

  plannedTotal = pending.length
  if (plannedTotal === 0) {
    settled = true
    useImportProgressStore.getState().finishTask(taskId, "done", {
      completed: 0,
      total: candidates.length,
      currentTitle: "",
      message: mode === "pending" ? "所有章节都已提取过，没有需要处理的未提取章节。" : "没有可提取的章节。",
    })
    // 只有 pending 档才可能因为「都已提取过」而空手而归；all 档本来就要求
    // 连已提取的一起重来，这里再报 already_extracted 就是对用户说谎。
    return emptyResult(mode === "pending" ? "already_extracted" : "no_chapters")
  }

  useImportProgressStore.getState().updateTask(taskId, {
    total: plannedTotal,
    message: "正在一键提取章节记忆",
  })

  for (const chapter of pending) {
    if (abortController.signal.aborted) return settleCancelled()

    useImportProgressStore.getState().updateTask(taskId, {
      completed: succeeded,
      total: plannedTotal,
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

  if (!settled) {
    useImportProgressStore.getState().finishTask(taskId, failures.length > 0 ? "error" : "done", {
      completed: succeeded,
      total: plannedTotal,
      currentTitle: "",
      message: failures.length > 0
        ? `章节记忆提取完成：成功 ${succeeded} 个，失败 ${failures.length} 个。${failures[0]?.reason ? ` 最近错误：${failures[0].reason}` : ""}`
        : `章节记忆提取完成：成功 ${succeeded} 个章节。`,
    })
  }

  return { total: plannedTotal, succeeded, failed: failures.length, cancelled: false, failures }
}
