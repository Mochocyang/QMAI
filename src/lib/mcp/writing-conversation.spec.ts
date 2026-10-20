import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"
import { useChatStore, type Conversation, type DisplayMessage } from "@/stores/chat-store"
import type { ConversationRunStates } from "@/lib/conversation-run-state"
import * as writing from "./writing-conversation"
import { runWritingConversation, type WritingConversationDeps } from "./writing-conversation"
import { createWritingProgressStore, writingProgressStore, type WritingProgress } from "./writing-progress"
import { handleMcpToolCall } from "./dispatch"
import { stopProjectWriting } from "./stop-writing"
import { runAiChatSession } from "@/lib/agent/ai-chat-session"
import { runNovelPrePluginChain } from "@/lib/agent/novel-pre-plugin-chain"

vi.mock("@/lib/agent/ai-chat-session", () => ({ runAiChatSession: vi.fn() }))
vi.mock("@/lib/agent/novel-pre-plugin-chain", () => ({ runNovelPrePluginChain: vi.fn() }))

type History = { conversations: Conversation[]; messages: DisplayMessage[]; runStates: ConversationRunStates }
const conversation: Conversation = { id: "conv-1", title: "既有会话", createdAt: 1, updatedAt: 1, deAiMode: false }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture(session?: WritingConversationDeps["runSession"]) {
  const files = new Map<string, string>()
  const io = {
    read: async (path: string) => { if (!files.has(path)) throw new Error("missing"); return files.get(path)! },
    write: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  }
  const progressStore = createWritingProgressStore(io)
  let history: History = { conversations: [], messages: [], runStates: {} }
  const deps: WritingConversationDeps = {
    progressStore, readLive: () => null,
    loadHistory: vi.fn(async () => structuredClone(history)),
    saveHistory: vi.fn(async (_path, conversations, messages, runStates) => { history = structuredClone({ conversations, messages, runStates }) }),
    runSession: vi.fn(session ?? (async () => "完整正文")),
  }
  const start = async (input = {}) => JSON.parse(await runWritingConversation({
    projectPath: "/book", message: "编写第 200 章", background: true, ...input,
  }, deps)) as WritingProgress
  async function terminal(run: WritingProgress, expected: string) {
    await vi.waitFor(async () => expect((await progressStore.get(run)).status).toBe(expected))
    return progressStore.get(run)
  }
  return { start, deps, files, io, progressStore, terminal, history: () => history, setHistory: (data: History) => { history = data } }
}

beforeEach(() => {
  vi.mocked(runNovelPrePluginChain).mockReset().mockResolvedValue({ errors: [], executedPlugins: [] })
  vi.mocked(runAiChatSession).mockReset().mockResolvedValue({ toolCalls: [], roundsUsed: 1, finalText: "完整正文" })
  useWikiStore.setState({
    project: null, aiChatModel: "custom/writer", aiWorkflowMode: "standard", aiChatReasoningDepth: "auto",
    llmConfig: { provider: "custom", model: "writer", apiKey: "test-key", customEndpoint: "https://example.test/v1", ollamaUrl: "", maxContextSize: 8192 },
    novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/writer" },
    providerConfigs: { custom: { enabled: true, apiKey: "test-key", savedModels: [{ id: "writer", name: "Writer", model: "writer", createdAt: 1 }] } },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  useWikiStore.setState({ project: null })
  useChatStore.setState({ conversations: [], messages: [], runStates: {}, activeConversationId: null })
})

describe("background MCP writing", () => {
  it("wires the default generator's activity, tool and final output callbacks into progress", async () => {
    vi.mocked(runAiChatSession).mockImplementation(async (input) => {
      input.callbacks.onActivityEvent?.({ id: "draft:start", stageId: "generate_draft", kind: "stage_started", title: "草稿", content: "秘密正文", timestamp: Date.now() })
      input.callbacks.onToolEvent?.({ type: "call_started", callId: "child:1", parentCallId: "parent:1", name: "chapter_generate_draft", params: { content: "秘密输入" }, timestamp: Date.now() })
      input.callbacks.onToolEvent?.({ type: "result", callId: "child:1", parentCallId: "parent:1", name: "chapter_generate_draft", params: {}, result: "秘密正文", timestamp: Date.now() })
      input.callbacks.onFinalContent?.("完整正文")
      return { toolCalls: [], roundsUsed: 1, finalText: "完整正文" }
    })
    const h = fixture()
    h.deps.runSession = undefined
    const result = await h.terminal(await h.start(), "completed")
    expect(result.stages.some((stage) => stage.id === "generate_draft")).toBe(true)
    expect(result.tools[0]).toMatchObject({ id: "child:1", parentCallId: "parent:1", status: "done" })
    expect(h.history().messages[1].content).toBe("完整正文")
    expect(JSON.stringify(result)).not.toContain("秘密")
  })

  it.each([
    ["clarification_needed", "needs_input"],
    ["soul_dialog_confirmation_required", "needs_input"],
    ["source_canon_overflow", "failed"],
  ])("handles pre-plugin stop reason %s without running the generator", async (stopReason, status) => {
    vi.mocked(runNovelPrePluginChain).mockResolvedValue({ shouldStop: true, stopReason, finalSystemPrompt: "秘密系统提示", errors: [], executedPlugins: [] })
    const h = fixture()
    h.deps.runSession = undefined
    const result = await h.terminal(await h.start(), status)
    expect(runAiChatSession).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("秘密系统提示")
    expect(h.history().messages[1].content).not.toContain("秘密系统提示")
  })

  it("returns an identifier before generation completes and supports progress and stop through the dispatcher", async () => {
    const entered = deferred()
    const h = fixture(async (ctx) => {
      ctx.onActivityEvent?.({ id: "stage", stageId: "generate_draft", kind: "stage_started", title: "草稿", content: "秘密正文", timestamp: Date.now() })
      entered.resolve()
      return new Promise((_resolve, reject) => ctx.signal!.addEventListener("abort", () => reject(new Error("操作已取消")), { once: true }))
    })
    const original = writing.runWritingConversation
    vi.spyOn(writing, "runWritingConversation").mockImplementation((input) => original(input, h.deps))
    vi.spyOn(writingProgressStore, "get").mockImplementation(h.progressStore.get)
    const started = await handleMcpToolCall({ name: "writing_conversation", arguments: { projectPath: "/book", message: "编写第 200 章", background: true } })
    const run = JSON.parse(started.content[0].text) as WritingProgress
    expect(run).toMatchObject({ status: "running", runId: expect.any(String), conversationId: expect.any(String) })
    expect(h.files.has(run.progressPath)).toBe(true)
    await entered.promise
    const response = await handleMcpToolCall({ name: "get_writing_progress", arguments: { projectPath: "/book", runId: run.runId, afterRevision: run.revision, waitMs: 100 } })
    expect(JSON.parse(response.content[0].text)).toMatchObject({ changed: true, currentStage: { title: "生成章节草稿" } })
    const stopped = await handleMcpToolCall({ name: "stop_writing", arguments: { projectPath: "/book" } })
    expect(stopped.content[0].text).toBe("已停止生成。")
    await h.terminal(run, "cancelled")
    expect(h.history().messages.map((message) => message.content)).toEqual(["编写第 200 章", "已停止生成。"])
  })

  it("marks completed only after the complete reply is saved", async () => {
    const saving = deferred()
    const releaseSave = deferred()
    const h = fixture()
    const originalSave = h.deps.saveHistory!
    h.deps.saveHistory = async (...args) => { saving.resolve(); await releaseSave.promise; await originalSave(...args) }
    const run = await h.start()
    await saving.promise
    expect((await h.progressStore.get(run)).status).toBe("running")
    releaseSave.resolve()
    const finished = await h.terminal(run, "completed")
    expect(h.history().messages[1]).toMatchObject({ content: "完整正文", isAgentRunning: false, generationTiming: { finishedAt: expect.any(Number) } })
    expect(JSON.parse(h.files.get(finished.progressPath)!)).toMatchObject({ status: "completed" })
    expect(JSON.stringify(finished)).not.toContain("完整正文")
  })

  it("preserves a failed round and its partial reply while reporting a brief failure", async () => {
    const h = fixture(async (ctx) => { ctx.onText?.("部分正文"); throw new Error("Agent 已达到最大调用轮次（15）") })
    const run = await h.start()
    const result = await h.terminal(run, "failed")
    expect(result.issues).toContainEqual({ kind: "error", message: expect.stringContaining("最大调用轮次") })
    expect(h.history().messages[1].content).toMatch(/^出错：.*最大调用轮次[\s\S]*部分正文/)
    expect(JSON.stringify(result)).not.toContain("部分正文")
  })

  it.each(["clarification", "approval"])("ends a %s request as needs_input", async (kind) => {
    const h = fixture(async (ctx) => {
      if (kind === "clarification") ctx.onNeedsInput?.("需要明确本次写作意图。")
      else ctx.onToolEvent?.({ type: "approval_required", name: "save_document", callId: "approval", params: { content: "秘密正文" }, result: "秘密预览", timestamp: Date.now() })
      return "需要用户确认"
    })
    const run = await h.start()
    const result = await h.terminal(run, "needs_input")
    expect(result.issues.some((issue) => issue.kind === "input_required")).toBe(true)
    expect(result.conversationId).toBe(run.conversationId)
    expect(result.finishedAt).toBeTypeOf("number")
  })

  it("does not turn a recovered tool error into a failed run", async () => {
    const h = fixture(async (ctx) => {
      ctx.onToolEvent?.({ type: "error", name: "read_chapter", callId: "first", params: {}, result: "失败", timestamp: Date.now() })
      ctx.onToolEvent?.({ type: "result", name: "read_chapter", callId: "retry", params: {}, result: "成功", timestamp: Date.now() })
      return "完整正文"
    })
    await h.terminal(await h.start(), "completed")
  })

  it("reports a history save failure rather than completed", async () => {
    const h = fixture()
    h.deps.saveHistory = async () => { throw new Error("disk full") }
    const result = await h.terminal(await h.start(), "failed")
    expect(result.issues).toContainEqual({ kind: "error", message: expect.stringContaining("对话保存失败") })
  })

  it("does not launch when initial progress cannot be persisted and releases the project lock", async () => {
    const h = fixture()
    const write = h.io.write
    h.io.write = vi.fn(async () => { throw new Error("disk full") })
    await expect(h.start()).rejects.toThrow("任务未启动")
    expect(h.deps.runSession).not.toHaveBeenCalled()
    h.io.write = write
    await h.terminal(await h.start(), "completed")
  })

  it("keeps terminal persistence errors visible even when the background promise rejects", async () => {
    const gate = deferred()
    const h = fixture(async () => { await gate.promise; return "完整正文" })
    const run = await h.start()
    h.io.write = vi.fn(async () => { throw new Error("disk full") })
    gate.resolve()
    await vi.waitFor(async () => expect((await h.progressStore.get(run)).persistenceError).toContain("保存失败"))
    expect((await h.progressStore.get(run)).status).toBe("completed")
  })

  it("merges other conversations created during generation without replacing them", async () => {
    const gate = deferred()
    const h = fixture(async () => { await gate.promise; return "新正文" })
    h.setHistory({ conversations: [conversation], messages: [], runStates: {} })
    const run = await h.start({ conversationId: conversation.id })
    const other: Conversation = { ...conversation, id: "other", title: "并行会话" }
    h.setHistory({ conversations: [conversation, other], messages: [{ id: "other-message", role: "assistant", content: "并行结果", conversationId: other.id, timestamp: 2 }], runStates: { other: { status: "running", updatedAt: 2 } } })
    gate.resolve()
    await h.terminal(run, "completed")
    expect(h.history().conversations.map((item) => item.id)).toEqual(["conv-1", "other"])
    expect(h.history().messages[0].content).toBe("并行结果")
    expect(h.history().runStates.other.status).toBe("running")
  })

  it("does not write the old book's result into the newly opened book", async () => {
    const gate = deferred()
    const h = fixture(async () => { await gate.promise; return "旧书正文" })
    let live: History & { projectPath: string } = { projectPath: "/book", conversations: [], messages: [], runStates: {} }
    h.deps.readLive = () => live
    h.deps.writeLive = vi.fn()
    const run = await h.start()
    live = { projectPath: "/another-book", conversations: [], messages: [], runStates: {} }
    gate.resolve()
    await h.terminal(run, "completed")
    expect(h.deps.writeLive).not.toHaveBeenCalled()
    expect(h.history().messages[1].content).toBe("旧书正文")
  })

  it("merges into the real live store before saving and preserves messages added while saving", async () => {
    const gate = deferred()
    const h = fixture(async () => { await gate.promise; return "新正文" })
    h.deps.readLive = undefined
    useWikiStore.setState({ project: { path: "/book", id: "book", name: "书" } })
    useChatStore.setState({ conversations: [conversation], messages: [], runStates: {}, activeConversationId: "other" })
    const save = h.deps.saveHistory!
    h.deps.saveHistory = async (...args) => {
      expect(useChatStore.getState().messages.some((message) => message.content === "新正文")).toBe(true)
      useChatStore.setState((state) => ({ messages: [...state.messages, { id: "during-save", conversationId: "other", content: "并行结果", role: "assistant", timestamp: Date.now() }] }))
      await save(...args)
    }
    const run = await h.start({ conversationId: conversation.id })
    expect(useChatStore.getState().runStates[conversation.id].status).toBe("running")
    gate.resolve()
    await h.terminal(run, "completed")
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(["编写第 200 章", "新正文", "并行结果"])
    expect(useChatStore.getState().activeConversationId).toBe("other")
    expect(useChatStore.getState().runStates[conversation.id].status).toBe("idle")
  })

  it("keeps the synchronous response and accepts an explicit stop before the background session begins", async () => {
    const h = fixture(async (ctx) => {
      if (ctx.signal!.aborted) throw new Error("操作已取消")
      return "完整正文"
    })
    const sync = await runWritingConversation({ projectPath: "/book", message: "继续" }, h.deps)
    expect(sync).toContain("写作对话已完成。")
    expect(sync).toContain("正文模型：writer")
    const run = await h.start()
    expect(stopProjectWriting("/book")).toBe("已停止生成。")
    await h.terminal(run, "cancelled")
  })
})
