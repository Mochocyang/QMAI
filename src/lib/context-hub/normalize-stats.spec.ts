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
