import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

const clientMock = vi.hoisted(() => ({
  call: vi.fn(),
  handler: null as null | { onEnvelope?: (envelope: Record<string, unknown>) => void },
  interrupt: vi.fn(async () => undefined),
}))

vi.mock("./codex-app-server-client", () => ({
  getCodexAppServerClient: () => ({
    isolatedCwd: "/tmp/qmai/workspace",
    ensureStarted: vi.fn(async () => undefined),
    call: clientMock.call,
    interrupt: clientMock.interrupt,
    registerThread: (_threadId: string, handler: typeof clientMock.handler) => {
      clientMock.handler = handler
      return () => {
        clientMock.handler = null
      }
    },
  }),
}))

import {
  buildCodexTurnInput,
  codexNativeBoundaryError,
  restrictedCodexConfig,
  streamCodexCli,
} from "./codex-cli-transport"

const config: LlmConfig = {
  provider: "codex-cli",
  apiKey: "",
  model: "gpt-test",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
  codexCliTimeoutMinutes: 10,
}

describe("codex app-server transport", () => {
  beforeEach(() => {
    clientMock.call.mockReset()
    clientMock.handler = null
    clientMock.interrupt.mockClear()
  })

  it("disables native extension, shell, web, image, and project-rule surfaces", () => {
    const restricted = restrictedCodexConfig()
    expect(restricted).toEqual(expect.objectContaining({
      web_search: "disabled",
      project_doc_max_bytes: 0,
      project_root_markers: [],
      tools: { view_image: false, web_search: false },
      features: expect.objectContaining({
        apps: false,
        plugins: false,
        shell_tool: false,
        multi_agent: false,
        skill_search: false,
      }),
    }))
  })

  it("serializes trimmed chat history and images into turn input", () => {
    const input = buildCodexTurnInput([
      { role: "system", content: "system" },
      { role: "user", content: [
        { type: "text", text: "看图" },
        { type: "image", mediaType: "image/png", dataBase64: "YWJj" },
      ] },
      { role: "assistant", content: "收到" },
    ])
    expect(input[0].text).toContain("<USER>\n看图")
    expect(input[0].text).toContain("<ASSISTANT>\n收到")
    expect(input).toContainEqual({ type: "image", url: "data:image/png;base64,YWJj" })
  })

  it("allows only QMAI dynamic tool server requests and rejects native MCP notifications", () => {
    const dynamic = { id: 1, method: "item/tool/call", params: {} }
    expect(codexNativeBoundaryError(dynamic, true)).toBeNull()
    expect(codexNativeBoundaryError(dynamic)).toEqual(expect.objectContaining({
      message: expect.stringContaining("禁止 Codex 原生能力"),
    }))
    expect(codexNativeBoundaryError({
      method: "mcpServer/startupStatus/updated",
      params: {},
    })).toEqual(expect.objectContaining({
      message: expect.stringContaining("mcpServer/startupStatus/updated"),
    }))
    expect(codexNativeBoundaryError({
      method: "hook/started",
      params: {},
    })).toEqual(expect.objectContaining({
      message: expect.stringContaining("hook/started"),
    }))
  })

  it("uses app-server for plain streamChat without exposing dynamic tools", async () => {
    clientMock.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "thread/start") {
        expect(params).not.toHaveProperty("dynamicTools")
        return { thread: { id: "thread-text" }, instructionSources: [] }
      }
      if (method === "turn/start") {
        queueMicrotask(() => {
          clientMock.handler?.onEnvelope?.({
            method: "item/agentMessage/delta",
            params: { threadId: "thread-text", delta: "纯文本结果" },
          })
          clientMock.handler?.onEnvelope?.({
            method: "turn/completed",
            params: { threadId: "thread-text", turn: { status: "completed" } },
          })
        })
        return { turn: { id: "turn-text" } }
      }
      throw new Error(`unexpected method: ${method}`)
    })
    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await streamCodexCli(config, [
      { role: "system", content: "只输出正文" },
      { role: "user", content: "生成大纲" },
    ], callbacks)

    expect(callbacks.onToken).toHaveBeenCalledWith("纯文本结果")
    expect(callbacks.onDone).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("fails closed when app-server reports inherited instruction sources", async () => {
    clientMock.call.mockResolvedValueOnce({
      thread: { id: "thread-bad" },
      instructionSources: ["/Users/test/.codex/AGENTS.md"],
    })
    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await streamCodexCli(config, [{ role: "user", content: "测试" }], callbacks)

    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("禁止 Codex 加载本机或项目规则"),
    }))
    expect(callbacks.onDone).not.toHaveBeenCalled()
  })
})
