import { describe, expect, it, vi } from "vitest"
import { createConfidenceGatePlugin, DEFAULT_CONFIDENCE_THRESHOLD, intentToLabel } from "./confidence-gate-plugin"
import type { NovelTaskIntent } from "@/lib/novel/task-router"

describe("confidence-gate-plugin", () => {
  it("passes through when confidence >= threshold", async () => {
    const plugin = createConfidenceGatePlugin({ threshold: 0.5 })

    const result = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "write_chapter" as NovelTaskIntent,
        confidence: 0.9,
        chapterNumber: 5,
        extractedParams: {},
      },
    })

    expect(result.shouldStop).toBeUndefined()
    expect(result.stopReason).toBeUndefined()
  })

  it("stops when confidence < threshold", async () => {
    const plugin = createConfidenceGatePlugin({ threshold: 0.7 })

    const result = await plugin.run({
      userMessage: "随便写点",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 0.5,
        extractedParams: {},
      },
    })

    expect(result.shouldStop).toBe(true)
    expect(result.stopReason).toBe("clarification_needed")
    expect(result.clarificationNeeded).toBe(true)
  })

  it("stops for general_chat even if confidence >= threshold", async () => {
    const plugin = createConfidenceGatePlugin({ threshold: 0.5 })

    const result = await plugin.run({
      userMessage: "你好",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 1.0,
        extractedParams: {},
      },
    })

    expect(result.shouldStop).toBe(true)
    expect(result.stopReason).toBe("clarification_needed")
  })

  it("uses default threshold when not specified", async () => {
    const plugin = createConfidenceGatePlugin()
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.5)

    const highResult = await plugin.run({
      userMessage: "写第5章",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "write_chapter" as NovelTaskIntent,
        confidence: 0.6,
        extractedParams: {},
      },
    })
    expect(highResult.shouldStop).toBeUndefined()

    const lowResult = await plugin.run({
      userMessage: "随便",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 0.4,
        extractedParams: {},
      },
    })
    expect(lowResult.shouldStop).toBe(true)
  })

  it("returns candidates when stopping for clarification", async () => {
    const plugin = createConfidenceGatePlugin({ threshold: 0.7 })

    const result = await plugin.run({
      userMessage: "这段再处理一下",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "polish_chapter" as NovelTaskIntent,
        confidence: 0.4,
        extractedParams: {},
      },
    })

    expect(result.clarificationCandidates).toBeDefined()
    const candidates = result.clarificationCandidates as Array<{ intent: string; label: string; confidence: number }>
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].intent).toBe("polish_chapter")
    expect(candidates[0].label).toBe("润色章节")
  })

  it("supports custom getCandidates function", async () => {
    const customCandidates = [
      { intent: "rewrite_chapter" as NovelTaskIntent, label: "改写章节", confidence: 0.6 },
      { intent: "polish_chapter" as NovelTaskIntent, label: "润色章节", confidence: 0.5 },
    ]
    const mockGetCandidates = vi.fn().mockReturnValue(customCandidates)
    const plugin = createConfidenceGatePlugin({ threshold: 0.7, getCandidates: mockGetCandidates })

    const result = await plugin.run({
      userMessage: "改一下",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 0.5,
        extractedParams: {},
      },
    })

    expect(mockGetCandidates).toHaveBeenCalledWith("改一下")
    expect(result.clarificationCandidates).toEqual(customCandidates)
  })

  it("does nothing when not in novel mode", async () => {
    const plugin = createConfidenceGatePlugin()

    const result = await plugin.run({
      userMessage: "你好",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: false,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 0.5,
        extractedParams: {},
      },
    })

    expect(result.shouldStop).toBeUndefined()
  })

  it("does nothing when no task route", async () => {
    const plugin = createConfidenceGatePlugin()

    const result = await plugin.run({
      userMessage: "你好",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: null,
    })

    expect(result.shouldStop).toBeUndefined()
  })

  it("handles error gracefully", async () => {
    const mockError = vi.fn()
    const mockGetCandidates = vi.fn().mockImplementation(() => {
      throw new Error("candidates error")
    })
    const plugin = createConfidenceGatePlugin({
      threshold: 0.7,
      getCandidates: mockGetCandidates,
      onError: mockError,
    })

    const result = await plugin.run({
      userMessage: "改一下",
      projectPath: "/test",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "general_chat" as NovelTaskIntent,
        confidence: 0.5,
        extractedParams: {},
      },
    })

    expect(result.shouldStop).toBeUndefined()
    expect(mockError).toHaveBeenCalled()
  })
})

describe("intentToLabel", () => {
  it("returns Chinese label for known intents", () => {
    expect(intentToLabel("write_chapter")).toBe("写新章节")
    expect(intentToLabel("continue_chapter")).toBe("续写章节")
    expect(intentToLabel("rewrite_chapter")).toBe("改写章节")
    expect(intentToLabel("polish_chapter")).toBe("润色章节")
    expect(intentToLabel("review_chapter")).toBe("AI 审稿")
    expect(intentToLabel("lint_chapter")).toBe("连贯性检查")
    expect(intentToLabel("generate_outline")).toBe("生成大纲")
    expect(intentToLabel("general_chat")).toBe("随便聊聊")
  })

  it("returns intent string for unknown intents", () => {
    expect(intentToLabel("unknown_intent" as NovelTaskIntent)).toBe("unknown_intent")
  })
})
