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
    cacheableLoaded: 5, cacheableHits: 3,
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

  it("分别展示本地复用、供应商缓存和估算减少发送的摘要", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={reference} />)
    })

    expect(host.textContent).toContain("上下文中控")
    expect(host.textContent).toContain("本地资料复用率 60%")
    expect(host.textContent).toContain("复用 3/5 项")
    expect(host.textContent).toContain("不含任务型")
    expect(host.textContent).toContain("模型输入缓存命中率 50%")
    expect(host.textContent).toContain("仅当前请求")
    expect(host.textContent).toContain("估算少发送约 1,320 Token")
    expect(host.textContent).toContain("不代表缓存价格折扣")
    expect(host.textContent).not.toContain("相比全量节省")
    expect(host.textContent).not.toContain("本轮数据源")
    expect(host.textContent).not.toContain("供应商已确认命中")
    expect(host.textContent).not.toContain("展开上下文中控")
  })

  it("没有本地加载项时仍展示供应商的有效缓存数据", async () => {
    const emptyStats = {
      ...snapshot.stats,
      cacheHits: 0, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
      cacheableLoaded: 0, cacheableHits: 0,
    }
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: emptyStats }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 暂不可用")
    expect(host.textContent).toContain("无可缓存项")
    expect(host.textContent).toContain("模型输入缓存命中率 50%")
  })

  it("同任务十二项命中包含四项任务型时显示八项复用的 100% 而非 150%", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        cacheHits: 12, reloaded: 0, taskScopedLoaded: 4,
        cacheableLoaded: 8, cacheableHits: 8,
      } }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 100%")
    expect(host.textContent).toContain("复用 8/8 项")
    expect(host.textContent).not.toContain("150%")
  })

  it("失败与降级等诊断重叠不放大本地复用率的分母", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        cacheHits: 1, reloaded: 1, empty: 0, readFailed: 1, fallbackUsed: 1, writeFailed: 1,
        cacheableLoaded: 3, cacheableHits: 1,
      } }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 33%")
    expect(host.textContent).toContain("复用 1/3 项")
  })

  it("旧快照没有新口径时不估计任务型命中项", async () => {
    const { cacheableLoaded: _loaded, cacheableHits: _hits, ...oldStats } = snapshot.stats
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...oldStats, cacheHits: 12, reloaded: 0, taskScopedLoaded: 4,
      } }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 暂不可用")
    expect(host.textContent).not.toContain("150%")
    expect(host.textContent).not.toContain("复用 8/8 项")
    expect(host.textContent).toContain("模型输入缓存命中率 50%")
  })

  it("本地复用为零不影响供应商缓存的正命中率", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats, cacheHits: 0, reloaded: 8, cacheableLoaded: 8, cacheableHits: 0,
        providerCacheEnabled: false,
      } }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 0%")
    expect(host.textContent).toContain("模型输入缓存命中率 50%")
  })

  it("优先使用工作流总账，不重加请求明细或使用最后一次请求代替", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        requestDiagnostics: {
          requestCount: 3, usageScope: "workflow", providerUsageAvailable: true,
          inputTokens: 4000, cacheReadTokens: 1000, cacheWriteTokens: 2000,
          omittedRequestCount: 2,
          requests: [{
            provider: "openai", model: "test-model", apiMode: "chat_completions",
            startedAt: 1, finishedAt: 2, durationMs: 1, status: "success",
            inputTokens: 100, cacheReadTokens: 90,
          }],
        },
      } }} />)
    })
    expect(host.textContent).toContain("模型输入缓存命中率 25%")
    expect(host.textContent).toContain("本轮工作流")
    expect(host.textContent).not.toContain("仅当前请求")
    expect(host.textContent).not.toContain("模型输入缓存命中率 50%")
    expect(host.textContent).not.toContain("90%")
  })

  it.each([undefined, 0])("工作流区分供应商未提供缓存计数与显式零：%s", async (cacheReadTokens) => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        requestDiagnostics: {
          requestCount: 2, providerUsageAvailable: true, inputTokens: 1600,
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        },
      } }} />)
    })
    expect(host.textContent).toContain("本轮工作流")
    if (cacheReadTokens === undefined) {
      expect(host.textContent).toContain("供应商未提供缓存数据")
      expect(host.textContent).not.toContain("模型输入缓存命中率 0%")
      expect(host.textContent).not.toContain("模型输入缓存命中率 50%")
    } else {
      expect(host.textContent).toContain("模型输入缓存命中率 0%")
      expect(host.textContent).not.toContain("供应商未提供缓存数据")
    }
  })

  it.each([undefined, 0])("旧供应商字段区分未提供缓存计数与显式零且标注仅当前请求：%s", async (providerCachedTokens) => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats, providerCachedTokens,
      } }} />)
    })
    expect(host.textContent).toContain("仅当前请求")
    if (providerCachedTokens === undefined) {
      expect(host.textContent).toContain("供应商未提供缓存数据")
      expect(host.textContent).not.toContain("模型输入缓存命中率 0%")
    } else {
      expect(host.textContent).toContain("模型输入缓存命中率 0%")
    }
  })

  it.each([undefined, 0])("没有有效总输入时不生成百分比：%s", async (inputTokens) => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        requestDiagnostics: { requestCount: 1, providerUsageAvailable: true, inputTokens, cacheReadTokens: 0 },
      } }} />)
    })
    expect(host.textContent).toContain("模型输入缓存命中率 暂不可用")
    expect(host.textContent).not.toContain("模型输入缓存命中率 0%")
    expect(host.textContent).not.toContain("NaN")
    expect(host.textContent).not.toContain("Infinity")
  })

  it("供应商会话总量不冒充本轮工作流", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        requestDiagnostics: {
          requestCount: 0, requestCountAvailable: false, usageScope: "provider_thread",
          providerUsageAvailable: true, inputTokens: 2000, cacheReadTokens: 500,
        },
      } }} />)
    })
    expect(host.textContent).toContain("模型输入缓存命中率 25%")
    expect(host.textContent).toContain("供应商会话")
    expect(host.textContent).not.toContain("本轮工作流")
  })

  it("损坏的本地或供应商计数显示不可用而不是截成 100%", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats: {
        ...snapshot.stats,
        cacheableLoaded: 8, cacheableHits: 12,
        requestDiagnostics: { requestCount: 1, providerUsageAvailable: true, inputTokens: 800, cacheReadTokens: 1200 },
      } }} />)
    })
    expect(host.textContent).toContain("本地资料复用率 暂不可用")
    expect(host.textContent).toContain("模型输入缓存命中率 暂不可用")
    expect(host.textContent).not.toContain("100%")
    expect(host.textContent).not.toContain("150%")
  })

  it("摘要使用可自然折行的分项布局而不新增弹窗", async () => {
    await act(async () => {
      root.render(<ContextHubDetails reference={reference} />)
    })
    const summary = Array.from(host.querySelectorAll("div")).find((element) => (
      element.classList.contains("break-words") && element.textContent?.includes("本地资料复用率")
    ))
    expect(summary).toBeDefined()
    expect(summary?.children.length).toBeGreaterThanOrEqual(2)
    expect(summary?.classList.contains("whitespace-normal")).toBe(true)
    expect(summary?.classList.contains("min-w-0")).toBe(true)
    expect(host.querySelector("button, [role='dialog']")).toBeNull()
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
