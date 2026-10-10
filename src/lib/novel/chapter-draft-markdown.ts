import { yamlEscape } from "./chapter-meta"

/**
 * 拼一份新章节的 frontmatter + 正文（AI 生成正文时的**草稿**落盘口径）。
 *
 * 🔴 `chapter_status` 在这里是**字面量** `draft`，没有布尔开关可翻 —— 这是草稿隔离
 * （`.agents/AGENTS.md` 核心工作流第 2/4 条）的落点：AI 刚生成的正文不得被当成
 * 可摄取的终稿。任何「按需转正」的参数都会把这条硬约束押在一个实参上。
 *
 * 刻意**不**用 `buildImportedChapterMarkdown`（`chapter-import.ts`）：它有一个必填参数
 * `finalForMemoryExtraction` 能产出 `chapter_status: final`，而 `ingestChapter` 默认
 * 就接收 final —— 参数名还极具误导性。要转正只能走用户显式的「提取记忆」入口。
 *
 * `title` 一律经 `yamlEscape`（`chapter-meta.ts`）：模型给的标题里出现引号或反斜杠
 * 时，不转义会直接破坏整段 YAML，读回来就是一份 frontmatter 解析失败的文件。
 *
 * ⚠️ 已知重复（N5 刻意**不**在这一批里动）：`chat-panel.tsx:1300-1314` 里那份
 * `buildDraftContent` 与这里字段顺序完全相同，但它 (a) 没有转义标题、(b) 直接用
 * `chapter-NNN.md` 这个 AI 对话草稿名。把它并过来要同时改那条链路的目标路径策略
 * （`decideChapterSaveStrategy` 那一套），超出本批范围；两处的一致性是**约定**
 * 而非编译期保证，改这里时请一并看那边。
 */
export function buildDraftChapterMarkdown(chapterNumber: number, title: string, body: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const frontmatter = [
    "---",
    "type: chapter",
    `chapter_number: ${chapterNumber}`,
    "chapter_status: draft",
    `title: "${yamlEscape(title)}"`,
    `created: ${today}`,
    "---",
    "",
  ].join("\n")
  // 标题只写入 frontmatter，正文只保存实际章节内容，避免重复（正文不带 H1）。
  return `${frontmatter}${body}\n`
}
