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

    expect(host.textContent).toContain("109 Token")
    expect(host.textContent).not.toContain("上下文中控")
    expect(host.textContent).not.toContain("本地资料复用率")
    expect(host.textContent).not.toContain("模型输入缓存命中率")

    expect(host.querySelector('[title^="上下文约"]')).not.toBeNull()
    expect(host.querySelector('[title^="模型输入缓存命中率"]')).not.toBeNull()
    expect(host.querySelector('[title^="本地资料复用率"]')).not.toBeNull()
  })
})
