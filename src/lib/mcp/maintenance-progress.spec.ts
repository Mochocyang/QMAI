import { describe, expect, it, vi } from "vitest"
import { createMaintenanceProgressStore, maintenanceProgressPath } from "./maintenance-progress"

function fixture() {
  const files = new Map<string, string>()
  const io = { read: async (path: string) => { if (!files.has(path)) throw new Error("missing"); return files.get(path)! },
    write: vi.fn(async (path: string, contents: string) => { files.set(path, contents) }) }
  return { files, io, store: createMaintenanceProgressStore(io) }
}
const deferred = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve }); return { promise, release } }

describe("maintenance progress", () => {
  it("returns a background run, rejects concurrent work and persists its final result", async () => {
    const { store, files } = fixture(), gate = deferred()
    const run = await store.start({ projectPath: "/book", operation: "scan", model: "codex-cli/gpt-6-luna" }, async (task) => {
      task.report("模型检测", { done: 1, total: 2 }); await gate.promise
      return { scanId: "scan-1", issueCount: 2 }
    })
    expect(run.status).toBe("running")
    expect(store.active("/book")).toBe(run.runId)
    await expect(store.start({ projectPath: "/book", operation: "undo" }, async () => ({}))).rejects.toThrow("已有维护任务")
    const before = await store.get({ projectPath: "/book", runId: run.runId })
    expect(before.progress).toEqual({ done: 1, total: 2 })
    const waiting = store.get({ projectPath: "/book", runId: run.runId, afterRevision: before.revision, waitMs: 30000 })
    gate.release()
    expect((await waiting).status).toBe("completed")
    await vi.waitFor(() => expect(store.active("/book")).toBeNull())
    expect(JSON.parse(files.get(run.progressPath)!)).toMatchObject({ status: "completed", model: "codex-cli/gpt-6-luna", result: { scanId: "scan-1" } })
    expect((await store.get({ projectPath: "/book", runId: run.runId, afterRevision: (await store.get({ projectPath: "/book", runId: run.runId })).revision })).changed).toBe(false)
    await expect(store.get({ projectPath: "/other", runId: run.runId })).rejects.toThrow("找不到")
  })
  it("aborts scans but refuses to interrupt committed data synchronization", async () => {
    const { store } = fixture()
    const scan = await store.start({ projectPath: "/book", operation: "scan" }, async ({ signal }) => {
      await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true }))
      return {}
    })
    await store.stop("/book", scan.runId)
    await vi.waitFor(async () => expect((await store.get({ projectPath: "/book", runId: scan.runId })).status).toBe("cancelled"))
    await vi.waitFor(() => expect(store.active("/book")).toBeNull())
    const gate = deferred(), apply = await store.start({ projectPath: "/book", operation: "apply" }, async () => { await gate.promise; return {} })
    await expect(store.stop("/book", apply.runId)).rejects.toThrow("不能中途停止")
    gate.release()
    await vi.waitFor(() => expect(store.active("/book")).toBeNull())
  })
  it("marks restarted runs interrupted and preserves completed records without replaying", async () => {
    const { store, files, io } = fixture(), gate = deferred()
    const run = await store.start({ projectPath: "/book", operation: "scan" }, async () => { await gate.promise; return {} })
    const restarted = createMaintenanceProgressStore(io)
    expect((await restarted.get({ projectPath: "/book", runId: run.runId })).status).toBe("interrupted")
    expect(JSON.parse(files.get(run.progressPath)!).status).toBe("interrupted")
    gate.release()
    await vi.waitFor(() => expect(store.active("/book")).toBeNull())
    expect((await createMaintenanceProgressStore(io).get({ projectPath: "/book", runId: run.runId })).status).toBe("completed")
  })
  it("does not execute when initial persistence fails and sanitizes asynchronous errors", async () => {
    const { store, io } = fixture(), execute = vi.fn(async () => ({}))
    io.write.mockRejectedValueOnce(new Error("disk full"))
    await expect(store.start({ projectPath: "/book", operation: "apply" }, execute)).rejects.toThrow("disk full")
    expect(execute).not.toHaveBeenCalled(); expect(store.active("/book")).toBeNull()
    const run = await store.start({ projectPath: "/book", operation: "scan" }, async () => { throw new Error("secret") }, () => "已隐藏")
    await vi.waitFor(() => expect(store.active("/book")).toBeNull())
    expect((await store.get({ projectPath: "/book", runId: run.runId })).error).toBe("已隐藏")
  })
  it("rejects traversal run IDs and invalid wait arguments", async () => {
    expect(() => maintenanceProgressPath("/book", "../../other")).toThrow("无效")
    const { store } = fixture()
    await expect(store.get({ projectPath: "/book", runId: "x", waitMs: 30001 })).rejects.toThrow("waitMs")
  })
})
