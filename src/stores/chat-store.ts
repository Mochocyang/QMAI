import { create } from "zustand"
import type { ChatMessage } from "@/lib/llm-client"
import type { AgentRunRecord, AgentStageTrace } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import type { ContextTrace } from "@/lib/agent/context-trace"
import i18n from "@/i18n"

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  deAiMode: boolean
  selectedDeAiSkillId?: string | null
  inputDraft?: string
}

export interface MessageReference {
  title: string
  path: string
}

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  conversationId: string
  references?: MessageReference[]  // pages cited in this response, saved at creation time
  discarded?: boolean
  agentToolCalls?: AgentRunRecord["toolCalls"]
  agentStages?: AgentStageTrace[]
  isAgentRunning?: boolean
  attachedReferences?: ReferenceToken[]
  contextTrace?: ContextTrace
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: DisplayMessage[]
  /** 按会话 ID 存储流式内容，支持多会话同时生成 */
  streamingContents: Record<string, string>
  pendingReferenceTokens: ReferenceToken[]
  mode: "chat" | "ingest"
  ingestSource: string | null
  maxHistoryMessages: number

  // Conversation management
  createConversation: () => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  renameConversation: (id: string, title: string) => void
  setConversationDeAiMode: (id: string, deAiMode: boolean) => void
  setConversationDeAiSkillId: (id: string, skillId: string | null | undefined) => void
  setConversationInputDraft: (id: string, draft: string) => void

  // Message management
  addMessage: (role: DisplayMessage["role"], content: string) => void
  setMessages: (messages: DisplayMessage[]) => void
  setConversations: (conversations: Conversation[]) => void
  /** 开始指定会话的流式生成 */
  startStreaming: (conversationId: string) => void
  /** 追加 token 到指定会话的流式内容 */
  appendStreamToken: (token: string, conversationId: string) => void
  /** 设置指定会话的流式内容（用于深度模式整体更新） */
  setStreamingContent: (content: string, conversationId: string) => void
  /** 结束指定会话的流式生成，将内容保存为消息 */
  finalizeStream: (content: string, references?: MessageReference[] | undefined, targetConvId?: string) => void
  /** 停止指定会话的流式生成（不保存内容，仅清理状态） */
  clearStreaming: (conversationId: string) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
  setMaxHistoryMessages: (n: number) => void
  removeLastAssistantMessage: () => void  // for regenerate: remove last assistant reply
  markLastAssistantDiscarded: () => void   // for novel draft discard
  enqueueReferenceTokens: (tokens: ReferenceToken[]) => void
  consumePendingReferenceTokens: () => ReferenceToken[]

  // Helpers
  getActiveMessages: () => DisplayMessage[]
  isConversationStreaming: (conversationId: string) => boolean
  getStreamingContent: (conversationId: string) => string
  /** 是否有任何会话正在流式生成 */
  isAnyStreaming: () => boolean
}

let messageCounter = 0

function nextId(): string {
  messageCounter += 1
  return String(messageCounter)
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingContents: {},
  pendingReferenceTokens: [],
  mode: "chat",
  ingestSource: null,
  maxHistoryMessages: 20,

  createConversation: () => {
    const id = generateConversationId()
    const now = Date.now()
    const newConversation: Conversation = {
      id,
      title: i18n.t("chat.newConversation"),
      createdAt: now,
      updatedAt: now,
      deAiMode: false,
      selectedDeAiSkillId: undefined,
      inputDraft: "",
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
    }))
    return id
  },

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id)
      const newActiveId =
        state.activeConversationId === id
          ? (remaining[0]?.id ?? null)
          : state.activeConversationId
      // 清理该会话的流式状态
      const { [id]: _, ...restStreaming } = state.streamingContents
      return {
        conversations: remaining,
        messages: state.messages.filter((m) => m.conversationId !== id),
        activeConversationId: newActiveId,
        streamingContents: restStreaming,
      }
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      ),
    })),

  setConversationDeAiMode: (id, deAiMode) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, deAiMode, updatedAt: Date.now() } : c
      ),
    })),

  setConversationDeAiSkillId: (id, selectedDeAiSkillId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, selectedDeAiSkillId, updatedAt: Date.now() } : c
      ),
    })),

  setConversationInputDraft: (id, draft) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, inputDraft: draft } : c
      ),
    })),

  addMessage: (role, content) =>
    set((state) => {
      const { activeConversationId, conversations } = state
      if (!activeConversationId) return state

      const newMessage: DisplayMessage = {
        id: nextId(),
        role,
        content,
        timestamp: Date.now(),
        conversationId: activeConversationId,
      }

      // Auto-set title from first user message (first 50 chars)
      const convMessages = state.messages.filter(
        (m) => m.conversationId === activeConversationId && m.role === "user"
      )
      const updatedConversations =
        role === "user" && convMessages.length === 0
          ? conversations.map((c) =>
              c.id === activeConversationId
                ? { ...c, title: content.slice(0, 50), updatedAt: Date.now() }
                : c
            )
          : conversations.map((c) =>
              c.id === activeConversationId
                ? { ...c, updatedAt: Date.now() }
                : c
            )

      return {
        messages: [...state.messages, newMessage],
        conversations: updatedConversations,
      }
    }),

  setMessages: (messages) => set({ messages }),

  setConversations: (conversations) => set({ conversations }),

  startStreaming: (conversationId) =>
    set((state) => ({
      streamingContents: {
        ...state.streamingContents,
        [conversationId]: "",
      },
    })),

  appendStreamToken: (token, conversationId) =>
    set((state) => ({
      streamingContents: {
        ...state.streamingContents,
        [conversationId]: (state.streamingContents[conversationId] ?? "") + token,
      },
    })),

  setStreamingContent: (content, conversationId) =>
    set((state) => ({
      streamingContents: {
        ...state.streamingContents,
        [conversationId]: content,
      },
    })),

  finalizeStream: (content, references, targetConvId?: string) =>
    set((state) => {
      const convId = targetConvId ?? state.activeConversationId
      if (!convId) {
        // 无目标会话时不操作，避免清空所有会话的流式状态
        return {}
      }

      const newMessage: DisplayMessage = {
        id: nextId(),
        role: "assistant" as const,
        content,
        timestamp: Date.now(),
        conversationId: convId,
        references,
      }

      // 清理该会话的流式状态
      const { [convId]: _, ...restStreaming } = state.streamingContents

      return {
        streamingContents: restStreaming,
        messages: [...state.messages, newMessage],
        conversations: state.conversations.map((c) =>
          c.id === convId
            ? { ...c, updatedAt: Date.now() }
            : c
        ),
      }
    }),

  clearStreaming: (conversationId) =>
    set((state) => {
      const { [conversationId]: _, ...restStreaming } = state.streamingContents
      return { streamingContents: restStreaming }
    }),

  setMode: (mode) => set({ mode }),

  setIngestSource: (ingestSource) => set({ ingestSource }),

  clearMessages: () =>
    set((state) => ({
      messages: state.messages.filter(
        (m) => m.conversationId !== state.activeConversationId
      ),
    })),

  setMaxHistoryMessages: (maxHistoryMessages) => set({ maxHistoryMessages }),

  removeLastAssistantMessage: () =>
    set((state) => {
      const activeId = state.activeConversationId
      if (!activeId) return state
      const activeMessages = state.messages.filter((m) => m.conversationId === activeId)
      // Find last assistant message
      const lastAssistantIdx = [...activeMessages].reverse().findIndex((m) => m.role === "assistant")
      if (lastAssistantIdx === -1) return state
      const msgToRemove = activeMessages[activeMessages.length - 1 - lastAssistantIdx]
      return {
        messages: state.messages.filter((m) => m.id !== msgToRemove.id),
      }
    }),

  markLastAssistantDiscarded: () =>
    set((state) => {
      const activeId = state.activeConversationId
      if (!activeId) return state
      const activeMessages = state.messages.filter((m) => m.conversationId === activeId)
      const lastAssistantIdx = [...activeMessages].reverse().findIndex((m) => m.role === "assistant")
      if (lastAssistantIdx === -1) return state
      const msgToDiscard = activeMessages[activeMessages.length - 1 - lastAssistantIdx]
      return {
        messages: state.messages.map((m) =>
          m.id === msgToDiscard.id ? { ...m, discarded: true, content: "" } : m
        ),
      }
    }),

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

  getActiveMessages: () => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return []
    return messages.filter((m) => m.conversationId === activeConversationId)
  },

  isConversationStreaming: (conversationId) => {
    return conversationId in get().streamingContents
  },

  getStreamingContent: (conversationId) => {
    return get().streamingContents[conversationId] ?? ""
  },

  isAnyStreaming: () => {
    return Object.keys(get().streamingContents).length > 0
  },
}))

export function chatMessagesToLLM(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}
