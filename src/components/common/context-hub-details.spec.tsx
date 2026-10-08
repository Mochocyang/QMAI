// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ContextHubDetails } from "./context-hub-details"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type ContextHubSnapshot,
  type ContextHubStats,
} from "@/lib/context-hub/types"

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

  async function renderDetails(stats: ContextHubStats) {
    await act(async () => {
      root.render(<ContextHubDetails reference={{ ...reference, stats }} />)
    })
  }

  /** 点击用量按钮展开明细，返回弹层的完整文案（未展开时没有可读数字）。 */
  async function openUsage(): Promise<string> {
    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    return host.querySelector("[role='dialog']")?.textContent ?? ""
  }

  it("回复下方只保留用量、用时和结束时间，不再渲染上下文中控多行摘要", async () => {
    await renderDetails(snapshot.stats)

    expect(host.querySelector("div.ui-test-context-details")).not.toBeNull()
    expect(host.querySelector("[aria-label='查看本轮用量']")?.textContent).toBe("未提供")
    expect(host.querySelector("[aria-label='用时 —']")).not.toBeNull()
    expect(host.querySelector("time")?.textContent).toBe("—")

    // 26f80ee（fix(ui): 调整对话输入框与界面资源）把多行统计摘要换成紧凑用量行，旧文案全部下线。
    expect(host.textContent).not.toContain("上下文中控")
    expect(host.textContent).not.toContain("本地资料复用率")
    expect(host.textContent).not.toContain("模型输入缓存命中率")
    expect(host.textContent).not.toContain("相比全量节省")
    expect(host.textContent).not.toContain("不代表缓存价格折扣")
    expect(host.textContent).not.toContain("本轮数据源")
    expect(host.textContent).not.toContain("供应商已确认命中")
    expect(host.textContent).not.toContain("展开上下文中控")
  })

  it("本地没有可缓存项时仍展示供应商返回的真实缓存用量", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheHits: 0, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
      cacheableLoaded: 0, cacheableHits: 0,
      requestDiagnostics: {
        requestCount: 1, providerUsageAvailable: true,
        inputTokens: 1000, cacheReadTokens: 500, outputTokens: 200,
      },
    })

    expect(host.querySelector("[aria-label='查看本轮用量']")?.textContent).toBe("1.7K tokens")
    expect(await openUsage()).toBe(
      "缓存命中50%未缓存输入500 tokens缓存读取500 tokens输出200 tokens",
    )
  })

  it("任务级命中不计入本地复用率：八项复用显示 100% 而不是 150%", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheHits: 12, reloaded: 0, taskScopedLoaded: 4,
      cacheableLoaded: 8, cacheableHits: 8,
    })

    const dialog = await openUsage()
    expect(dialog).toBe("缓存命中100%未缓存输入未提供缓存读取未提供输出未提供")
    expect(dialog).not.toContain("150%")
  })

  it("失败与降级等诊断重叠不放大本地复用率的分母", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheHits: 1, reloaded: 1, empty: 0, readFailed: 1, fallbackUsed: 1, writeFailed: 1,
      cacheableLoaded: 3, cacheableHits: 1,
    })

    const dialog = await openUsage()
    // 分母只取 cacheableLoaded(3)；错用诊断计数总和(5)会得到 20%。
    expect(dialog).toBe("缓存命中33.3%未缓存输入未提供缓存读取未提供输出未提供")
    expect(dialog).not.toContain("20%")
  })

  it("旧快照没有新口径时不估计任务型命中项", async () => {
    const { cacheableLoaded: _loaded, cacheableHits: _hits, ...oldStats } = snapshot.stats
    await renderDetails({ ...oldStats, cacheHits: 12, reloaded: 0, taskScopedLoaded: 4 })

    const dialog = await openUsage()
    expect(dialog).toBe("缓存命中未提供未缓存输入未提供缓存读取未提供输出未提供")
    expect(dialog).not.toContain("150%")
    expect(dialog).not.toContain("100%")
  })

  it("本地复用为零不影响供应商缓存的正命中率", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheHits: 0, reloaded: 8, cacheableLoaded: 8, cacheableHits: 0,
      providerCacheEnabled: false,
      requestDiagnostics: {
        requestCount: 1, providerUsageAvailable: true, inputTokens: 1000, cacheReadTokens: 500,
      },
    })

    const dialog = await openUsage()
    expect(dialog).toBe("缓存命中50%未缓存输入500 tokens缓存读取500 tokens输出未提供")
    expect(dialog).not.toContain("缓存命中0%")
  })

  it("本地复用计数显式为 0 时显示 0% 而不是未提供", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheHits: 0, reloaded: 8, cacheableLoaded: 8, cacheableHits: 0,
    })

    expect(await openUsage()).toBe("缓存命中0%未缓存输入未提供缓存读取未提供输出未提供")
  })

  it("优先使用工作流总账，不重加请求明细或使用最后一次请求代替", async () => {
    await renderDetails({
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
    })

    expect(host.querySelector("[aria-label='查看本轮用量']")?.textContent).toBe("未提供")
    const dialog = await openUsage()
    expect(dialog).toBe("缓存命中25%未缓存输入3,000 tokens缓存读取1,000 tokens输出未提供")
    expect(dialog).not.toContain("90%")
  })

  it.each([undefined, 0])("工作流区分供应商未提供缓存计数与显式零：%s", async (cacheReadTokens) => {
    await renderDetails({
      ...snapshot.stats,
      requestDiagnostics: {
        requestCount: 2, providerUsageAvailable: true, inputTokens: 1600,
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      },
    })

    const dialog = await openUsage()
    if (cacheReadTokens === undefined) {
      // 供应商没有返回缓存字段 → 改用本地已统计的命中率兜底，不补造成 0%。
      expect(dialog).toBe("缓存命中60%未缓存输入未提供缓存读取未提供输出未提供")
      expect(dialog).not.toContain("缓存命中0%")
    } else {
      expect(dialog).toBe("缓存命中0%未缓存输入1,600 tokens缓存读取0 tokens输出未提供")
    }
  })

  it("旧供应商字段不再顶替本轮用量，命中率仍走本地兜底", async () => {
    // snapshot.stats 只有旧字段：providerInputTokens 1600 / providerCachedTokens 800。
    await renderDetails(snapshot.stats)

    const dialog = await openUsage()
    expect(dialog).toBe("缓存命中60%未缓存输入未提供缓存读取未提供输出未提供")
    expect(dialog).not.toContain("50%")
  })

  it.each([undefined, 0])("没有有效总输入时不生成供应商百分比：%s", async (inputTokens) => {
    await renderDetails({
      ...snapshot.stats,
      requestDiagnostics: {
        requestCount: 1, providerUsageAvailable: true, inputTokens, cacheReadTokens: 0,
      },
    })

    const dialog = await openUsage()
    // 总输入缺失或为 0 时不用 0/0 造百分比，回退本地命中率。
    expect(dialog).toContain("缓存命中60%")
    expect(dialog).not.toContain("缓存命中0%")
    expect(host.textContent).not.toContain("NaN")
    expect(host.textContent).not.toContain("Infinity")
    if (inputTokens === undefined) {
      expect(dialog).toBe("缓存命中60%未缓存输入未提供缓存读取0 tokens输出未提供")
    } else {
      expect(dialog).toBe("缓存命中60%未缓存输入0 tokens缓存读取0 tokens输出未提供")
    }
  })

  it("供应商会话总量按其总账显示，不累加请求明细", async () => {
    await renderDetails({
      ...snapshot.stats,
      requestDiagnostics: {
        requestCount: 0, requestCountAvailable: false, usageScope: "provider_thread",
        providerUsageAvailable: true, inputTokens: 2000, cacheReadTokens: 500,
      },
    })

    expect(await openUsage()).toBe(
      "缓存命中25%未缓存输入1,500 tokens缓存读取500 tokens输出未提供",
    )
  })

  it("损坏的本地或供应商计数显示不可用而不是截成 100%", async () => {
    await renderDetails({
      ...snapshot.stats,
      cacheableLoaded: 8, cacheableHits: 12,
      requestDiagnostics: {
        requestCount: 1, providerUsageAvailable: true, inputTokens: 800, cacheReadTokens: 1200,
      },
    })

    const dialog = await openUsage()
    // 🔴 真实回归：26f80ee 改用紧凑用量行时删掉了旧 cacheHitRate() 的「命中数 > 总数 → 暂不可用」守卫，
    // 缓存读取 1200 > 总输入 800 现在会显示 150%；而 20260907-011559 更新日志写明
    // 「不再用错误分母显示超过100%的比例」。按铁律不把错误值固化成断言，本用例保留失败，等生产恢复守卫。
    expect(dialog).not.toContain("150%")
  })

  it("用量明细默认收起，点击后才在行内展开", async () => {
    await renderDetails(snapshot.stats)

    expect(host.querySelector("[role='dialog']")).toBeNull()
    expect(host.querySelectorAll("button")).toHaveLength(1)
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false")

    const dialog = await openUsage()
    expect(dialog).not.toBe("")
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector("div.ui-test-context-details")?.contains(host.querySelector("[role='dialog']"))).toBe(true)

    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(host.querySelector("[role='dialog']")).toBeNull()
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
