/**
 * 读宿主上下文（项目 / 章节 / 选区），供 `{{project.*}}` `{{chapter.*}}` 插值。
 *
 * ## 先说实话：这些字段的真实存储在哪
 *
 *   - `bookTitle` —— **真源是项目目录名**（`rename_project` 改的就是目录名），
 *     前端拿得到，所以是可用的；
 *   - `bookIntro` —— **没有单一存储**。设计上散在 wiki 页面与
 *     `.novel/project-meta.json`。这里只认后者（一次小文件读，成本可控），
 *     并且读不到就 `undefined`；
 *   - `bookTags` / `protagonist` / `setting` —— **同样没有单一存储**，一律 `undefined`。
 *
 * **不为了填满字段去读 wiki 页面**：一个项目可能有上千个 wiki 页面，为了拼一个
 * 简介把所有页面读一遍，代价是"点一次按钮卡两秒"，而结果依旧不可靠（哪一页算简介
 * 没有约定）。宁可让插值结果是空串并在对话框里提示"这些变量当前拿不到"
 * （`runDeclarativeAction` 的 `missing`），也不要假装有值。
 */
import { splitChapterHeading } from "@/lib/chapter-selection"
import { loadNovelProjectMeta } from "@/lib/novel/project-meta"
import { isChapterPath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"

export interface HostProjectContext {
  bookTitle?: string
  bookTags?: string[]
  bookIntro?: string
  protagonist?: string
  setting?: string
}

export interface HostChapterContext {
  title?: string
  text?: string
}

/**
 * 当前项目信息（没有打开项目 → `null`）。
 *
 * 读 `.novel/project-meta.json` 只为 `description`（简介）一个字段：那是一次
 * 几十字节的文件读；失败（文件不存在/格式坏了）按"没有简介"处理，不影响别的字段。
 */
export async function readProjectContext(): Promise<HostProjectContext | null> {
  const project = useWikiStore.getState().project
  if (!project) return null

  const context: HostProjectContext = {}
  const title = typeof project.name === "string" ? project.name.trim() : ""
  if (title !== "") context.bookTitle = title

  try {
    const meta = await loadNovelProjectMeta(project.path)
    const description = typeof meta?.description === "string" ? meta.description.trim() : ""
    if (description !== "") context.bookIntro = description
  } catch (cause) {
    // 元数据读不到不该让生成失败：作者要的是"这次没有简介"，不是"插件报错"。
    console.warn("[plugins] 读取 .novel/project-meta.json 失败，简介按空值处理：", cause)
  }

  return context
}

/**
 * 当前打开的章节（不是章节 / 没打开文档 → `null`）。
 *
 * 正文取 `useWikiStore.fileContent`（编辑器当前载入的 markdown），标题取首行的
 * `# 标题`。取不到就返回 `null`，让插值按空值处理 —— 用户可能正在写大纲，
 * 那时"没有章节正文"是正常状态，不该报错。
 */
export async function readChapterContext(): Promise<HostChapterContext | null> {
  const state = useWikiStore.getState()
  const path = state.selectedFile
  if (!path || !isChapterPath(path)) return null

  const markdown = typeof state.fileContent === "string" ? state.fileContent : ""
  if (markdown.trim() === "") return null

  const { heading, body } = splitChapterHeading(markdown)
  // 不 trim 正文：段首的全角缩进（`　　`）是正文排版的一部分，裁掉会让提示词里的
  // 段落格式与用户看到的原文不一致。
  const context: HostChapterContext = { text: body }
  const title = heading.trim()
  if (title !== "") context.title = title
  return context
}

/**
 * 编辑器当前选区。
 *
 * **当前返回 `undefined`**：选区是 `WikiEditor` 的组件内部状态（`useState`），
 * 宿主没有把它放进任何 store，也没有对外的读取 API。为了一处插值去改编辑器的
 * 选中模型，代价与风险都远大于收益（选区变化会触发整个编辑区重渲染）。
 * 声明了 `{{selection}}` 的 action 会因此看到 `missing` 提示，链路上是可见的、
 * 不会静默出错。
 */
export function readSelectionContext(): string | undefined {
  return undefined
}
