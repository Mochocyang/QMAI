import { describe, expect, it } from "vitest"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  isCurrentContextHubStats,
  parseContextHubSnapshot,
  parseContextHubSnapshotRef,
} from "./types"

const currentStats = {
  cacheHits: 1,
  reloaded: 2,
  empty: 0,
  fallbackUsed: 0,
  readFailed: 0,
  writeFailed: 0,
  stableTokens: 100,
  summaryTokens: 20,
  dynamicTokens: 40,
  candidateTokens: 200,
  estimatedSavedTokens: 40,
  estimatedSavedPercent: 20,
  expanded: false,
  providerCacheEnabled: true,
}

describe("isCurrentContextHubStats", () => {
  it("accepts the current counter shape", () => {
    expect(isCurrentContextHubStats(currentStats)).toBe(true)
  })

  it("rejects main-era hits/refreshed/failures payloads", () => {
    expect(isCurrentContextHubStats({
      hits: 3,
      refreshed: 2,
      failures: 1,
      stableTokens: 100,
      summaryTokens: 20,
      dynamicTokens: 40,
      candidateTokens: 200,
      estimatedSavedTokens: 40,
      estimatedSavedPercent: 20,
      expanded: false,
      providerCacheEnabled: true,
    })).toBe(false)
  })
})

describe("parseContextHubSnapshot", () => {
  it("returns null for legacy snapshots instead of remapping fields", () => {
    expect(parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 10,
      stats: {
        hits: 1,
        refreshed: 0,
        failures: 0,
        stableTokens: 1,
        summaryTokens: 0,
        dynamicTokens: 0,
        candidateTokens: 1,
        estimatedSavedTokens: 0,
        estimatedSavedPercent: 0,
        expanded: false,
        providerCacheEnabled: false,
      },
      items: [{
        key: "data-source:outline",
        sourceName: "outline",
        status: "hit",
        dependencyStamp: { fingerprint: "x", sourceCount: 1, kinds: ["outline"] },
        dependencyPaths: ["wiki/outlines/main.md"],
        dependencyPathsTruncated: false,
      }],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })).toBeNull()
  })

  it("parses a current snapshot unchanged", () => {
    const snapshot = parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 10,
      stats: currentStats,
      items: [{
        key: "data-source:outline",
        sourceName: "outline",
        status: "cache_hit",
        dependencyStamp: { fingerprint: "x", sourceCount: 1, kinds: ["outline"] },
        dependencyPaths: ["wiki/outlines/main.md"],
        dependencyPathsTruncated: false,
      }],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })
    expect(snapshot?.stats.cacheHits).toBe(1)
    expect(snapshot?.items[0]?.status).toBe("cache_hit")
  })

  it("keeps valid request traces and drops damaged optional trace entries", () => {
    const snapshot = parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:trace",
      surface: "ai-chat",
      createdAt: 10,
      stats: {
        ...currentStats,
        requestDiagnostics: {
          requestCount: 2,
          providerUsageAvailable: true,
          requests: [
            {
              provider: "openai",
              model: "gpt-test",
              apiMode: "chat_completions",
              startedAt: 1,
              finishedAt: 2,
              durationMs: 1,
              status: "success",
              prompt: "不应保留",
            },
            {
              provider: "openai",
              model: "gpt-test",
              apiMode: "chat_completions",
              startedAt: 1,
              finishedAt: 2,
              durationMs: -1,
              status: "success",
              prompt: "不应保留",
            },
          ],
          omittedRequestCount: 3,
        },
      },
      items: [],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })

    expect(snapshot?.stats.requestDiagnostics?.requests).toHaveLength(1)
    expect(snapshot?.stats.requestDiagnostics?.omittedRequestCount).toBe(3)
    expect(snapshot?.stats.requestDiagnostics?.requests?.[0]).not.toHaveProperty("prompt")
  })

  it("keeps valid aggregate scope metadata and drops invalid optional values", () => {
    const valid = parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:codex-usage",
      surface: "ai-chat",
      createdAt: 10,
      stats: {
        ...currentStats,
        requestDiagnostics: {
          requestCount: 0,
          requestCountAvailable: false,
          usageScope: "provider_thread",
          providerUsageAvailable: true,
          inputTokens: 100,
        },
      },
      items: [],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })
    const damaged = parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:damaged-usage-scope",
      surface: "ai-chat",
      createdAt: 11,
      stats: {
        ...currentStats,
        requestDiagnostics: {
          requestCount: 1,
          requestCountAvailable: "no",
          usageScope: "single_request",
          providerUsageAvailable: true,
          inputTokens: 100,
        },
      },
      items: [],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })

    expect(valid?.stats.requestDiagnostics).toMatchObject({
      requestCountAvailable: false,
      usageScope: "provider_thread",
    })
  })

  it("保留章节工作流完整总账，供界面显示真实用量", () => {
    const snapshot = parseContextHubSnapshot({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id: "assistant:chapter-usage",
      surface: "ai-chat",
      createdAt: 12,
      stats: {
        ...currentStats,
        requestDiagnostics: {
          requestCount: 3,
          providerUsageAvailable: true,
          usageTotals: { requestCount: 3, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 600 },
        },
      },
      items: [],
      stableCore: "stable",
      sessionSummary: "",
      dynamicContext: "dynamic",
    })

    expect(snapshot?.stats.requestDiagnostics?.usageTotals).toEqual({
      requestCount: 3,
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 600,
    })
  })
})

describe("parseContextHubSnapshotRef", () => {
  it("drops legacy refs", () => {
    expect(parseContextHubSnapshotRef({
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 10,
      stats: { hits: 1, refreshed: 0, failures: 0 },
    })).toBeNull()
  })
})


describe("local cache counter normalization", () => {
  function parseStats(counters: Record<string, unknown>) {
    return parseContextHubSnapshotRef({
      id: "assistant:cache-metrics",
      surface: "ai-chat",
      createdAt: 10,
      stats: { ...currentStats, ...counters },
    })?.stats
  }

  it.each([
    { cacheableLoaded: 8, cacheableHits: 8 },
    { cacheableLoaded: 8, cacheableHits: 0 },
    { cacheableLoaded: 0, cacheableHits: 0 },
  ])("preserves valid local counters, including explicit zero: %j", (counters) => {
    expect(parseStats(counters)).toMatchObject(counters)
  })

  it("keeps old snapshots without inventing task hits or new counters", () => {
    const stats = parseStats({ cacheHits: 12, taskScopedLoaded: 4 })
    expect(stats).toMatchObject({ cacheHits: 12, taskScopedLoaded: 4 })
    expect(stats).not.toHaveProperty("cacheableLoaded")
    expect(stats).not.toHaveProperty("cacheableHits")
  })

  it.each([
    { cacheableLoaded: 8 },
    { cacheableHits: 4 },
    { cacheableLoaded: 8, cacheableHits: 9 },
    { cacheableLoaded: 0, cacheableHits: 1 },
    { cacheableLoaded: -1, cacheableHits: 0 },
    { cacheableLoaded: 8, cacheableHits: -1 },
    { cacheableLoaded: 8.5, cacheableHits: 4 },
    { cacheableLoaded: 8, cacheableHits: 0.5 },
    { cacheableLoaded: Number.NaN, cacheableHits: 0 },
    { cacheableLoaded: 8, cacheableHits: Number.POSITIVE_INFINITY },
    { cacheableLoaded: Number.MAX_SAFE_INTEGER + 1, cacheableHits: 0 },
    { cacheableLoaded: "8", cacheableHits: 4 },
    { cacheableLoaded: 8, cacheableHits: null },
  ])("drops an invalid or incomplete pair without discarding other stats: %j", (counters) => {
    const stats = parseStats(counters)
    expect(stats).toMatchObject(currentStats)
    expect(stats).not.toHaveProperty("cacheableLoaded")
    expect(stats).not.toHaveProperty("cacheableHits")
  })
})
