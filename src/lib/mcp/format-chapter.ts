import { readFile, writeFileAtomic } from "@/commands/fs"
import { normalizeChapterWriting } from "@/lib/chapter-formatting"
import { getOpenDocumentGuard } from "./open-document"
import { requireProjectDocument } from "./paths"

export async function formatProjectChapter(input: {
  projectPath: string
  path: string
}, io: {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
} = { readFile, writeFile: writeFileAtomic }): Promise<string> {
  const kind = requireProjectDocument(input.projectPath, input.path)
  if (kind !== "chapter") throw new Error("只能排版章节正文")
  const formatted = normalizeChapterWriting(await io.readFile(input.path))
  await io.writeFile(input.path, formatted)
  getOpenDocumentGuard(input.path)?.applyMarkdown(formatted)
  return "章节已排版"
}
