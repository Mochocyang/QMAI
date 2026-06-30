// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { OutlineChatConversation } from "@/stores/outline-chat-store"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UseAgentConfigResult } from "@/hooks/use-agent-config"

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

async function renderHook(systemPrompt: string, overrides: StoreStates & { skillConfig?: DeAiSkillConfig | null } = {}) {
  vi.resetModules()

  const wikiState = {
    aiChatModel: "",
    project: null as WikiProject | null,
    dataVersion: 0,
    llmConfig: baseLlmConfig,
    providerConfigs: {} as ProviderConfigs,
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

  vi.doMock("@/stores/wiki-store", () => ({
    useWikiStore: (selector?: (s: typeof wikiState) => unknown) =>
      selector ? selector(wikiState) : wikiState,
  }))

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

  const { useAgentConfig } = await import("@/hooks/use-agent-config")

  let result: UseAgentConfigResult | null = null

  function TestComponent() {
    result = useAgentConfig(systemPrompt)
    return null
  }

  const container = document.createElement("div")
  const root = createRoot(container)

  await act(async () => {
    root.render(React.createElement(TestComponent))
    await flushPromises()
  })

  return {
    get result() {
      return result!
    },
    cleanup: () => act(() => root.unmount()),
  }
}

describe("useAgentConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.doUnmock("@/stores/wiki-store")
    vi.doUnmock("@/stores/chat-store")
    vi.doUnmock("@/stores/outline-chat-store")
    vi.doUnmock("@/lib/novel/de-ai-skill-library")
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
  })

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
  })

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
    expect(result.config?.tools.length).toBeGreaterThan(0)
    expect(result.registry.list().some((tool) => tool.name === "read_chapter")).toBe(true)
    expect(result.registry.list().some((tool) => tool.name === "apply_skill")).toBe(true)

    await cleanup()
  })
})
