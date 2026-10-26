import { normalizeComparablePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import type { MemoryField } from "./memory-cleanup-policy"
import type { MemoryCleanupScan } from "./memory-cleanup"
import { runMemoryCleanupScan } from "./memory-cleanup-runner"

export interface MemoryCleanupSession {
  projectPath: string
  status: "running" | "completed" | "cancelled" | "failed"
  progress: { done: number; total: number } | null
  scan: MemoryCleanupScan | null
  error: string
  logs: string[]
  controller: AbortController
}

const sessions = new Map<string, MemoryCleanupSession>()
const listeners = new Map<string, Set<() => void>>()

function emit(projectPath: string) {
  for (const listener of listeners.get(projectPath) ?? []) listener()
}

export function memoryCleanupSession(projectPath: string): MemoryCleanupSession | null {
  return sessions.get(normalizeComparablePath(projectPath)) ?? null
}

/** Running scans stay in memory. Idle scans fall back to the validated file, then to the in-memory copy. */
export function visibleMemoryCleanupScan(projectPath: string, cached: MemoryCleanupScan | null): MemoryCleanupScan | null {
  const session = memoryCleanupSession(projectPath)
  if (session?.status === "running") return session.scan ?? cached
  if (cached) return cached
  return session?.scan ?? null
}

export function subscribeMemoryCleanupSession(projectPath: string, listener: () => void): () => void {
  const key = normalizeComparablePath(projectPath)
  const set = listeners.get(key) ?? new Set()
  set.add(listener)
  listeners.set(key, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(key)
  }
}

export function cancelMemoryCleanupSession(projectPath: string): void {
  const session = memoryCleanupSession(projectPath)
  if (!session || session.status !== "running") return
  session.status = "cancelled"
  session.controller.abort()
  emit(session.projectPath)
}

export async function startMemoryCleanupSession(projectPath: string, config: LlmConfig, fields: MemoryField[], current: MemoryCleanupScan | null = null): Promise<void> {
  const key = normalizeComparablePath(projectPath)
  const existing = sessions.get(key)
  if (existing?.status === "running") return
  const session: MemoryCleanupSession = {
    projectPath: key, status: "running", progress: null, scan: current, error: "", logs: [], controller: new AbortController(),
  }
  sessions.set(key, session)
  emit(key)
  try {
    const result = await runMemoryCleanupScan(key, config, {
      fields: [...fields], resume: true, signal: session.controller.signal,
      onLog: (message) => { session.logs = [...session.logs.slice(-99), message]; emit(key) },
      onProgress: (done, total, scan) => {
        session.progress = { done, total }
        if (done > 0 || scan.complete || scan.issues.length > 0) session.scan = scan
        emit(key)
      },
    })
    if (sessions.get(key) !== session || session.controller.signal.aborted) return
    session.scan = result
    session.status = "completed"
    session.progress = null
  } catch (error) {
    if (sessions.get(key) !== session) return
    if (session.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      if (session.status === "running") session.status = "cancelled"
      return
    }
    session.status = "failed"
    session.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    if (sessions.get(key) === session) emit(key)
  }
}

export function resetMemoryCleanupSessionsForTests(): void {
  const running = [...sessions.values()]
  sessions.clear()
  listeners.clear()
  for (const session of running) session.controller.abort()
}
