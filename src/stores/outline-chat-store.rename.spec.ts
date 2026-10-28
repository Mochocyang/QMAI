/**
 * 大纲会话的「重命名」契约：
 * - 改名后打上 titleLocked，首条消息的派生标题不再覆盖它；
 * - 空白标题直接忽略，不允许把标题写没；
 * - 改名要落盘（`.qmai/outline-chats.json`）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({ createDirectory: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }))
const contextHubMocks = vi.hoisted(() => ({
  getContextHub: vi.fn(),
  pruneSnapshots: vi.fn(),
}))
vi.mock("@/commands/fs", () => fsMocks)
vi.mock("@/lib/context-hub/context-hub", () => ({
  getContextHub: contextHubMocks.getContextHub,
}))

import type { OutlineChatConversation } from "./outline-chat-store"
import { useOutlineChatStore } from "./outline-chat-store"
import { useWikiStore } from "./wiki-store"

function conversation(id: string, overrides: Partial<OutlineChatConversation> = {}): OutlineChatConversation {
  return { id, title: `大纲对话 ${id}`, createdAt: 10, updatedAt: 10, messages: [], ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
  fsMocks.createDirectory.mockReset().mockResolvedValue(undefined)
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset().mockResolvedValue(undefined)
  contextHubMocks.pruneSnapshots.mockReset().mockResolvedValue(undefined)
  contextHubMocks.getContextHub.mockReset().mockReturnValue({
    pruneSnapshots: contextHubMocks.pruneSnapshots,
  })
  useWikiStore.setState({ project: { id: "p1", name: "测试项目", path: "C:/Novel" } })
  useOutlineChatStore.setState({
    conversations: [conversation("a")],
    activeConversationId: "a",
    streamingContents: {},
    runStates: {},
    loaded: true,
    pendingReferenceTokens: [],
    dismissedIntentPromptIds: {},
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  useWikiStore.setState({ project: null })
})

describe("大纲会话重命名", () => {
  it("改名后写入 title、titleLocked，并落盘", async () => {
    useOutlineChatStore.getState().renameConversation("a", "  第 23 章 空位  ")
    const renamed = useOutlineChatStore.getState().conversations[0]
    expect(renamed.title).toBe("第 23 章 空位")
    expect(renamed.titleLocked).toBe(true)

    await vi.advanceTimersByTimeAsync(600)
    const written = fsMocks.writeFile.mock.calls.at(-1)?.[1] as string
    expect(written).toContain("第 23 章 空位")
    expect(written).toContain('"titleLocked": true')
  })

  it("改过名之后，首条消息派生出的标题不再覆盖它", () => {
    useOutlineChatStore.getState().renameConversation("a", "我的手改标题")
    useOutlineChatStore.getState().addMessage("a", {
      id: "u1",
      role: "user",
      content: "帮我写第 24 章的开头，要求冷峻、短句",
    })
    useOutlineChatStore.getState().replaceLastAssistant("a", "好的，先从雨夜写起。")

    expect(useOutlineChatStore.getState().conversations[0].title).toBe("我的手改标题")
  })

  it("没改过名的会话仍然按首条消息派生标题", () => {
    useOutlineChatStore.getState().addMessage("a", {
      id: "u1",
      role: "user",
      content: "帮我写第 24 章的开头，要求冷峻、短句",
    })
    useOutlineChatStore.getState().replaceLastAssistant("a", "好的。")

    const title = useOutlineChatStore.getState().conversations[0].title
    expect(title).not.toBe("大纲对话 a")
    expect(title.length).toBeGreaterThan(0)
  })

  it("空白标题被忽略，不会把标题写没", () => {
    useOutlineChatStore.getState().renameConversation("a", "   ")
    expect(useOutlineChatStore.getState().conversations[0].title).toBe("大纲对话 a")
    expect(useOutlineChatStore.getState().conversations[0].titleLocked).toBeUndefined()
  })
})
