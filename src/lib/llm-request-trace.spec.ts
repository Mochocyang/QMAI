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
