import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CHAPTER_TARGET_CHARS_MAX,
  CHAPTER_TARGET_CHARS_MIN,
} from "@/lib/novel/deep-chapter-prompts"

const novelSection = readFileSync(
  resolve(__dirname, "../components/settings/sections/novel-section.tsx"),
  "utf8",
)
const previewPanel = readFileSync(
  resolve(__dirname, "../components/layout/preview-panel.tsx"),
  "utf8",
)
const contextEngine = readFileSync(
  resolve(__dirname, "./novel/context-engine.ts"),
  "utf8",
)
const contextDataSources = readFileSync(
  resolve(__dirname, "./novel/context-data-sources.ts"),
  "utf8",
)
const deepChapter = readFileSync(
  resolve(__dirname, "./novel/deep-chapter-generation.ts"),
  "utf8",
)
const chapterIngest = readFileSync(
  resolve(__dirname, "./novel/chapter-ingest.ts"),
  "utf8",
)
const communitySummary = readFileSync(
  resolve(__dirname, "./novel/community-summary.ts"),
  "utf8",
)
const revisionFeedback = readFileSync(
  resolve(__dirname, "./novel/revision-feedback.ts"),
  "utf8",
)
const modelResolver = readFileSync(
  resolve(__dirname, "./novel/model-resolver.ts"),
  "utf8",
)
const reviewAdapter = readFileSync(
  resolve(__dirname, "./novel/review-adapter.ts"),
  "utf8",
)
const projectStore = readFileSync(
  resolve(__dirname, "./project-store.ts"),
  "utf8",
)
const chatPanel = readFileSync(
  resolve(__dirname, "../components/chat/chat-panel.tsx"),
  "utf8",
)
const wikiStore = readFileSync(
  resolve(__dirname, "../stores/wiki-store.ts"),
  "utf8",
)
const zhI18n = readFileSync(
  resolve(__dirname, "../i18n/zh.json"),
  "utf8",
)

describe("writing settings still reach runtime", () => {
  it("persists novelConfig, feedback window, and chat history immediately from the writing settings panel", () => {
    expect(novelSection).toContain("saveNovelConfig")
    expect(novelSection).toContain("saveRevisionFeedbackWindowConfig")
    expect(novelSection).toContain("saveMaxHistoryMessages")
    expect(novelSection).toContain("updateFeedbackWindow")
    expect(novelSection).toContain("updateMaxHistoryMessages")
  })

  it("keeps chapter target chars UI and runtime clamp on the same 1000–10000 range", () => {
    expect(CHAPTER_TARGET_CHARS_MIN).toBe(1000)
    expect(CHAPTER_TARGET_CHARS_MAX).toBe(10_000)
    expect(novelSection).toContain("CHAPTER_TARGET_CHARS_MIN")
    expect(novelSection).toContain("CHAPTER_TARGET_CHARS_MAX")
    expect(projectStore).toContain("CHAPTER_TARGET_CHARS_MIN")
    expect(projectStore).toContain("CHAPTER_TARGET_CHARS_MAX")
    expect(novelSection).not.toContain("Math.max(2000, Math.min(6000")
  })

  it("wires de-AI batch concurrency into the live chapter queue", () => {
    expect(novelSection).toContain("deAiBatchConcurrency")
    expect(novelSection).toContain("notifyDeAiChapterConcurrencyChanged")
    expect(previewPanel).toContain("acquireDeAiChapterSlot")
  })

  it("uses recentSummaryWindow and searchTopK in context loading, including graph search", () => {
    expect(novelSection).toContain("recentSummaryWindow")
    expect(novelSection).toContain("searchTopK")
    expect(contextEngine).toContain("recentSummaryWindow: novelConfig.recentSummaryWindow")
    expect(contextEngine).toContain("searchTopK: novelConfig.searchTopK")
    expect(contextDataSources).toContain("context.config.searchTopK")
    expect(contextEngine).toContain("const topK = Math.max(1, Math.floor(limit) || 10)")
    expect(contextEngine).not.toContain("topK: 10")
  })

  it("honors prior-chapter analysis in standard and strict modes, not only the old deep-only gate", () => {
    expect(novelSection).toContain("deepPreviousChaptersAnalysis")
    expect(deepChapter).toContain("workflowProfile.mode !== \"fast\"")
    expect(deepChapter).toContain("novelConfig.deepPreviousChaptersAnalysis")
    expect(deepChapter).not.toContain("runPreviousChaptersAnalysis")
  })

  it("gates chapter writing web search with a writing-settings switch, not strict mode alone", () => {
    expect(novelSection).toContain("writingWebSearchEnabled")
    expect(wikiStore).toContain("writingWebSearchEnabled")
    expect(projectStore).toContain("writingWebSearchEnabled")
    expect(zhI18n).toContain("writingWebSearchEnabled")
    expect(zhI18n).toContain("writingWebSearchEnabled")
    expect(deepChapter).toContain("novelConfig.writingWebSearchEnabled")
    expect(deepChapter).toContain("workflowProfile.mode !== \"fast\" && novelConfig.writingWebSearchEnabled")
    expect(deepChapter).not.toContain("workflowProfile.mode === \"strict\"")
    expect(chatPanel).toContain("writingWebSearchEnabled")
  })

  it("deletes the dead deepChapterReview switch instead of keeping an unused config field", () => {
    expect(novelSection).not.toContain("deepChapterReview")
    expect(wikiStore).not.toContain("deepChapterReview")
    expect(projectStore).not.toContain("deepChapterReview")
    expect(zhI18n).not.toContain("deepChapterReview")
    expect(zhI18n).not.toContain("deepChapterReview")
    expect(deepChapter).toContain("const shouldRunAiReview = workflowProfile.runAiReview")
    expect(deepChapter).not.toContain("novelConfig.deepChapterReview")
  })

  it("keeps community summary, review effort, and task models on live paths", () => {
    expect(communitySummary).toContain("novelConfig.communitySummaryEnabled")
    expect(communitySummary).toContain("novelConfig.communitySummaryInterval")
    expect(chapterIngest).toContain("novelConfig.communitySummaryAsync")
    expect(reviewAdapter).toContain("reviewReasoningEffort")
    expect(modelResolver).toContain("review: novelConfig.reviewModel")
    expect(modelResolver).toContain("summary: novelConfig.summaryModel")
    expect(modelResolver).toContain("extract: novelConfig.extractModel")
    expect(modelResolver).toContain("deAi: novelConfig.deAiModel")
    expect(chatPanel).toContain("maxHistoryMessages")
    expect(revisionFeedback).toContain("config.currentChapterIncludeShouldImprove")
    expect(revisionFeedback).toContain("config.previousChapterCarryEnabled")
    expect(revisionFeedback).toContain("config.lookbackChapterCount")
    expect(revisionFeedback).toContain("config.lookbackIncludeMustFixOnly")
  })

  /*
   * 保存为正式章节不再自动提取记忆（用户要求：它与章节/大纲的「提取记忆」按钮
   * 是同一件事，重复）。这道断言是**防回归**：把四处一起钉住，
   * 谁日后想把这个开关加回来，必须先在这里看到「它已被有意移除」。
   *
   * 断言的是**代码形态**而不是裸词：上面那些移除原因说明留在注释里，
   * 注释里当然会出现这个字段名；只有真把字段/开关加回来才会命中这些模式。
   */
  /*
   * 丙-4b：新章节灵感提示开关。
   *
   * 与上面 `writingWebSearchEnabled` 那条同风格：把一个新开关的五个落点
   * （设置界面、store 字段、默认值文件、落盘归一化、中文文案）一起钉住。
   * 只钉其中两三处，日后最容易漏的恰恰是 `normalizeNovelConfig` ——
   * 漏了它，老配置读回来字段是 `undefined`，`if (enabled)` 这种写法
   * 会把开关默认成**关**，而界面上开关仍显示开。
   */
  it("把新章节灵感提示开关的每个落点都钉住", () => {
    expect(novelSection).toContain("inspirationHintEnabled")
    expect(wikiStore).toContain("inspirationHintEnabled")
    expect(projectStore).toContain("inspirationHintEnabled")
    expect(zhI18n).toContain('"inspirationHintEnabled"')
    expect(zhI18n).toContain('"inspirationHintEnabledHint"')
  })

  it("keeps ingest-on-save deleted instead of letting the duplicate path return", () => {
    expect(previewPanel).not.toContain("novelConfig.autoIngestOnSave")
    expect(novelSection).not.toContain("novelConfig.autoIngestOnSave")
    expect(novelSection).not.toContain("autoIngestOnSaveHint")
    // `autoIngestOnSave:` 同时盯住 NovelConfig 的字段声明与 DEFAULT_NOVEL_CONFIG 的默认值。
    expect(wikiStore).not.toContain("autoIngestOnSave:")
    expect(projectStore).not.toContain("autoIngestOnSave:")
    expect(zhI18n).not.toContain('"autoIngestOnSave"')
    // 手动路径必须还在：删掉的是自动触发，不是「提取记忆」这个功能本身。
    expect(previewPanel).toContain("handleReingest")
  })
})
