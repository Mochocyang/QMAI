// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ContextHubDetails } from "./context-hub-details"
import { CONTEXT_CACHE_SCHEMA_VERSION, type ContextHubSnapshot } from "@/lib/context-hub/types"

const dependencyStamp = { fingerprint: "test", sourceCount: 1, kinds: ["outline" as const] }

const snapshot: ContextHubSnapshot = {
  schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
  id: "assistant:1",
  surface: "ai-chat",
  createdAt: 10,
  stats: {
    cacheHits: 3, reloaded: 2, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
    stableTokens: 1200,
    summaryTokens: 60,
    dynamicTokens: 420,
    candidateTokens: 3000,
    estimatedSavedTokens: 1320,
    estimatedSavedPercent: 44,
    expanded: false,
    providerCacheEnabled: true,
    providerUsageReported: true,
    providerInputTokens: 1600,
    providerCachedTokens: 800,
    providerCacheWriteTokens: 200,
  },
  items: [
    {
      key: "data-source:outline",
      sourceName: "outline",
      status: "cache_hit",
      dependencyStamp: { ...dependencyStamp, sourceCount: 3 },
      dependencyPaths: ["wiki/outlines/main.md"],
      dependencyPathsTruncated: true,
    },
    {
      key: "stable-core:ai-chat",
      sourceName: "stableCore",
      status: "reloaded",
      dependencyStamp,
      dependencyPaths: ["wiki/settings/world.md"],
      dependencyPathsTruncated: false,
    },
    {
      key: "data-source:book-analysis",
      sourceName: "bookAnalysisReferences",
      status: "cache_hit",
      dependencyStamp,
      dependencyPaths: [".qmai/book-analysis-context.json"],
      dependencyPathsTruncated: false,
    },
  ],
  stableCore: "稳定核心正文",
  sessionSummary: "会话摘要正文",
  dynamicContext: "动态片段正文",
}

const reference = {
  id: snapshot.id,
  surface: snapshot.surface,
  createdAt: snapshot.createdAt,
  stats: snapshot.stats,
}

describe("ContextHubDetails", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("展示标题与单行摘要（本次命中/命中率/节省 token）", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={reference} />)
    })

    expect(host.textContent).toContain("上下文中控")
    expect(host.textContent).toContain("本次命中 3 项")
    expect(host.textContent).toContain("命中率 60%")
    expect(host.textContent).toContain("节省约 1,320 Token")
    expect(host.textContent).not.toContain("本轮数据源")
    expect(host.textContent).not.toContain("供应商已确认命中")
    expect(host.textContent).not.toContain("展开上下文中控")
  })

  it("无数据源时显示友好文案", async () => {
    const emptyStats = {
      ...snapshot.stats,
      cacheHits: 0, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
    }
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: emptyStats }} />)
    })
    expect(host.textContent).toContain("本轮无上下文数据")
  })

  it("旧格式 stats 不渲染", async () => {
    const legacyReference = {
      id: "assistant:legacy",
      surface: "ai-chat" as const,
      createdAt: 11,
      stats: {
        hits: 4,
        refreshed: 1,
        failures: 2,
        stableTokens: 10,
        summaryTokens: 0,
        dynamicTokens: 5,
        candidateTokens: 20,
        estimatedSavedTokens: 5,
        estimatedSavedPercent: 25,
        expanded: false,
        providerCacheEnabled: false,
      },
    }

    await act(async () => {
      root.render(<ContextHubDetails reference={legacyReference as never} />)
    })

    expect(host.textContent).toBe("")
  })
})
