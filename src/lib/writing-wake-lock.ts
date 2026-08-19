import { isTauri } from "@/lib/platform"

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export interface WritingWakeLockBindings {
  isTauri: () => boolean
  invoke: TauriInvoke
  warn: (message: string, error: unknown) => void
}

const defaultBindings: WritingWakeLockBindings = {
  isTauri,
  invoke: async <T>(command: string, args?: Record<string, unknown>) => {
    const { invoke } = await import("@tauri-apps/api/core")
    return invoke<T>(command, args)
  },
  warn: (message, error) => console.warn(message, error),
}

let holdCount = 0
let sharedToken: string | null = null
let mutex: Promise<void> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutex.then(task, task)
  mutex = run.then(() => undefined, () => undefined)
  return run
}

async function acquireSharedLock(bindings: WritingWakeLockBindings): Promise<void> {
  await enqueue(async () => {
    holdCount += 1
    if (holdCount !== 1) return
    try {
      sharedToken = await bindings.invoke<string>("acquire_writing_wake_lock")
    } catch (error) {
      sharedToken = null
      bindings.warn("[writing-wake-lock] 启用失败，继续执行正文生成", error)
    }
  })
}

async function releaseSharedLock(bindings: WritingWakeLockBindings): Promise<void> {
  await enqueue(async () => {
    holdCount = Math.max(0, holdCount - 1)
    if (holdCount !== 0) return
    const token = sharedToken
    sharedToken = null
    if (!token) return
    try {
      await bindings.invoke<void>("release_writing_wake_lock", { token })
    } catch (error) {
      bindings.warn("[writing-wake-lock] 释放失败，将在应用退出时清理", error)
    }
  })
}

export function resetWritingWakeLockForTests(): void {
  holdCount = 0
  sharedToken = null
  mutex = Promise.resolve()
}

export async function withWritingWakeLock<T>(
  enabled: boolean,
  operation: () => Promise<T>,
  bindings: WritingWakeLockBindings = defaultBindings,
): Promise<T> {
  if (!enabled || !bindings.isTauri()) {
    return operation()
  }

  await acquireSharedLock(bindings)
  try {
    return await operation()
  } finally {
    await releaseSharedLock(bindings)
  }
}
