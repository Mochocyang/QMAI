import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { vi } from "vitest"
import type { TaskBreakpoint } from "@/lib/agent/task-breakpoint"

const wikiState = {
  project: { path: "C:/QMAI_C/QMAI-main", name: "测试项目" },
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
  mcpConfig: { servers: [] },
  bindingVersion: 0,
  aiChatModel: "openai/gpt-4o",
  chatEditModeEnabled: false,
  selectedFile: null,
  aiWorkflowMode: "standard",
  planExecuteEnabled: false,
  deepChapterEnabled: false,
  chatDockPosition: "right",
  novelConfig: { contextTokenBudget: 0 },
  setActiveView: vi.fn(),
  setAiChatModel: vi.fn(),
  setAiWorkflowMode: vi.fn(),
  setPlanExecuteEnabled: vi.fn(),
  setChatEditModeEnabled: vi.fn(),
  setDeepChapterEnabled: vi.fn(),
  setChatDockPosition: vi.fn(),
  setSelectedFile: vi.fn(),
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
  useAgentConfig: (systemPrompt: string) => ({
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
    mcpCapabilities: [],
    mcpWarnings: [],
  }),
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
  writeFileAtomic: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
}))

vi.mock("@/lib/project-refresh", () => ({
  refreshProjectState: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-store", () => ({
  saveAiChatModel: vi.fn(async () => {}),
}))

import { ChatPanel } from "@/components/chat/chat-panel"
import { useChatStore } from "@/stores/chat-store"

export interface RenderChatPanelOptions {
  activeConversation?: boolean
  agentSkillConfig?: typeof defaultAgentSkillConfig | null
  taskBreakpoint?: TaskBreakpoint | null
}

export async function renderChatPanel(options: RenderChatPanelOptions = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockAgentSkillConfig = options.agentSkillConfig === undefined
    ? defaultAgentSkillConfig
    : options.agentSkillConfig
  mockTaskBreakpoint = options.taskBreakpoint ?? null

  const activeConversationId = options.activeConversation ? "conv_mount" : null
  useChatStore.setState({
    conversations: activeConversationId
      ? [{
          id: activeConversationId,
          title: "测试会话",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deAiMode: false,
          inputDraft: "",
        }]
      : [],
    activeConversationId,
    messages: [],
    streamingContents: {},
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
