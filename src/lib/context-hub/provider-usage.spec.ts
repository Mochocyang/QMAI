import { describe, expect, it, vi } from "vitest"
import type { ContextHubResult, ContextHubSnapshotRef, ContextHubStats } from "./types"
import {
  applyProviderUsageToStats,
  buildLlmRequestDiagnostics,
  persistContextHubProviderUsage,
} from "./provider-usage"
import type { UserMemoryDecision } from "@/lib/user-memory/decision-trace"
import { setLatestUserMemoryDecision } from "@/lib/user-memory/decision-trace"

const baseStats: ContextHubStats = {
  cacheHits: 2,
  reloaded: 1,
  empty: 0,
  fallbackUsed: 0,
  readFailed: 0,
  writeFailed: 0,
  stableTokens: 1000,
  summaryTokens: 100,
  dynamicTokens: 300,
  candidateTokens: 2000,
  estimatedSavedTokens: 600,
  estimatedSavedPercent: 30,
  expanded: false,
  providerCacheEnabled: true,
}

describe("context hub provider usage", () => {
  it("stores confirmed cache usage without changing local cache counters", () => {
    const next = applyProviderUsageToStats(baseStats, {
      inputTokens: 1600,
      outputTokens: 200,
      cachedInputTokens: 800,
      cacheWriteInputTokens: 300,
    })
    expect(next).toMatchObject({
      cacheHits: 2, reloaded: 1, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
      providerUsageReported: true,
      providerInputTokens: 1600,
      providerCachedTokens: 800,
      providerCacheWriteTokens: 300,
      requestDiagnostics: {
        requestCount: 1,
        providerUsageAvailable: true,
        inputTokens: 1600,
        outputTokens: 200,
        cacheReadTokens: 800,
        cacheWriteTokens: 300,
      },
    })
  })

  it("把用户记忆决策作为独立统计写入上下文中控", () => {
    const decision: UserMemoryDecision = {
      createdAt: 1,
      surface: "ai-chat",
      projectKey: "p1",
      sessionKey: "s1",
      candidateCount: 8,
      selectedRuleIds: ["r1", "r2"],
      filtered: [{ ruleId: "r3", reason: "candidate" }],
      injectedChars: 240,
      estimatedTokens: 60,
    }

    expect(applyProviderUsageToStats(baseStats, { inputTokens: 100 }, decision)).toMatchObject({
      memoryCandidateCount: 8,
      memorySelectedCount: 2,
      memoryFilteredCount: 1,
      memoryInjectedChars: 240,
      memoryEstimatedTokens: 60,
    })
  })

  it("persist 必须使用显式 memoryDecision，不读取全局 latest", async () => {
    setLatestUserMemoryDecision({
      createdAt: 1,
      surface: "ai-chat",
      projectKey: "other",
      sessionKey: "other",
      candidateCount: 99,
      selectedRuleIds: ["leak"],
      filtered: [],
      injectedChars: 1,
      estimatedTokens: 1,
    })
    const reference: ContextHubSnapshotRef = {
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 20,
      stats: baseStats,
    }
    const saveSnapshot = vi.fn(async () => reference)
    const result = { stats: { ...baseStats } } as ContextHubResult
    const decision: UserMemoryDecision = {
      createdAt: 2,
      surface: "ai-chat",
      projectKey: "p1",
      sessionKey: "s1",
      candidateCount: 3,
      selectedRuleIds: ["r1"],
      filtered: [],
      injectedChars: 10,
      estimatedTokens: 3,
    }

    await persistContextHubProviderUsage(
      { saveSnapshot },
      "assistant:1",
      result,
      { inputTokens: 1600, cachedInputTokens: 800 },
      {
        memoryDecision: decision,
        requestDiagnostics: buildLlmRequestDiagnostics(
          { inputTokens: 1600, cachedInputTokens: 800 },
          2,
        ),
      },
    )

    expect(result.stats.memoryCandidateCount).toBe(3)
    expect(result.stats.memorySelectedCount).toBe(1)
    expect(result.stats.requestDiagnostics?.requestCount).toBe(2)
    expect(saveSnapshot).toHaveBeenCalledWith("assistant:1", result)
  })
})
