import { describe, expect, it, vi } from "vitest"
import { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, Tool } from "./types"
import { runAiChatSession } from "./ai-chat-session"

const agentConfig: AgentConfig = {
  maxRounds: 3,
  tools: [],
  systemPrompt: "system",
  llmConfig: {
    provider: "custom",
    apiKey: "test-key",
    model: "test-model",
    ollamaUrl: "",
    customEndpoint: "https://example.test/v1",
    maxContextSize: 120000,
  },
}

describe("runAiChatSession", () => {
  it("runs the ReAct AgentRunner for chapter writing instead of bypassing to workflow", async () => {
    const registry = new ToolRegistry()
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "生成第3章" },
    ]
    const agentRunner = {
      run: vi.fn(async () => ({ toolCalls: [], roundsUsed: 1, finalText: "正文" })),
    }
    const callbacks = {
      onText: vi.fn(),
      onToolEvent: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    const result = await runAiChatSession({
      userMessage: "生成第3章",
      projectPath: "/project",
      agentConfig,
      registry,
      messages,
      callbacks,
      agentRunner,
    })

    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "/project",
        taskGoal: "生成第3章",
      }),
      registry,
      messages,
      expect.objectContaining({
        onText: callbacks.onText,
        onToolEvent: callbacks.onToolEvent,
        onDone: callbacks.onDone,
        onError: callbacks.onError,
      }),
      undefined,
    )
    expect(result.finalText).toBe("正文")
  })

  it("scopes visible tools to selected capability names before invoking AgentRunner", async () => {
    const registry = new ToolRegistry()
    const readTool: Tool = {
      name: "read_chapter",
      description: "read",
      category: "read",
      parameters: {},
      execute: vi.fn(async () => "chapter"),
    }
    const writeTool: Tool = {
      name: "write_chapter",
      description: "write",
      category: "write",
      parameters: {},
      execute: vi.fn(async () => "draft"),
    }
    const messages: AgentMessage[] = [{ role: "user", content: "生成第3章" }]
    const agentRunner = {
      run: vi.fn(async (_config: AgentConfig) => ({ toolCalls: [], roundsUsed: 1, finalText: "正文" })),
    }
    const callbacks = {
      onText: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await runAiChatSession({
      userMessage: "生成第3章",
      agentConfig: {
        ...agentConfig,
        tools: [readTool, writeTool],
      },
      registry,
      messages,
      callbacks,
      enabledToolNames: ["read_chapter"],
      agentRunner,
    })

    const passedConfig = agentRunner.run.mock.calls[0][0] as AgentConfig
    expect(passedConfig.tools.map((tool) => tool.name)).toEqual(["read_chapter"])
    expect(agentConfig.tools).toEqual([])
  })

  it("forwards activity callbacks to AgentRunner", async () => {
    const registry = new ToolRegistry()
    const messages: AgentMessage[] = [{ role: "user", content: "生成第3章" }]
    const agentRunner = {
      run: vi.fn(async () => ({ toolCalls: [], roundsUsed: 1, finalText: "正文" })),
    }
    const callbacks = {
      onText: vi.fn(),
      onToolEvent: vi.fn(),
      onActivityEvent: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }

    await runAiChatSession({
      userMessage: "生成第3章",
      agentConfig,
      registry,
      messages,
      callbacks,
      agentRunner,
    })

    const passedCallbacks = (agentRunner.run.mock.calls[0] as unknown[])[3]
    expect(passedCallbacks).toMatchObject({
      onActivityEvent: callbacks.onActivityEvent,
    })
  })
})
