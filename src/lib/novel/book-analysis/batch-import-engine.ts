import {
  copyDirectory,
  createDirectory,
  deleteFile,
  fileExists,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { fingerprintFileSample } from "./content-fingerprint"
import { joinPath, normalizePath } from "@/lib/path-utils"
import {
  buildChapterMarkdown,
  parseNovelChapters,
  type ParsedNovelChapter,
} from "./analysis-engine"
import { hashNormalizedNovel, normalizeNovelForHash } from "./batch-import-hash"
import {
  cleanupCompletedTaskWorkspaceUnlocked,
  importTaskDir,
  loadTaskCheckpoint,
  saveBatchImportTaskUnlocked,
  saveTaskCheckpointUnlocked,
  withBatchImportTaskLock,
} from "./batch-import-storage"
import type {
  BatchImportCheckpoint,
  BatchImportTask,
} from "./batch-import-types"
import { removeBookLibraryEntry, upsertBookLibraryEntry } from "./library-store"
import type { BookAnalysisMetadata } from "./types"

export interface ChapterSummary {
  id: string
  title: string
  order: number
  wordCount: number
  path: string
}

export interface RunBatchImportTaskOptions {
  signal: AbortSignal
  onProgress?: (completed: number, total: number, currentTitle: string) => void
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("用户取消导入")
}

function assertRunnableTask(task: BatchImportTask): void {
  if (
    task.version !== 1
    || !task.id
    || !task.projectPath
    || !task.cachedSourcePath
    || !task.sourceSha256
    || !task.bookId
    || !(task.finalTitle || task.requestedTitle)
  ) {
    throw new Error("批量导入任务数据无效")
  }
  if (task.status !== "splitting") {
    throw new Error("批量导入任务状态不允许执行")
  }
}

function chapterId(chapter: ParsedNovelChapter): string {
  return `ch-${String(chapter.order).padStart(4, "0")}`
}

function chapterFilePath(chaptersPath: string, chapter: ParsedNovelChapter): string {
  return joinPath(chaptersPath, `${chapterId(chapter)}.md`)
}

function isValidChapterFile(
  contents: string,
  bookId: string,
  chapter: ParsedNovelChapter,
): boolean {
  return normalizeNovelForHash(contents) === normalizeNovelForHash(
    buildChapterMarkdown(bookId, chapter),
  )
}

async function findResumeIndex(
  task: BatchImportTask,
  checkpoint: BatchImportCheckpoint | null,
  chapters: ParsedNovelChapter[],
  chaptersPath: string,
): Promise<number> {
  if (
    !checkpoint
    || checkpoint.version !== 1
    || checkpoint.sourceSha256 !== task.sourceSha256
    || checkpoint.totalChapters !== chapters.length
    || !Array.isArray(checkpoint.completedChapterIndexes)
  ) {
    return 0
  }

  const completed = new Set(checkpoint.completedChapterIndexes)
  for (let index = 0; index < chapters.length; index += 1) {
    if (!completed.has(index)) return index

    const path = chapterFilePath(chaptersPath, chapters[index])
    if (!(await fileExists(path))) return index
    try {
      if (!isValidChapterFile(await readFile(path), task.bookId, chapters[index])) return index
    } catch {
      return index
    }
  }
  return chapters.length
}

async function rollbackPublishedCommit(
  projectPath: string,
  bookId: string,
  metadataPath: string,
): Promise<void> {
  try {
    await removeBookLibraryEntry(projectPath, bookId)
  } catch (error) {
    console.warn("批量导入：回滚作品索引失败", error)
  }

  try {
    if (await fileExists(metadataPath)) await deleteFile(metadataPath)
  } catch (error) {
    console.warn("批量导入：回滚 metadata 失败", error)
  }
}
function buildChapterSummaries(
  chapters: ParsedNovelChapter[],
  chaptersPath: string,
): ChapterSummary[] {
  return chapters.map((chapter) => ({
    id: chapterId(chapter),
    title: chapter.title,
    order: chapter.order,
    wordCount: chapter.content.length,
    path: chapterFilePath(chaptersPath, chapter),
  }))
}

export async function runBatchImportTask(
  task: BatchImportTask,
  options: RunBatchImportTaskOptions,
): Promise<{
  task: BatchImportTask
  metadata: BookAnalysisMetadata
  chapters: ChapterSummary[]
}> {
  return withBatchImportTaskLock(task.projectPath, task.id, async () => {
    assertRunnableTask(task)
    throwIfCancelled(options.signal)

    const sourceContent = await readFile(task.cachedSourcePath)
    throwIfCancelled(options.signal)
    const sourceSha256 = await hashNormalizedNovel(sourceContent)
    if (sourceSha256 !== task.sourceSha256) {
      throw new Error("缓存源文件校验失败：文件内容与任务记录不一致")
    }

    const parsedChapters = parseNovelChapters(sourceContent)
    let checkpoint: BatchImportCheckpoint | null
    try {
      checkpoint = await loadTaskCheckpoint(task)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      console.warn("批量导入：checkpoint 数据损坏，将从第一章重新开始", error)
      checkpoint = null
    }
    const taskDirectory = importTaskDir(task.projectPath, task.id)
    const taskChaptersPath = joinPath(taskDirectory, "chapters")
    const resumeIndex = await findResumeIndex(
      task,
      checkpoint,
      parsedChapters,
      taskChaptersPath,
    )
    let totalWords = parsedChapters
      .slice(0, resumeIndex)
      .reduce((sum, chapter) => sum + chapter.content.length, 0)
    const completedChapterIndexes = Array.from(
      { length: resumeIndex },
      (_, index) => index,
    )

    for (let index = resumeIndex; index < parsedChapters.length; index += 1) {
      throwIfCancelled(options.signal)
      const chapter = parsedChapters[index]
      await writeFileAtomic(
        chapterFilePath(taskChaptersPath, chapter),
        buildChapterMarkdown(task.bookId, chapter),
      )
      throwIfCancelled(options.signal)

      totalWords += chapter.content.length
      completedChapterIndexes.push(index)
      await saveTaskCheckpointUnlocked(task, {
        version: 1,
        sourceSha256,
        totalChapters: parsedChapters.length,
        completedChapterIndexes: [...completedChapterIndexes],
        totalWords,
        updatedAt: Date.now(),
      })
      options.onProgress?.(index + 1, parsedChapters.length, chapter.title)
    }

    throwIfCancelled(options.signal)
    const bookPath = normalizePath(joinPath(
      task.projectPath,
      "book-analysis",
      task.bookId,
    ))
    const publishedChaptersPath = joinPath(bookPath, "chapters")
    const publishedSourcePath = joinPath(bookPath, "source.txt")
    await createDirectory(normalizePath(joinPath(task.projectPath, "book-analysis")))
    await createDirectory(bookPath)
    await createDirectory(publishedChaptersPath)
    await createDirectory(joinPath(bookPath, "characters"))
    await createDirectory(joinPath(bookPath, "skills"))

    throwIfCancelled(options.signal)
    await copyDirectory(taskChaptersPath, publishedChaptersPath)
    throwIfCancelled(options.signal)
    await writeFileAtomic(publishedSourcePath, sourceContent)
    const now = Date.now()
    const metadataPath = joinPath(bookPath, "metadata.json")
    const metadata: BookAnalysisMetadata = {
      title: task.finalTitle ?? task.requestedTitle,
      author: undefined,
      totalChapters: parsedChapters.length,
      totalWords,
      sourceType: "file",
      createdAt: task.createdAt,
      updatedAt: now,
    }
    const completedTask: BatchImportTask = {
      ...task,
      cachedSourcePath: publishedSourcePath,
      status: "completed",
      completed: parsedChapters.length,
      total: parsedChapters.length,
      error: null,
      skipReason: null,
      completedAt: now,
      updatedAt: now,
    }

    // metadata 是正式发布的可见提交点；通过此安全点后必须完成或回滚提交。
    throwIfCancelled(options.signal)
    try {
      await writeFileAtomic(metadataPath, JSON.stringify(metadata, null, 2))
      await upsertBookLibraryEntry(task.projectPath, {
        bookId: task.bookId,
        sourcePath: publishedSourcePath,
        contentHash: fingerprintFileSample(sourceContent),
        contentSha256: sourceSha256,
        title: metadata.title,
        totalChapters: parsedChapters.length,
        totalWords,
        charactersCount: 0,
        skillsCount: 0,
        status: "completed",
        createdAt: task.createdAt,
        updatedAt: now,
      })
      await saveBatchImportTaskUnlocked(completedTask)
    } catch (error) {
      await rollbackPublishedCommit(task.projectPath, task.bookId, metadataPath)
      throw error
    }

    try {
      await cleanupCompletedTaskWorkspaceUnlocked(completedTask)
    } catch (error) {
      console.warn("批量导入：清理已完成任务工作区失败", error)
    }

    return {
      task: completedTask,
      metadata,
      chapters: buildChapterSummaries(parsedChapters, publishedChaptersPath),
    }
  })
}
