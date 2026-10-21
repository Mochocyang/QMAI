/**
 * Antigravity CLI subprocess transport.
 *
 * Rust counterpart: src-tauri/src/commands/antigravity_cli.rs. The child is
 * `agy --input-format stream-json --output-format stream-json` with cwd set
 * to an empty temp directory. Stdout is NDJSON. Assistant text arrives as
 * `step_update.step_type === "agent_response"` `text_delta` fragments.
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { LlmConfig } from "@/stores/wiki-store"
import type { LlmUsage } from "@/lib/llm-usage"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"

export interface AntigravityParseState {
  token: string | null
  usage?: LlmUsage
  terminalStatus?: string
  terminalError?: string
}

export function createAntigravityStreamParser() {
  let sawDelta = false

  return function parseLine(rawLine: string): AntigravityParseState {
    const line = rawLine.trim()
    if (!line) return { token: null }

    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      return { token: null }
    }
    if (!evt || typeof evt !== "object") return { token: null }
    const obj = evt as Record<string, unknown>

    if (obj.event === "step_update") {
      const step = obj.step_update
      if (!step || typeof step !== "object") return { token: null }
      const update = step as Record<string, unknown>
      if (update.step_type !== "agent_response" || typeof update.text_delta !== "string") {
        return { token: null }
      }
      if (!update.text_delta) return { token: null }
      sawDelta = true
      return { token: update.text_delta }
    }

    if (obj.event === "result") {
      const result = obj.result
      if (!result || typeof result !== "object") return { token: null }
      const payload = result as Record<string, unknown>
      const status = typeof payload.status === "string" ? payload.status : undefined
      const error = typeof payload.error === "string" ? payload.error : undefined
      const usage = readUsage(payload.usage)
      let token: string | null = null
      if (!sawDelta && status === "SUCCESS" && typeof payload.response === "string" && payload.response) {
        sawDelta = true
        token = payload.response
      }
      return {
        token,
        usage,
        terminalStatus: status,
        terminalError: error,
      }
    }

    return { token: null }
  }
}

function readUsage(value: unknown): LlmUsage | undefined {
  if (!value || typeof value !== "object") return undefined
  const usage = value as Record<string, unknown>
  const next: LlmUsage = {}
  if (typeof usage.input_tokens === "number") next.inputTokens = usage.input_tokens
  if (typeof usage.output_tokens === "number") next.outputTokens = usage.output_tokens
  if (typeof usage.total_tokens === "number") next.totalTokens = usage.total_tokens
  if (typeof usage.cache_read_tokens === "number") next.cachedInputTokens = usage.cache_read_tokens
  return Object.keys(next).length > 0 ? next : undefined
}

type SpawnPayload = Record<string, unknown> & {
  streamId: string
  model: string
  messages: ChatMessage[]
}

export async function streamAntigravityCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  const { onToken, onDone, onError, onUsage } = callbacks

  if (import.meta.env?.DEV && overrides) {
    for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
      if (overrides[key] !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(`[antigravity-cli] 忽略不支持的参数 "${key}"：agy 没有对应开关`)
      }
    }
  }

  const streamId = crypto.randomUUID()
  const parse = createAntigravityStreamParser()
  let unlistenData: UnlistenFn | (() => void) | undefined
  let unlistenDone: UnlistenFn | (() => void) | undefined
  let finished = false
  let aborted = signal?.aborted ?? false
  let emittedToken = false
  let terminalStatus: string | undefined
  let terminalError: string | undefined
  let resolveCompletion: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const cleanup = () => {
    unlistenData?.()
    unlistenDone?.()
  }

  const finishWith = (cb: () => void) => {
    if (finished) return
    finished = true
    cleanup()
    cb()
    resolveCompletion()
  }

  const abortListener = () => {
    aborted = true
    void invoke("antigravity_cli_kill", { streamId }).catch(() => {})
    finishWith(onDone)
  }
  if (aborted) {
    finishWith(onDone)
    return
  }
  signal?.addEventListener("abort", abortListener)

  try {
    unlistenData = await listen<string>(`antigravity-cli:${streamId}`, (event) => {
      const parsed = parse(event.payload)
      if (parsed.usage) onUsage?.(parsed.usage)
      if (parsed.terminalStatus) terminalStatus = parsed.terminalStatus
      if (parsed.terminalError) terminalError = parsed.terminalError
      if (parsed.token !== null) {
        emittedToken = true
        onToken(parsed.token)
      }
      if (parsed.terminalStatus && parsed.terminalStatus !== "SUCCESS") {
        finishWith(() => onError(new Error(failureMessage(parsed.terminalStatus, parsed.terminalError))))
      }
    })
    if (aborted || finished) {
      cleanup()
      return
    }

    unlistenDone = await listen<{ code: number | null; stderr: string }>(
      `antigravity-cli:${streamId}:done`,
      (event) => {
        const code = event.payload?.code
        const stderr = stripAuthNoise(event.payload?.stderr ?? "")
        if (terminalStatus && terminalStatus !== "SUCCESS") {
          finishWith(() => onError(new Error(failureMessage(terminalStatus, terminalError || stderr))))
          return
        }
        if (code !== null && code !== undefined && code !== 0 && !emittedToken) {
          finishWith(() => onError(new Error(exitMessage(code, stderr))))
          return
        }
        if (!emittedToken) {
          finishWith(() => onError(new Error(emptyOutputMessage(stderr))))
          return
        }
        finishWith(onDone)
      },
    )
    if (aborted || finished) {
      cleanup()
      return
    }

    const payload: SpawnPayload = {
      streamId,
      model: config.model,
      messages,
    }
    await invoke("antigravity_cli_spawn", payload)

    if (aborted || signal?.aborted) {
      aborted = true
      await invoke("antigravity_cli_kill", { streamId }).catch(() => {})
      finishWith(onDone)
      return
    }
    await completion
  } catch (err) {
    finishWith(() => {
      const message = err instanceof Error ? err.message : String(err)
      if (/not found|No such file|executable file not found|未找到 agy/i.test(message)) {
        onError(new Error("未找到 Antigravity CLI。请安装 agy，或在设置里改用其他模型源。"))
      } else {
        onError(err instanceof Error ? err : new Error(message))
      }
    })
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}

function stripAuthNoise(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !/not logged into antigravity/i.test(line))
    .join("\n")
    .trim()
}

function failureMessage(status: string | undefined, error: string | undefined): string {
  const detail = error?.trim()
  if (detail && /not logged into antigravity|authentication required/i.test(detail)) {
    return "Antigravity CLI 未登录。请在终端运行 agy 完成登录后再试。"
  }
  if (detail) return `Antigravity CLI 失败（${status ?? "ERROR"}）：${detail}`
  return `Antigravity CLI 失败（${status ?? "ERROR"}）。`
}

export function emptyOutputMessage(stderr: string): string {
  if (/no output produced/i.test(stderr) && /permission/i.test(stderr)) {
    return "Antigravity CLI 试图执行命令，无头模式不能弹出授权，所以没有正文。"
  }
  if (stderr) return `Antigravity CLI 没有返回正文：\n${stderr}`
  return "Antigravity CLI 没有返回正文。请在终端运行 agy 确认登录状态。"
}

function exitMessage(code: number, stderr: string): string {
  if (/authentication required|not logged into antigravity|unauthenticated/i.test(stderr)) {
    return "Antigravity CLI 未登录。请在终端运行 agy 完成登录后再试。"
  }
  if (stderr) return `agy 退出码 ${code}：${stderr}`
  return `agy 退出码 ${code}，没有返回正文。请在终端运行 agy 确认登录状态。`
}
