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

  /*
   * 物品此前只写了 `"items": []` 一行、零指导，于是提取质量随机：模型可能只收关键道具，
   * 也可能把「一杯茶」当物品收进来。分类要求把这件事说清楚了，这里钉住它别被删回去。
   */
  it("要求为每件物品给出四分类，并说明「有无意义」的判定口径", () => {
    const prompt = buildChapterExtractUserPrompt(12, "正文")
    expect(prompt).toContain("itemCategories")
    // 四个分类标签都要在提示词里出现，模型才知道可选值
    for (const label of ["主角使用", "配角使用", "反派使用", "没有意义"]) {
      expect(prompt, `提取提示词应包含分类「${label}」`).toContain(label)
    }
    // 键必须与 items 一一对应，否则分类会挂到不存在的物品上
    expect(prompt).toContain("一一对应")
    // 判定口径是「有没有故事作用」，不是「贵不贵重」——
    // 这一点很关键：否则模型会把凡尔赛的茶具当重要道具、把祖传钥匙当闲笔。
    expect(prompt).toContain("故事作用")
  })

  it("把已建立设定喂给提取，但明确要求不要在输出里复述", () => {
    const prompt = buildChapterExtractUserPrompt(12, "正文", "已建立的角色定位：萧炎（主角）")
    expect(prompt).toContain("已建立的设定")
    expect(prompt).toContain("萧炎（主角）")
    // 不复述：否则这些内容会一路污染快照 JSON（summary/events 里混进名册）
    expect(prompt).toContain("不要在输出里复述")
  })

  it("没有已建立设定时提示词与改造前逐字节相同（老项目与新项目行为一致）", () => {
    const withoutContext = buildChapterExtractUserPrompt(12, "正文")
    expect(buildChapterExtractUserPrompt(12, "正文", "")).toBe(withoutContext)
    // 纯空白同样视为「没有」——否则空行也会改动提示词
    expect(buildChapterExtractUserPrompt(12, "正文", "   \n  ")).toBe(withoutContext)
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
