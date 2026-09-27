// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextHubStats } from "@/lib/context-hub/types"

let root: Root
let host: HTMLDivElement

const stats: ContextHubStats = {
  cacheHits: 3,
  reloaded: 2,
  empty: 0,
  fallbackUsed: 0,
  readFailed: 0,
  writeFailed: 0,
  cacheableHits: 3,
  cacheableLoaded: 5,
  stableTokens: 1200,
  summaryTokens: 60,
  dynamicTokens: 420,
  candidateTokens: 3000,
  composedTokens: 109,
  estimatedSavedTokens: 1320,
  estimatedSavedPercent: 44,
  expanded: false,
  providerCacheEnabled: true,
  providerInputTokens: 1000,
  providerCachedTokens: 0,
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubEnv("VITE_QMAI_UI_TEST", "1")
  vi.resetModules()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("新版上下文中控数字摘要", () => {
  it("默认只显示数字，悬停标题再解释指标", async () => {
    const { ContextHubStatsSummary } = await import("./context-hub-stats-summary")
    await act(async () => root.render(<ContextHubStatsSummary stats={stats} />))

    expect(host.querySelector("[aria-label='查看本轮用量']")).not.toBeNull()
    expect(host.querySelector("[aria-label^='用时']")).not.toBeNull()
    expect(host.textContent).not.toContain("上下文中控")
    expect(host.textContent).not.toContain("本地资料复用率")
    expect(host.textContent).not.toContain("模型输入缓存命中率")

    expect(host.querySelector('[aria-label="查看本轮用量"]')).not.toBeNull()
    expect(host.querySelector("[aria-label='用时 —']")).not.toBeNull()
  })

  it("章节工作流总账有用量时显示真实数字", async () => {
    const { UiTestGenerationStats } = await import("./context-hub-stats-summary")
    await act(async () => root.render(<UiTestGenerationStats stats={{
      ...stats,
      requestDiagnostics: {
        requestCount: 3,
        providerUsageAvailable: true,
        usageTotals: { requestCount: 3, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 600 },
      },
    }} />))

    expect(host.querySelector("[aria-label='查看本轮用量']")?.textContent).toContain("1.8K tokens")
    await act(async () => host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(host.textContent).toContain("60%")
    expect(host.textContent).toContain("400 tokens")
    expect(host.textContent).toContain("600 tokens")
    expect(host.textContent).toContain("200 tokens")
  })

  it("供应商未返回缓存字段时显示本地缓存命中率", async () => {
    const { UiTestGenerationStats } = await import("./context-hub-stats-summary")
    await act(async () => root.render(<UiTestGenerationStats stats={stats} />))
    await act(async () => host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(host.textContent).toContain("60%")
    expect(host.textContent).not.toContain("缓存命中未提供")
  })
})
