import type { ChatMessage } from "@/lib/llm-providers"
import { parseFrontmatter } from "@/lib/frontmatter"

export interface ChapterBodySelection {
  start: number
  end: number
  text: string
  bodySnapshot: string
}

export type ChapterSelectionAction = "polish" | "de-ai"

const POLISH_SYSTEM_PROMPT = [
  "请在不改动核心剧情事实、人物关系、时间线和关键设定的前提下润色表达。",
  "保留原段落的叙事视角、信息密度和情绪走向。",
  "增强画面感、节奏感、动作细节和文字流畅度，但不要扩写成新的剧情。",
  "输出仅返回润色后的正文片段，不要解释。",
].join("\n")

export function splitChapterHeading(markdown: string): { heading: string; body: string } {
  const match = markdown.match(/^#\s+(.+)$/m)
  if (!match) return { heading: "", body: markdown }
  const heading = match[1]
  const body = markdown.replace(/^#\s+.+$/m, "").replace(/^\n+/, "")
  return { heading, body }
}

export function rebuildChapterBody(heading: string, body: string): string {
  return heading ? `# ${heading}\n\n${body}` : body
}

export function replaceWholeChapterBody(currentMarkdown: string, replacementMarkdown: string): string {
  const { rawBlock, body: currentBody } = parseFrontmatter(currentMarkdown)
  const { body: replacementBodyRaw } = parseFrontmatter(replacementMarkdown)
  const { heading } = splitChapterHeading(currentBody)
  const { body: replacementBody } = splitChapterHeading(replacementBodyRaw)
  return rawBlock + rebuildChapterBody(heading, replacementBody)
}

export function buildPolishSelectionMessages(content: string): ChatMessage[] {
  if (!content.trim()) throw new Error("润色内容为空，无法处理")
  return [
    { role: "system", content: POLISH_SYSTEM_PROMPT },
    {
      role: "user",
      content: "请润色下面选中的小说正文片段。\n\n输出仅返回润色后的正文片段，不要解释。\n\n正文如下：\n\n" + content,
    },
  ]
}

export function replaceChapterBodySelection(
  currentBody: string,
  selection: ChapterBodySelection,
  replacement: string,
): { ok: true; body: string } | { ok: false; reason: "changed" | "empty" } {
  if (!selection.text.trim()) {
    return { ok: false, reason: "empty" }
  }

  const { start, end, bodySnapshot, text } = selection
  if (bodySnapshot !== currentBody) {
    return { ok: false, reason: "changed" }
  }

  if (currentBody.slice(start, end) !== text) {
    return { ok: false, reason: "changed" }
  }

  return {
    ok: true,
    body: `${currentBody.slice(0, start)}${replacement}${currentBody.slice(end)}`,
  }
}
