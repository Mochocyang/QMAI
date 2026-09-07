import { describe, expect, it } from "vitest"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import {
  LlmRequestTraceCollector,
  MAX_LLM_REQUEST_CACHE_TRACES,
  buildLlmRequestPrefixDescriptor,
  isLlmRequestCacheTrace,
  type LlmRequestCacheTrace,
} from "./llm-request-trace"
import type { LlmConfig } from "@/stores/wiki-store"

const config: LlmConfig = {
  provider: "openai",
  apiKey: "sk-must-not-be-persisted",
  model: "gpt-test",
  apiMode: "chat_completions",
  ollamaUrl: "",
  customEndpoint: "https://secret.example/v1",
  maxContextSize: 204_800,
  reasoning: { mode: "medium" },
}

function messages(dynamicRule: string, stableCore = "项目稳定核心"): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        { type: "text", text: "固定基础规则\n" },
        { type: "text", text: stableCore, cacheControl: true },
        { type: "text", text: `\n动态规则：${dynamicRule}` },
      ],
    },
    { role: "user", content: `任务：${dynamicRule}` },
  ]
}

const tools: NonNullable<RequestOverrides["tools"]> = [{
  type: "function",
  function: {
    name: "read_outline",
    description: "读取大纲",
    parameters: { type: "object", properties: {} },
  },
}]

describe("LLM request prefix fingerprint", () => {
  it("ignores task, chapter and Skill changes after the cache breakpoint", async () => {
    const first = await buildLlmRequestPrefixDescriptor(config, messages("写第 11 章并启用 Skill A"), {
      tools,
      toolChoice: "auto",
      reasoning: { mode: "medium" },
    })
    const second = await buildLlmRequestPrefixDescriptor(config, messages("分析第 229 章并启用 Skill B"), {
      tools,
      toolChoice: "auto",
      reasoning: { mode: "medium" },
    })

    expect(first.prefixFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(second.prefixFingerprint).toBe(first.prefixFingerprint)
    expect(first.prefixEstimatedTokens).toBeGreaterThan(0)
  })

  it("changes for stable text, model, tool schema and reasoning changes", async () => {
    const base = await buildLlmRequestPrefixDescriptor(config, messages("动态"), {
      tools,
      toolChoice: "auto",
      reasoning: { mode: "medium" },
    })
    const variants = await Promise.all([
      buildLlmRequestPrefixDescriptor(config, messages("动态", "变化后的稳定核心"), { tools, toolChoice: "auto", reasoning: { mode: "medium" } }),
      buildLlmRequestPrefixDescriptor({ ...config, model: "gpt-other" }, messages("动态"), { tools, toolChoice: "auto", reasoning: { mode: "medium" } }),
      buildLlmRequestPrefixDescriptor(config, messages("动态"), { tools: [{ ...tools[0], function: { ...tools[0].function, description: "变化" } }], toolChoice: "auto", reasoning: { mode: "medium" } }),
      buildLlmRequestPrefixDescriptor(config, messages("动态"), { tools, toolChoice: "auto", reasoning: { mode: "high" } }),
    ])

    for (const variant of variants) {
      expect(variant.prefixFingerprint).not.toBe(base.prefixFingerprint)
    }
  })

  it("returns no fingerprint when no virtual or real breakpoint exists", async () => {
    await expect(buildLlmRequestPrefixDescriptor(config, [
      { role: "system", content: "普通系统提示" },
      { role: "user", content: "任务" },
    ])).resolves.toEqual({})
  })
})

function trace(index: number, fingerprint = "a".repeat(64)): LlmRequestCacheTrace {
  return {
    provider: "openai",
    model: "gpt-test",
    apiMode: "chat_completions",
    prefixFingerprint: fingerprint,
    startedAt: index * 1_000,
    finishedAt: index * 1_000 + 400,
    durationMs: 400,
    firstResponseMs: 120,
    inputTokens: 1_000,
    outputTokens: 100,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    status: "success",
  }
}

describe("LLM request trace collector", () => {
  it("computes same-prefix start/idle gaps and caps snapshots at 32 requests", () => {
    const collector = new LlmRequestTraceCollector()
    for (let index = 0; index < MAX_LLM_REQUEST_CACHE_TRACES + 2; index += 1) {
      collector.record(trace(index))
    }

    const snapshot = collector.snapshot()
    expect(snapshot.requests).toHaveLength(MAX_LLM_REQUEST_CACHE_TRACES)
    expect(snapshot.omittedRequestCount).toBe(2)
    expect(snapshot.requests[0].startedAt).toBe(2_000)
    expect(snapshot.requests[1]).toMatchObject({ startGapMs: 1_000, idleGapMs: 600 })
  })

  it("stores only sanitized diagnostics and strictly rejects damaged traces", () => {
    const value = trace(1)
    expect(isLlmRequestCacheTrace(value)).toBe(true)
    expect(JSON.stringify(value)).not.toContain(config.apiKey)
    expect(JSON.stringify(value)).not.toContain(config.customEndpoint)
    expect(JSON.stringify(value)).not.toContain("项目稳定核心")
    expect(isLlmRequestCacheTrace({ ...value, status: "timeout" })).toBe(false)
    expect(isLlmRequestCacheTrace({ ...value, durationMs: -1 })).toBe(false)
  })
})


describe("完整请求用量总账", () => {
  it("明细截断后仍累计全部请求，不因32条上限漏掉费用", () => {
    const collector = new LlmRequestTraceCollector()
    for (let index = 0; index < 40; index += 1) collector.record(trace(index))
    expect(collector.snapshot().usageTotals).toEqual({
      requestCount: 40,
      inputTokens: 40_000,
      outputTokens: 4_000,
      cachedInputTokens: 32_000,
      cacheWriteInputTokens: 0,
    })
  })

  it("同一请求经嵌套回调重复转发不能重复累计", () => {
    const collector = new LlmRequestTraceCollector()
    const request = { ...trace(1), requestId: "request-one" }
    collector.record(request)
    collector.record({ ...request })
    collector.record({ ...trace(1), requestId: "request-two" })
    expect(collector.snapshot().requests).toHaveLength(2)
    expect(collector.snapshot().usageTotals.inputTokens).toBe(2000)
  })

  it("部分请求未上报缓存数据时，总体缓存量必须未知而不是当零求和", () => {
    const collector = new LlmRequestTraceCollector()
    collector.record(trace(1))
    collector.record({ ...trace(2), cacheReadTokens: undefined, cacheWriteTokens: undefined })
    const totals = collector.snapshot().usageTotals
    expect(totals.requestCount).toBe(2)
    expect(totals.inputTokens).toBe(2000)
    expect(totals.outputTokens).toBe(200)
    expect(totals.cachedInputTokens).toBeUndefined()
    expect(totals.cacheWriteInputTokens).toBeUndefined()
    expect(collector.snapshot().requests[0].cacheReadTokens).toBe(800)
  })

  it("请求标识经过复制和校验保留，损坏标识被拒绝", () => {
    const collector = new LlmRequestTraceCollector()
    collector.record({ ...trace(1), requestId: "request-one" })
    expect(collector.snapshot().requests[0].requestId).toBe("request-one")
    expect(isLlmRequestCacheTrace({ ...trace(1), requestId: 42 })).toBe(false)
  })
})


describe("持久化总账恢复", () => {
  it("明细截断后恢复仍保留全量总数、缺失字段和阶段，并去重最新请求", () => {
    const collector = new LlmRequestTraceCollector()
    for (let index = 0; index < 40; index += 1) collector.record({
      requestId: `persist-${index}`, provider: "openai", model: "fixture", apiMode: "chat_completions",
      startedAt: index, finishedAt: index + 1, durationMs: 1, status: "success",
      inputTokens: 100, outputTokens: 10, ...(index === 0 ? {} : { cacheReadTokens: 80 }),
      surface: "book-analysis", stage: "verification",
    })
    const restored = new LlmRequestTraceCollector(collector.snapshot())
    restored.record(collector.snapshot().requests.at(-1)!)
    restored.record({ requestId: "persist-0", provider: "openai", model: "fixture", apiMode: "chat_completions",
      startedAt: 0, finishedAt: 1, durationMs: 1, status: "success", inputTokens: 100, outputTokens: 10,
    })
    restored.record({ requestId: "persist-40", provider: "openai", model: "fixture", apiMode: "chat_completions",
      startedAt: 40, finishedAt: 41, durationMs: 1, status: "success", inputTokens: 100, outputTokens: 10, cacheReadTokens: 80,
    })
    const snapshot = restored.snapshot()
    expect(snapshot.usageTotals).toEqual({ requestCount: 41, inputTokens: 4100, outputTokens: 410 })
    expect(snapshot.omittedRequestCount).toBe(9)
    expect(snapshot.requests[0]).toMatchObject({ surface: "book-analysis", stage: "verification" })
  })
})
