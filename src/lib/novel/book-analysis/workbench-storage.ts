import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { loadChapterList } from "./analysis-engine"
import { sanitizeRemovedSubjects, type WorkbenchRevision } from "./workbench-core"

export async function readWorkbenchChapters(bookPath: string, ids?: string[]) {
  const list = await loadChapterList(bookPath)
  const chapters = []
  for (const chapter of list) {
    if (ids && !ids.includes(chapter.chapterId)) continue
    if (!/^[A-Za-z0-9_-]+$/.test(chapter.chapterId)) throw new Error("章节ID无效")
    const raw = await readFile(joinPath(bookPath, "chapters", `${chapter.chapterId}.md`))
    const content = parseFrontmatter(raw).body
    chapters.push({ id: chapter.chapterId, title: chapter.title, order: chapter.order, content, sourceHash: await sha256Text(content) })
  }
  if (ids && new Set(ids).size !== chapters.length) throw new Error("所选章节读取不完整")
  return chapters
}
export function workbenchRevisionPath(bookPath: string, id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("结果版本ID无效")
  return joinPath(bookPath, "analysis", "revisions", `${id}.json`)
}
export async function saveWorkbenchRevision(bookPath: string, revision: WorkbenchRevision) {
  await createDirectory(joinPath(bookPath, "analysis", "revisions"))
  await writeFileAtomic(workbenchRevisionPath(bookPath, revision.id), JSON.stringify(revision, null, 2))
}
export async function loadWorkbenchRevisions(bookPath: string): Promise<WorkbenchRevision[]> {
  const root = joinPath(bookPath, "analysis", "revisions")
  if (!await fileExists(root)) return []
  const results: WorkbenchRevision[] = []
  for (const file of await listDirectory(root)) {
    if (file.is_dir || !file.name.endsWith(".json")) continue
    const value = JSON.parse(await readFile(file.path)) as WorkbenchRevision
    if (value.workbenchVersion !== 2 || !Array.isArray(value.items) || !Array.isArray(value.evidence)) throw new Error("拆书结果版本损坏，请检查文件")
    // removedSubjects 只用于隐藏已删卡片：清洗而非抛错，缺字段的旧数据必须照常读出。
    results.push({ ...value, removedSubjects: sanitizeRemovedSubjects(value.removedSubjects) })
  }
  return results.sort((a, b) => b.createdAt - a.createdAt)
}
