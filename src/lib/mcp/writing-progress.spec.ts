import { afterEach, describe, expect, it, vi } from "vitest"
import { createWritingProgressStore, summarizeWritingError, type WritingProgressIo } from "./writing-progress"
import type { AgentActivityEvent, AgentToolEvent } from "@/lib/agent/types"

function fixture() {
  const files = new Map<string, string>()
  const io: WritingProgressIo = {
    read: async (path) => { if (!files.has(path)) throw new Error("missing"); return files.get(path)! },
    write: vi.fn(async (path, text) => { files.set(path, text) }),
  }
  const store = createWritingProgressStore(io)
  const input = { projectPath: "/book", conversationId: "conv-1", runId: "run-1" }
  return { files, io, store, input }
}

const activity = (stageId = "generate_draft", kind: AgentActivityEvent["kind"] = "stage_started"): AgentActivityEvent => ({
  id: "event-1", stageId, kind, title: "秘密正文标题", content: "秘密正文与思考", timestamp: Date.now(),
})
const tool = (type: AgentToolEvent["type"], extra: Partial<AgentToolEvent> = {}): AgentToolEvent => ({
  type, callId: "child-1", parentCallId: "parent-1", name: "chapter_generate_draft",
  params: { prompt: "秘密输入", apiKey: "secret-token" }, result: "秘密结果", preview: "秘密预览",
  timestamp: Date.now(), ...extra,
})

afterEach(() => vi.useRealTimers())

describe("writing progress snapshots", () => {
  it("projects real stages and nested tools without storing content or reasoning", async () => {
    const { store, input, files } = fixture()
    const run = await store.start(input)
    expect(run.snapshot().currentStage?.title).toBe("准备写作上下文")
    run.activity(activity())
    run.tool(tool("call_started"))
    expect(run.snapshot().currentStage?.title).toBe("生成章节草稿")
    expect(run.snapshot().tools[0]).toMatchObject({ id: "child-1", parentCallId: "parent-1", status: "running" })
    run.tool(tool("result"))
    await run.finish("completed")
    const saved = files.get(run.snapshot().progressPath)!
    for (const secret of ["秘密", "secret-token", "params", "preview", "reasoning", '"result"', '"content"']) expect(saved).not.toContain(secret)
    expect(JSON.parse(saved)).toMatchObject({ status: "completed", conversationPath: "/book/.qmai/chats/conv-1.json" })
    run.activity(activity("final_output"))
    await run.finish("failed")
    expect(run.snapshot().status).toBe("completed")
  })

  it("reports recoverable tool errors without failing the whole run", async () => {
    const { store, input } = fixture()
    const run = await store.start(input)
    run.tool(tool("error"))
    expect(run.snapshot().status).toBe("running")
    expect(run.snapshot().issues[0].kind).toBe("tool_error")
    run.tool(tool("call_started", { callId: "retry" }))
    run.tool(tool("result", { callId: "retry" }))
    await run.finish("completed")
    expect(run.snapshot().status).toBe("completed")
    expect(run.snapshot().issues).toHaveLength(1)
  })

  it("writes at most once per second under continuous events without starving persistence", async () => {
    vi.useFakeTimers()
    const { store, input, io } = fixture()
    const run = await store.start(input)
    for (let i = 0; i < 9; i++) {
      run.activity(activity())
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(io.write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(io.write).toHaveBeenCalledTimes(2)
    await run.finish("cancelled")
    expect(io.write).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(io.write).toHaveBeenCalledTimes(3)
  })

  it("serializes an in-flight write before the terminal write and never regresses", async () => {
    vi.useFakeTimers()
    const { store, input, io, files } = fixture()
    const normalWrite = io.write
    let release!: () => void
    let gate: Promise<void> | undefined
    io.write = vi.fn(async (path, text) => {
      if (gate) await gate
      await normalWrite(path, text)
    })
    const run = await store.start(input)
    gate = new Promise<void>((resolve) => { release = resolve })
    run.activity(activity())
    await vi.advanceTimersByTimeAsync(1000)
    const finishing = run.finish("completed")
    release()
    await finishing
    expect(JSON.parse(files.get(run.snapshot().progressPath)!)).toMatchObject({ status: "completed" })
    await vi.advanceTimersByTimeAsync(2000)
    expect(JSON.parse(files.get(run.snapshot().progressPath)!)).toMatchObject({ status: "completed" })
  })

  it("coalesces events during a slow disk write instead of queueing a write per event", async () => {
    vi.useFakeTimers()
    const { store, input, io } = fixture()
    const run = await store.start(input)
    const write = io.write
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    io.write = vi.fn(async (path, text) => { await gate; await write(path, text) })
    run.activity(activity())
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 15; i++) {
      run.activity(activity())
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(io.write).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(io.write).toHaveBeenCalledTimes(2)
    await run.finish("completed")
  })

  it("wakes a bounded progress wait on a new revision and reports unchanged timeouts", async () => {
    vi.useFakeTimers()
    const { store, input } = fixture()
    const run = await store.start(input)
    const waiting = store.get({ ...input, afterRevision: 1, waitMs: 30_000 })
    run.activity(activity())
    expect(await waiting).toMatchObject({ changed: true, status: "running" })
    const revision = run.snapshot().revision
    // Flush first so a pending write failure cannot affect the wait.
    await run.flush()
    const unchanged = store.get({ ...input, afterRevision: revision, waitMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await unchanged).toMatchObject({ changed: false, revision })
    await run.finish("completed")
    // Terminal tasks never consume the requested wait time.
    expect(await store.get({ ...input, afterRevision: run.snapshot().revision, waitMs: 30_000 })).toMatchObject({ changed: false, status: "completed" })
  })

  it("marks a previous process's running snapshot interrupted, but preserves terminal snapshots", async () => {
    const { store, io, input, files } = fixture()
    const run = await store.start(input)
    const restarted = createWritingProgressStore(io)
    expect(await restarted.get(input)).toMatchObject({ status: "interrupted", finishedAt: expect.any(Number) })
    expect(JSON.parse(files.get(run.snapshot().progressPath)!)).toMatchObject({ status: "interrupted" })
    expect(await createWritingProgressStore(io).get(input)).toMatchObject({ status: "interrupted" })
  })

  it("rejects initial persistence failure and exposes later write failures to the query", async () => {
    const { store, input, io } = fixture()
    const write = io.write
    io.write = async () => { throw new Error("disk full") }
    await expect(store.start(input)).rejects.toThrow("任务未启动")
    io.write = write
    const run = await store.start(input)
    io.write = async () => { throw new Error("disk full") }
    run.activity(activity())
    await expect(run.flush()).rejects.toThrow("disk full")
    expect(await store.get(input)).toMatchObject({ persistenceError: expect.stringContaining("保存失败"), status: "running" })
    io.write = write
    await run.finish("failed", { kind: "error", message: "模型连接或网络传输失败。" })
    expect(run.snapshot().persistenceError).toBeUndefined()
  })

  it("validates query identifiers and wait arguments without reading arbitrary paths", async () => {
    const { store, input } = fixture()
    await expect(store.get({ ...input, runId: "../../private" })).rejects.toThrow("runId 无效")
    await expect(store.get({ ...input, afterRevision: -1 })).rejects.toThrow("afterRevision")
    await expect(store.get({ ...input, waitMs: 30_001 })).rejects.toThrow("waitMs")
    await expect(store.get(input)).rejects.toThrow("找不到")
  })

  it.each([
    ["Agent 已达到最大调用轮次（15）", "最大调用轮次"],
    ["Authorization: Bearer secret-token\n401 body=秘密正文", "认证失败"],
    ["ECONNRESET body=秘密正文", "网络传输失败"],
    ["意外异常，秘密正文", "未能完成本轮任务"],
  ])("keeps a brief error category for %s", (error, expected) => {
    const message = summarizeWritingError(new Error(error))
    expect(message).toContain(expected)
    expect(message).not.toMatch(/秘密|secret-token/)
  })
})
