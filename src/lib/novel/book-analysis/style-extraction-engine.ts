/**
 * 作品级写作文风提取引擎（feature/book-style-extraction）
 *
 * 一次性成本：在拆书时对抽样章节跑一次 LLM，产出 BookStyleProfile，
 * 落盘到 <bookPath>/style-profile.json + style.md。
 * 生成端只消费蒸馏后的 constitution + samples（见 writing-style-store），
 * 绝不在生成时加载整本原文。
 */
import type { LlmConfig } from "@/stores/wiki-store"
import { readFile, writeFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { resolveUserVisibleReasoning } from "@/lib/user-visible-reasoning"
import type { BookStyleProfile } from "./types"
import { loadChapterList, loadMetadata } from "./analysis-engine"
import {
  STYLE_DIMENSIONS,
  buildStyleExtractionPrompt,
  parseStyleProfileResult,
} from "./style-prompts"

const MAX_SAMPLE_CHAPTERS = 8
const PER_CHAPTER_CHAR_LIMIT = 6000
/** 跳过过短的纯过渡章，避免样本不具代表性。 */
const MIN_SAMPLE_WORD_COUNT = 800

export interface AnalyzeWritingStyleOptions {
  onProgress?: (message: string) => void
  signal?: AbortSignal
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim()
}

/** 在候选下标里均匀取最多 count 个（首/中/尾铺开）。 */
function pickEvenlySpread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const picked: T[] = []
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (items.length - 1)) / (count - 1))
    picked.push(items[idx])
  }
  // 去重（极端情况下 round 可能撞下标）
  return Array.from(new Set(picked))
}

/**
 * 提取一本拆书作品的写作文风。
 * @param bookPath  <projectPath>/book-analysis/<bookId>
 */
export async function analyzeWritingStyle(
  bookPath: string,
  llmConfig: LlmConfig,
  options: AnalyzeWritingStyleOptions = {},
): Promise<BookStyleProfile> {
  const { onProgress, signal } = options
  if (signal?.aborted) throw new Error("用户取消提取")

  onProgress?.("读取章节列表…")
  const chapters = await loadChapterList(bookPath)
  if (chapters.length === 0) throw new Error("没有可用于分析的章节，请先完成拆书章节拆分")

  const metadata = await loadMetadata(bookPath)
  const bookTitle = metadata?.title || "未命名作品"

  // 优先取有一定篇幅的章节，再在其中首/中/尾均匀抽样
  const meaningful = chapters.filter((c) => c.wordCount >= MIN_SAMPLE_WORD_COUNT)
  const pool = meaningful.length >= 3 ? meaningful : chapters
  const sampled = pickEvenlySpread(pool, MAX_SAMPLE_CHAPTERS)

  onProgress?.(`读取 ${sampled.length} 章样本正文…`)
  const sampleBlocks: string[] = []
  for (const chapter of sampled) {
    if (signal?.aborted) throw new Error("用户取消提取")
    try {
      const raw = await readFile(joinPath(bookPath, "chapters", `${chapter.chapterId}.md`))
      const body = stripFrontmatter(raw).slice(0, PER_CHAPTER_CHAR_LIMIT)
      if (body) sampleBlocks.push(`【${chapter.title}】\n${body}`)
    } catch {
      // 跳过读不到的章节
    }
  }
  if (sampleBlocks.length === 0) throw new Error("样本章节正文为空，无法分析文风")

  onProgress?.("正在分析作品文风…")
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "你是专业的小说文风分析助手。只输出用户要求的 JSON，不要解释，不要代码围栏。",
    },
    {
      role: "user",
      content: buildStyleExtractionPrompt(sampleBlocks.join("\n\n———\n\n"), bookTitle),
    },
  ]

  let result = ""
  let streamError: Error | null = null
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (err) => { streamError = err },
    },
    signal,
    { reasoning: resolveUserVisibleReasoning(llmConfig.reasoning) },
  )
  if (signal?.aborted) throw new Error("用户取消提取")
  if (streamError) throw streamError

  const profile = parseStyleProfileResult(result, sampled.map((c) => c.chapterId))
  profile.generatedAt = Date.now()

  onProgress?.("保存文风画像…")
  await writeFile(joinPath(bookPath, "style-profile.json"), JSON.stringify(profile, null, 2))
  await writeFile(joinPath(bookPath, "style.md"), styleProfileToMarkdown(profile, bookTitle))

  return profile
}

/** 把 profile 渲染成人类可读的 markdown（下一期编辑器会用到）。 */
export function styleProfileToMarkdown(profile: BookStyleProfile, bookTitle: string): string {
  const lines: string[] = [
    `# 《${bookTitle}》作品文风画像`,
    "",
    `> 由拆书文风提取生成 · ${profile.sampledChapterIds.length} 章样本`,
    "",
    "## 风格维度",
    "",
  ]
  for (const dim of STYLE_DIMENSIONS) {
    const value = (profile[dim.key] as string) || "（未提取）"
    lines.push(`- **${dim.label}**：${value}`)
  }
  lines.push("", "## 风格宪法（注入生成）", "", profile.constitution, "")
  lines.push("## 代表原文样本", "")
  if (profile.samples.length === 0) {
    lines.push("（无）")
  } else {
    profile.samples.forEach((sample, i) => lines.push(`${i + 1}. ${sample}`, ""))
  }
  return lines.join("\n")
}
