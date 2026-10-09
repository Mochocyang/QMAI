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
 */
function recordDeAiWrite(path: string, markdown: string): void {
  useWritingStatsStore.getState().recordChapter(path, markdown, "ai")
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
  const merged = mergeAndFormatDeAiResult(input.currentMarkdown(), input.candidateContent)
  input.invalidatePendingSave()
  const externalVersion = await input.runExternalUpdate(input.path, () =>
    input.writeFileAtomic(input.path, merged),
  )
  input.bumpDataVersion()
  recordDeAiWrite(input.path, merged)
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
    recordDeAiWrite(path, merged)
  }
}
