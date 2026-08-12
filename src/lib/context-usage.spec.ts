import { describe, expect, it } from "vitest"
import {
  buildContextUsageSnapshot,
  calibrateContextUsageSnapshot,
  composeLiveContextUsage,
  formatContextTokenCount,
  normalizeContextUsageSnapshot,
} from "./context-usage"

describe("context usage snapshot", () => {
  it("builds local segments and marks estimated when provider usage is missing", () => {
    const snapshot = buildContextUsageSnapshot({
      windowTokens: 100_000,
      softwareRules: "规则".repeat(20),
      toolDefinitionsJson: '{"tools":[]}',
      stableTokens: 1000,
      summaryTokens: 200,
      dynamicTokens: 400,
      historyTexts: ["历史".repeat(50)],
      currentInput: "继续写下一章",
    })

    expect(snapshot.estimated).toBe(true)
    expect(snapshot.windowTokens).toBe(100_000)
    expect(snapshot.totalTokens).toBeGreaterThan(0)
    expect(snapshot.segments.reduce((sum, segment) => sum + segment.tokens, 0)).toBe(snapshot.totalTokens)
    expect(snapshot.segments.find((segment) => segment.key === "stableCore")?.tokens).toBe(1000)
  })

  it("scales local segments to match provider prompt tokens", () => {
    const local = buildContextUsageSnapshot({
      windowTokens: 256_000,
      softwareRules: "a".repeat(400),
      stableTokens: 1000,
      summaryTokens: 500,
      dynamicTokens: 500,
      historyTexts: ["b".repeat(400)],
      currentInput: "c".repeat(400),
    })
    const calibrated = calibrateContextUsageSnapshot(local, { inputTokens: 8000 })

    expect(calibrated.estimated).toBe(false)
    expect(calibrated.totalTokens).toBe(8000)
    expect(calibrated.segments.reduce((sum, segment) => sum + segment.tokens, 0)).toBe(8000)
    expect(calibrated.segments.every((segment) => segment.tokens >= 0)).toBe(true)
  })

  it("keeps estimated=true when usage has no input tokens", () => {
    const local = buildContextUsageSnapshot({
      windowTokens: 10_000,
      softwareRules: "hello",
      historyTexts: ["world"],
    })
    const calibrated = calibrateContextUsageSnapshot(local, { outputTokens: 12 })
    expect(calibrated.estimated).toBe(true)
    expect(calibrated.totalTokens).toBe(local.totalTokens)
  })

  it("formats token counts compactly", () => {
    expect(formatContextTokenCount(512)).toBe("512")
    expect(formatContextTokenCount(11200)).toBe("11.2K")
    expect(formatContextTokenCount(256_000)).toBe("256K")
  })

  it("normalizes persisted snapshots defensively", () => {
    expect(normalizeContextUsageSnapshot(null)).toBeUndefined()
    expect(normalizeContextUsageSnapshot({
      windowTokens: 1000.8,
      totalTokens: 12.2,
      measuredAt: 1,
      estimated: true,
      segments: [{ key: "history", tokens: 12.9 }],
    })).toEqual({
      windowTokens: 1000,
      totalTokens: 12,
      measuredAt: 1,
      estimated: true,
      segments: [{ key: "history", tokens: 12 }],
    })
  })

  it("composes a live overlay that keeps stable layers and refreshes draft on calibrated snapshots", () => {
    const last = buildContextUsageSnapshot({
      windowTokens: 100_000,
      softwareRules: "规则".repeat(40),
      stableTokens: 2000,
      summaryTokens: 100,
      dynamicTokens: 800,
      historyTexts: ["旧历史"],
      currentInput: "旧输入",
      usage: { inputTokens: 5000 },
    })
    const live = composeLiveContextUsage(last, {
      sessionSummaryText: "新的会话摘要内容".repeat(5),
      historyTexts: ["新历史".repeat(20)],
      currentInput: "正在输入下一章需求".repeat(8),
    })

    expect(live).not.toBeNull()
    expect(live!.estimated).toBe(true)
    expect(live!.segments.find((segment) => segment.key === "stableCore")?.tokens).toBe(
      last.segments.find((segment) => segment.key === "stableCore")?.tokens,
    )
    expect(live!.segments.find((segment) => segment.key === "history")?.tokens).toBe(
      last.segments.find((segment) => segment.key === "history")?.tokens,
    )
    expect(live!.segments.find((segment) => segment.key === "currentInput")?.tokens).toBeGreaterThan(
      last.segments.find((segment) => segment.key === "currentInput")?.tokens ?? 0,
    )
    expect(live!.totalTokens).toBeGreaterThan(last.totalTokens)
  })

  it("can show a draft-only live estimate before the first measured request", () => {
    const live = composeLiveContextUsage(null, {
      windowTokens: 32_000,
      currentInput: "第一次提问前的草稿".repeat(10),
    })
    expect(live).not.toBeNull()
    expect(live!.segments.find((segment) => segment.key === "currentInput")?.tokens).toBeGreaterThan(0)
    expect(composeLiveContextUsage(null, { windowTokens: 32_000, currentInput: "   " })).toBeNull()
  })

  it("adds pending tool reads on top of a calibrated snapshot without rewriting stable layers", () => {
    const last = calibrateContextUsageSnapshot(
      buildContextUsageSnapshot({
        windowTokens: 100_000,
        softwareRules: "规则".repeat(20),
        stableTokens: 1000,
        summaryTokens: 100,
        dynamicTokens: 400,
        historyTexts: ["历史"],
        currentInput: "写下一章",
      }),
      { inputTokens: 10_000 },
    )
    const live = composeLiveContextUsage(last, {
      currentInput: "写下一章",
      pendingToolResultTexts: ["大纲正文".repeat(80)],
    })

    expect(live).not.toBeNull()
    expect(live!.totalTokens).toBeGreaterThan(last.totalTokens)
    expect(live!.segments.find((segment) => segment.key === "toolResults")?.tokens).toBeGreaterThan(0)
    expect(live!.segments.find((segment) => segment.key === "stableCore")?.tokens).toBe(
      last.segments.find((segment) => segment.key === "stableCore")?.tokens,
    )
  })
})
