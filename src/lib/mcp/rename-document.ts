import { deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { extractChapterNumberFromContent } from "@/lib/novel/chapter-utils"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import { allocateUniqueSiblingPath, planPageRename, type RenameSibling } from "@/lib/wiki/rename-page"
import { normalizePath } from "@/lib/path-utils"
import { getOpenDocumentGuard } from "./open-document"
import { requireProjectDocument } from "./paths"

function directoryOf(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

function fileNameOf(path: string): string {
  return normalizePath(path).split("/").pop() ?? ""
}

export function titleFromMarkdown(content: string, fallback: string): string {
  const parsed = parseFrontmatter(content)
  const title = parsed.frontmatter?.title
  if (typeof title === "string" && title.trim()) return title.trim()
  const heading = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || fallback
}

export async function renameProjectDocument(input: {
  projectPath: string
  path: string
  title: string
  siblings: RenameSibling[]
}, io: {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  fileExists: (path: string) => Promise<boolean>
  transferChapter?: (fromPath: string, toPath: string) => void
} = {
  readFile,
  writeFile,
  deleteFile,
  fileExists,
  transferChapter: (fromPath, toPath) => useWritingStatsStore.getState().transferChapter(fromPath, toPath),
}): Promise<{ path: string; title: string }> {
  const kind = requireProjectDocument(input.projectPath, input.path)
  const content = await io.readFile(input.path)
  const currentTitle = titleFromMarkdown(content, fileNameOf(input.path).replace(/\.md$/i, ""))
  const plan = planPageRename({
    path: input.path,
    nextTitle: input.title,
    content,
    type: kind,
    currentTitle,
    siblings: input.siblings,
  })
  if (plan.status === "unchanged") return { path: input.path, title: currentTitle }
  if (plan.status === "rejected" || !plan.content || !plan.fileName || !plan.normalizedTitle) {
    throw new Error(plan.message ?? "无法修改标题")
  }
  const guard = getOpenDocumentGuard(input.path)
  if (guard?.isDirty()) throw new Error("该文件在编辑器中有未保存的修改，请先保存后再修改标题")
  const targetPath = await allocateUniqueSiblingPath(directoryOf(input.path), plan.fileName, input.path, io.fileExists)
  await io.writeFile(targetPath, plan.content)
  if (targetPath !== input.path) {
    if (kind === "chapter") io.transferChapter?.(input.path, targetPath)
    await io.deleteFile(input.path)
  }
  guard?.applyMarkdown(plan.content)
  return { path: targetPath, title: plan.normalizedTitle }
}

export function siblingFromMarkdown(path: string, content: string, type: "chapter" | "outline"): RenameSibling {
  return {
    path,
    type,
    title: titleFromMarkdown(content, fileNameOf(path).replace(/\.md$/i, "")),
    chapterNumber: extractChapterNumberFromContent(content),
  }
}
