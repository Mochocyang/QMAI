/**
 * 大纲文档的**伴生文件**（`.html` / `.json`）。
 *
 * 为什么需要统一处理：大纲在磁盘上是三个文件 ——
 * `大纲-第01卷.md`（正文）、`大纲-第01卷.html`（网页版）、`大纲-第01卷.json`（卷纲结构化数据）。
 * 过去删除/改名只动 `.md`，另外两个留在原地，于是：
 * - 大纲树里已经看不到这份大纲了，但 AI 通过 `list_outlines` / `read_outline` 仍能读到
 *   残留的 HTML 与 JSON（用户 2026-10-28 报的重大缺陷）；
 * - 预览还可能把旧 HTML 当成"这份大纲的网页版"显示出来。
 *
 * 删除走回收站（`trash.ts` 已把伴生文件一起搬走并随主文件还原）；
 * 这里提供的是**改名/移动**场景要用的搬运，以及一个显式的直接删除工具。
 */

import { deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

/** 大纲 .md 可能带的伴生扩展名。 */
export const OUTLINE_COMPANION_EXTENSIONS = ["html", "json"] as const

/** 由 .md 路径推出伴生文件路径（不判断是否存在）。 */
export function outlineCompanionPaths(mdPath: string): string[] {
  const normalized = normalizePath(mdPath)
  if (!/\.md$/i.test(normalized)) return []
  const stem = normalized.replace(/\.md$/i, "")
  return OUTLINE_COMPANION_EXTENSIONS.map((extension) => `${stem}.${extension}`)
}

/** 直接删除伴生文件，返回实际删掉的个数。 */
export async function deleteOutlineCompanions(mdPath: string): Promise<number> {
  let deleted = 0
  for (const companion of outlineCompanionPaths(mdPath)) {
    if (!(await fileExists(companion))) continue
    try {
      await deleteFile(companion)
      deleted += 1
    } catch (error) {
      console.warn("[outline-companions] 删除伴生文件失败:", companion, error)
    }
  }
  return deleted
}

/**
 * 改名/移动：把伴生文件搬到新主名旁边，再删掉旧的。
 *
 * 用「读内容 → 写新路径 → 删旧文件」而不是复制接口：集中在一个地方处理，
 * 也不会在目标已存在时误覆盖（目标存在就跳过，交给用户后续重新生成）。
 */
export async function moveOutlineCompanions(sourceMdPath: string, destMdPath: string): Promise<number> {
  const sources = outlineCompanionPaths(sourceMdPath)
  const destinations = outlineCompanionPaths(destMdPath)
  let moved = 0
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    const destination = destinations[index]
    if (!source || !destination) continue
    if (!(await fileExists(source))) continue
    try {
      if (!(await fileExists(destination))) {
        await writeFile(destination, await readFile(source))
      }
      await deleteFile(source)
      moved += 1
    } catch (error) {
      console.warn("[outline-companions] 搬移伴生文件失败:", source, "→", destination, error)
    }
  }
  return moved
}
