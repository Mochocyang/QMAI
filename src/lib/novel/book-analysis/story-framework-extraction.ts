import { listDirectory, readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import {
  extractPlotFrameworkBeatsFromAnalysis,
  extractPlotFrameworkLineageFromAnalysis,
} from "@/lib/novel/dismantling"
import type { PlotFramework } from "@/lib/novel/plot-framework"

export interface BookStoryFrameworkChapter {
  id: string
  title: string
  order: number
  content: string
}

export async function loadBookStoryFrameworkChapters(
  bookPath: string,
  selectedChapterIds?: string[],
): Promise<BookStoryFrameworkChapter[]> {
  const selected = selectedChapterIds?.length ? new Set(selectedChapterIds) : null
  const files = await listDirectory(joinPath(bookPath, "chapters"))
  const chapters: BookStoryFrameworkChapter[] = []
  for (const file of files) {
    if (file.is_dir || !file.name.endsWith(".md")) continue
    const raw = await readFile(file.path)
    const parsed = parseBookChapterMarkdown(raw, file.name.replace(/\.md$/, ""))
    if (selected && !selected.has(parsed.id)) continue
    chapters.push(parsed)
  }
  return chapters.sort((a, b) => a.order - b.order)
}

export function buildBookStoryFrameworkPrompt(input: {
  bookTitle: string
  chapters: BookStoryFrameworkChapter[]
}): string {
  return [
    `拆书作品：${input.bookTitle}`,
    "",
    ...input.chapters.map((chapter) =>
      [
        `## 第 ${chapter.order} 章：${chapter.title}`,
        trimChapterContentForPrompt(chapter.content),
      ].join("\n"),
    ),
    "",
    "你是小说故事框架拆解助手。请只提取可复用的故事结构模板，不要复述原文情节。",
    "",
    "重要边界：",
    "1. 只学习节奏、冲突推进、期待管理、爽点释放和章节钩子。",
    "2. 不得复用原作人物、设定、剧情和具体表达。",
    "3. 输出必须使用中文。",
    "4. 四段缺一不可，缺失时不要编造，请直接说明无法提取。",
    "",
    "请严格按以下 Markdown 标题输出：",
    "",
    "## 框架归属与衔接",
    "属于：主线/支线",
    "与上一框架衔接：",
    "与下一框架衔接：",
    "覆盖本批章节数：",
    "",
    "## 开局钩子",
    "说明本框架如何让读者产生期待。",
    "",
    "## 铺垫",
    "说明本框架如何塑造规则、压力、误解、负面情绪或期待差。",
    "",
    "## 爽点",
    "说明本框架如何完成反转、打脸、情绪释放或价值兑现。",
    "",
    "## 结尾钩子",
    "说明本框架如何把期待接到下一轮。",
    "",
    "## 可复用结构记忆",
    "一句话可复用模板：",
    "适用场景：",
    "作者手搓留白：标注哪些位置适合作者用人设卡、文风、对话、整活或玩梗补血肉。",
  ].join("\n")
}

export function buildPlotFrameworkDraftFromBookStoryOutput(input: {
  bookId: string
  bookTitle: string
  markdown: string
  rangeChapterIds: string[]
  createdAt?: number
}): PlotFramework | null {
  const beats = extractPlotFrameworkBeatsFromAnalysis(input.markdown)
  if (!beats) return null
  const lineage = extractPlotFrameworkLineageFromAnalysis(input.markdown)
  const createdAt = input.createdAt ?? Date.now()
  const safeBookId = input.bookId.replace(/[^a-zA-Z0-9_-]/g, "-")
  const reusableTemplate =
    lineage.reusableTemplate || input.markdown.match(/一句话可复用模板[：:]\s*(.+)/)?.[1]?.trim() || ""

  return {
    id: `framework-${safeBookId}-${createdAt}`,
    title: reusableTemplate || `${input.bookTitle || "拆书"}故事框架`,
    beats,
    rangeChapterIds: input.rangeChapterIds,
    line: lineage.line ?? "main",
    characters: [],
    foreshadowing: [],
    reusableTemplate,
    directionHints: "由拆书库选中章节提取的故事框架；用于约束章纲的节奏、期待、爽点与结尾钩子。",
    handcraftHints:
      "作者手搓留白：请在章纲阶段用人设卡、文风、对话设计、整活或玩梗补充血肉层。",
    sourceDismantlingProjectId: `book-analysis:${input.bookId}`,
    sourceDismantlingProjectTitle: input.bookTitle || undefined,
    prevConnector: lineage.prevConnector,
    nextConnector: lineage.nextConnector,
    createdAt,
    updatedAt: createdAt,
  }
}

function parseBookChapterMarkdown(raw: string, fallbackId: string): BookStoryFrameworkChapter {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const frontmatter = match?.[1] ?? ""
  const body = match?.[2] ?? raw
  const id = readFrontmatterValue(frontmatter, "id") || fallbackId
  const title = readFrontmatterValue(frontmatter, "title") || fallbackId
  const order = Number(readFrontmatterValue(frontmatter, "order")) || 0
  return {
    id,
    title,
    order,
    content: body.trim(),
  }
}

function readFrontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
}

function trimChapterContentForPrompt(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= 8000) return trimmed
  return `${trimmed.slice(0, 8000)}\n\n[本章内容过长，已截断用于故事框架提取]`
}
