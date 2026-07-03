import { describe, expect, it, vi, beforeEach } from "vitest"
import { AgentRunner } from "./runner"
import { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage } from "./types"
import type { Tool } from "./types"
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

    expect(tool.execute).toHaveBeenCalledWith({ name: "ch1" }, undefined)
    expect(callbacks.onToolCall).toHaveBeenCalledOnce()
    expect(callbacks.onToolResult).toHaveBeenCalledOnce()
    expect(result.finalText).toBe("Got it!")
    expect(result.roundsUsed).toBe(2)
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
