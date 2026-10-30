/**
 * 插件 provider 请求适配器（T3）的单元测试。
 *
 * 覆盖三件事：
 *   1. 插件 provider 打到宿主分配的 baseUrl + `/v1/chat/completions`；
 *   2. `Authorization` 用的是 `plugins_provider_auth` 现取的 token（不落盘）；
 *   3. body 与内置 OpenAI 分支共用同一份构造（不复制线格式代码）。
 *
 * 真正的 SSE 流与统计在 llm-client 的测试里覆盖，这里只测「请求长什么样」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import type { LlmConfig } from "@/stores/wiki-store"
import { getProviderConfig, resolveProviderConfig } from "./llm-providers"
import { clearPluginProviderAuth } from "./plugins/provider-auth"

function pluginConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "wb-connect",
    // 计划第 0 节：插件 provider 的 apiKey 永远不落盘，这里刻意留空。
    apiKey: "",
    model: "glm-5.3",
    ollamaUrl: "",
    // 宿主分配的 baseUrl 由运行期解析进 customEndpoint（与 cursor-cli 注入运行期端点同构）。
    customEndpoint: "http://127.0.0.1:43210",
    maxContextSize: 200_000,
    ...overrides,
  }
}

describe("插件 provider 通用请求适配器", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    clearPluginProviderAuth()
  })

  it("打到 baseUrl + /v1/chat/completions，Authorization 用现取的 token", async () => {
    invokeMock.mockResolvedValue("provider-token-abc")

    const cfg = await resolveProviderConfig(pluginConfig())

    expect(cfg.url).toBe("http://127.0.0.1:43210/v1/chat/completions")
    expect(cfg.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer provider-token-abc",
    })
    expect(invokeMock).toHaveBeenCalledWith("plugins_provider_auth", { providerId: "wb-connect" })
  })

  it("body 复用 OpenAI 兼容构造，且 token 不会混进请求体", async () => {
    invokeMock.mockResolvedValue("provider-token-abc")

    const cfg = await resolveProviderConfig(pluginConfig())
    const body = cfg.buildBody([{ role: "user", content: "hi" }]) as Record<string, unknown>

    expect(body).toEqual({
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
      model: "glm-5.3",
    })
    expect(JSON.stringify(body)).not.toContain("provider-token-abc")
  })

  it("baseUrl 末尾的斜杠不会拼出双斜杠", async () => {
    invokeMock.mockResolvedValue("t")

    const cfg = await resolveProviderConfig(pluginConfig({ customEndpoint: "http://127.0.0.1:43210/" }))

    expect(cfg.url).toBe("http://127.0.0.1:43210/v1/chat/completions")
  })

  it("同步 getProviderConfig 在 token 未缓存时明确报错，而不是发无鉴权请求", () => {
    // token 只能异步现取；同步路径拿不到时宁可报错，也不要发一个会被本机插件
    // 401 掉的请求（那和「插件没启动」几乎无法区分）。
    expect(() => getProviderConfig(pluginConfig())).toThrow(/resolveProviderConfig/)
  })

  it("端点未注入时报错，不猜默认地址", async () => {
    invokeMock.mockResolvedValue("t")

    await expect(resolveProviderConfig(pluginConfig({ customEndpoint: "" }))).rejects.toThrow(/端点未注入/)
  })
})
