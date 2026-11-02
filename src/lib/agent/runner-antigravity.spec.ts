import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentRunner } from "./runner"
import { ToolRegistry } from "./registry"
import type { AgentMessage, Tool } from "./types"
import type { StreamCallbacks } from "../llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("./task-breakpoint", () => ({
  createTaskBreakpoint: vi.fn(() => ({ taskId: "t", taskGoal: "t", completedStages: [], currentStage: "", usedSkills: [], usedTools: [], searches: [], createdAt: 0, updatedAt: 0 })),
  updateBreakpointStage: vi.fn((bp) => bp),
  saveTaskBreakpoint: vi.fn(async () => {}),
  clearTaskBreakpoint: vi.fn(async () => {}),
  buildBreakpointResumePrompt: vi.fn(() => ""),
}))

const mockStreamChat = vi.fn()
vi.mock("../llm-client", () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
  isOutputTruncatedError: () => false,
}))

const cancelMock = vi.fn(async (_ids: string[]) => {})
vi.mock("@/lib/antigravity-agent-proxy", () => ({
  cancelAntigravityToolCalls: (ids: string[]) => cancelMock(ids),
}))

const llm = (provider: LlmConfig["provider"]): LlmConfig => ({
  provider, apiKey: "", model: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128000,
})

describe("AgentRunner with Antigravity CLI", () => {
  beforeEach(() => {
    mockStreamChat.mockReset()
    cancelMock.mockClear()
  })

  it("ends parked agy tool calls when the run stops at the round limit", async () => {
    const registry = new ToolRegistry()
    const tool: Tool = { name: "list_chapters", description: "list", category: "read", parameters: {}, execute: vi.fn().mockResolvedValue("第1章") }
    registry.register(tool)
    mockStreamChat.mockImplementation(async (_c: unknown, _m: unknown, cb: StreamCallbacks) => {
      cb.onToolCallDelta?.({ index: 0, id: `call_${mockStreamChat.mock.calls.length}`, name: "list_chapters" })
      cb.onToolCallDelta?.({ index: 0, arguments: "{}" })
      cb.onDone()
    })
    const callbacks = { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    const messages: AgentMessage[] = [{ role: "user", content: "列章节" }]
    await new AgentRunner().run({ maxRounds: 2, tools: [tool], systemPrompt: "", llmConfig: llm("antigravity-cli") }, registry, messages, callbacks)
    expect(callbacks.onError).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalledWith(["call_1", "call_2"])
  })

  it("does not touch the agy proxy for other providers", async () => {
    const registry = new ToolRegistry()
    mockStreamChat.mockImplementation(async (_c: unknown, _m: unknown, cb: StreamCallbacks) => {
      cb.onToken("完成")
      cb.onDone()
    })
    const callbacks = { onText: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onToolError: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await new AgentRunner().run({ maxRounds: 2, tools: [], systemPrompt: "", llmConfig: llm("openai") }, registry, [{ role: "user", content: "hi" }], callbacks)
    expect(cancelMock).not.toHaveBeenCalled()
  })
})
