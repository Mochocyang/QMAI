import { describe, expect, it, vi, beforeEach } from "vitest"
import { AgentRunner, ModelDoesNotSupportToolsError } from "./runner"
import { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage } from "./types"
import type { Tool } from "./types"
import { TOOL_EXECUTE_TIMEOUT_MS } from "./types"
import type { StreamCallbacks } from "../llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

const breakpointMocks = vi.hoisted(() => ({
  createTaskBreakpoint: vi.fn(() => ({
    taskId: "test",
    taskGoal: "test",
    completedStages: [],
    currentStage: "agent_round_1",
    usedSkills: [],
    usedTools: [],
    searches: [],
    mcpCalls: [],
    createdAt: 0,
    updatedAt: 0,
  })),
  updateBreakpointStage: vi.fn((bp, newStage, completedStage) => ({
    ...bp,
    currentStage: newStage,
    completedStages: completedStage ? [...bp.completedStages, completedStage] : bp.completedStages,
    updatedAt: 1,
  })),
  saveTaskBreakpoint: vi.fn(async () => {}),
  clearTaskBreakpoint: vi.fn(async () => {}),
  buildBreakpointResumePrompt: vi.fn(() => ""),
}))

vi.mock("./task-breakpoint", () => breakpointMocks)

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "",
  model: "test",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
}

// Mock streamChat
const mockStreamChat = vi.fn()
vi.mock("../llm-client", () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}))

describe("AgentRunner", () => {
  let runner: AgentRunner
  let registry: ToolRegistry

  const systemMsg: AgentMessage = { role: "system", content: "You are helpful" }
  const userMsg: AgentMessage = { role: "user", content: "Hello" }

  beforeEach(() => {
    runner = new AgentRunner()
    registry = new ToolRegistry()
    mockStreamChat.mockReset()
    breakpointMocks.createTaskBreakpoint.mockClear()
    breakpointMocks.updateBreakpointStage.mockClear()
    breakpointMocks.saveTaskBreakpoint.mockClear()
    breakpointMocks.clearTaskBreakpoint.mockClear()
  })

  it("returns final text when LLM responds without tool calls", async () => {
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      for (const char of "Hello user!") {
        cb.onToken(char)
      }
      cb.onDone()
    })
    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    const config: AgentConfig = { maxRounds: 3, tools: [], systemPrompt: "You are helpful", llmConfig: mockLlmConfig }
    const result = await runner.run(config, registry, [systemMsg, userMsg], callbacks, undefined)
    expect(result.finalText).toBe("Hello user!")
    expect(result.roundsUsed).toBe(1)
    expect(callbacks.onDone).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("passes cacheable system content blocks through to the provider layer", async () => {
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onToken("完成")
      cb.onDone()
    })
    const cacheableSystem: AgentMessage = {
      role: "system",
      content: [
        { type: "text", text: "稳定核心", cacheControl: true },
        { type: "text", text: "动态上下文" },
      ],
    }

    await runner.run(
      { maxRounds: 1, tools: [], systemPrompt: "", llmConfig: mockLlmConfig },
      registry,
      [cacheableSystem, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    )

    expect(mockStreamChat.mock.calls[0][1][0]).toEqual(cacheableSystem)
  })

  it("aggregates provider usage across agent rounds", async () => {
    let round = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      round += 1
      if (round === 1) {
        cb.onUsage?.({ inputTokens: 1000, outputTokens: 20, cachedInputTokens: 600 })
        cb.onToolCallDelta?.({ index: 0, id: "call_1", name: "missing_tool", arguments: "{}" })
      } else {
        cb.onUsage?.({ inputTokens: 700, outputTokens: 80, cachedInputTokens: 500 })
        cb.onToken("完成")
      }
      cb.onDone()
    })

    const result = await runner.run(
      { maxRounds: 2, tools: [], systemPrompt: "", llmConfig: mockLlmConfig },
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    )

    expect(result.usage).toEqual({
      inputTokens: 1700,
      outputTokens: 100,
      cachedInputTokens: 1100,
    })
  })

  it("executes tool calls and continues the loop", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    // Round 1: tool call
    // Round 2: final text
    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "call_1", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"ch1"}' })
        cb.onDone()
      } else {
        cb.onToken("G")
        cb.onToken("ot it!")
        cb.onDone()
      }
    })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "You are helpful", llmConfig: mockLlmConfig }
    const result = await runner.run(config, registry, [systemMsg, userMsg], callbacks, undefined)

    expect(tool.execute).toHaveBeenCalledWith(
      { name: "ch1" },
      undefined,
      expect.objectContaining({ callId: "call_1", toolName: "read_chapter" }),
    )
    expect(callbacks.onToolCall).toHaveBeenCalledOnce()
    expect(callbacks.onToolResult).toHaveBeenCalledOnce()
    expect(result.finalText).toBe("Got it!")
    expect(result.roundsUsed).toBe(2)
  })

  it("parses text JSON tool calls for cursor-cli providers", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToken('{"name":"read_chapter","arguments":{"name":"ch1"}}')
        cb.onDone()
      } else {
        cb.onToken("完成")
        cb.onDone()
      }
    })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    const config: AgentConfig = {
      maxRounds: 3,
      tools: [tool],
      systemPrompt: "You are helpful",
      llmConfig: { ...mockLlmConfig, provider: "cursor-cli" },
    }
    const result = await runner.run(config, registry, [systemMsg, userMsg], callbacks, undefined)

    expect(tool.execute).toHaveBeenCalledWith(
      { name: "ch1" },
      undefined,
      expect.objectContaining({ toolName: "read_chapter" }),
    )
    expect(callbacks.onToolCall).toHaveBeenCalledOnce()
    expect(result.finalText).toBe("完成")
    expect(result.roundsUsed).toBe(2)
  })

  it("passes the real tool call id into tool execution context", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "real_call_1", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"ch1"}' })
        cb.onDone()
      } else {
        cb.onToken("done")
        cb.onDone()
      }
    })

    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
    )

    expect(tool.execute).toHaveBeenCalledWith(
      { name: "ch1" },
      undefined,
      expect.objectContaining({
        callId: "real_call_1",
        toolName: "read_chapter",
      }),
    )
  })

  it("passes the tool event emitter into tool execution context", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "real_call_2", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"ch1"}' })
        cb.onDone()
      } else {
        cb.onToken("done")
        cb.onDone()
      }
    })

    const onToolEvent = vi.fn()
    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolEvent },
      undefined,
    )

    expect(tool.execute).toHaveBeenCalledWith(
      { name: "ch1" },
      undefined,
      expect.objectContaining({
        callId: "real_call_2",
        toolName: "read_chapter",
        onToolEvent,
      }),
    )
  })

  it("passes the activity event emitter into tool execution context", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn(async (_params, _signal, context) => {
        context?.onActivityEvent?.({
          id: "tool-activity",
          stageId: "read_context",
          kind: "read_source",
          title: "读取章节",
          content: "读取章节《第1章》",
          toolCallId: context.callId,
          timestamp: 100,
        })
        return "Chapter content"
      }),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "real_call_3", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"ch1"}' })
        cb.onDone()
      } else {
        cb.onToken("done")
        cb.onDone()
      }
    })

    const onActivityEvent = vi.fn()
    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      {
        onText: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onToolError: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
        onActivityEvent,
      },
      undefined,
    )

    expect(tool.execute).toHaveBeenCalledWith(
      { name: "ch1" },
      undefined,
      expect.objectContaining({
        callId: "real_call_3",
        toolName: "read_chapter",
        onActivityEvent,
      }),
    )
    expect(onActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      stageId: "read_context",
      kind: "read_source",
      title: "读取章节",
    }))
  })

  it("does not stream assistant narration from tool-call rounds", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: { name: { type: "string", description: "name" } },
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToken("我先读取上一章。")
        cb.onToolCallDelta?.({ index: 0, id: "call_1", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"ch1"}' })
        cb.onDone()
      } else {
        cb.onToken("章节正文")
        cb.onDone()
      }
    })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "You are helpful", llmConfig: mockLlmConfig }
    const result = await runner.run(config, registry, [systemMsg, userMsg], callbacks, undefined)

    expect(callbacks.onText).toHaveBeenCalledTimes(1)
    expect(callbacks.onText).toHaveBeenCalledWith("章节正文")
    expect(result.finalText).toBe("章节正文")
  })

  it("stops after maxRounds exceeded", async () => {
    // Always return tool calls
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onToolCallDelta?.({ index: 0, id: "call_1", name: "read_chapter" })
      cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
      cb.onDone()
    })

    const tool: Tool = {
      name: "read_chapter",
      description: "",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("ok"),
    }
    registry.register(tool)

    const onError = vi.fn()
    const config: AgentConfig = { maxRounds: 2, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    await runner.run(config, registry, [systemMsg, userMsg], { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError }, undefined)

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toContain("轮次")
  })

  it("reports tool execution errors via onToolError", async () => {
    const tool: Tool = {
      name: "bad_tool",
      description: "",
      category: "read",
      parameters: {},
      execute: vi.fn().mockRejectedValue(new Error("execution failed")),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "c1", name: "bad_tool" })
        cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
        cb.onDone()
      } else {
        cb.onToken("ok")
        cb.onDone()
      }
    })

    const onToolError = vi.fn()
    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    await runner.run(config, registry, [systemMsg, userMsg], { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError, onDone: vi.fn(), onError: vi.fn() }, undefined)

    expect(onToolError).toHaveBeenCalledOnce()
  })

  it("allows long-running workflow tools to opt out of the generic 30 second timeout", async () => {
    vi.useFakeTimers()
    try {
      const tool: Tool = {
        name: "run_chapter_workflow",
        description: "workflow",
        category: "action",
        permission: "auto",
        executeTimeoutMs: 0,
        parameters: {},
        execute: vi.fn(() => new Promise<string>((resolve) => {
          setTimeout(() => resolve("章节工作流完成"), TOOL_EXECUTE_TIMEOUT_MS + 1000)
        })),
      }
      registry.register(tool)

      let callCount = 0
      mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        callCount++
        if (callCount === 1) {
          cb.onToolCallDelta?.({ index: 0, id: "workflow_1", name: "run_chapter_workflow" })
          cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
          cb.onDone()
        } else {
          cb.onToken("完成")
          cb.onDone()
        }
      })

      const onToolError = vi.fn()
      const onToolResult = vi.fn()
      const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
      const runPromise = runner.run(
        config,
        registry,
        [systemMsg, userMsg],
        { onText: vi.fn(), onToolCall: vi.fn(), onToolResult, onToolError, onDone: vi.fn(), onError: vi.fn() },
        undefined,
      )

      await vi.advanceTimersByTimeAsync(TOOL_EXECUTE_TIMEOUT_MS + 1000)
      const result = await runPromise

      expect(onToolError).not.toHaveBeenCalled()
      expect(onToolResult).toHaveBeenCalledWith("workflow_1", "章节工作流完成")
      expect(result.toolCalls[0].status).toBe("done")
    } finally {
      vi.useRealTimers()
    }
  })

  it("executes confirm-required write tools for preview and sets approval_required status", async () => {
    const tool: Tool = {
      name: "write_chapter",
      description: "",
      category: "write",
      permission: "confirm",
      parameters: {},
      execute: vi.fn().mockResolvedValue("written preview content"),
    }
    registry.register(tool)

    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, messages: AgentMessage[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "write_1", name: "write_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: '{"name":"第1章","content":"正文"}' })
        cb.onDone()
      } else {
        expect(messages[messages.length - 1].content).toContain("written preview content")
        cb.onToken("已生成写入预览，等待确认。")
        cb.onDone()
      }
    })

    const onToolEvent = vi.fn()
    const config: AgentConfig = { maxRounds: 3, tools: [tool], systemPrompt: "", llmConfig: mockLlmConfig }
    const result = await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      {
        onText: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onToolError: vi.fn(),
        onToolEvent,
        onDone: vi.fn(),
        onError: vi.fn(),
      },
      undefined,
    )

    expect(tool.execute).toHaveBeenCalledTimes(1)
    expect(result.toolCalls[0].status).toBe("approval_required")
    expect((result.toolCalls[0] as any).preview).toBe("written preview content")
    expect(result.toolCalls[0].result).toBe("written preview content")
    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "approval_required", callId: "write_1", preview: "written preview content" }))
  })

  it("keeps full tool result in record but sends compressed result back to the model", async () => {
    const longResult = `${"开头".repeat(2000)}\n中间内容\n${"结尾".repeat(2000)}`
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue(longResult),
    }
    registry.register(tool)

    let compressedToolMessage = ""
    let callCount = 0
    mockStreamChat.mockImplementation(async (_config: unknown, messages: AgentMessage[], cb: StreamCallbacks) => {
      callCount++
      if (callCount === 1) {
        cb.onToolCallDelta?.({ index: 0, id: "read_1", name: "read_chapter" })
        cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
        cb.onDone()
      } else {
        compressedToolMessage = String(messages[messages.length - 1].content)
        cb.onToken("已分析")
        cb.onDone()
      }
    })

    const config: AgentConfig = {
      maxRounds: 3,
      tools: [tool],
      systemPrompt: "",
      llmConfig: mockLlmConfig,
      toolResultContextLimit: 1200,
    }
    const result = await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
    )

    expect(result.toolCalls[0].result).toBe(longResult)
    expect(compressedToolMessage.length).toBeLessThan(longResult.length)
    expect(compressedToolMessage).toContain("已压缩给模型使用")
    expect(compressedToolMessage).toContain("开头")
    expect(compressedToolMessage).toContain("结尾")
  })

  it("每轮模型请求保留任务契约并压缩内部工作消息", async () => {
    mockStreamChat.mockImplementation(async (_config: unknown, messages: AgentMessage[], cb: StreamCallbacks) => {
      const total = messages.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0)
      expect(total).toBeLessThanOrEqual(750)
      expect(messages.some((message) => String(message.content).includes("任务契约"))).toBe(true)
      expect(messages.some((message) => String(message.content).includes("完成整本小说"))).toBe(true)
      cb.onToken("完成")
      cb.onDone()
    })

    const callbacks = { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runner.run(
      {
        maxRounds: 2,
        tools: [],
        systemPrompt: "",
        taskGoal: "完成整本小说，不能改变主角身份。",
        llmConfig: { ...mockLlmConfig, maxContextSize: 1_000 },
      },
      registry,
      [
        { role: "system", content: "系统规则".repeat(120) },
        { role: "assistant", content: "旧结果".repeat(180) },
        { role: "user", content: "继续执行当前任务" },
      ],
      callbacks,
    )
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("15 轮重复工具调用不会让内部上下文无限增长", async () => {
    const tool: Tool = {
      name: "read_memory",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn(async () => "记忆原文".repeat(3000)),
    }
    registry.register(tool)
    let round = 0
    const injectedToolContents: string[] = []
    mockStreamChat.mockImplementation(async (_config: unknown, messages: AgentMessage[], cb: StreamCallbacks) => {
      round += 1
      const total = messages.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0)
      expect(total).toBeLessThanOrEqual(2250)
      const latestTool = [...messages].reverse().find((message) => message.role === "tool")
      if (latestTool) injectedToolContents.push(String(latestTool.content))
      if (round <= 15) {
        cb.onToolCallDelta?.({ index: 0, id: `call-${round}`, name: "read_memory", arguments: '{"name":"核心目标"}' })
      } else {
        cb.onToken("全部完成")
      }
      cb.onDone()
    })
    const callbacks = { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() }

    const result = await runner.run({
      maxRounds: 16,
      tools: [tool],
      systemPrompt: "",
      taskGoal: "持续读取并完成长期任务",
      llmConfig: { ...mockLlmConfig, maxContextSize: 3000 },
      toolResultContextLimit: 1200,
    }, registry, [systemMsg, userMsg], callbacks)

    expect(result.toolCalls).toHaveLength(15)
    expect(tool.execute).toHaveBeenCalledTimes(15)
    expect(injectedToolContents.some((content) => content.includes("工具证据引用"))).toBe(true)
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("merges caller request overrides with tool calling options", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onToken("章节正文")
      cb.onDone()
    })

    const config: AgentConfig = {
      maxRounds: 3,
      tools: [tool],
      systemPrompt: "",
      llmConfig: mockLlmConfig,
      requestOverrides: {
        max_tokens: 8000,
        reasoning: { mode: "off" },
      },
    }

    await runner.run(
      config,
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
    )

    expect(mockStreamChat).toHaveBeenCalledWith(
      mockLlmConfig,
      expect.any(Array),
      expect.any(Object),
      undefined,
      expect.objectContaining({
        max_tokens: 8000,
        reasoning: { mode: "off" },
        tools: expect.any(Array),
        toolChoice: "auto",
      }),
    )
  })

  it("omits tools when functionCallingEnabled is false on llmConfig", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onToken("普通回复")
      cb.onDone()
    })

    await runner.run(
      {
        maxRounds: 3,
        tools: [tool],
        systemPrompt: "",
        llmConfig: { ...mockLlmConfig, functionCallingEnabled: false },
      },
      registry,
      [systemMsg, userMsg],
      { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
    )

    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ functionCallingEnabled: false }),
      expect.any(Array),
      expect.any(Object),
      undefined,
      undefined,
    )
  })

  it("retries once without tools when the API rejects function calling", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    mockStreamChat
      .mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        cb.onError(new Error("This model does not support function calling / tools"))
      })
      .mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        cb.onToken("降级正文")
        cb.onDone()
      })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    const result = await runner.run(
      {
        maxRounds: 3,
        tools: [tool],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
      },
      registry,
      [systemMsg, userMsg],
      callbacks,
      undefined,
    )

    expect(mockStreamChat).toHaveBeenCalledTimes(2)
    expect(mockStreamChat.mock.calls[0][4]).toEqual(expect.objectContaining({
      tools: expect.any(Array),
      toolChoice: "auto",
    }))
    expect(mockStreamChat.mock.calls[1][4]).toBeUndefined()
    expect(result.finalText).toBe("降级正文")
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("emits ModelDoesNotSupportToolsError when tool-less retry still fails", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    mockStreamChat
      .mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        cb.onError(new Error("does not support function calling"))
      })
      .mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        cb.onError(new Error("upstream 500"))
      })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await runner.run(
      {
        maxRounds: 3,
        tools: [tool],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
      },
      registry,
      [systemMsg, userMsg],
      callbacks,
      undefined,
    )

    expect(mockStreamChat).toHaveBeenCalledTimes(2)
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(ModelDoesNotSupportToolsError))
  })

  it("does not treat unrelated unsupported errors as missing function calling", async () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn().mockResolvedValue("Chapter content"),
    }
    registry.register(tool)

    mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onError(new Error("Unsupported parameter: temperature"))
    })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await runner.run(
      {
        maxRounds: 3,
        tools: [tool],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
      },
      registry,
      [systemMsg, userMsg],
      callbacks,
      undefined,
    )

    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Unsupported parameter: temperature",
    }))
  })

  it("retries a reasoning-only model round once with reasoning disabled", async () => {
    const reasoningOnlyError = new Error("模型只输出了 543 字符的思考内容，但没有输出正文。")
    mockStreamChat.mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onError(reasoningOnlyError)
    })
    mockStreamChat.mockImplementationOnce(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
      cb.onToken("章节正文")
      cb.onDone()
    })

    const callbacks = {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    const config: AgentConfig = {
      maxRounds: 3,
      tools: [],
      systemPrompt: "",
      llmConfig: { ...mockLlmConfig, reasoning: { mode: "high" } },
    }

    const result = await runner.run(config, registry, [systemMsg, userMsg], callbacks, undefined)

    expect(mockStreamChat).toHaveBeenCalledTimes(2)
    expect(mockStreamChat.mock.calls[0][4]).toBeUndefined()
    expect(mockStreamChat.mock.calls[1][4]).toEqual({ reasoning: { mode: "off" } })
    expect(result.finalText).toBe("章节正文")
    expect(callbacks.onText).toHaveBeenCalledWith("章节正文")
    expect(callbacks.onDone).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  describe("Stage F 断点保存与清理", () => {
    it("config.projectPath 存在时创建并保存断点", async () => {
      const tool: Tool = {
        name: "read_chapter",
        description: "read",
        category: "read",
        parameters: {},
        execute: vi.fn().mockResolvedValue("章节内容"),
      }
      registry.register(tool)

      let callCount = 0
      mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        callCount++
        if (callCount === 1) {
          cb.onToolCallDelta?.({ index: 0, id: "call_1", name: "read_chapter" })
          cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
          cb.onDone()
        } else {
          cb.onToken("完成")
          cb.onDone()
        }
      })

      const config: AgentConfig = {
        maxRounds: 3,
        tools: [tool],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
        projectPath: "/test",
        taskGoal: "写第一章",
      }
      await runner.run(config, registry, [systemMsg, userMsg], {
        onText: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onToolError: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      })

      expect(breakpointMocks.createTaskBreakpoint).toHaveBeenCalledWith(
        expect.objectContaining({ taskGoal: "写第一章", currentStage: "agent_round_1" })
      )
      expect(breakpointMocks.saveTaskBreakpoint).toHaveBeenCalledWith("/test", expect.any(Object))
      expect(breakpointMocks.updateBreakpointStage).toHaveBeenCalled()
    })

    it("成功完成时清理断点", async () => {
      mockStreamChat.mockImplementation(async (_config: unknown, _msgs: unknown[], cb: StreamCallbacks) => {
        cb.onToken("完成")
        cb.onDone()
      })

      const config: AgentConfig = {
        maxRounds: 3,
        tools: [],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
        projectPath: "/test",
        taskGoal: "写第一章",
      }
      await runner.run(config, registry, [systemMsg, userMsg], {
        onText: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onToolError: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      })

      expect(breakpointMocks.clearTaskBreakpoint).toHaveBeenCalledWith("/test")
    })

    it("失败时保留断点", async () => {
      mockStreamChat.mockRejectedValueOnce(new Error("模型失败"))

      const config: AgentConfig = {
        maxRounds: 3,
        tools: [],
        systemPrompt: "",
        llmConfig: mockLlmConfig,
        projectPath: "/test",
        taskGoal: "写第一章",
      }
      await runner.run(config, registry, [systemMsg, userMsg], {
        onText: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onToolError: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      })

      expect(breakpointMocks.saveTaskBreakpoint).toHaveBeenCalled()
      expect(breakpointMocks.clearTaskBreakpoint).not.toHaveBeenCalled()
    })
  })
})
