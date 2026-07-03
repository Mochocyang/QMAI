// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { LlmConfig, ProviderConfigs, SearchApiConfig } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { OutlineChatConversation } from "@/stores/outline-chat-store"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkillConfig } from "@/lib/novel/user-skill-store"
import type { McpConfig } from "@/lib/mcp/config"
import type { UseAgentConfigResult } from "@/hooks/use-agent-config"
import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"

const baseLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "",
  model: "",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
}

interface StoreStates {
  wiki?: Partial<{
    aiChatModel: string
    project: WikiProject | null
    dataVersion: number
    llmConfig: LlmConfig
    providerConfigs: ProviderConfigs
    searchApiConfig: SearchApiConfig
    mcpConfig: McpConfig
    aiWorkflowMode: AiWorkflowMode
  }>
  chat?: Partial<{
    conversations: Conversation[]
    messages: DisplayMessage[]
  }>
  outline?: Partial<{
    conversations: OutlineChatConversation[]
  }>
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderHook(systemPrompt: string, overrides: StoreStates & {
  skillConfig?: DeAiSkillConfig | null
  userSkillConfig?: UserSkillConfig | null
} = {}) {
  vi.resetModules()

  const wikiState = {
    aiChatModel: "",
    project: null as WikiProject | null,
    dataVersion: 0,
    llmConfig: baseLlmConfig,
    providerConfigs: {} as ProviderConfigs,
    searchApiConfig: {
      provider: "none",
      apiKey: "",
      serpApiEngine: "google",
      searXngUrl: "",
      searXngCategories: ["general"],
      providerConfigs: {},
    } as SearchApiConfig,
    mcpConfig: { servers: [] } as McpConfig,
    novelMode: true,
    aiWorkflowMode: "standard" as AiWorkflowMode,
    ...overrides.wiki,
  }

  const chatState = {
    conversations: [] as Conversation[],
    messages: [] as DisplayMessage[],
    ...overrides.chat,
  }

  const outlineState = {
    conversations: [] as OutlineChatConversation[],
    ...overrides.outline,
  }

  const skillConfig = overrides.skillConfig ?? null
  const userSkillConfig = overrides.userSkillConfig ?? {
    version: 1,
    selectedSkillId: null,
    disabledSkillIds: [],
    skills: [],
  }

  vi.doMock("@/stores/wiki-store", () => {
    const mockStore = (selector?: (s: typeof wikiState) => unknown) =>
      selector ? selector(wikiState) : wikiState
    mockStore.getState = () => wikiState
    return {
      useWikiStore: mockStore,
    }
  })

  vi.doMock("@/stores/chat-store", () => ({
    useChatStore: (selector?: (s: typeof chatState) => unknown) =>
      selector ? selector(chatState) : chatState,
  }))

  vi.doMock("@/stores/outline-chat-store", () => ({
    useOutlineChatStore: (selector?: (s: typeof outlineState) => unknown) =>
      selector ? selector(outlineState) : outlineState,
  }))

  vi.doMock("@/lib/novel/de-ai-skill-library", () => ({
    loadDeAiSkillConfig: vi.fn().mockResolvedValue(skillConfig),
  }))

  vi.doMock("@/lib/novel/user-skill-store", async () => {
    const actual = await vi.importActual<typeof import("@/lib/novel/user-skill-store")>(
      "@/lib/novel/user-skill-store",
    )
    return {
      ...actual,
      loadUserSkillConfig: vi.fn().mockResolvedValue(userSkillConfig),
    }
  })

  vi.doMock("@/lib/novel/deep-chapter-generation", () => ({
    runDeepChapterGeneration: vi.fn(),
  }))

  vi.doMock("@/lib/web-search", () => ({
    resolveSearchConfig: (config: SearchApiConfig) => config,
    webSearch: (...args: unknown[]) => webSearchMock(...args),
  }))

  vi.doMock("@/lib/mcp/real-connector", () => ({
    RealMcpConnector: RealMcpConnectorMock,
  }))

  const { useAgentConfig } = await import("@/hooks/use-agent-config")

  let result: UseAgentConfigResult | null = null

  function TestComponent() {
    result = useAgentConfig(systemPrompt)
    return null
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(React.createElement(TestComponent))
    await flushPromises()
  })
  for (let i = 0; result === null && i < 10; i++) {
    await act(async () => {
      await flushPromises()
    })
  }

  return {
    get result() {
      return result!
    },
    cleanup: () => act(() => {
      root.unmount()
      container.remove()
    }),
  }
}

const webSearchMock = vi.fn()
const realMcpCallerMock = vi.fn()
const RealMcpConnectorMock = vi.fn()

describe("useAgentConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webSearchMock.mockReset()
    realMcpCallerMock.mockReset()
    RealMcpConnectorMock.mockReset()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.doUnmock("@/stores/wiki-store")
    vi.doUnmock("@/stores/chat-store")
    vi.doUnmock("@/stores/outline-chat-store")
    vi.doUnmock("@/lib/novel/de-ai-skill-library")
    vi.doUnmock("@/lib/novel/user-skill-store")
    vi.doUnmock("@/lib/novel/deep-chapter-generation")
    vi.doUnmock("@/lib/web-search")
    vi.doUnmock("@/lib/mcp/real-connector")
  })

  it("当 aiChatModel 在不支持列表中时，返回 supportsTools: false 且 config: null", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/o3-mini",
        project: { path: "/tmp/project" } as WikiProject,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    expect(result.supportsTools).toBe(false)
    expect(result.config).toBeNull()
    expect(result.skillConfigLoaded).toBe(false)

    await cleanup()
  }, 15000)

  it("当 project.path 为空时，返回 config: null", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: null,
      },
    })

    expect(result.supportsTools).toBe(true)
    expect(result.config).toBeNull()
    expect(result.skillConfigLoaded).toBe(false)

    await cleanup()
  }, 15000)

  it("当模型支持且项目路径存在时，加载 skill config 后返回非空 config 且 registry 包含内置工具", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    expect(result.supportsTools).toBe(true)
    expect(result.skillConfigLoaded).toBe(true)
    expect(result.config).not.toBeNull()
    expect(result.skillConfig?.defaultSkillId).toBe("built-in:comprehensive")
    expect(result.config?.tools.length).toBeGreaterThan(0)
    expect(result.registry.list().some((tool) => tool.name === "read_chapter")).toBe(true)
    expect(result.registry.list().some((tool) => tool.name === "apply_skill")).toBe(true)

    await cleanup()
  }, 15000)

  it("passes Web Search settings into the web_search agent tool", async () => {
    webSearchMock.mockResolvedValueOnce([])
    const searchApiConfig: SearchApiConfig = {
      provider: "tavily",
      apiKey: "search-key",
      serpApiEngine: "google",
      searXngUrl: "",
      searXngCategories: ["general"],
      providerConfigs: {},
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
        searchApiConfig,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    const tool = result.registry.get("web_search")
    expect(tool).toBeDefined()

    await tool?.execute({ query: "黄蓉", maxResults: 2 })

    expect(webSearchMock).toHaveBeenCalledWith("黄蓉", searchApiConfig, 2)

    await cleanup()
  }, 15000)

  it("loads enabled writing skills for AI chat and excludes disabled skills", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
      userSkillConfig: {
        version: 1,
        selectedSkillId: "skill:three",
        disabledSkillIds: ["skill:hidden"],
        skills: [
          {
            id: "skill:three",
            name: "三翻四抖",
            description: "三次转折，四次震惊。",
            kind: ["structure", "planning"],
            stages: ["planning", "drafting"],
            modes: ["standard", "strict"],
            content: "每章设置三次局势变化和四次信息冲击。",
            source: "uploaded",
          },
          {
            id: "skill:hidden",
            name: "禁用 Skill",
            description: "",
            kind: ["review"],
            stages: ["review"],
            modes: ["strict"],
            content: "不要进入 AI 会话。",
            source: "uploaded",
          },
        ],
      },
    })

    expect(result.skillConfigLoaded).toBe(true)
    expect(result.writingSkills).toHaveLength(1)
    expect(result.writingSkills[0]).toMatchObject({
      id: "skill:three",
      name: "三翻四抖",
      source: "uploaded",
    })

    await cleanup()
  }, 15000)

  it("passes enabled MCP config into agent tools and exposes MCP capabilities", async () => {
    const mcpConfig: McpConfig = {
      servers: [{
        id: "graph",
        name: "Knowledge Graph",
        enabled: true,
        tools: [{
          serverId: "graph",
          serverName: "Knowledge Graph",
          name: "query_graph",
          description: "Query graph",
          operation: "read",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Query" } },
            required: ["query"],
          },
        }],
      }],
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
        mcpConfig,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    expect(result.registry.has("mcp_graph_query_graph")).toBe(true)
    expect(result.config?.tools.some((tool) => tool.name === "mcp_graph_query_graph")).toBe(true)
    expect(result.mcpCapabilities).toContainEqual(expect.objectContaining({
      kind: "mcp_tool",
      toolName: "mcp_graph_query_graph",
      source: "mcp",
    }))
    expect(result.mcpWarnings).toEqual([])

    await cleanup()
  }, 15000)

  it("passes chapter workflow dependencies into the agent tool registry", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
        aiWorkflowMode: "strict",
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    expect(result.registry.has("run_chapter_workflow")).toBe(true)
    expect(result.config?.tools.some((tool) => tool.name === "run_chapter_workflow")).toBe(true)

    await cleanup()
  }, 15000)

  it("MCP server 含 command 时注入 RealMcpConnector caller", async () => {
    realMcpCallerMock.mockResolvedValue({
      status: "ok",
      content: "真实 MCP 结果",
      summary: "真实 MCP 结果",
    })
    RealMcpConnectorMock.mockImplementation(function (this: { caller: unknown }) {
      this.caller = realMcpCallerMock
    })

    const mcpConfig: McpConfig = {
      servers: [{
        id: "graph",
        name: "Knowledge Graph",
        enabled: true,
        command: "node",
        args: ["server.js"],
        tools: [{
          serverId: "graph",
          serverName: "Knowledge Graph",
          name: "query_graph",
          description: "Query graph",
          operation: "read",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Query" } },
            required: ["query"],
          },
        }],
      }],
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
        mcpConfig,
      },
      skillConfig: {
        version: 1,
        defaultSkillId: "built-in:comprehensive",
        disabledSkillIds: [],
        projectSkills: [],
        builtInSkillOverrides: [],
        lastChapterDeAiSkillId: null,
      },
    })

    await result.registry.get("mcp_graph_query_graph")?.execute({ query: "主角" })

    expect(RealMcpConnectorMock).toHaveBeenCalledWith(mcpConfig)
    expect(realMcpCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "graph", toolName: "query_graph" }),
      { query: "主角" },
      undefined,
    )

    await cleanup()
  }, 15000)
})
