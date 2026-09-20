import { isTauriInvalidResourceIdError } from "./tauri-resource-error"

export const USER_ABORT_MESSAGE = "已停止生成"

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(USER_ABORT_MESSAGE)
}

export function isUserAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (isTauriInvalidResourceIdError(error)) return true
  if (!(error instanceof Error)) return false
  if (error.message === USER_ABORT_MESSAGE) return true
  if (error.name === "AbortError") return true
  return /request cancelled|request canceled|aborted/i.test(error.message)
}

export function rethrowIfUserAbort(error: unknown, signal?: AbortSignal): never | void {
  if (!isUserAbortError(error, signal)) return
  throw new Error(USER_ABORT_MESSAGE)
}
