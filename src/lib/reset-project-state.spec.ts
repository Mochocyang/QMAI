import { beforeEach, describe, expect, it, vi } from "vitest"

const contextHubMocks = vi.hoisted(() => ({
  disposeAllContextHubs: vi.fn(),
  getContextHub: vi.fn(() => ({ pruneSnapshots: vi.fn(async () => {}) })),
}))

vi.mock("@/lib/ingest-queue", () => ({
  pauseQueue: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/context-hub/context-hub", () => contextHubMocks)

import { resetProjectState, resetProjectStores } from "./reset-project-state"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useReviewStore } from "@/stores/review-store"

beforeEach(() => {
  contextHubMocks.disposeAllContextHubs.mockClear()
  useChatStore.setState({
    conversations: [{ id: "chat-a", title: "chat-a", createdAt: 1, updatedAt: 1, deAiMode: false }],
    messages: [{ id: "m1", role: "user", content: "hi", timestamp: 1, conversationId: "chat-a" }],
    activeConversationId: "chat-a",
    streamingContents: { "chat-a": "stream" },
  })
  useOutlineChatStore.setState({
    conversations: [{ id: "outline-a", title: "outline-a", createdAt: 1, updatedAt: 1, messages: [] }],
    activeConversationId: "outline-a",
    streamingContents: { "outline-a": "stream" },
    runStates: { "outline-a": { status: "idle", updatedAt: 1 } },
    pendingReferenceTokens: [{ id: "ref", category: "outline", title: "引用", displayTitle: "引用" }],
    loaded: true,
  })
  useReviewStore.setState({ items: [{ id: "r1" } as never] })
  useActivityStore.setState({ items: [{ id: "a1" } as never] })
})

describe("resetProjectStores", () => {
  it("清空大纲 AI 会话并重置 loaded，避免切书后残留历史", () => {
    resetProjectStores()

    expect(useOutlineChatStore.getState()).toMatchObject({
      conversations: [],
      activeConversationId: null,
      streamingContents: {},
      runStates: {},
      pendingReferenceTokens: [],
      loaded: false,
    })
    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      messages: [],
      activeConversationId: null,
      streamingContents: {},
    })
    expect(useReviewStore.getState().items).toEqual([])
    expect(useActivityStore.getState().items).toEqual([])
  })
})

describe("resetProjectState", () => {
  it("clears the session chapter restore key used by sidebar view switching", async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })
    sessionStorage.setItem("lk-last-chapter-path", "/books/other/wiki/chapters/212.md")

    await resetProjectState()

    expect(sessionStorage.getItem("lk-last-chapter-path")).toBeNull()
    expect(contextHubMocks.disposeAllContextHubs).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
