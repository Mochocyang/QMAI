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
import { createNovelGenerationRequestPackage, getOutlineMessageModelContent } from "@/lib/novel/novel-generation-request-package"
import type { OutlineWizardRequest } from "@/lib/novel/outline-wizard"

function conversation(id: string): OutlineChatConversation {
  return { id, title: id, createdAt: 10, updatedAt: 10, messages: [] }
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
  useWikiStore.setState({ project: null })
  useOutlineChatStore.setState({
    conversations: [], activeConversationId: null, streamingContents: {}, runStates: {}, loaded: false, pendingReferenceTokens: [],
  })
})

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe("outline-chat-store", () => {
  it("加载时把旧字符串上下文摘要迁移为带依赖的结构", async () => {
    useWikiStore.setState({ project: { id: "p", name: "Novel", path: "E:/Novel" } })
    fsMocks.readFile.mockResolvedValue(JSON.stringify({
      conversations: [{ ...conversation("legacy-summary"), contextSummary: "旧大纲摘要" }],
      activeConversationId: "legacy-summary",
    }))

    await useOutlineChatStore.getState().loadFromDisk()

    expect(useOutlineChatStore.getState().conversations[0].contextSummary).toEqual({
      text: "旧大纲摘要",
      dependencies: {},
      updatedAt: 0,
    })
  })

  it("按会话隔离流式内容，并支持追加、读取和单独清理", () => {
    useOutlineChatStore.setState({ conversations: [conversation("a"), conversation("b")] })
    const store = useOutlineChatStore.getState()
    store.setStreamingContent("a", "A")
    store.appendStreamingContent("a", "内容")
    store.setStreamingContent("b", "B内容")
    expect(useOutlineChatStore.getState().streamingContents).toEqual({ a: "A内容", b: "B内容" })
    expect(useOutlineChatStore.getState().getStreamingContent("a")).toBe("A内容")
    useOutlineChatStore.getState().clearStreamingContent("a")
    expect(useOutlineChatStore.getState().streamingContents).toEqual({ b: "B内容" })
  })

  it("后台完成显示未读，首次打开后只清除完成未读状态", () => {
    useOutlineChatStore.setState({ conversations: [conversation("a"), conversation("b")], activeConversationId: "b" })
    expect(useOutlineChatStore.getState().startConversationRun("a", "run-a")).toBe(true)
    useOutlineChatStore.getState().finishConversationRun("a", "b", "run-a")
    expect(useOutlineChatStore.getState().runStates.a.status).toBe("completed_unread")
    useOutlineChatStore.getState().setActiveConversation("a")
    expect(useOutlineChatStore.getState().runStates.a.status).toBe("idle")
  })

  it("打开失败或中断会话不会清除其状态", () => {
    useOutlineChatStore.setState({
      conversations: [conversation("failed"), conversation("interrupted")],
      runStates: {
        failed: { status: "failed", error: "接口错误", updatedAt: 10 },
        interrupted: { status: "interrupted", error: "任务中断", updatedAt: 20 },
      },
    })
    useOutlineChatStore.getState().setActiveConversation("failed")
    useOutlineChatStore.getState().setActiveConversation("interrupted")
    expect(useOutlineChatStore.getState().runStates.failed.status).toBe("failed")
    expect(useOutlineChatStore.getState().runStates.interrupted.status).toBe("interrupted")
  })

  it("最多允许三个大纲会话同时运行", () => {
    const ids = ["a", "b", "c", "d"]
    useOutlineChatStore.setState({ conversations: ids.map(conversation) })
    ids.slice(0, 3).forEach((id) => expect(useOutlineChatStore.getState().startConversationRun(id, `run-${id}`)).toBe(true))
    expect(useOutlineChatStore.getState().canStartConversationRun("d")).toBe(false)
    expect(useOutlineChatStore.getState().startConversationRun("d", "run-d")).toBe(false)
  })

  it("不存在的会话不能创建孤儿运行状态", () => {
    expect(useOutlineChatStore.getState().startConversationRun("missing", "run-missing")).toBe(false)
    expect(useOutlineChatStore.getState().runStates.missing).toBeUndefined()
  })

  it("停止后重启时忽略旧任务的完成和失败回调", () => {
    useOutlineChatStore.setState({ conversations: [conversation("a")] })
    const store = useOutlineChatStore.getState()
    store.startConversationRun("a", "run-old")
    store.stopConversationRun("a", "run-old")
    store.startConversationRun("a", "run-new")
    useOutlineChatStore.getState().finishConversationRun("a", "a", "run-old")
    useOutlineChatStore.getState().failConversationRun("a", "旧任务失败", "run-old")
    expect(useOutlineChatStore.getState().runStates.a).toMatchObject({ status: "running", runId: "run-new" })
  })

  it("删除后旧回调不能重建状态，并清理该会话流内容和运行状态", () => {
    useOutlineChatStore.setState({ conversations: [conversation("a"), conversation("b")] })
    const store = useOutlineChatStore.getState()
    store.startConversationRun("a", "run-a"); store.startConversationRun("b", "run-b")
    store.setStreamingContent("a", "A内容"); store.setStreamingContent("b", "B内容")
    useOutlineChatStore.getState().deleteConversation("a")
    useOutlineChatStore.getState().finishConversationRun("a", "b", "run-a")
    useOutlineChatStore.getState().failConversationRun("a", "旧任务失败", "run-a")
    const state = useOutlineChatStore.getState()
    expect(state.runStates.a).toBeUndefined(); expect(state.runStates.b?.status).toBe("running")
    expect(state.streamingContents).toEqual({ b: "B内容" })
  })

  it("保存运行状态但不保存临时流式内容", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    useOutlineChatStore.setState({ conversations: [conversation("a")] })
    useOutlineChatStore.getState().startConversationRun("a", "run-a")
    useOutlineChatStore.getState().setStreamingContent("a", "临时内容")
    await useOutlineChatStore.getState().saveToDisk()
    const saved = JSON.parse(fsMocks.writeFile.mock.calls[0][1])
    expect(saved.runStates.a).toMatchObject({ status: "running", runId: "run-a" })
    expect(saved.streamingContents).toBeUndefined()
  })

  it("保存成功后使用当前大纲历史引用清理快照", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    const stored = conversation("a")
    stored.messages = [{
      id: "assistant",
      role: "assistant",
      content: "大纲",
      contextHubSnapshot: {
        id: "outline-ref",
        surface: "ai-outline",
        createdAt: 10,
        stats: {
          hits: 1, refreshed: 0, failures: 0,
          stableTokens: 100, summaryTokens: 20, dynamicTokens: 30,
          candidateTokens: 300, estimatedSavedTokens: 150, estimatedSavedPercent: 50,
          expanded: false, providerCacheEnabled: true,
        },
      },
    }]
    useOutlineChatStore.setState({ conversations: [stored] })

    await useOutlineChatStore.getState().saveToDisk()

    expect(contextHubMocks.getContextHub).toHaveBeenCalledWith("C:/Book")
    expect(contextHubMocks.pruneSnapshots).toHaveBeenCalledWith("ai-outline", ["outline-ref"])
  })

  it("仅运行状态变化也会自动保存", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    useOutlineChatStore.setState({ conversations: [conversation("a")] })
    useOutlineChatStore.getState().startConversationRun("a", "run-a")
    await vi.advanceTimersByTimeAsync(500)
    const saved = JSON.parse(fsMocks.writeFile.mock.calls.at(-1)?.[1] ?? "{}")
    expect(saved.runStates.a).toMatchObject({ status: "running", runId: "run-a" })
  })

  it("加载时过滤孤儿状态，并把遗留运行状态转为中断", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    fsMocks.readFile.mockResolvedValue(JSON.stringify({
      conversations: [conversation("kept")], activeConversationId: "kept",
      runStates: { kept: { status: "running", updatedAt: 10, runId: "run-kept" }, orphan: { status: "failed", updatedAt: 20, error: "孤儿状态" } },
    }))
    useOutlineChatStore.setState({ streamingContents: { stale: "旧内容" } })
    await useOutlineChatStore.getState().loadFromDisk()
    const state = useOutlineChatStore.getState()
    expect(state.runStates.kept).toMatchObject({ status: "interrupted", error: "任务在软件关闭前未完成。" })
    expect(state.runStates.orphan).toBeUndefined(); expect(state.streamingContents).toEqual({})
  })

  it("兼容没有运行状态字段的旧版大纲会话文件", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    useOutlineChatStore.setState({
      pendingReferenceTokens: [{ id: "old-ref", category: "outline", title: "旧引用", displayTitle: "旧引用" }],
    })
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ conversations: [conversation("legacy")], activeConversationId: "legacy" }))
    await useOutlineChatStore.getState().loadFromDisk()
    expect(useOutlineChatStore.getState()).toMatchObject({
      activeConversationId: "legacy", loaded: true, runStates: {}, streamingContents: {}, pendingReferenceTokens: [],
    })
  })

  it("加载失败时清除上一个项目的会话状态", async () => {
    useWikiStore.setState({ project: { name: "项目", path: "C:/Book" } })
    useOutlineChatStore.setState({
      conversations: [conversation("old")], activeConversationId: "old",
      pendingReferenceTokens: [{ id: "ref", category: "outline", title: "旧引用", displayTitle: "旧引用" }],
    })
    fsMocks.readFile.mockRejectedValue(new Error("文件不存在"))
    await useOutlineChatStore.getState().loadFromDisk()
    expect(useOutlineChatStore.getState()).toMatchObject({
      conversations: [], activeConversationId: null, pendingReferenceTokens: [], loaded: true,
    })
  })
  it("persists structured model content and reloads legacy messages", async () => {
    useWikiStore.setState({ project: { name: "??", path: "C:/Book" } })
    const request: OutlineWizardRequest = {
      task: "newBook", length: "auto", channel: "auto", genre: "auto", customGenre: "",
      inspiration: "persisted inspiration", sellingPoints: [], targets: ["outline"], scale: "",
      narrative: "auto", materialSource: "none",
    }
    const structured = createNovelGenerationRequestPackage(request, "full model workflow")
    const stored = conversation("persisted")
    stored.messages = [
      { id: "new", role: "user", content: structured.summary, novelGenerationRequest: structured },
      { id: "old", role: "user", content: "legacy body" },
      {
        id: "assistant",
        role: "assistant",
        content: "大纲正文",
        contextHubSnapshot: {
          id: "assistant",
          surface: "ai-outline",
          createdAt: 10,
          stats: {
            hits: 1, refreshed: 0, failures: 0,
            stableTokens: 100, summaryTokens: 20, dynamicTokens: 30,
            candidateTokens: 300, estimatedSavedTokens: 150, estimatedSavedPercent: 50,
            expanded: false, providerCacheEnabled: true,
          },
        },
      },
    ]
    useOutlineChatStore.setState({ conversations: [stored], activeConversationId: "persisted" })
    await useOutlineChatStore.getState().saveToDisk()
    const savedJson = fsMocks.writeFile.mock.calls[0][1]
    fsMocks.readFile.mockResolvedValue(savedJson)
    useOutlineChatStore.setState({ conversations: [], activeConversationId: null })
    await useOutlineChatStore.getState().loadFromDisk()
    const messages = useOutlineChatStore.getState().conversations[0].messages
    expect(messages[0].content).toBe(structured.summary)
    expect(getOutlineMessageModelContent(messages[0])).toBe("full model workflow")
    expect(getOutlineMessageModelContent(messages[1])).toBe("legacy body")
    expect(messages[2].contextHubSnapshot).toMatchObject({ id: "assistant", createdAt: 10 })
  })

  it.each([
    { version: 2, summary: "??", details: ["??"], modelContent: "??" },
    { version: 1, summary: "??", details: ["??"] },
    { version: 1, summary: "??", details: "??", modelContent: "??" },
  ])("ignores invalid persisted novel request package %#", async (invalidPackage) => {
    useWikiStore.setState({ project: { name: "??", path: "C:/Book" } })
    const stored = conversation("invalid")
    stored.messages = [{ id: "u", role: "user", content: "????", novelGenerationRequest: invalidPackage as never }]
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ conversations: [stored], activeConversationId: "invalid" }))
    await useOutlineChatStore.getState().loadFromDisk()
    const message = useOutlineChatStore.getState().conversations[0].messages[0]
    expect(message.novelGenerationRequest).toBeUndefined()
    expect(getOutlineMessageModelContent(message)).toBe("????")
  })

})
