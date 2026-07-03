import { create } from "zustand"
import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import { useWikiStore } from "@/stores/wiki-store"

export interface OutlineChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: string[]
  agentToolCalls?: AgentRunRecord["toolCalls"]
  isAgentRunning?: boolean
  attachedReferences?: ReferenceToken[]
}

export interface OutlineChatConversation {
  id: string
  title: string
  createdAt: number
  messages: OutlineChatMessage[]
  modelId?: string
}

interface OutlineChatState {
  conversations: OutlineChatConversation[]
  activeConversationId: string | null
  streamingContent: string
  isStreaming: boolean
  loaded: boolean

  createConversation: () => string
  setActiveConversation: (id: string | null) => void
  addMessage: (convId: string, msg: OutlineChatMessage) => void
  replaceLastAssistant: (convId: string, content: string, sources?: string[]) => void
  removeLastMessage: (convId: string) => void
  deleteConversation: (id: string) => void
  setConversationModel: (id: string, modelId: string) => void
  setStreamingContent: (content: string) => void
  setIsStreaming: (value: boolean) => void
  loadFromDisk: () => Promise<void>
  saveToDisk: () => Promise<void>
}

function getStoragePath(): string | null {
  const project = useWikiStore.getState().project
  if (!project?.path) return null
  return `${normalizePath(project.path)}/.qmai/outline-chats.json`
}

export const useOutlineChatStore = create<OutlineChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  streamingContent: "",
  isStreaming: false,
  loaded: false,

  createConversation: () => {
    const id = crypto.randomUUID()
    const conv: OutlineChatConversation = {
      id,
      title: `大纲对话 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: Date.now(),
      messages: [],
    }
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: id,
    }))
    void get().saveToDisk()
    return id
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (convId, msg) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, msg] } : c
      ),
    }))
    void get().saveToDisk()
  },

  replaceLastAssistant: (convId, content, sources) => {
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
        return { ...c, messages: msgs, title }
      }),
    }))
    void get().saveToDisk()
  },

  removeLastMessage: (convId) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.slice(0, -1) } : c
      ),
    }))
    void get().saveToDisk()
  },

  deleteConversation: (id) => {
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
    }))
    void get().saveToDisk()
  },

  setConversationModel: (id, modelId) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, modelId } : c
      ),
    }))
    void get().saveToDisk()
  },

  setStreamingContent: (content) => set({ streamingContent: content }),
  setIsStreaming: (value) => set({ isStreaming: value }),

  loadFromDisk: async () => {
    const path = getStoragePath()
    if (!path) return
    try {
      const content = await readFile(path)
      const data = JSON.parse(content) as { conversations: OutlineChatConversation[]; activeConversationId: string | null }
      set({
        conversations: data.conversations ?? [],
        activeConversationId: data.activeConversationId ?? null,
        loaded: true,
      })
    } catch {
      set({ loaded: true })
    }
  },

  saveToDisk: async () => {
    const path = getStoragePath()
    if (!path) return
    const state = get()
    // Don't save streaming state
    const data = {
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
    }
    try {
      const dir = path.replace(/[/\\][^/\\]+$/, "")
      await createDirectory(dir)
      await writeFile(path, JSON.stringify(data, null, 2))
    } catch {
      // Ignore save errors silently
    }
  },
}))
