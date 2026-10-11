import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { vi } from "vitest"
import type { TaskBreakpoint } from "@/lib/agent/task-breakpoint"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { ConversationRunStates } from "@/lib/conversation-run-state"

const wikiState = {
  project: { id: "mount-spec-project", path: "C:/QMAI_C/QMAI-main", name: "测试项目" },
  novelMode: true,
  dataVersion: 0,
  llmConfig: {
    provider: "openai",
    apiKey: "",
    model: "test-model",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 8192,
  },
  providerConfigs: {},
  searchApiConfig: { provider: "none", providerConfigs: {} },
  bindingVersion: 0,
  aiChatModel: "openai/gpt-4o",
  chatEditModeEnabled: false,
  selectedFile: null,
  aiWorkflowMode: "standard",
  planExecuteEnabled: false,
  novelConfig: { contextTokenBudget: 0 },
  setActiveView: vi.fn(),
  setAiChatModel: vi.fn(),
  setAiWorkflowMode: vi.fn(),
  setPlanExecuteEnabled: vi.fn(),
  setChatEditModeEnabled: vi.fn(),
  setSelectedFile: vi.fn(),
  // 丙-4c：分步引导教程在「显示即记 seen」时要写 novelConfig。
  setNovelConfig: vi.fn(),
}

const mockRegistry = {
  get: vi.fn(),
  has: vi.fn(() => false),
  list: vi.fn(() => []),
  register: vi.fn(),
}

const defaultAgentSkillConfig = {
  version: 1,
  defaultSkillId: "built-in:comprehensive",
  disabledSkillIds: [],
  projectSkills: [],
  builtInSkillOverrides: [],
  lastChapterDeAiSkillId: null,
}

let mockAgentSkillConfig: typeof defaultAgentSkillConfig | null = defaultAgentSkillConfig
let mockTaskBreakpoint: TaskBreakpoint | null = null
/**
 * `useAgentConfig` 每次调用的**完整实参**（最新的在最后）。
 *
 * 用途：丁-2 的「产出端」用例必须能问到「chat-panel 到底把什么 getter 交出去了」——
 * 只看界面上的标签变了证明不了 getter 的返回值也跟着变
 * （产出方与消费方是两件事，本仓库已经有过「getter 没有产出者」的死通道）。
 * 每次 `renderChatPanel` 会清空，避免跨用例串味。
 */
export const agentConfigArgs: unknown[][] = []

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
  }),
}))

vi.mock("@/stores/wiki-store", () => {
  const useWikiStore = (selector?: (state: typeof wikiState) => unknown) =>
    selector ? selector(wikiState) : wikiState
  useWikiStore.getState = () => wikiState
  return { useWikiStore }
})

vi.mock("@/stores/outline-chat-store", () => ({
  useOutlineChatStore: (selector?: (state: { conversations: unknown[] }) => unknown) => {
    const state = { conversations: [] }
    return selector ? selector(state) : state
  },
}))

vi.mock("@/hooks/use-agent-config", () => ({
  useAgentConfig: (...args: unknown[]) => {
    agentConfigArgs.push(args)
    const systemPrompt = args[0] as string
    return {
      config: {
        maxRounds: 3,
        tools: [],
        systemPrompt,
        llmConfig: wikiState.llmConfig,
      },
      registry: mockRegistry,
      supportsTools: true,
      skillConfigLoaded: true,
      skillConfig: mockAgentSkillConfig,
      writingSkills: [],
    }
  },
}))

vi.mock("@/components/chat/chat-shared", () => ({
  useSourceFiles: () => [],
  getLastQueryPages: () => [],
}))

vi.mock("@/lib/novel/story-simulation/framework-binding", () => ({
  loadBinding: vi.fn(async () => null),
}))

vi.mock("@/lib/novel/story-simulation/framework-store", () => ({
  loadFrameworks: vi.fn(async () => []),
}))

vi.mock("@/lib/agent/task-breakpoint", () => ({
  loadTaskBreakpoint: vi.fn(async () => mockTaskBreakpoint),
  clearTaskBreakpoint: vi.fn(async () => {}),
  buildBreakpointResumePrompt: vi.fn(() => "恢复提示词"),
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(async (_config, _messages, callbacks) => {
    callbacks?.onToken?.("测试回复")
    callbacks?.onDone?.()
  }),
}))

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  fileExists: vi.fn(async () => false),
  getFileSize: vi.fn(async () => 0),
  writeFileAtomic: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
}))

vi.mock("@/lib/project-refresh", () => ({
  refreshProjectState: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-store", () => ({
  saveAiChatModel: vi.fn(async () => {}),
  saveAiWorkflowMode: vi.fn(async () => {}),
  // 丙-4c：分步引导教程在「显示即记 seen」时会写这一项。
  saveNovelConfig: vi.fn(async () => {}),
}))

import { ChatPanel } from "@/components/chat/chat-panel"
import { useChatStore } from "@/stores/chat-store"

interface RenderChatPanelOptions {
  activeConversation?: boolean
  activeConversationId?: string | null
  conversations?: Conversation[]
  messages?: DisplayMessage[]
  runStates?: ConversationRunStates
  agentSkillConfig?: typeof defaultAgentSkillConfig | null
  taskBreakpoint?: TaskBreakpoint | null
  /**
   * 会话执行模式。丁-3 的用例传 `"fast"`：快速模式不跑 novel pre-plugin 链
   * （`shouldRunNovelPrePluginChain` 的第一项），用例不再依赖真实的上下文装配，
   * 既快又不会因为磁盘 mock 的细节而变红。不传时保持 `"standard"`（原有行为）。
   */
  aiWorkflowMode?: "fast" | "standard" | "strict"
}

export async function renderChatPanel(options: RenderChatPanelOptions = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = vi.fn()
  mockAgentSkillConfig = options.agentSkillConfig === undefined
    ? defaultAgentSkillConfig
    : options.agentSkillConfig
  mockTaskBreakpoint = options.taskBreakpoint ?? null
  wikiState.aiWorkflowMode = options.aiWorkflowMode ?? "standard"
  agentConfigArgs.length = 0

  const activeConversationId = options.activeConversationId !== undefined
    ? options.activeConversationId
    : options.activeConversation ? "conv_mount" : null
  const conversations = options.conversations ?? (activeConversationId
    ? [{
        id: activeConversationId,
        title: "测试会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deAiMode: false,
        inputDraft: "",
      }]
    : [])
  useChatStore.setState({
    conversations,
    activeConversationId,
    messages: options.messages ?? [],
    streamingContents: {},
    runStates: options.runStates ?? {},
    pendingReferenceTokens: [],
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root

  await act(async () => {
    root = createRoot(container)
    root.render(React.createElement(ChatPanel))
  })

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}
