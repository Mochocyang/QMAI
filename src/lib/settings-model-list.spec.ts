import { afterEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { invoke } from "@tauri-apps/api/core"
import { getCursorCliCatalog, rememberCursorCliCatalog } from "@/lib/cursor-acp-models"

const fetchMock = vi.fn()

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: async () => fetchMock,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
}))

function customConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "custom",
    apiKey: "sk-test",
    model: "gpt-4o",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "https://hub.linux.do/v1",
    maxContextSize: 128000,
    apiMode: "chat_completions",
    reasoning: { mode: "off" },
    ...overrides,
  }
}

afterEach(() => {
  fetchMock.mockReset()
  vi.mocked(invoke).mockReset()
  rememberCursorCliCatalog([])
})

describe("settings model list", () => {
  it("fetches custom OpenAI-compatible models from the normalized /models endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { fetchLlmModelList } = await import("./settings-model-list")
    const result = await fetchLlmModelList(customConfig())

    expect(fetchMock).toHaveBeenCalledWith("https://hub.linux.do/v1/models", {
      method: "GET",
      headers: {
        Authorization: "Bearer sk-test",
        Origin: "",
      },
    })
    expect(result.models).toEqual(["gpt-test"])
  })

  it("retries model list 403 responses with browser-compatible OpenAI headers", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "linux-do-model" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )

    const { fetchLlmModelList } = await import("./settings-model-list")
    const result = await fetchLlmModelList(customConfig())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://hub.linux.do/v1/models",
      {
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          Accept: "application/json",
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
        }),
      },
    ])
    expect(result.models).toEqual(["linux-do-model"])
  })

  it("keeps the original 403 diagnostic when the compatibility retry cannot be sent", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockRejectedValueOnce(new TypeError("Refused to set unsafe header"))

    const { fetchLlmModelList } = await import("./settings-model-list")

    await expect(fetchLlmModelList(customConfig())).rejects.toThrow(
      "模型列表拉取失败：HTTP 403 forbidden",
    )
  })

  it("reads the configured local Claude CLI model from Tauri detection", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      installed: true,
      version: "2.1.169 (Claude Code)",
      path: "C:/Users/Administrator/AppData/Roaming/npm/claude.cmd",
      model: "haiku",
      error: null,
    })

    const { fetchLlmModelList } = await import("./settings-model-list")
    const result = await fetchLlmModelList(customConfig({
      provider: "claude-code",
      apiKey: "",
      model: "",
    }))

    expect(invoke).toHaveBeenCalledWith("claude_cli_detect")
    expect(result.models).toEqual(["haiku"])
  })

  it("reads the configured local Codex CLI model from Tauri detection", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      installed: true,
      version: "codex-cli 0.146.1",
      path: "C:/Users/Administrator/AppData/Roaming/npm/codex.cmd",
      model: "gpt-5.6-terra",
      appServerReady: true,
      dynamicToolsReady: true,
      models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
      error: null,
    })

    const { fetchLlmModelList } = await import("./settings-model-list")
    const result = await fetchLlmModelList(customConfig({
      provider: "codex-cli",
      apiKey: "",
      model: "",
    }))

    expect(invoke).toHaveBeenCalledWith("codex_cli_detect")
    expect(result.models).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"])
  })

  it("filters the cursor-cli list through ACP params and keeps CLI ids", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "cursor_proxy_ensure") {
        return {
          healthy: true,
          base_url: "http://127.0.0.1:8765",
          managed: true,
          error: null,
        }
      }
      if (command === "cursor_cli_apply_acp_model") return undefined
      if (command === "cursor_cli_acp_models") {
        return [
          { name: "grok-4.6", modelId: "grok-4.6[effort=high,fast=true]" },
          { name: "composer-2.5", modelId: "composer-2.5[fast=true]" },
        ]
      }
      throw new Error(`unexpected invoke ${command}`)
    })
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: "cursor-grok-4.6-medium-fast" },
              { id: "cursor-grok-4.6-high-fast" },
              { id: "cursor-grok-4.6-high" },
              { id: "composer-2-fast" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const { fetchLlmModelList } = await import("./settings-model-list")
    const result = await fetchLlmModelList(customConfig({
      provider: "cursor-cli",
      apiKey: "",
      model: "cursor-grok-4.6-medium-fast",
      customEndpoint: "http://127.0.0.1:8765/v1",
    }))

    expect(invoke).toHaveBeenCalledWith("cursor_cli_acp_models")
    expect(invoke).toHaveBeenCalledWith("cursor_cli_apply_acp_model", {
      model: "grok-4.6",
      cliModel: "cursor-grok-4.6-medium-fast",
      fast: true,
      effort: "medium",
    })
    expect(result.models).toEqual([
      "composer-2-fast",
      "cursor-grok-4.6-high-fast",
    ])
    expect(getCursorCliCatalog()).toEqual([
      "cursor-grok-4.6-high-fast",
      "composer-2-fast",
    ])
  })

  it("fails closed when the ACP catalog is empty", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "cursor_proxy_ensure") {
        return {
          healthy: true,
          base_url: "http://127.0.0.1:8765",
          managed: true,
          error: null,
        }
      }
      if (command === "cursor_cli_apply_acp_model") return undefined
      if (command === "cursor_cli_acp_models") return []
      throw new Error(`unexpected invoke ${command}`)
    })
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "cursor-grok-4.6-high-fast" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )

    const { fetchLlmModelList } = await import("./settings-model-list")
    await expect(fetchLlmModelList(customConfig({
      provider: "cursor-cli",
      apiKey: "",
      model: "cursor-grok-4.6-high-fast",
      customEndpoint: "http://127.0.0.1:8765/v1",
    }))).rejects.toThrow("ACP catalog 为空")
  })

  it("rejects a Codex CLI without app-server dynamic tools", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      installed: true,
      version: "codex-cli 0.120.0",
      path: "/usr/local/bin/codex",
      appServerReady: false,
      dynamicToolsReady: false,
      models: [],
      error: "当前 Codex CLI 不支持 QMAI 主 Agent，请升级 Codex CLI。",
    })

    const { fetchLlmModelList } = await import("./settings-model-list")
    await expect(fetchLlmModelList(customConfig({
      provider: "codex-cli",
      apiKey: "",
      model: "",
    }))).rejects.toThrow("请升级 Codex CLI")
  })
})
