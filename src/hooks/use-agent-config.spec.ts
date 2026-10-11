// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { DEFAULT_NOVEL_CONFIG, type LlmConfig, type NovelConfig, type ProviderConfigs, type SearchApiConfig } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { OutlineChatConversation } from "@/stores/outline-chat-store"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkillConfig } from "@/lib/novel/user-skill-store"
import type { UseAgentConfigResult } from "@/hooks/use-agent-config"
import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"
import type { ReasoningDepth } from "@/lib/reasoning-depth"

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
    defaultLlmModel: string
    novelConfig: NovelConfig
    searchApiConfig: SearchApiConfig
    aiWorkflowMode: AiWorkflowMode
    aiChatReasoningDepth: ReasoningDepth
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
  /**
   * 丁-2：`useAgentConfig` 的第 4 个参数（生成时临时覆盖文风）。
   * 传进来是为了让整条 getter 通道能被端到端钉住 —— 从钩子参数一路到
   * `runDeepChapterGeneration` 的输入，中间任何一环断了都会被这条用例抓住。
   */
  getWritingStyleIdOverride?: () => string | null | undefined
} = {}) {
  vi.resetModules()

  const wikiState = {
    aiChatModel: "",
    project: null as WikiProject | null,
    dataVersion: 0,
    llmConfig: baseLlmConfig,
    providerConfigs: {
      openai: {
        enabled: true,
        apiKey: "test-key",
        savedModels: [{ id: "gpt-4o", name: "GPT-4o", model: "gpt-4o", createdAt: 1 }],
      },
    } as ProviderConfigs,
    defaultLlmModel: "",
    novelConfig: { ...DEFAULT_NOVEL_CONFIG },
    searchApiConfig: {
      provider: "none",
      apiKey: "",
      serpApiEngine: "google",
      searXngUrl: "",
      searXngCategories: ["general"],
      providerConfigs: {},
    } as SearchApiConfig,
    novelMode: true,
    aiWorkflowMode: "standard" as AiWorkflowMode,
    aiChatReasoningDepth: "auto" as ReasoningDepth,
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
    providerRequiresApiKey: (provider: SearchApiConfig["provider"]) =>
      provider === "bocha" ||
      provider === "qiniu" ||
      provider === "metaso" ||
      provider === "tavily" ||
      provider === "serpapi",
    webSearch: (...args: unknown[]) => webSearchMock(...args),
  }))

  const { useAgentConfig } = await import("@/hooks/use-agent-config")

  let result: UseAgentConfigResult | null = null
  /**
   * 换一个**新的 getter 身份**并强制重渲染。
   *
   * 为什么需要它：真实的 chat-panel 用
   * `useCallback(() => sessionWritingStyleId, [sessionWritingStyleId])`，
   * 所以「用户选了另一条文风」= **函数身份变了**，而不是同一个函数换了返回值。
   * 只换返回值（闭包内可变变量）测不出依赖数组漏项 —— 旧闭包照样读到新值。
   */
  let swapGetter: ((fn: () => string | null | undefined) => Promise<void>) | null = null

  function TestComponent() {
    const [getterState, setGetterState] = React.useState<{
      fn?: () => string | null | undefined
    }>(() => ({ fn: overrides.getWritingStyleIdOverride }))
    swapGetter = (fn) => act(async () => {
      setGetterState({ fn })
      await flushPromises()
    })
    result = useAgentConfig(systemPrompt, undefined, undefined, getterState.fn)
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
    setWritingStyleGetter: (fn: () => string | null | undefined) => swapGetter!(fn),
    cleanup: () => act(() => {
      root.unmount()
      container.remove()
    }),
  }
}

const webSearchMock = vi.fn()

describe("useAgentConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webSearchMock.mockReset()
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

  it("provider 关闭 Function Calling 时仍返回 config，但 tools 为空", async () => {
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "openai/gpt-4o",
        project: { path: "/tmp/project" } as WikiProject,
        providerConfigs: {
          openai: {
            enabled: true,
            apiKey: "test-key",
            functionCallingEnabled: false,
            savedModels: [{ id: "gpt-4o", name: "GPT-4o", model: "gpt-4o", createdAt: 1 }],
          },
        },
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

    expect(result.config).not.toBeNull()
    expect(result.supportsTools).toBe(false)
    expect(result.config?.tools).toEqual([])
    expect(result.config?.llmConfig.functionCallingEnabled).toBe(false)

    await cleanup()
  }, 15000)

  it("uses the default model for Agent orchestration while preserving the chat model for chapter writing", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        savedModels: [
          { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
          { id: "workflow", name: "Workflow", model: "workflow-model", createdAt: 2 },
        ],
      },
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        defaultLlmModel: "custom/workflow-model",
        novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
        providerConfigs,
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

    expect(result.config?.modelId).toBe("workflow-model")
    expect(result.config?.llmConfig.model).toBe("workflow-model")

    const workflowTool = result.registry.get("run_chapter_workflow")
    const deepChapterModule = await import("@/lib/novel/deep-chapter-generation")
    const runDeepChapterGeneration = vi.mocked(deepChapterModule.runDeepChapterGeneration)
    runDeepChapterGeneration.mockResolvedValueOnce({
      finalContent: "正文",
      taskBrief: "任务书",
      draftContent: "初稿",
      reviewResults: [],
      revised: false,
    })
    await workflowTool?.execute({ userRequest: "写第三章" })
    expect(runDeepChapterGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ llmConfig: expect.objectContaining({ model: "writer-model" }) }),
      expect.any(Object),
      undefined,
      undefined,
    )

    await cleanup()
  }, 15000)

  it("applies the thinking depth to chapter body generation without touching the orchestration model", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        reasoning: { mode: "auto" },
        savedModels: [
          { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
          { id: "workflow", name: "Workflow", model: "workflow-model", createdAt: 2 },
        ],
      },
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        defaultLlmModel: "custom/workflow-model",
        novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
        providerConfigs,
        project: { path: "/tmp/project" } as WikiProject,
        aiChatReasoningDepth: "high",
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

    // The chapter session model also receives the slider depth, so fast mode
    // and direct chapter requests honor the same selection.
    expect(result.config?.llmConfig.model).toBe("workflow-model")
    expect(result.config?.llmConfig.reasoning).toEqual({ mode: "high" })

    const workflowTool = result.registry.get("run_chapter_workflow")
    const deepChapterModule = await import("@/lib/novel/deep-chapter-generation")
    const runDeepChapterGeneration = vi.mocked(deepChapterModule.runDeepChapterGeneration)
    runDeepChapterGeneration.mockResolvedValueOnce({
      finalContent: "正文",
      taskBrief: "任务书",
      draftContent: "初稿",
      reviewResults: [],
      revised: false,
    })
    await workflowTool?.execute({ userRequest: "写第三章" })

    expect(runDeepChapterGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        llmConfig: expect.objectContaining({
          model: "writer-model",
          reasoning: { mode: "high" },
        }),
      }),
      expect.any(Object),
      undefined,
      undefined,
    )

    await cleanup()
  }, 15000)

  it("leaves the chapter writing config untouched at the default depth", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        reasoning: { mode: "custom", budgetTokens: 20000 },
        savedModels: [
          { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
        ],
      },
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        providerConfigs,
        project: { path: "/tmp/project" } as WikiProject,
        aiChatReasoningDepth: "auto",
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

    const workflowTool = result.registry.get("run_chapter_workflow")
    const deepChapterModule = await import("@/lib/novel/deep-chapter-generation")
    const runDeepChapterGeneration = vi.mocked(deepChapterModule.runDeepChapterGeneration)
    runDeepChapterGeneration.mockResolvedValueOnce({
      finalContent: "正文",
      taskBrief: "任务书",
      draftContent: "初稿",
      reviewResults: [],
      revised: false,
    })
    await workflowTool?.execute({ userRequest: "写第三章" })

    expect(runDeepChapterGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        llmConfig: expect.objectContaining({
          reasoning: { mode: "custom", budgetTokens: 20000 },
        }),
      }),
      expect.any(Object),
      undefined,
      undefined,
    )

    await cleanup()
  }, 15000)

  /*
   * 丁-2「文风写作」的**整条 getter 通道**（这是本批唯一一处端到端接线断言）。
   *
   * 通道形状：useAgentConfig 第 4 参数 → buildAgentConfig options →
   * registerAllBuiltInTools(createRunChapterWorkflowTool) → `getWritingStyleIdOverride`
   * → DeepChapterGenerationInput.writingStyleIdOverride。
   *
   * 只测首尾两端（钩子参数 / runDeepChapterGeneration）是**故意**的：
   * 中间任意一环漏传，这里都会红，而单点测试各自都能全绿
   * （本仓库已有过「getter 没有产出者」的死通道先例）。
   *
   * 三态必须分开断言：`null` = 本次不用文风，一旦被 `?? undefined` 抹平，
   * 用户点「不用」反而会用上项目启用的那条 —— 方向正好相反。
   */
  it("把文风覆盖 getter 一路接到章节生成的输入上（含 null 不被抹平）", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        savedModels: [{ id: "writer", name: "Writer", model: "writer-model", createdAt: 1 }],
      },
    }
    let override: string | null | undefined = "style-jia"
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        providerConfigs,
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
      getWritingStyleIdOverride: () => override,
    })

    const workflowTool = result.registry.get("run_chapter_workflow")
    const deepChapterModule = await import("@/lib/novel/deep-chapter-generation")
    const runDeepChapterGeneration = vi.mocked(deepChapterModule.runDeepChapterGeneration)
    const okResult = {
      finalContent: "正文",
      taskBrief: "任务书",
      draftContent: "初稿",
      reviewResults: [],
      revised: false,
    }

    for (const expected of ["style-jia", null, undefined] as const) {
      override = expected
      runDeepChapterGeneration.mockResolvedValueOnce(okResult)
      await workflowTool?.execute({ userRequest: "写第三章" })
      const [input] = runDeepChapterGeneration.mock.calls.at(-1) as unknown as [
        { writingStyleIdOverride?: string | null },
      ]
      expect(input.writingStyleIdOverride, `覆盖值 ${String(expected)} 必须原样到达生成输入`).toBe(expected)
    }

    await cleanup()
  }, 15000)

  /*
   * 依赖数组的守卫（这条是**变异测试逼出来的**：先删掉 `getWritingStyleIdOverride`
   * 依赖，前一条用例依然全绿）。
   *
   * 为什么漏项是**真实缺陷**而不是洁癖：整个 `{ config, registry }` 都在
   * `useAgentConfig` 的同一个 useMemo 里构造，而 chat-panel 的 getter 是
   * `useCallback(..., [sessionWritingStyleId])` —— 用户选了另一条文风后，
   * getter 换了身份。依赖数组漏了它，memo 就返回**上一次**的 registry，
   * 里面那个 run_chapter_workflow 仍抓着**旧闭包** ⇒ 生成用的还是上一次选的文风。
   *
   * 所以这里必须换 getter **身份**（模拟 useCallback 产生新函数），
   * 而不是换闭包里的可变值 —— 后者旧闭包也能读到新值，测不出漏项。
   */
  it("文风 getter 换了身份后，已注册的工具必须读到新值（依赖数组漏了会拿旧闭包）", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        savedModels: [{ id: "writer", name: "Writer", model: "writer-model", createdAt: 1 }],
      },
    }
    const view = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        providerConfigs,
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
      getWritingStyleIdOverride: () => "style-old",
    })

    const deepChapterModule = await import("@/lib/novel/deep-chapter-generation")
    const runDeepChapterGeneration = vi.mocked(deepChapterModule.runDeepChapterGeneration)
    const okResult = {
      finalContent: "正文",
      taskBrief: "任务书",
      draftContent: "初稿",
      reviewResults: [],
      revised: false,
    }
    /*
     * ⚠️ 每次都要重新读 `view.result`。
     *
     * `result` 是 `renderHook` 返回对象上的**取值器**；一旦像
     * `const { result } = await renderHook(...)` 那样解构，拿到的就是
     * **首帧**那份快照，后面的重渲染再也反映不出来 ——
     * 于是这条用例会永远读到旧 registry，即使依赖数组是对的。
     * （实测踩过：正确代码上也全红，报的还是"依赖漏项"。）
     */
    const runOnce = async () => {
      const tool = view.result.registry.get("run_chapter_workflow")
      runDeepChapterGeneration.mockResolvedValueOnce(okResult)
      await tool?.execute({ userRequest: "写第三章" })
      const [input] = runDeepChapterGeneration.mock.calls.at(-1) as unknown as [
        { writingStyleIdOverride?: string | null },
      ]
      return input.writingStyleIdOverride
    }

    expect(await runOnce()).toBe("style-old")

    await view.setWritingStyleGetter(() => "style-new")

    expect(
      await runOnce(),
      "换了 getter 身份后仍读到旧值 ⇒ useAgentConfig 的依赖数组漏了 getWritingStyleIdOverride",
    ).toBe("style-new")

    await view.cleanup()
  }, 15000)

  it("uses the selected chat model for fast-mode conversation output instead of the default agent model", async () => {
    const providerConfigs: ProviderConfigs = {
      custom: {
        enabled: true,
        apiKey: "test-key",
        savedModels: [
          { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
          { id: "workflow", name: "Workflow", model: "workflow-model", createdAt: 2 },
        ],
      },
    }
    const { result, cleanup } = await renderHook("test prompt", {
      wiki: {
        aiChatModel: "custom/writer-model",
        defaultLlmModel: "custom/workflow-model",
        novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
        providerConfigs,
        project: { path: "/tmp/project" } as WikiProject,
        aiWorkflowMode: "fast",
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

    expect(result.config?.modelId).toBe("writer-model")
    expect(result.config?.llmConfig.model).toBe("writer-model")

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
        categories: [],
        skills: [
          {
            id: "skill:three",
            name: "三翻四抖",
            displayName: "三翻四抖",
            description: "三次转折，四次震惊。",
            kind: ["structure", "planning"],
            stages: ["planning", "drafting"],
            modes: ["standard", "strict"],
            content: "每章设置三次局势变化和四次信息冲击。",
            source: "uploaded",
            priority: 50,
            tags: [],
            categoryId: "",
          },
          {
            id: "skill:hidden",
            name: "禁用 Skill",
            displayName: "禁用 Skill",
            description: "",
            kind: ["review"],
            stages: ["review"],
            modes: ["strict"],
            content: "不要进入 AI 会话。",
            source: "uploaded",
            priority: 50,
            tags: [],
            categoryId: "",
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
})
