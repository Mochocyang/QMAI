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
/**
 * 同一版本文件的串行锁。
 *
 * 「确认入库」（confirmWorkbenchRevision）与「删除条目」（removeWorkbenchRevisionItem）
 * 都会对这个 JSON 做整份读-改-写，二者交错就会丢更新。真实症状（有回归测试钉住）：
 *  - 用户在入库循环进行中点删除，刚写下的 removedSubjects 被入库的旧快照整份覆盖成
 *    undefined —— 重新打开页面，已删的卡片又回来了；
 *  - 入库用的是「读版本那一刻」的 items 快照，会为刚被用户删掉的对象继续创建灵魂。
 * 按版本文件路径串行是消灭这类丢更新最省心的办法：删除要么整段发生在入库之前
 * （入库读到的就是删过的内容），要么整段发生在入库之后（在已确认的版本上追加记录）。
 */
const revisionChains = new Map<string, Promise<unknown>>()
export function withWorkbenchRevisionLock<T>(
  bookPath: string, revisionId: string, task: () => Promise<T>,
): Promise<T> {
  const key = workbenchRevisionPath(bookPath, revisionId)
  const previous = revisionChains.get(key) ?? Promise.resolve()
  // 前一个失败也要接着跑下一个：否则一次失败会把这条链永久卡死。
  const run = previous.then(task, task)
  const settled = run.then(() => {}, () => {})
  revisionChains.set(key, settled)
  void settled.then(() => { if (revisionChains.get(key) === settled) revisionChains.delete(key) })
  return run
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
