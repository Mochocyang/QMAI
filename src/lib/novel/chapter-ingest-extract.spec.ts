import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "./chapter-excerpts"
import {
  buildChapterExtractSystemPrompt,
  buildChapterExtractUserPrompt,
  buildOutlineExtractUserPrompt,
  CHAPTER_EXTRACT_MAX_OUTPUT_TOKENS,
  CHAPTER_EXTRACT_REQUEST_OVERRIDES,
  GRAPH_EDGE_RELATION_LABELS,
  resolveChapterExtractMaxTokens,
  sliceChapterExtractBody,
} from "./chapter-ingest-extract"
import { NOVEL_RELATION_LABELS } from "./graph-adapter"
import { ANALYSIS_OUTPUT_FRAC, MIN_LLM_OUTPUT_TOKENS } from "@/lib/context-budget"

const LEGACY_CHAPTER_EXTRACT_SCHEMA_CHARS = 2_400

describe("chapter extract prompt", () => {
  it("keeps graph edge labels aligned with the graph adapter", () => {
    expect(GRAPH_EDGE_RELATION_LABELS).toBe(Object.values(NOVEL_RELATION_LABELS).join("|"))
  })

  it("asks for compact JSON without graphNodes or verbose field comments", () => {
    const prompt = buildChapterExtractUserPrompt(12, "正文")
    expect(prompt).toContain('"chapterId": "chapter-12"')
    expect(prompt).toContain("characterDetails")
    expect(prompt).toContain("graphEdges")
    expect(prompt).toContain(GRAPH_EDGE_RELATION_LABELS)
    expect(prompt).not.toContain("graphNodes")
    expect(prompt).not.toContain("弧光变化（本章中该人物的成长或变化）")
    expect(prompt.length).toBeLessThan(LEGACY_CHAPTER_EXTRACT_SCHEMA_CHARS + "正文".length)
  })

  it("slices long chapter bodies before sending them to the model", () => {
    const body = "甲".repeat(CHAPTER_BODY_EXCERPT_MAX_CHARS + 80)
    expect(sliceChapterExtractBody(body)).toHaveLength(CHAPTER_BODY_EXCERPT_MAX_CHARS)
    expect(buildChapterExtractUserPrompt(1, body)).not.toContain("甲".repeat(CHAPTER_BODY_EXCERPT_MAX_CHARS + 1))
  })

  it("keeps the system prompt short and forbids markdown fences", () => {
    const prompt = buildChapterExtractSystemPrompt("请使用中文。")
    expect(prompt).toContain("只输出一个 JSON 对象")
    expect(prompt).toContain("请使用中文。")
    expect(prompt.length).toBeLessThan(120)
  })

  it("caps extract output tokens instead of reserving 15% of the window", () => {
    expect(resolveChapterExtractMaxTokens(204_800)).toBe(CHAPTER_EXTRACT_MAX_OUTPUT_TOKENS)
    expect(resolveChapterExtractMaxTokens(8_192)).toBeGreaterThanOrEqual(MIN_LLM_OUTPUT_TOKENS)
    expect(resolveChapterExtractMaxTokens(8_192)).toBe(Math.max(
      MIN_LLM_OUTPUT_TOKENS,
      Math.floor(8_192 * ANALYSIS_OUTPUT_FRAC),
    ))
    expect(CHAPTER_EXTRACT_MAX_OUTPUT_TOKENS).toBeLessThan(Math.floor(204_800 * 0.15))
  })

  it("disables thinking and skips global user memory for extraction", () => {
    expect(CHAPTER_EXTRACT_REQUEST_OVERRIDES).toMatchObject({
      temperature: 0.1,
      reasoning: { mode: "off" },
      skipUserMemory: true,
    })
  })

  it("does not ask outline ingest for graphNodes", () => {
    const prompt = buildOutlineExtractUserPrompt("世界观")
    expect(prompt).toContain("graphEdges")
    expect(prompt).not.toContain("graphNodes")
  })
})

describe("chapter ingest reextract path", () => {
  const source = readFileSync(resolve(__dirname, "chapter-ingest.ts"), "utf8")

  it("rebuilds derived memory on reextract instead of applying incremental changes twice", () => {
    expect(source).toContain("const isReingest = existingSnapshot != null")
    expect(source).toContain("REINGEST_SYNC_OPTIONS")
    expect(source).toContain("skipDerivedIncremental: true")
    expect(source).toContain("if (isReingest)")
    expect(source).toContain("await finalizeProjectMemoryRebuild(pp)")
    expect(source).toContain("await rebuildTimelineFromSnapshots(projectPath, snapshots)")
    expect(source).toContain("if (!isReingest && shouldRebuildCommunitySummaries")
  })

  it("sends extract requests with the compact overrides", () => {
    expect(source).toContain("CHAPTER_EXTRACT_REQUEST_OVERRIDES")
    expect(source).toContain("parseLlmJsonObject")
    expect(source).toContain("resolveChapterExtractMaxTokens")
  })
})
