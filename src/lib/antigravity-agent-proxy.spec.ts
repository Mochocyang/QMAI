import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  cancelAntigravityToolCalls,
  DEFAULT_ANTIGRAVITY_AGENT_MODEL,
  ensureAntigravityAgentProxy,
  resetAntigravityAgentProxyCacheForTests,
  resolveAntigravityAgentModel,
  shouldUseAntigravityAgentProxy,
  withAntigravityAgentProxy,
} from "./antigravity-agent-proxy"
import { getProviderConfig } from "./llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"

const base: LlmConfig = {
  provider: "antigravity-cli",
  apiKey: "",
  model: "",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128000,
}

const tool = { type: "function", function: { name: "read_chapter", description: "", parameters: { type: "object", properties: {}, required: [] } } }

describe("antigravity agent proxy", () => {
  beforeEach(() => resetAntigravityAgentProxyCacheForTests())

  it("defaults the agent model to gemini-3.8-flash-medium", () => {
    expect(DEFAULT_ANTIGRAVITY_AGENT_MODEL).toBe("gemini-3.8-flash-medium")
    expect(resolveAntigravityAgentModel("")).toBe("gemini-3.8-flash-medium")
    expect(resolveAntigravityAgentModel(" gemini-3.8-flash-low ")).toBe("gemini-3.8-flash-low")
  })

  it("only routes tool requests through the proxy", () => {
    expect(shouldUseAntigravityAgentProxy(base, { tools: [tool] as never })).toBe(true)
    expect(shouldUseAntigravityAgentProxy(base, { tools: [] as never })).toBe(false)
    expect(shouldUseAntigravityAgentProxy(base, undefined)).toBe(false)
    expect(shouldUseAntigravityAgentProxy({ provider: "cursor-cli" }, { tools: [tool] as never })).toBe(false)
  })

  it("starts the proxy once and reuses it", async () => {
    const invoke = vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:4567/v1", token: "t" })
    await ensureAntigravityAgentProxy(invoke)
    await ensureAntigravityAgentProxy(invoke)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith("antigravity_agent_proxy_ensure")
  })

  it("retries after a failed start with a Chinese error", async () => {
    const invoke = vi.fn().mockRejectedValueOnce("没有找到登录凭据").mockResolvedValue({ baseUrl: "http://x/v1", token: "t" })
    await expect(ensureAntigravityAgentProxy(invoke)).rejects.toThrow(/无法启动 Antigravity 主 Agent 代理：没有找到登录凭据/)
    await expect(ensureAntigravityAgentProxy(invoke)).resolves.toEqual({ baseUrl: "http://x/v1", token: "t" })
  })

  it("turns the config into an OpenAI-compatible request against the proxy", () => {
    const config = withAntigravityAgentProxy(base, { baseUrl: "http://127.0.0.1:4567/v1", token: "secret" })
    const provider = getProviderConfig(config)
    expect(provider.url).toBe("http://127.0.0.1:4567/v1/chat/completions")
    expect(provider.headers.Authorization).toBe("Bearer secret")
    const body = provider.buildBody([{ role: "user", content: "hi" }], { tools: [tool] as never, toolChoice: "auto" }) as Record<string, unknown>
    expect(body.model).toBe("gemini-3.8-flash-medium")
    expect(body.stream).toBe(true)
    expect(body.tools).toHaveLength(1)
  })

  it("still refuses plain antigravity configs in getProviderConfig (subprocess path)", () => {
    expect(() => getProviderConfig(base)).toThrow(/subprocess transport/)
  })

  it("cancels parked tool calls by id and skips empty lists", async () => {
    const invoke = vi.fn().mockResolvedValue(1)
    await cancelAntigravityToolCalls([], invoke)
    expect(invoke).not.toHaveBeenCalled()
    await cancelAntigravityToolCalls(["call_1"], invoke)
    expect(invoke).toHaveBeenCalledWith("antigravity_agent_cancel", { toolCallIds: ["call_1"] })
  })
})
