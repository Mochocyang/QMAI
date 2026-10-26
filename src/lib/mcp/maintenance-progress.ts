import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizeComparablePath } from "@/lib/path-utils"

export type MaintenanceOperation = "scan" | "apply" | "undo"
export interface MaintenanceProgress {
  version: 1
  runId: string
  projectPath: string
  progressPath: string
  operation: MaintenanceOperation
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
  revision: number
  startedAt: number
  updatedAt: number
  finishedAt?: number
  stage: string
  progress?: { done: number; total: number }
  model?: string
  logs: string[]
  result?: Record<string, unknown>
  error?: string
  persistenceError?: string
}
export interface MaintenanceTaskContext {
  signal: AbortSignal
  report(stage: string, progress?: { done: number; total: number }): void
  log(message: string): void
}
interface ProgressIo {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
}

export function maintenanceProgressPath(projectPath: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw new Error("维护任务 runId 无效")
  return `${normalizeComparablePath(projectPath)}/.qmai/maintenance-runs/${runId}.json`
}

export function createMaintenanceProgressStore(io: ProgressIo = {
  read: readFile,
  write: async (path, contents) => { await createDirectory(path.slice(0, path.lastIndexOf("/"))); await writeFileAtomic(path, contents) },
}) {
  interface Entry { state: MaintenanceProgress; controller?: AbortController; listeners: Set<() => void>; writes: Promise<void> }
  const entries = new Map<string, Entry>()
  const active = new Map<string, string>()
  const key = (projectPath: string, runId: string) => maintenanceProgressPath(projectPath, runId)
  const copy = (entry: Entry) => structuredClone(entry.state)
  function update(entry: Entry, patch: Partial<MaintenanceProgress>) {
    entry.state = { ...entry.state, ...patch, revision: entry.state.revision + 1, updatedAt: Date.now() }
    for (const listener of entry.listeners) listener()
    const snapshot = JSON.stringify(entry.state, null, 2)
    entry.writes = entry.writes.then(() => io.write(entry.state.progressPath, snapshot)).catch(() => {
      entry.state.persistenceError = "维护进度保存失败，当前查询为内存状态，磁盘记录可能滞后。"
    })
  }
  async function load(projectPath: string, runId: string): Promise<Entry> {
    const path = key(projectPath, runId)
    const found = entries.get(path)
    if (found) return found
    let state: MaintenanceProgress
    try { state = JSON.parse(await io.read(path)) as MaintenanceProgress }
    catch { throw new Error("找不到维护任务") }
    if (!state || state.version !== 1 || state.runId !== runId || normalizeComparablePath(state.projectPath) !== normalizeComparablePath(projectPath)
      || !["scan", "apply", "undo"].includes(state.operation) || !Array.isArray(state.logs)
      || !["running", "completed", "failed", "cancelled", "interrupted"].includes(state.status)) throw new Error("维护任务记录无效")
    const entry: Entry = { state: { ...state, progressPath: path }, listeners: new Set(), writes: Promise.resolve() }
    entries.set(path, entry)
    if (state.status === "running") {
      update(entry, { status: "interrupted", stage: "任务已中断", finishedAt: Date.now(), error: "应用重启前任务未完成；不会自动重新扫描或重复执行清理，请检查结果。" })
      await entry.writes
    }
    return entry
  }
  return {
    active(projectPath: string): string | null { return active.get(normalizeComparablePath(projectPath)) ?? null },
    async start(input: { projectPath: string; operation: MaintenanceOperation; model?: string }, execute: (context: MaintenanceTaskContext) => Promise<Record<string, unknown>>, summarizeError: (error: unknown) => string = String): Promise<MaintenanceProgress> {
      const projectPath = normalizeComparablePath(input.projectPath)
      if (active.has(projectPath)) throw new Error("该项目已有维护任务正在执行，请先查询进度。")
      const runId = crypto.randomUUID(), now = Date.now(), progressPath = key(projectPath, runId)
      const entry: Entry = { state: {
        version: 1, runId, projectPath, progressPath, operation: input.operation, model: input.model,
        status: "running", revision: 1, stage: "准备维护任务", logs: [], startedAt: now, updatedAt: now,
      }, controller: new AbortController(), listeners: new Set(), writes: Promise.resolve() }
      active.set(projectPath, runId); entries.set(progressPath, entry)
      try { await io.write(progressPath, JSON.stringify(entry.state, null, 2)) }
      catch (error) { active.delete(projectPath); entries.delete(progressPath); throw error }
      void (async () => {
        try {
          const result = await execute({
            signal: entry.controller!.signal,
            report: (stage, progress) => update(entry, { stage, ...(progress ? { progress } : {}) }),
            log: (message) => update(entry, { logs: [...entry.state.logs.slice(-49), message.slice(0, 2000)] }),
          })
          update(entry, { status: "completed", stage: "维护任务完成", result, finishedAt: Date.now() })
        } catch (error) {
          const cancelled = entry.controller!.signal.aborted
          update(entry, { status: cancelled ? "cancelled" : "failed", stage: cancelled ? "扫描已取消" : "维护任务失败", error: cancelled ? undefined : summarizeError(error), finishedAt: Date.now() })
        } finally {
          await entry.writes
          if (active.get(projectPath) === runId) active.delete(projectPath)
          entry.controller = undefined
        }
      })()
      return copy(entry)
    },
    async get(input: { projectPath: string; runId: string; afterRevision?: number; waitMs?: number }): Promise<MaintenanceProgress & { changed: boolean }> {
      if (input.afterRevision !== undefined && (!Number.isInteger(input.afterRevision) || input.afterRevision < 0)) throw new Error("afterRevision 必须是非负整数")
      const waitMs = input.waitMs ?? 0
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error("waitMs 必须在 0–30000 之间")
      const entry = await load(input.projectPath, input.runId)
      if (entry.state.status === "running" && input.afterRevision === entry.state.revision && waitMs > 0) {
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); entry.listeners.delete(done); resolve() }
          const timer = setTimeout(done, waitMs)
          entry.listeners.add(done)
          if (entry.state.revision !== input.afterRevision) done()
        })
      }
      return { ...copy(entry), changed: input.afterRevision === undefined || entry.state.revision !== input.afterRevision }
    },
    async stop(projectPath: string, runId: string): Promise<MaintenanceProgress> {
      const entry = await load(projectPath, runId)
      if (entry.state.status !== "running") return copy(entry)
      if (entry.state.operation !== "scan") throw new Error("清理或撤销正在同步数据，不能中途停止；完成后可以撤销清理。")
      entry.controller?.abort()
      update(entry, { stage: "正在取消扫描" })
      return copy(entry)
    },
  }
}

export const maintenanceProgressStore = createMaintenanceProgressStore()
export async function lastMemoryCleanupId(projectPath: string): Promise<string | null> {
  const path = `${normalizeComparablePath(projectPath)}/.qmai/memory-cleanup-last.json`
  if (!await fileExists(path)) return null
  const data = JSON.parse(await readFile(path)) as { dir?: string }
  return typeof data.dir === "string" ? data.dir.replace(/\\/g, "/").split("/").pop() ?? null : null
}
