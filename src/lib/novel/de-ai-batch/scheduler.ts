import type { DeAiBatchTaskRecord } from "./types"

export interface DeAiBatchAgent {
  run(): Promise<DeAiBatchTaskRecord>
  dispose(): void
}

interface DeAiBatchSchedulerSnapshot {
  concurrency: number
  activeTaskIds: string[]
  queuedTaskIds: string[]
  disposed: boolean
}

interface DeAiBatchSchedulerOptions {
  concurrency?: number
  createAgent(record: DeAiBatchTaskRecord): DeAiBatchAgent
  initialRecords?: DeAiBatchTaskRecord[]
  onChange?: (snapshot: DeAiBatchSchedulerSnapshot) => void
  onTaskComplete?: (record: DeAiBatchTaskRecord) => void
  onTaskError?: (record: DeAiBatchTaskRecord, error: Error) => void
}

interface ActiveAgent {
  agent: DeAiBatchAgent
  disposed: boolean
  cancelled: boolean
}

export function clampDeAiBatchConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(5, Math.max(1, Math.floor(value)))
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function createDeAiBatchScheduler(options: DeAiBatchSchedulerOptions) {
  let concurrency = clampDeAiBatchConcurrency(options.concurrency ?? 3)
  let disposed = false
  const queue: DeAiBatchTaskRecord[] = []
  const active = new Map<string, ActiveAgent>()
  const knownTaskIds = new Set<string>()
  const idleWaiters = new Set<() => void>()

  function getSnapshot(): DeAiBatchSchedulerSnapshot {
    return {
      concurrency,
      activeTaskIds: Array.from(active.keys()),
      queuedTaskIds: queue.map((record) => record.task.id),
      disposed,
    }
  }

  function publish(): void {
    options.onChange?.(getSnapshot())
  }

  function resolveIdle(): void {
    if (!disposed && (queue.length > 0 || active.size > 0)) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  }

  function disposeAgent(entry: ActiveAgent): void {
    if (entry.disposed) return
    entry.disposed = true
    entry.agent.dispose()
  }

  function pump(): void {
    if (disposed) {
      resolveIdle()
      return
    }
    while (active.size < concurrency && queue.length > 0) {
      const record = queue.shift()!
      const id = record.task.id
      const entry: ActiveAgent = {
        agent: options.createAgent(record),
        disposed: false,
        cancelled: false,
      }
      active.set(id, entry)
      publish()
      void entry.agent.run()
        .then((result) => { if (!entry.cancelled) options.onTaskComplete?.(result) })
        .catch((error) => { if (!entry.cancelled) options.onTaskError?.(record, toError(error)) })
        .finally(() => {
          disposeAgent(entry)
          if (active.get(id) !== entry) return
          active.delete(id)
          knownTaskIds.delete(id)
          publish()
          pump()
          resolveIdle()
        })
    }
    publish()
    resolveIdle()
  }

  function enqueue(records: DeAiBatchTaskRecord | DeAiBatchTaskRecord[]): void {
    if (disposed) return
    const items = Array.isArray(records) ? records : [records]
    for (const record of items) {
      if (knownTaskIds.has(record.task.id)) continue
      knownTaskIds.add(record.task.id)
      queue.push(record)
    }
    publish()
    pump()
  }

  function cancel(taskId: string): boolean {
    const queuedIndex = queue.findIndex((record) => record.task.id === taskId)
    if (queuedIndex >= 0) {
      queue.splice(queuedIndex, 1)
      knownTaskIds.delete(taskId)
      publish()
      resolveIdle()
      return true
    }
    const entry = active.get(taskId)
    if (!entry) return false
    entry.cancelled = true
    disposeAgent(entry)
    publish()
    return true
  }
  function setConcurrency(value: number): void {
    concurrency = clampDeAiBatchConcurrency(value)
    publish()
    pump()
  }

  function whenIdle(): Promise<void> {
    if (disposed || (queue.length === 0 && active.size === 0)) return Promise.resolve()
    return new Promise((resolve) => idleWaiters.add(resolve))
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    queue.length = 0
    for (const entry of active.values()) disposeAgent(entry)
    publish()
    resolveIdle()
  }

  return { enqueue, cancel, setConcurrency, getSnapshot, whenIdle, dispose }
}
