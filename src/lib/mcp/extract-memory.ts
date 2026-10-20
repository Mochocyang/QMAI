import { ingestChapter, ingestOutline } from "@/lib/novel/chapter-ingest"
import { requireProjectDocument } from "./paths"

export async function extractProjectMemory(input: {
  projectPath: string
  path: string
  allowDraft?: boolean
}, deps: {
  ingestChapter: typeof ingestChapter
  ingestOutline: typeof ingestOutline
} = { ingestChapter, ingestOutline }): Promise<string> {
  const kind = requireProjectDocument(input.projectPath, input.path)
  if (kind === "outline") {
    const result = await deps.ingestOutline(input.projectPath, input.path)
    if (!result.snapshot) {
      throw new Error(`大纲记忆提取失败：${result.failureReason ?? "未知错误"}`)
    }
    return `大纲记忆提取完成：第 ${result.snapshot.chapterNumber} 章`
  }
  const result = await deps.ingestChapter(
    input.projectPath,
    input.path,
    undefined,
    undefined,
    undefined,
    { allowDraft: input.allowDraft === true },
  )
  if (!result.snapshot) {
    throw new Error(`章节记忆提取失败：${result.error ?? result.failReason ?? "未知错误"}`)
  }
  return `章节记忆提取完成：第 ${result.snapshot.chapterNumber} 章`
}
