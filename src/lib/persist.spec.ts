import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  readFile: vi.fn(),
  createDirectory: vi.fn(),
}))

const contextHubMocks = vi.hoisted(() => ({
  getContextHub: vi.fn(),
  pruneSnapshots: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)
vi.mock("@/lib/context-hub/context-hub", () => ({
  getContextHub: contextHubMocks.getContextHub,
}))

import { loadChatHistory, saveChatHistory } from "./persist"

describe("chat context summary persistence", () => {
  beforeEach(() => {
    fsMocks.writeFile.mockReset().mockResolvedValue(undefined)
    fsMocks.writeFileAtomic.mockReset().mockResolvedValue(undefined)
    fsMocks.createDirectory.mockReset().mockResolvedValue(undefined)
    fsMocks.readFile.mockReset()
    contextHubMocks.pruneSnapshots.mockReset().mockResolvedValue(undefined)
    contextHubMocks.getContextHub.mockReset().mockReturnValue({
      pruneSnapshots: contextHubMocks.pruneSnapshots,
    })
  })

  it("saves the dependency fingerprint in the conversation manifest", async () => {
    const contextSummary = { text: "摘要", dependencyFingerprint: "outline-v3", updatedAt: 10 }
    await saveChatHistory("E:/Novel", [{
      id: "chat-1",
      title: "会话",
      createdAt: 1,
      updatedAt: 2,
      deAiMode: false,
      contextSummary,
    }], [])

    const manifestCall = fsMocks.writeFile.mock.calls.find(([path]) => path.endsWith("/.qmai/conversations.json"))
    expect(JSON.parse(manifestCall[1]).conversations[0].contextSummary).toEqual(contextSummary)
  })

  it("migrates a legacy string summary while loading", async () => {
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.qmai/conversations.json")) {
        return JSON.stringify({ conversations: [{
          id: "chat-1",
          title: "会话",
          createdAt: 1,
          updatedAt: 2,
          deAiMode: false,
          contextSummary: "旧摘要",
        }] })
      }
      throw new Error("文件不存在")
    })

    const loaded = await loadChatHistory("E:/Novel")

    expect(loaded.conversations[0].contextSummary).toEqual({
      text: "旧摘要",
      updatedAt: 0,
    })
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "E:/Novel/.qmai/conversations.json",
      expect.not.stringContaining("dependencies"),
    )
  })

  it("migrates a legacy combined chat file and removes its dependency table", async () => {
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.qmai/chat-history.json")) {
        return JSON.stringify({
          conversations: [{
            id: "chat-legacy",
            title: "旧会话",
            createdAt: 1,
            updatedAt: 2,
            deAiMode: false,
            contextSummary: {
              text: "保留的旧摘要",
              updatedAt: 2,
              dependencies: { "E:/Novel/wiki/entities/a.md": 1 },
            },
          }],
          messages: [{
            id: "message-1",
            role: "assistant",
            content: "旧消息",
            timestamp: 2,
            conversationId: "chat-legacy",
          }],
        })
      }
      throw new Error("文件不存在")
    })

    const loaded = await loadChatHistory("E:/Novel")

    expect(loaded.conversations[0].contextSummary).toEqual({ text: "保留的旧摘要", updatedAt: 2 })
    const manifestCall = fsMocks.writeFile.mock.calls.find(([path]) => path.endsWith("/.qmai/conversations.json"))
    expect(manifestCall).toBeDefined()
    expect(manifestCall![1]).not.toContain("dependencies")
    expect(manifestCall![1]).toContain("保留的旧摘要")
  })

  it("persists the context snapshot reference with an assistant message", async () => {
    const contextHubSnapshot = {
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 10,
      stats: {
        cacheHits: 1, reloaded: 2, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
        stableTokens: 100, summaryTokens: 20, dynamicTokens: 30,
        candidateTokens: 300, estimatedSavedTokens: 150, estimatedSavedPercent: 50,
        expanded: false, providerCacheEnabled: true,
      },
    }
    await saveChatHistory("E:/Novel", [{
      id: "chat-1",
      title: "会话",
      createdAt: 1,
      updatedAt: 2,
      deAiMode: false,
    }], [{
      id: "assistant:1",
      role: "assistant",
      content: "正文",
      timestamp: 10,
      conversationId: "chat-1",
      contextHubSnapshot,
    }])

    const messageCall = fsMocks.writeFile.mock.calls.find(([path]) => path.endsWith("/.qmai/chats/chat-1.json"))
    expect(JSON.parse(messageCall[1])[0].contextHubSnapshot).toEqual(contextHubSnapshot)
  })

  it("writes an empty message file when an existing conversation is cleared", async () => {
    await saveChatHistory("E:/Novel", [{
      id: "chat-1",
      title: "会话",
      createdAt: 1,
      updatedAt: 2,
      deAiMode: false,
    }], [])

    const messageCall = fsMocks.writeFile.mock.calls.find(([path]) => path.endsWith("/.qmai/chats/chat-1.json"))
    expect(messageCall).toBeDefined()
    expect(JSON.parse(messageCall![1])).toEqual([])
    expect(contextHubMocks.pruneSnapshots).toHaveBeenCalledWith("ai-chat", [])
  })

  it("queues overlapping saves so the newest chat state is not discarded", async () => {
    const conversation = {
      id: "chat-1",
      title: "会话",
      createdAt: 1,
      updatedAt: 2,
      deAiMode: false,
    }
    let releaseFirstManifestWrite: (() => void) | undefined
    let manifestWriteCount = 0
    fsMocks.writeFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.qmai/conversations.json") && manifestWriteCount++ === 0) {
        await new Promise<void>((resolve) => {
          releaseFirstManifestWrite = resolve
        })
      }
    })

    const firstSave = saveChatHistory("E:/Novel", [conversation], [{
      id: "old-message",
      role: "assistant",
      content: "旧消息",
      timestamp: 1,
      conversationId: "chat-1",
    }])
    await vi.waitFor(() => expect(releaseFirstManifestWrite).toBeTypeOf("function"))

    const clearSave = saveChatHistory("E:/Novel", [conversation], [])
    releaseFirstManifestWrite?.()
    await Promise.all([firstSave, clearSave])

    const messageWrites = fsMocks.writeFile.mock.calls.filter(([path]) =>
      path.endsWith("/.qmai/chats/chat-1.json")
    )
    expect(messageWrites).toHaveLength(2)
    expect(JSON.parse(messageWrites.at(-1)![1])).toEqual([])
  })

  it("prunes AI chat snapshots using only references that were actually persisted", async () => {
    const stats = {
      cacheHits: 1, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
      stableTokens: 100, summaryTokens: 20, dynamicTokens: 30,
      candidateTokens: 300, estimatedSavedTokens: 150, estimatedSavedPercent: 50,
      expanded: false, providerCacheEnabled: true,
    }
    const messages = [
      {
        id: "old",
        role: "assistant" as const,
        content: "旧回复",
        timestamp: 1,
        conversationId: "chat-1",
        contextHubSnapshot: { id: "old", surface: "ai-chat" as const, createdAt: 1, stats },
      },
      {
        id: "kept",
        role: "assistant" as const,
        content: "新回复",
        timestamp: 2,
        conversationId: "chat-1",
        contextHubSnapshot: { id: "kept", surface: "ai-chat" as const, createdAt: 2, stats },
      },
    ]

    await saveChatHistory("E:/Novel", [{
      id: "chat-1",
      title: "会话",
      createdAt: 1,
      updatedAt: 2,
      deAiMode: false,
    }], messages, 1)

    expect(contextHubMocks.getContextHub).toHaveBeenCalledWith("E:/Novel")
    expect(contextHubMocks.pruneSnapshots).toHaveBeenCalledWith("ai-chat", ["kept"])
  })

  it("does not fail chat persistence when snapshot cleanup fails", async () => {
    contextHubMocks.pruneSnapshots.mockRejectedValueOnce(new Error("清理失败"))

    await expect(saveChatHistory("E:/Novel", [], [])).resolves.toBeUndefined()
  })
})
