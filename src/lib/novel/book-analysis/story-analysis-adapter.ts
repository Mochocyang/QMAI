import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { upsertPlotFramework } from "@/lib/novel/plot-framework-library"
import type { PlotFramework } from "@/lib/novel/plot-framework"
import { loadMetadata } from "./analysis-engine"
import { llmRecognizeCharacters } from "./character-llm-recognizer"
import { replaceAutomaticEvidence } from "./analysis-evidence-store"
import { rebuildBookAnalysisContextIndex } from "./analysis-context-index"
import { loadAnalysisManifest, saveAnalysisManifest } from "./analysis-pipeline-storage"
import type { AnalysisEvidenceSnippet, BookAnalysisModuleManifest } from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import {
  buildBookStoryFrameworkPrompt,
  buildPlotFrameworkDraftFromBookStoryOutput,
  loadBookStoryFrameworkChapters,
  type BookStoryFrameworkChapter,
} from "./story-framework-extraction"

export interface StoryAnalysisChunkResult {
  markdown: string
  rangeChapterIds: string[]
}

interface StoryAnalysisAdapterDependencies {
  loadChapters: typeof loadBookStoryFrameworkChapters
  loadMetadata: typeof loadMetadata
  recognizeCharacters: typeof llmRecognizeCharacters
  callModel: (messages: ChatMessage[], llmConfig: Parameters<typeof streamChat>[0], signal: AbortSignal) => Promise<string>
  buildDraft: typeof buildPlotFrameworkDraftFromBookStoryOutput
  upsertFramework: typeof upsertPlotFramework
  replaceEvidence: typeof replaceAutomaticEvidence
  loadManifest: typeof loadAnalysisManifest
  saveManifest: typeof saveAnalysisManifest
  rebuildContextIndex: typeof rebuildBookAnalysisContextIndex
  now: () => number
}

async function callStoryModel(
  messages: ChatMessage[],
  llmConfig: Parameters<typeof streamChat>[0],
  signal: AbortSignal,
): Promise<string> {
  let output = ""
  let streamError: Error | null = null
  await streamChat(llmConfig, messages, {
    onToken: (token) => { output += token },
    onDone: () => {},
    onError: (error) => { streamError = error },
  }, signal, { reasoning: llmConfig.reasoning })
  if (signal.aborted) throw new Error("用户取消故事分析")
  if (streamError) throw streamError
  return output.trim()
}

const defaultDependencies: StoryAnalysisAdapterDependencies = {
  loadChapters: loadBookStoryFrameworkChapters,
  loadMetadata,
  recognizeCharacters: llmRecognizeCharacters,
  callModel: callStoryModel,
  buildDraft: buildPlotFrameworkDraftFromBookStoryOutput,
  upsertFramework: upsertPlotFramework,
  replaceEvidence: replaceAutomaticEvidence,
  loadManifest: loadAnalysisManifest,
  saveManifest: saveAnalysisManifest,
  rebuildContextIndex: rebuildBookAnalysisContextIndex,
  now: Date.now,
}

function trimEvidenceText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length <= 320 ? text : `${text.slice(0, 320)}…`
}

function storyEvidence(
  taskId: string,
  bookId: string,
  chunkId: string,
  chapters: BookStoryFrameworkChapter[],
  now: number,
): AnalysisEvidenceSnippet[] {
  const selected = chapters.length <= 1 ? chapters : [chapters[0], chapters[chapters.length - 1]]
  return selected.map((chapter, index): AnalysisEvidenceSnippet => ({
    version: 1,
    id: `evidence-${taskId}-story-${chunkId}-${index}`,
    bookId,
    skill: "story",
    taskId,
    chapterId: chapter.id,
    chapterOrder: chapter.order,
    text: trimEvidenceText(chapter.content),
    tags: [index === 0 ? "开局与铺垫" : "推进与钩子", "故事结构"],
    reason: index === 0 ? "用于理解本区块如何建立期待" : "用于理解本区块如何推进并留下钩子",
    purpose: "故事节奏与四段结构参考",
    enabled: true,
    userPinned: false,
    createdAt: now,
    updatedAt: now,
  })).filter((item) => item.text)
}

function buildAggregatePrompt(chunks: StoryAnalysisChunkResult[]): string {
  return [
    "你是小说故事框架汇总助手。以下内容是同一用户所选章节范围内，各章节区块已经完成的四段框架分析。",
    "只合并这些已完成结果，不补写范围外剧情，不输出角色档案或角色 Skill。",
    "请去重并保留区块间的衔接，严格按原有标题输出：框架归属与衔接、开局钩子、铺垫、爽点、结尾钩子、可复用结构记忆。",
    "",
    ...chunks.map((chunk, index) => [
      `# 区块 ${index + 1}（${chunk.rangeChapterIds.join("、")}）`,
      chunk.markdown,
    ].join("\n")),
  ].join("\n\n")
}

export function createStoryAnalysisAdapter(
  overrides: Partial<StoryAnalysisAdapterDependencies> = {},
): AnalysisSkillAdapter<StoryAnalysisChunkResult, StoryAnalysisChunkResult> {
  const dependencies = { ...defaultDependencies, ...overrides }
  return {
    skill: "story",
    async runChunk({ task, bookPath, llmConfig, chunk, signal, onProgress }) {
      onProgress?.({ stageLabel: "读取章节…", percentage: 10 })
      const chapters = await dependencies.loadChapters(bookPath, chunk.chapterIds)
      if (chapters.length !== chunk.chapterIds.length) {
        throw new Error("所选故事章节读取不完整，请检查章节文件后重试")
      }
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法分析故事")
      let temporaryCharacters: Array<{ name: string; aliases: string[]; category: string }> | undefined
      if (task.modules.characters.status === "completed") {
        temporaryCharacters = undefined
      } else {
        onProgress?.({ stageLabel: "识别临时角色…", percentage: 30 })
        temporaryCharacters = (await dependencies.recognizeCharacters({
          chapters: chapters.map((chapter, index) => ({ index, content: chapter.content })),
          llmConfig,
          sourceBook: metadata.title,
          signal,
        })).map((character) => ({
          name: character.name,
          aliases: character.aliases,
          category: character.category,
        }))
      }
      onProgress?.({ stageLabel: "正在调用模型分析故事框架…", percentage: 50 })
      const markdown = await dependencies.callModel([
        { role: "system", content: "你是严谨的小说故事框架拆解助手，必须输出可复用的中文四段框架。" },
        {
          role: "user",
          content: buildBookStoryFrameworkPrompt({
            bookTitle: metadata.title,
            chapters,
            temporaryCharacters,
          }),
        },
      ], llmConfig, signal)
      onProgress?.({ stageLabel: "解析故事框架结果…", percentage: 90 })
      return {
        result: { markdown, rangeChapterIds: chunk.chapterIds },
        evidence: storyEvidence(task.id, task.bookId, chunk.id, chapters, dependencies.now()),
      }
    },
    async aggregate({ chunks, llmConfig, signal, onProgress }) {
      if (chunks.length === 0) throw new Error("没有已完成的故事区块可供汇总")
      const rangeChapterIds = chunks.flatMap((chunk) => chunk.rangeChapterIds)
      if (chunks.length === 1) {
        onProgress?.({ stageLabel: "单区块无需汇总", percentage: 95 })
        return { ...chunks[0], rangeChapterIds }
      }
      onProgress?.({ stageLabel: "正在调用模型汇总故事框架…", percentage: 93 })
      const markdown = await dependencies.callModel([
        { role: "system", content: "你只汇总已有故事分析，禁止补写未分析章节。" },
        { role: "user", content: buildAggregatePrompt(chunks) },
      ], llmConfig, signal)
      onProgress?.({ stageLabel: "故事汇总完成", percentage: 95 })
      return { markdown, rangeChapterIds }
    },
    async publish({ task, bookPath, projectPath, result, evidence, onProgress }) {
      onProgress?.({ stageLabel: "正在发布故事框架…", percentage: 97 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法发布故事分析")
      const framework = dependencies.buildDraft({
        bookId: task.bookId,
        bookTitle: metadata.title,
        markdown: result.markdown,
        rangeChapterIds: result.rangeChapterIds,
        createdAt: dependencies.now(),
      })
      if (!framework) throw new Error("故事框架提取失败：AI 输出缺少开局钩子、铺垫、爽点或结尾钩子")
      const saved = await dependencies.upsertFramework(projectPath, framework)
      await dependencies.replaceEvidence(bookPath, "story", evidence)

      const resultPath = `plot-framework:${saved.id}`
      const updatedAt = dependencies.now()
      const current = await dependencies.loadManifest(bookPath)
      const manifest: BookAnalysisModuleManifest = {
        version: 1,
        bookId: task.bookId,
        modules: {
          ...(current?.modules ?? {}),
          story: {
            ...task.modules.story,
            status: "completed",
            resultPath,
            summary: `提取四段故事框架，覆盖第 ${task.modules.story.range.startOrder}～${task.modules.story.range.endOrder} 章。`,
            updatedAt,
          },
        },
        updatedAt,
      }
      await dependencies.saveManifest(bookPath, manifest)
      await dependencies.rebuildContextIndex(projectPath)
      onProgress?.({ stageLabel: "故事框架已发布", percentage: 100 })
      return resultPath
    },
  }
}

export const storyAnalysisAdapter = createStoryAnalysisAdapter()

export type { PlotFramework }
