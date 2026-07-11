import { create } from "zustand"
import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import { useWikiStore } from "@/stores/wiki-store"
import type { IntentClarityResult } from "@/lib/novel/outline-intent-clarity"
import type { NextStepRecommendation } from "@/lib/novel/outline-next-step"
import {
  canStartConversationRun as canStartRun,
  failConversationRun as createFailedRunState,
  finishConversationRun as createFinishedRunState,
  normalizeLoadedRunStates,
  stopConversationRun as createStoppedRunState,
  type ConversationRunStates,
} from "@/lib/conversation-run-state"

export type OutlineMultiAgentStatus =
  | "planning"
  | "running"
  | "merging"
  | "fallback"
  | "done"
  | "error"

export type OutlineMultiAgentStepStatus =
  | "pending"
  | "waiting"
  | "retrying"
  | "running"
  | "done"
  | "error"
  | "skipped"

export interface OutlineMultiAgentItemState {
  id: string
  name: string
  kind: string
  skillNames: string[]
  taskPrompt: string
  dimension?: string
  dependencies?: string[]
  priority?: number
  finalReview?: boolean
  retryCount?: number
  status: OutlineMultiAgentStepStatus
  summary?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface OutlineMultiAgentRunState {
  mode: "multi-agent" | "single-agent-fallback"
  status: OutlineMultiAgentStatus
  maxConcurrency: number
  agents: OutlineMultiAgentItemState[]
  merge?: {
    status: OutlineMultiAgentStepStatus
    summary?: string
    error?: string
    startedAt?: number
    finishedAt?: number
  }
  fallbackReason?: string
  failureDetails?: string[]
}

export interface OutlineChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: string[]
  agentToolCalls?: AgentRunRecord["toolCalls"]
  multiAgentRun?: OutlineMultiAgentRunState
  showThinkingProcess?: boolean
  isAgentRunning?: boolean
  attachedReferences?: ReferenceToken[]
  intentPhase?: "intent_analysis" | "generation" | "waiting_user_input"
  intentClarityResult?: IntentClarityResult | null
  nextStepRecommendation?: NextStepRecommendation | null
}

export interface OutlineChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: OutlineChatMessage[]
  modelId?: string
  contextSummary?: string
}

interface OutlineChatState {
  conversations: OutlineChatConversation[]
  activeConversationId: string | null
  streamingContents: Record<string, string>
  runStates: ConversationRunStates
  loaded: boolean
  pendingReferenceTokens: ReferenceToken[]

  createConversation: () => string
  setActiveConversation: (id: string | null) => void
  addMessage: (convId: string, msg: OutlineChatMessage) => void
  replaceLastAssistant: (convId: string, content: string, sources?: string[]) => void
  removeLastMessage: (convId: string) => void
  deleteConversation: (id: string) => void
  setConversationModel: (id: string, modelId: string) => void
  setConversationContextSummary: (id: string, contextSummary: string) => void
  setStreamingContent: (conversationId: string, content: string) => void
  appendStreamingContent: (conversationId: string, content: string) => void
  clearStreamingContent: (conversationId: string) => void
  getStreamingContent: (conversationId: string) => string
  startConversationRun: (id: string, runId: string) => boolean
  finishConversationRun: (id: string, activeId: string | null, runId: string) => void
  failConversationRun: (id: string, error: string, runId: string) => void
  stopConversationRun: (id: string, runId: string) => void
  canStartConversationRun: (id: string) => boolean
  enqueueReferenceTokens: (tokens: ReferenceToken[]) => void
  consumePendingReferenceTokens: () => ReferenceToken[]
  loadFromDisk: () => Promise<void>
  saveToDisk: () => Promise<void>
}

function getStoragePath(): string | null {
  const project = useWikiStore.getState().project
  if (!project?.path) return null
  return `${normalizePath(project.path)}/.qmai/outline-chats.json`
}

export const useOutlineChatStore = create<OutlineChatState>((set, get) => {
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let loadGeneration = 0

  const scheduleSave = () => {
    const path = getStoragePath()
    if (!path) return
    const state = get()
    const data = {
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      runStates: state.runStates,
    }
    const existingTimer = saveTimers.get(path)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      saveTimers.delete(path)
      void doSave(path, data)
    }, 500)
    saveTimers.set(path, timer)
  }

  const doSave = async (path = getStoragePath(), data?: {
    conversations: OutlineChatConversation[]
    activeConversationId: string | null
    runStates: ConversationRunStates
  }) => {
    if (!path) return
    const state = get()
    const snapshot = data ?? {
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      runStates: state.runStates,
    }
    try {
      const dir = path.replace(/[/\\][^/\\]+$/, "")
      await createDirectory(dir)
      await writeFile(path, JSON.stringify(snapshot, null, 2))
    } catch {
    }
  }

  return {
  conversations: [],
  activeConversationId: null,
  streamingContents: {},
  runStates: {},
  loaded: false,
  pendingReferenceTokens: [],

  createConversation: () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const conv: OutlineChatConversation = {
      id,
      title: `大纲对话 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: id,
    }))
    scheduleSave()
    return id
  },

  setActiveConversation: (id) => {
    set((state) => {
      const runState = id ? state.runStates[id] : undefined
      return {
        activeConversationId: id,
        runStates: id && runState?.status === "completed_unread"
          ? { ...state.runStates, [id]: createStoppedRunState() }
          : state.runStates,
      }
    })
    scheduleSave()
  },

  addMessage: (convId, msg) => {
    const now = Date.now()
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, msg], updatedAt: now } : c
      ),
    }))
    scheduleSave()
  },

  replaceLastAssistant: (convId, content, sources) => {
    const now = Date.now()
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId) return c
        const msgs = [...c.messages]
        const lastIdx = msgs.length - 1
        if (lastIdx >= 0 && msgs[lastIdx].role === "assistant") {
          msgs[lastIdx] = { ...msgs[lastIdx], content, sources }
        } else {
          msgs.push({ id: crypto.randomUUID(), role: "assistant", content, sources })
        }
        const firstUser = msgs.find((m) => m.role === "user")
        const title = firstUser ? firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? "..." : "") : c.title
        return { ...c, messages: msgs, title, updatedAt: now }
      }),
    }))
    scheduleSave()
  },

  removeLastMessage: (convId) => {
    const now = Date.now()
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.slice(0, -1), updatedAt: now } : c
      ),
    }))
    scheduleSave()
  },

  deleteConversation: (id) => {
    set((s) => {
      const { [id]: _stream, ...streamingContents } = s.streamingContents
      const { [id]: _run, ...runStates } = s.runStates
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        streamingContents,
        runStates,
      }
    })
    scheduleSave()
  },

  setConversationModel: (id, modelId) => {
    const now = Date.now()
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, modelId, updatedAt: now } : c
      ),
    }))
    scheduleSave()
  },

  setConversationContextSummary: (id, contextSummary) => {
    const now = Date.now()
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, contextSummary, updatedAt: now } : c
      ),
    }))
    scheduleSave()
  },

  setStreamingContent: (conversationId, content) => set((state) => ({
    streamingContents: { ...state.streamingContents, [conversationId]: content },
  })),
  appendStreamingContent: (conversationId, content) => set((state) => ({
    streamingContents: {
      ...state.streamingContents,
      [conversationId]: (state.streamingContents[conversationId] ?? "") + content,
    },
  })),
  clearStreamingContent: (conversationId) => set((state) => {
    const { [conversationId]: _, ...streamingContents } = state.streamingContents
    return { streamingContents }
  }),
  getStreamingContent: (conversationId) => get().streamingContents[conversationId] ?? "",
  startConversationRun: (id, runId) => {
    if (!get().conversations.some((conversation) => conversation.id === id)) return false
    if (!canStartRun(get().runStates, id)) return false
    set((state) => ({ runStates: { ...state.runStates, [id]: { status: "running", updatedAt: Date.now(), runId } } }))
    scheduleSave()
    return true
  },
  finishConversationRun: (id, activeId, runId) => {
    set((state) => {
      const current = state.runStates[id]
      if (!state.conversations.some((conversation) => conversation.id === id)) return state
      if (current?.status !== "running" || current.runId !== runId) return state
      return { runStates: { ...state.runStates, [id]: createFinishedRunState(id, activeId) } }
    })
    scheduleSave()
  },
  failConversationRun: (id, error, runId) => {
    set((state) => {
      const current = state.runStates[id]
      if (!state.conversations.some((conversation) => conversation.id === id)) return state
      if (current?.status !== "running" || current.runId !== runId) return state
      return { runStates: { ...state.runStates, [id]: createFailedRunState(error) } }
    })
    scheduleSave()
  },
  stopConversationRun: (id, runId) => {
    set((state) => {
      const current = state.runStates[id]
      if (current?.status !== "running" || current.runId !== runId) return state
      return { runStates: { ...state.runStates, [id]: createStoppedRunState() } }
    })
    scheduleSave()
  },
  canStartConversationRun: (id) => get().conversations.some((conversation) => conversation.id === id) && canStartRun(get().runStates, id),
  enqueueReferenceTokens: (tokens) => {
    if (tokens.length === 0) return
    set((state) => ({
      pendingReferenceTokens: [...state.pendingReferenceTokens, ...tokens],
    }))
  },
  consumePendingReferenceTokens: () => {
    const tokens = get().pendingReferenceTokens
    set({ pendingReferenceTokens: [] })
    return tokens
  },

  loadFromDisk: async () => {
    const generation = ++loadGeneration
    const path = getStoragePath()
    if (!path) {
      set({
        conversations: [], activeConversationId: null, runStates: {}, streamingContents: {},
        pendingReferenceTokens: [], loaded: true,
      })
      return
    }
    try {
      const content = await readFile(path)
      if (generation !== loadGeneration || getStoragePath() !== path) return
      const data = JSON.parse(content) as {
        conversations: OutlineChatConversation[]
        activeConversationId: string | null
        runStates?: ConversationRunStates
      }
      const conversations = (data.conversations ?? []).map((conversation) => ({
        ...conversation,
        updatedAt: conversation.updatedAt ?? conversation.createdAt ?? Date.now(),
      }))
      const conversationIds = new Set(conversations.map((conversation) => conversation.id))
      const runStates = Object.fromEntries(
        Object.entries(normalizeLoadedRunStates(data.runStates)).filter(([id]) => conversationIds.has(id)),
      )
      const activeConversationId = data.activeConversationId && conversationIds.has(data.activeConversationId)
        ? data.activeConversationId
        : null
      set({
        conversations,
        activeConversationId,
        runStates,
        streamingContents: {},
        pendingReferenceTokens: [],
        loaded: true,
      })
    } catch {
      if (generation !== loadGeneration || getStoragePath() !== path) return
      set({
        conversations: [], activeConversationId: null, runStates: {}, streamingContents: {},
        pendingReferenceTokens: [], loaded: true,
      })
    }
  },

  saveToDisk: async () => {
    const path = getStoragePath()
    if (!path) return
    const timer = saveTimers.get(path)
    if (timer) {
      clearTimeout(timer)
      saveTimers.delete(path)
    }
    await doSave(path)
  },
}})
