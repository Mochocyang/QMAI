import { readFile, writeFileAtomic } from "@/commands/fs"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { replaceWholeChapterBody } from "@/lib/chapter-selection"
import { requestEditorExternalChapterBodyUpdate } from "@/lib/editor-external-update-session"
import { syncChapterFrontmatterFromBody } from "@/lib/novel/chapter-meta"
import { normalizePath } from "@/lib/path-utils"
import { useWritingStatsStore } from "@/stores/writing-stats-store"

/**
 * 去 AI 味（单章与批量都走这里）的正文是模型产出的，记到「今日 AI 生成」。
 *
 * `recordChapter` 内部按字符差分记账：模型只换掉的字才算新增，没动过的字归属
 * 原样保留，所以「润色一小段」不会虚报成整章都是 AI 新写的。
 *
 * `previousMarkdown` **必须**在有旧正文时传进来。批量去 AI 味的章节通常没有
 * 内存账本（用户没打开过），落盘摘要也因为内容变了而校验不过，此时若不传旧正文，
 * 应用只能退化成「整章都是今天 AI 新写的」——30 章 × 3000 字会把「今日 AI 生成」
 * 顶到九万字，而模型可能总共只改了几千字。
 */
function recordDeAiWrite(path: string, markdown: string, previousMarkdown?: string): void {
  useWritingStatsStore.getState().recordChapter(path, markdown, "ai", previousMarkdown)
}

function mergeAndFormatDeAiResult(currentMarkdown: string, candidateContent: string): string {
  const merged = replaceWholeChapterBody(currentMarkdown, candidateContent)
  return formatChapterWriting(syncChapterFrontmatterFromBody(merged))
}
 interface OpenChapterBodyUpdateInput {
  path: string
  candidateContent: string
  currentOpenPath(): string | null
  currentMarkdown(): string
  invalidatePendingSave(): void
  runExternalUpdate(path: string, write: () => Promise<void>): Promise<number>
  markEditorSession(path: string, version?: number): void
  writeFileAtomic(path: string, content: string): Promise<void>
  commitEditor(content: string): void
  bumpDataVersion(): void
}

export async function applyOpenChapterBodyUpdate(input: OpenChapterBodyUpdateInput): Promise<boolean> {
  const targetPath = normalizePath(input.path)
  const initialOpenPath = input.currentOpenPath()
  if (!initialOpenPath || normalizePath(initialOpenPath) !== targetPath) return false
  const previousMarkdown = input.currentMarkdown()
  const merged = mergeAndFormatDeAiResult(previousMarkdown, input.candidateContent)
  input.invalidatePendingSave()
  const externalVersion = await input.runExternalUpdate(input.path, () =>
    input.writeFileAtomic(input.path, merged),
  )
  input.bumpDataVersion()
  // 这一章开着，账本通常在内存里；但用户可能刚切换过来、或账本因带外修改
  // 校验不过，所以旧正文照样传进去兜底。
  recordDeAiWrite(input.path, merged, previousMarkdown)
  const latestOpenPath = input.currentOpenPath()
  if (latestOpenPath && normalizePath(latestOpenPath) === targetPath) {
    input.commitEditor(merged)
    input.markEditorSession(input.path, externalVersion)
  }
  return true
}
 interface DeAiBatchChapterApplierOptions {
  requestOpenUpdate(path: string, candidateContent: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, content: string): Promise<void>
}

export function createDeAiBatchChapterApplier(
  options: DeAiBatchChapterApplierOptions = {
    requestOpenUpdate: requestEditorExternalChapterBodyUpdate,
    readFile,
    writeFileAtomic,
  },
): (path: string, candidateContent: string) => Promise<void> {
  return async (path, candidateContent) => {
    if (await options.requestOpenUpdate(path, candidateContent)) return
    const currentMarkdown = await options.readFile(path)
    const merged = mergeAndFormatDeAiResult(currentMarkdown, candidateContent)
    await options.writeFileAtomic(path, merged)
    recordDeAiWrite(path, merged, currentMarkdown)
  }
}
