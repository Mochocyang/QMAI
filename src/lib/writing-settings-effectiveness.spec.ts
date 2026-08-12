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

  it("does not expose the dead deepChapterReview toggle that workflow modes already replaced", () => {
    expect(novelSection).not.toContain("deepChapterReview")
    expect(deepChapter).toContain("const shouldRunAiReview = workflowProfile.runAiReview")
    expect(deepChapter).not.toContain("novelConfig.deepChapterReview")
  })

  it("keeps community summary, ingest-on-save, review effort, and task models on live paths", () => {
    expect(communitySummary).toContain("novelConfig.communitySummaryEnabled")
    expect(communitySummary).toContain("novelConfig.communitySummaryInterval")
    expect(chapterIngest).toContain("novelConfig.communitySummaryAsync")
    expect(previewPanel).toContain("novelConfig.autoIngestOnSave")
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
})
