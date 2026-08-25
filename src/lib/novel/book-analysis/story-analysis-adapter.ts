import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { upsertPlotFramework } from "@/lib/novel/plot-framework-library"
import { loadMetadata } from "./analysis-engine"
import { llmRecognizeCharacters } from "./character-llm-recognizer"
import { replaceAutomaticEvidence } from "./analysis-evidence-store"
import { rebuildBookAnalysisContextIndex } from "./analysis-context-index"
import { loadAnalysisManifest, saveAnalysisManifest } from "./analysis-pipeline-storage"
import type { AnalysisEvidenceSnippet, BookAnalysisModuleManifest } from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import {
  buildPlotFrameworkDraftFromBookStoryOutput,
  loadBookStoryFrameworkChapters,
  type BookStoryFrameworkChapter,
} from "./story-framework-extraction"
import {
  buildStoryMapAggregatePrompt,
  buildStoryMapPrompt,
  parseStoryMapResult,
} from "./story-map-prompts"
import { writeStoryMapFiles } from "./story-map-history"
import type { StoryMap } from "./story-map-types"
import { scheduleVerification } from "./verification-engine"

interface StoryAnalysisChunkResult {
  map: StoryMap
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
  writeMapFiles: (bookPath: string, map: StoryMap) => Promise<void>
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
  writeMapFiles: writeStoryMapFiles,
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
    purpose: "故事节奏与主线/分支结构参考",
    enabled: true,
    userPinned: false,
    createdAt: now,
    updatedAt: now,
  })).filter((item) => item.text)
}

/** 本地合并多区块导图（LLM 汇总失败时的兜底：按 order 排序拼接） */
function mergeStoryMapsLocally(maps: StoryMap[], createdAt: number): StoryMap {
  const base = maps[0]
  const chapters = maps
    .flatMap((map) => map.chapters)
    .sort((left, right) => left.order - right.order)
  return {
    ...base,
    createdAt,
    chapters,
    mainLineLabel: maps.find((map) => map.mainLineLabel && map.mainLineLabel !== "主线")?.mainLineLabel ?? base.mainLineLabel,
    mainSummary: maps.map((map) => map.mainSummary).filter(Boolean).join("；") || base.mainSummary,
  }
}

/** 由 StoryMap 合成旧版四段 markdown（保持 PlotFramework 兼容，缺段不致命） */
export function synthesizeLegacyMarkdownFromMap(map: StoryMap): string {
  const eventLine = (event: StoryMap["chapters"][number]["mainEvents"][number]): string =>
    [event.label, ...event.beats].filter(Boolean).join("；")
  const chapters = map.chapters
  const firstChapter = chapters[0]
  const lastChapter = chapters[chapters.length - 1]
  const first = firstChapter?.mainEvents[0]
  const lastChapterEvents = lastChapter?.mainEvents ?? []
  const last = lastChapterEvents[lastChapterEvents.length - 1]
  const middle = chapters
    .slice(1, Math.max(1, chapters.length - 1))
    .flatMap((chapter) => chapter.mainEvents.slice(0, 2))
  const hook = first ? eventLine(first) : map.mainSummary
  const buildup = middle.length > 0 ? middle.map(eventLine).join("；") : hook
  const lastMiddle = middle[middle.length - 1]
  const payoff = last ? eventLine(last) : lastMiddle ? eventLine(lastMiddle) : hook
  const endingHook = last?.spinoff ?? lastChapter?.branches[0]?.label ?? payoff
  const reusableTemplate = map.mainSummary || `${map.mainLineLabel}结构`
  return [
    "## 框架归属与衔接",
    `属于：${"main"}`,
    `与上一框架衔接点：${map.chapters[0]?.summary ?? ""}`,
    `与下一框架衔接点：${endingHook}`,
    `覆盖本批章节数：${map.chapters.length}`,
    "",
    "## 开局钩子",
    hook,
    "",
    "## 铺垫",
    buildup,
    "",
    "## 爽点",
    payoff,
    "",
    "## 结尾钩子",
    endingHook,
    "",
    "## 可复用结构记忆",
    `一句话可复用模板：${reusableTemplate}`,
    "适用场景：主线推进 + 分支生发的节奏参考。",
    "作者手搓留白：请在章纲阶段用人设卡、文风、对话设计、整活或玩梗补充血肉层。",
  ].join("\n")
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
      onProgress?.({ stageLabel: "正在提取主线与分支导图…", percentage: 50 })
      const raw = await dependencies.callModel([
        { role: "system", content: "你是严谨的小说故事结构拆解助手，只输出用户要求的 JSON，不要围栏与解释。" },
        {
          role: "user",
          content: buildStoryMapPrompt({
            bookTitle: metadata.title,
            chapters,
            temporaryCharacters,
          }),
        },
      ], llmConfig, signal)
      onProgress?.({ stageLabel: "解析故事导图结果…", percentage: 90 })
      const map = parseStoryMapResult(raw, {
        bookId: task.bookId,
        bookTitle: metadata.title,
        chapterIds: chunk.chapterIds,
      })
      if (!map) {
        throw new Error("故事导图提取失败：AI 输出缺少主线事件或章节结构，请重试该区块")
      }
      return {
        result: { map, rangeChapterIds: chunk.chapterIds },
        evidence: storyEvidence(task.id, task.bookId, chunk.id, chapters, dependencies.now()),
      }
    },
    async aggregate({ task, chunks, llmConfig, signal, onProgress }) {
      if (chunks.length === 0) throw new Error("没有已完成的故事区块可供汇总")
      const legacy = chunks.find((chunk) => !(chunk as Partial<StoryAnalysisChunkResult>).map)
      if (legacy) {
        throw new Error("检测到旧版四段格式的故事区块，无法合并为导图；请重新提取故事区块")
      }
      const rangeChapterIds = chunks.flatMap((chunk) => chunk.rangeChapterIds)
      if (chunks.length === 1) {
        onProgress?.({ stageLabel: "单区块无需汇总", percentage: 95 })
        return { ...chunks[0], rangeChapterIds }
      }
      onProgress?.({ stageLabel: "正在汇总主线与分支…", percentage: 93 })
      let merged: StoryMap | null = null
      try {
        const raw = await dependencies.callModel([
          { role: "system", content: "你只汇总已有故事导图，禁止新增未分析章节。" },
          { role: "user", content: buildStoryMapAggregatePrompt(chunks.map((chunk) => chunk.map)) },
        ], llmConfig, signal)
        merged = parseStoryMapResult(raw, {
          bookId: task.bookId,
          bookTitle: chunks[0].map.bookTitle,
          chapterIds: rangeChapterIds,
        })
      } catch (error) {
        if (signal.aborted) throw error
        console.warn("[story-map] LLM 汇总失败，回退本地合并：", error)
      }
      const map = merged ?? mergeStoryMapsLocally(chunks.map((chunk) => chunk.map), dependencies.now())
      onProgress?.({ stageLabel: "故事导图汇总完成", percentage: 95 })
      return { map, rangeChapterIds }
    },
    async publish({ task, bookPath, projectPath, llmConfig, result, evidence, onProgress }) {
      onProgress?.({ stageLabel: "正在发布故事导图…", percentage: 97 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法发布故事分析")

      // 主产物：story-map.json + story-map.html
      const map = { ...result.map, createdAt: result.map.createdAt || dependencies.now() }
      await dependencies.writeMapFiles(bookPath, map)

      // 兼容产物：由导图合成四段框架（失败仅告警，不再让整个故事分析失败）
      let resultPath = `story-map:${task.bookId}`
      try {
        const markdown = synthesizeLegacyMarkdownFromMap(map)
        const framework = dependencies.buildDraft({
          bookId: task.bookId,
          bookTitle: metadata.title,
          markdown,
          rangeChapterIds: result.rangeChapterIds,
          createdAt: dependencies.now(),
        })
        if (framework) {
          const saved = await dependencies.upsertFramework(projectPath, framework)
          resultPath = `plot-framework:${saved.id}`
        }
      } catch (error) {
        console.warn("[story-map] 合成剧情框架失败（不影响导图发布）：", error)
      }
      await dependencies.replaceEvidence(bookPath, "story", evidence)

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
            summary: `提取故事导图（主线 ${map.chapters.reduce((sum, c) => sum + c.mainEvents.length, 0)} 事件 / 分支 ${map.chapters.reduce((sum, c) => sum + c.branches.length, 0)} 条），覆盖第 ${task.modules.story.range.startOrder}～${task.modules.story.range.endOrder} 章。`,
            updatedAt,
          },
        },
        updatedAt,
      }
      await dependencies.saveManifest(bookPath, manifest)
      await dependencies.rebuildContextIndex(projectPath)
      onProgress?.({ stageLabel: "故事导图已发布", percentage: 100 })

      // 后台审计：三重验证 + 压力测试（best-effort，失败不影响任务）
      void scheduleVerification(bookPath, "story", llmConfig)
        .catch((error) => console.warn("[story-verify] 校验失败：", error))
      return resultPath
    },
  }
}

export const storyAnalysisAdapter = createStoryAnalysisAdapter()
