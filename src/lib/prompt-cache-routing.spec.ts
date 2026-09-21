import { describe, expect, it } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import { preparePromptCacheRouting, supportsPromptCacheRouting } from "./prompt-cache-routing"

const config: LlmConfig = { provider: "openai", model: "gpt-test", apiKey: "never-record-this-key", ollamaUrl: "", customEndpoint: "", maxContextSize: 64000 }
function messages(task: string, stable = "固定规则与作品资料"): ChatMessage[] {
  return [{ role: "system", content: [
    { type: "text", text: stable, cacheControl: true },
    { type: "text", text: task, cacheControl: true },
  ] }, { role: "user", content: task }]
}

describe("官方接口稳定缓存路由", () => {
  it("键仅使用首个稳定边界，任务变化或后续断点变化不改变键", async () => {
    const overrides = { userMemoryProjectKey: "C:/私密作品", temperature: 0.7 }
    const first = await preparePromptCacheRouting(config, messages("第一章"), overrides)
    const second = await preparePromptCacheRouting(config, messages("第二章"), overrides)
    expect(first.promptCacheKey).toMatch(/^[a-f0-9]{64}$/)
    expect(second.promptCacheKey).toBe(first.promptCacheKey)
    expect(first.temperature).toBe(0.7)
    expect(first.promptCacheKey).not.toContain("私密作品")
    expect(first.promptCacheKey).not.toContain(config.apiKey)
  })

  it("稳定资料、模型、项目或工具定义变化使用不同键，密钥不参与计算", async () => {
    const overrides: RequestOverrides = { userMemoryProjectKey: "project-a" }
    const base = await preparePromptCacheRouting(config, messages("任务"), overrides)
    const variants = await Promise.all([
      preparePromptCacheRouting(config, messages("任务", "新的固定规则"), overrides),
      preparePromptCacheRouting({ ...config, model: "other-model" }, messages("任务"), overrides),
      preparePromptCacheRouting(config, messages("任务"), { userMemoryProjectKey: "project-b" }),
      preparePromptCacheRouting(config, messages("任务"), { ...overrides, tools: [{ type: "function", function: { name: "read", description: "读取", parameters: {} } }] }),
    ])
    expect(variants.every((item) => item.promptCacheKey !== base.promptCacheKey)).toBe(true)
    expect((await preparePromptCacheRouting({ ...config, apiKey: "changed-secret" }, messages("任务"), overrides)).promptCacheKey).toBe(base.promptCacheKey)
  })

  it.each(["https://proxy.test/v1", "https://api.openai.com.evil.test/v1", "https://api.openai.com@evil.test/v1", "http://api.openai.com/v1"])("未知或不安全入口不发送路由参数：%s", async (customEndpoint) => {
    const target: LlmConfig = { ...config, provider: "custom", customEndpoint }
    expect(supportsPromptCacheRouting(target)).toBe(false)
    expect((await preparePromptCacheRouting(target, messages("任务"), {})).promptCacheKey).toBeUndefined()
  })

  it("官方自定义Chat和Responses可用，Anthropic兼容和普通无断点请求保持原样", async () => {
    for (const apiMode of ["chat_completions", "responses"] as const) {
      expect(supportsPromptCacheRouting({ ...config, provider: "custom", customEndpoint: "https://api.openai.com/v1", apiMode })).toBe(true)
    }
    expect(supportsPromptCacheRouting({ ...config, provider: "custom", customEndpoint: "https://api.openai.com/v1", apiMode: "anthropic_messages" })).toBe(false)
    const overrides = { temperature: 0.5 }
    expect(await preparePromptCacheRouting(config, [{ role: "user", content: "你好" }], overrides)).toBe(overrides)
  })
})


it("重试裁剪移除缓存区时清除旧路由键，推理配置变更时重新计算", async () => {
  const first = await preparePromptCacheRouting(config, messages("任务"), {})
  const trimmed = await preparePromptCacheRouting(config, [{ role: "user", content: "只剩本轮任务" }], first)
  expect(trimmed.promptCacheKey).toBeUndefined()
  expect(first.promptCacheKey).toBeDefined()
  const retry = await preparePromptCacheRouting(config, messages("任务"), { ...first, reasoning: { mode: "off" } })
  expect(retry.promptCacheKey).not.toBe(first.promptCacheKey)
})
