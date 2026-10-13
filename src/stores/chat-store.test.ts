import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChatStore } from "./chat-store"

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    messages: [],
    streamingContents: {},
    runStates: {},
    pendingReferenceTokens: [],
    pendingComposerSend: null,
    mode: "chat",
    ingestSource: null,
    maxHistoryMessages: 20,
  })


})

describe("chat-store", () => {
  it("createConversation 会为新会话设置 deAiMode 默认值 false", () => {
    const id = useChatStore.getState().createConversation()

    const conversation = useChatStore.getState().conversations.find((item) => item.id === id)

    expect(conversation).toBeTruthy()
    expect(conversation?.deAiMode).toBe(false)
  })

  it("setMessageChapterDiscuss 只更新目标消息的共创字段", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.setState({
      messages: [
        { id: "m1", role: "assistant", content: "判断。", timestamp: 1, conversationId },
        { id: "m2", role: "assistant", content: "别的。", timestamp: 2, conversationId },
      ],
    })

    const protocol = {
      status: "needs_choice" as const,
      module: "第3章",
      judgment: "需要在第三章转折",
      directions: [{ id: "d1", storyType: "复仇线", title: "血债血偿", summary: "前".repeat(200) }],
      preferenceId: "d1",
      preferenceReason: "承接伏笔",
    }

    useChatStore.getState().setMessageChapterDiscuss("m1", { chapterDiscussProtocol: protocol })
    useChatStore.getState().setMessageChapterDiscuss("m2", { chapterDiscussDecision: "selected" })

    const messages = useChatStore.getState().messages
    expect(messages.find((m) => m.id === "m1")?.chapterDiscussProtocol?.module).toBe("第3章")
    expect(messages.find((m) => m.id === "m1")?.chapterDiscussDecision).toBeUndefined()
    expect(messages.find((m) => m.id === "m2")?.chapterDiscussProtocol).toBeUndefined()
    expect(messages.find((m) => m.id === "m2")?.chapterDiscussDecision).toBe("selected")
  })

  it("setConversationDeAiMode 只更新目标会话的 deAiMode", () => {
    const nowSpy = vi.spyOn(Date, "now")
    nowSpy.mockReturnValue(123456)

    const store = useChatStore.getState()
    const firstId = store.createConversation()
    const secondId = useChatStore.getState().createConversation()
    const beforeUpdate = useChatStore.getState().conversations
    const firstBeforeUpdate = beforeUpdate.find((item) => item.id === firstId)
    const secondBeforeUpdate = beforeUpdate.find((item) => item.id === secondId)

    nowSpy.mockReturnValue(234567)

    useChatStore.getState().setConversationDeAiMode(firstId, true)

    const conversations = useChatStore.getState().conversations
    const firstConversation = conversations.find((item) => item.id === firstId)
    const secondConversation = conversations.find((item) => item.id === secondId)

    expect(firstConversation?.deAiMode).toBe(true)
    expect(firstConversation?.updatedAt).toBe(234567)
    expect(secondConversation?.deAiMode).toBe(false)
    expect(secondConversation?.updatedAt).toBe(secondBeforeUpdate?.updatedAt)
    expect(firstBeforeUpdate?.updatedAt).toBe(123456)
  })

  it("切换当前会话不会改动任一会话的 deAiMode", () => {
    const store = useChatStore.getState()
    const firstId = store.createConversation()
    const secondId = useChatStore.getState().createConversation()

    useChatStore.getState().setConversationDeAiMode(firstId, true)
    const beforeSwitch = useChatStore.getState().conversations.map((conversation) => ({
      id: conversation.id,
      deAiMode: conversation.deAiMode,
    }))

    useChatStore.getState().setActiveConversation(firstId)

    expect(useChatStore.getState().activeConversationId).toBe(firstId)
    expect(useChatStore.getState().conversations.map((conversation) => ({
      id: conversation.id,
      deAiMode: conversation.deAiMode,
    }))).toEqual(beforeSwitch)
    expect(useChatStore.getState().conversations.find((conversation) => conversation.id === secondId)?.deAiMode).toBe(false)
  })

  it("重命名会话不会破坏 deAiMode", () => {
    const nowSpy = vi.spyOn(Date, "now")
    nowSpy.mockReturnValue(100)

    const id = useChatStore.getState().createConversation()
    useChatStore.getState().setConversationDeAiMode(id, true)
    const beforeRename = useChatStore.getState().conversations.find((conversation) => conversation.id === id)

    nowSpy.mockReturnValue(200)
    useChatStore.getState().renameConversation(id, "新的会话标题")

    const renamedConversation = useChatStore.getState().conversations.find((conversation) => conversation.id === id)

    expect(renamedConversation?.title).toBe("新的会话标题")
    expect(renamedConversation?.deAiMode).toBe(true)
    expect(renamedConversation?.updatedAt).toBe(200)
    expect(beforeRename?.deAiMode).toBe(true)
  })

  it("删除其他会话不会破坏剩余会话的 deAiMode", () => {
    const store = useChatStore.getState()
    const firstId = store.createConversation()
    const secondId = useChatStore.getState().createConversation()

    useChatStore.getState().setConversationDeAiMode(firstId, true)
    useChatStore.getState().deleteConversation(secondId)

    const remainingConversation = useChatStore.getState().conversations.find((conversation) => conversation.id === firstId)

    expect(useChatStore.getState().conversations).toHaveLength(1)
    expect(remainingConversation?.deAiMode).toBe(true)
    expect(useChatStore.getState().activeConversationId).toBe(firstId)
  })

  it("queues and consumes reference tokens for external send-to-chat actions", () => {
    const token = {
      id: "ref-1",
      category: "chapter" as const,
      title: "第一章",
      displayTitle: "第一章",
      path: "C:/Novel/wiki/chapters/第一章.md",
    }

    useChatStore.getState().enqueueReferenceTokens([token])

    expect(useChatStore.getState().pendingReferenceTokens).toEqual([token])
    expect(useChatStore.getState().consumePendingReferenceTokens()).toEqual([token])
    expect(useChatStore.getState().pendingReferenceTokens).toEqual([])
  })

  it("tracks independent states and clears completed unread on first open", () => {
    const a = useChatStore.getState().createConversation()
    const b = useChatStore.getState().createConversation()

    expect(useChatStore.getState().startConversationRun(a)).toBe(true)
    expect(useChatStore.getState().startConversationRun(b)).toBe(true)
    useChatStore.getState().finishConversationRun(a, b)

    expect(useChatStore.getState().runStates[a].status).toBe("completed_unread")
    expect(useChatStore.getState().runStates[b].status).toBe("running")

    useChatStore.getState().setActiveConversation(a)

    expect(useChatStore.getState().runStates[a].status).toBe("idle")
    expect(useChatStore.getState().runStates[b].status).toBe("running")
  })

  it("rejects a fourth ordinary chat run without mutating its state", () => {
    const ids = Array.from({ length: 4 }, () => useChatStore.getState().createConversation())
    ids.slice(0, 3).forEach((id) => expect(useChatStore.getState().startConversationRun(id)).toBe(true))

    expect(useChatStore.getState().canStartConversationRun(ids[3])).toBe(false)
    expect(useChatStore.getState().startConversationRun(ids[3])).toBe(false)
    expect(useChatStore.getState().runStates[ids[3]]).toBeUndefined()
  })

  it("does not clear failed state when opened", () => {
    const id = useChatStore.getState().createConversation()
    useChatStore.getState().startConversationRun(id)
    useChatStore.getState().failConversationRun(id, "接口错误")

    useChatStore.getState().setActiveConversation(id)

    expect(useChatStore.getState().runStates[id]).toMatchObject({ status: "failed", error: "接口错误" })
  })

  it("normalizes loaded running state and keeps interruption until a new run", () => {
    useChatStore.getState().setLoadedRunStates({
      running: { status: "running", updatedAt: 10 },
      completed: { status: "completed_unread", updatedAt: 20 },
    })

    expect(useChatStore.getState().runStates.running).toMatchObject({
      status: "interrupted",
      error: "任务在软件关闭前未完成。",
    })
    expect(useChatStore.getState().runStates.completed.status).toBe("completed_unread")

    useChatStore.getState().stopConversationRun("running")
    expect(useChatStore.getState().runStates.running.status).toBe("interrupted")
  })

  it("deleting a conversation clears only its run state and streaming content", () => {
    const deletedId = useChatStore.getState().createConversation()
    const keptId = useChatStore.getState().createConversation()
    useChatStore.getState().startConversationRun(deletedId)
    useChatStore.getState().startConversationRun(keptId)
    useChatStore.getState().startStreaming(deletedId)
    useChatStore.getState().startStreaming(keptId)

    useChatStore.getState().deleteConversation(deletedId)

    expect(useChatStore.getState().runStates[deletedId]).toBeUndefined()
    expect(useChatStore.getState().runStates[keptId]?.status).toBe("running")
    expect(useChatStore.getState().streamingContents[deletedId]).toBeUndefined()
    expect(useChatStore.getState().streamingContents[keptId]).toBe("")
  })

  it("ignores an old completion after stop and restart", () => {
    const id = useChatStore.getState().createConversation()
    useChatStore.getState().startConversationRun(id, "run-old")
    useChatStore.getState().stopConversationRun(id, "run-old")
    useChatStore.getState().startConversationRun(id, "run-new")
    useChatStore.getState().finishConversationRun(id, id, "run-old")
    expect(useChatStore.getState().runStates[id]).toMatchObject({ status: "running", runId: "run-new" })
  })

  it("ignores an old failure after stop and restart", () => {
    const id = useChatStore.getState().createConversation()
    useChatStore.getState().startConversationRun(id, "run-old")
    useChatStore.getState().stopConversationRun(id, "run-old")
    useChatStore.getState().startConversationRun(id, "run-new")
    useChatStore.getState().failConversationRun(id, "旧任务失败", "run-old")
    expect(useChatStore.getState().runStates[id]).toMatchObject({ status: "running", runId: "run-new" })
  })

  it("does not recreate run state when a deleted run finishes", () => {
    const id = useChatStore.getState().createConversation()
    useChatStore.getState().startConversationRun(id, "run-deleted")
    useChatStore.getState().deleteConversation(id)
    useChatStore.getState().finishConversationRun(id, null, "run-deleted")
    useChatStore.getState().failConversationRun(id, "旧任务失败", "run-deleted")
    expect(useChatStore.getState().runStates[id]).toBeUndefined()
  })
})

/*
 * 章节区「生成章节细纲」投进来的那条队列。
 *
 * 它存在的前提是发起方与执行方是两个组件、且执行方可能**还没挂载**，
 * 所以「取走即清空」与「后到覆盖先到」这两条语义都是契约，不是实现细节：
 * 前者保证同一条请求不会被发两轮（烧两次钱），后者保证用户最后一次意图一定被执行。
 */
describe("chat-store 外部发送队列（pendingComposerSend）", () => {
  it("初始为空", () => {
    expect(useChatStore.getState().pendingComposerSend).toBeNull()
  })

  it("投递后可取出，且取走即清空（同一条请求不会被发两次）", () => {
    useChatStore.getState().requestComposerSend({ text: "完整提示词", displayText: "给用户看的一句" })

    const first = useChatStore.getState().consumeComposerSend()
    expect(first).toEqual({ text: "完整提示词", displayText: "给用户看的一句" })
    expect(useChatStore.getState().pendingComposerSend).toBeNull()
    expect(useChatStore.getState().consumeComposerSend()).toBeNull()
  })

  it("后一次投递覆盖前一次，而不是排队", () => {
    useChatStore.getState().requestComposerSend({ text: "第一次", displayText: "第一次" })
    useChatStore.getState().requestComposerSend({ text: "第二次", displayText: "第二次" })

    expect(useChatStore.getState().consumeComposerSend()).toEqual({ text: "第二次", displayText: "第二次" })
    expect(useChatStore.getState().pendingComposerSend).toBeNull()
  })

  it("取空队列是 no-op（不写状态、不抛错）", () => {
    expect(useChatStore.getState().consumeComposerSend()).toBeNull()
    expect(useChatStore.getState().pendingComposerSend).toBeNull()
  })
})
