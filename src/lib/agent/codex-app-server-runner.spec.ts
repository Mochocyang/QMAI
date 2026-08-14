import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, Tool } from "./types"

const appServerMock = vi.hoisted(() => ({
  handler: null as null | {
    onEnvelope?: (envelope: Record<string, unknown>) => void
    onDynamicToolCall?: (request: Record<string, unknown>) => Promise<unknown>
  },
  turnNumber: 0,
  onTurn: null as null | ((turnNumber: number) => void | Promise<void>),
  call: vi.fn(),
  interrupt: vi.fn(async () => undefined),
}))

vi.mock("@/lib/codex-app-server-client", () => ({
  getCodexAppServerClient: () => ({
    isolatedCwd: "/tmp/qmai-codex/workspace",
    ensureStarted: vi.fn(async () => undefined),
    call: appServerMock.call,
    interrupt: appServerMock.interrupt,
    registerThread: (_threadId: string, handler: typeof appServerMock.handler) => {
      appServerMock.handler = handler
      return () => {
        appServerMock.handler = null
      }
    },
  }),
}))

import { CodexAppServerRunner } from "./codex-app-server-runner"

const llmConfig: LlmConfig = {
  provider: "codex-cli",
  apiKey: "",
  model: "gpt-test",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
  codexCliTimeoutMinutes: 10,
}

const messages: AgentMessage[] = [
  { role: "system", content: "QMAI system" },
  { role: "user", content: "读取大纲后回答" },
]

function callbacks(): AgentRunCallbacks {
  return {
    onText: vi.fn(),
    onReasoningToken: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onToolError: vi.fn(),
    onToolEvent: vi.fn(),
    onUsage: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  }
}

function config(tools: Tool[], overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    maxRounds: 3,
    tools,
    systemPrompt: "QMAI system",
    llmConfig,
    ...overrides,
  }
}

function envelope(method: string, params: Record<string, unknown>): void {
  appServerMock.handler?.onEnvelope?.({ method, params })
}

describe("CodexAppServerRunner", () => {
  beforeEach(() => {
    appServerMock.handler = null
    appServerMock.turnNumber = 0
    appServerMock.onTurn = null
    appServerMock.call.mockReset()
    appServerMock.interrupt.mockClear()
    appServerMock.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "thread/start") {
        return { thread: { id: "thread-1" }, instructionSources: [] }
      }
      if (method === "turn/start") {
        appServerMock.turnNumber += 1
        const current = appServerMock.turnNumber
        queueMicrotask(() => void appServerMock.onTurn?.(current))
        return { turn: { id: `turn-${current}` } }
      }
      throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`)
    })
  })

  it("publishes QMAI dynamic tools, executes a read tool, and returns the final record", async () => {
    const tool: Tool = {
      name: "read_outline",
      description: "读取大纲",
      category: "read",
      parameters: { path: { type: "string", description: "路径", required: true } },
      execute: vi.fn(async () => "大纲内容"),
    }
    const registry = new ToolRegistry()
    registry.register(tool)
    appServerMock.onTurn = async () => {
      const response = await appServerMock.handler?.onDynamicToolCall?.({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: null,
        tool: "read_outline",
        arguments: { path: "QM/outlines/总纲.md" },
      }) as { success: boolean; contentItems: Array<{ text: string }> }
      expect(response.success).toBe(true)
      expect(response.contentItems[0].text).toContain("大纲内容")
      envelope("item/reasoning/summaryTextDelta", { threadId: "thread-1", delta: "思考" })
      envelope("item/agentMessage/delta", { threadId: "thread-1", delta: "最终回答" })
      envelope("thread/tokenUsage/updated", {
        threadId: "thread-1",
        tokenUsage: {
          last: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
          total: { inputTokens: 18, outputTokens: 4, totalTokens: 22 },
        },
      })
      envelope("turn/completed", { threadId: "thread-1", turn: { status: "completed" } })
    }
    const cb = callbacks()

    const record = await new CodexAppServerRunner().run(
      config([tool]), registry, messages, cb,
    )

    const threadStart = appServerMock.call.mock.calls.find(([method]) => method === "thread/start")
    expect(threadStart?.[1]).toEqual(expect.objectContaining({
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      dynamicTools: [expect.objectContaining({ name: "read_outline" })],
    }))
    expect(threadStart?.[1].baseInstructions).toContain("## 任务契约")
    expect(tool.execute).toHaveBeenCalledWith(
      { path: "QM/outlines/总纲.md" }, undefined, expect.any(Object),
    )
    expect(record.finalText).toBe("最终回答")
    expect(record.toolCalls[0]).toEqual(expect.objectContaining({ name: "read_outline", status: "done" }))
    expect(record.lastRequestUsage).toEqual(expect.objectContaining({ totalTokens: 12 }))
    expect(record.usage).toEqual(expect.objectContaining({ totalTokens: 22 }))
    expect(record.usageAggregationScope).toBe("provider_thread")
    expect(record.providerRequestCountAvailable).toBe(false)
    expect(cb.onText).toHaveBeenCalledWith("最终回答")
    expect(cb.onDone).toHaveBeenCalledOnce()
    expect(cb.onError).not.toHaveBeenCalled()
  })

  it("returns approval_required previews without executing confirmation tools", async () => {
    const tool: Tool = {
      name: "write_outline_node",
      description: "修改大纲",
      category: "write",
      permission: "confirm",
      parameters: { content: { type: "string", description: "内容", required: true } },
      execute: vi.fn(async () => "不应执行"),
      generatePreview: vi.fn(async () => "将写入：新内容"),
    }
    const registry = new ToolRegistry()
    registry.register(tool)
    appServerMock.onTurn = async () => {
      const response = await appServerMock.handler?.onDynamicToolCall?.({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-write",
        namespace: null,
        tool: "write_outline_node",
        arguments: { content: "新内容" },
      }) as { success: boolean; contentItems: Array<{ text: string }> }
      expect(response.success).toBe(true)
      expect(response.contentItems[0].text).toContain("尚未执行")
      envelope("item/agentMessage/delta", { threadId: "thread-1", delta: "等待确认" })
      envelope("turn/completed", { threadId: "thread-1", turn: { status: "completed" } })
    }
    const cb = callbacks()

    const record = await new CodexAppServerRunner().run(config([tool]), registry, messages, cb)

    expect(tool.generatePreview).toHaveBeenCalledOnce()
    expect(tool.execute).not.toHaveBeenCalled()
    expect(record.toolCalls[0]).toEqual(expect.objectContaining({
      status: "approval_required",
      preview: "将写入：新内容",
    }))
  })

  it("continues in the same thread when requiredToolsOnce is missing", async () => {
    const tool: Tool = {
      name: "list_outlines",
      description: "列出大纲",
      category: "read",
      parameters: {},
      execute: vi.fn(async () => "总纲.md"),
    }
    const registry = new ToolRegistry()
    registry.register(tool)
    appServerMock.onTurn = async (turnNumber) => {
      if (turnNumber === 1) {
        envelope("item/agentMessage/delta", { threadId: "thread-1", delta: "未读取直接回答" })
        envelope("turn/completed", { threadId: "thread-1", turn: { status: "completed" } })
        return
      }
      await appServerMock.handler?.onDynamicToolCall?.({
        threadId: "thread-1",
        turnId: "turn-2",
        callId: "call-list",
        namespace: null,
        tool: "list_outlines",
        arguments: {},
      })
      envelope("item/agentMessage/delta", { threadId: "thread-1", delta: "读取后回答" })
      envelope("turn/completed", { threadId: "thread-1", turn: { status: "completed" } })
    }
    const cb = callbacks()

    const record = await new CodexAppServerRunner().run(
      config([tool], { requiredToolsOnce: ["list_outlines"] }),
      registry,
      messages,
      cb,
    )

    expect(appServerMock.turnNumber).toBe(2)
    const turnStarts = appServerMock.call.mock.calls.filter(([method]) => method === "turn/start")
    expect(turnStarts[1][1].input[0].text).toContain("list_outlines")
    expect(record.finalText).toBe("读取后回答")
    expect(cb.onText).not.toHaveBeenCalledWith("未读取直接回答")
  })

  it("hard-fails when Codex emits a native shell item", async () => {
    appServerMock.onTurn = () => {
      envelope("item/started", {
        threadId: "thread-1",
        item: { id: "native-1", type: "commandExecution", command: "pwd" },
      })
    }
    const cb = callbacks()

    await new CodexAppServerRunner().run(config([]), new ToolRegistry(), messages, cb)

    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("禁止 Codex 原生能力"),
    }))
    expect(appServerMock.interrupt).toHaveBeenCalledWith("thread-1", "turn-1")
    expect(cb.onDone).not.toHaveBeenCalled()
  })

  it("rejects non-object dynamic tool arguments without executing the tool", async () => {
    const tool: Tool = {
      name: "read_outline",
      description: "读取大纲",
      category: "read",
      parameters: {},
      execute: vi.fn(async () => "不应执行"),
    }
    const registry = new ToolRegistry()
    registry.register(tool)
    appServerMock.onTurn = async () => {
      const response = await appServerMock.handler?.onDynamicToolCall?.({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "bad-args",
        namespace: null,
        tool: "read_outline",
        arguments: "bad",
      }) as { success: boolean }
      expect(response.success).toBe(false)
      envelope("item/agentMessage/delta", { threadId: "thread-1", delta: "参数失败" })
      envelope("turn/completed", { threadId: "thread-1", turn: { status: "completed" } })
    }

    const record = await new CodexAppServerRunner().run(config([tool]), registry, messages, callbacks())

    expect(tool.execute).not.toHaveBeenCalled()
    expect(record.toolCalls[0].status).toBe("error")
  })

  it("maps AbortSignal cancellation to turn/interrupt", async () => {
    const controller = new AbortController()
    const cb = callbacks()
    const run = new CodexAppServerRunner().run(
      config([]),
      new ToolRegistry(),
      messages,
      cb,
      controller.signal,
    )
    await vi.waitFor(() => expect(appServerMock.turnNumber).toBe(1))
    controller.abort()
    await run

    expect(appServerMock.interrupt).toHaveBeenCalledWith("thread-1", "turn-1")
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "操作已取消" }))
    expect(cb.onDone).not.toHaveBeenCalled()
  })
})
