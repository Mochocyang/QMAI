import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type JsonRpcId = string | number

export interface CodexAppServerEnvelope {
  jsonrpc?: "2.0"
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

interface StartResult {
  generation: number
  cwd: string
}

interface EventPayload {
  generation: number
  line: string
}

interface ExitPayload {
  generation: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface DynamicToolCallRequest {
  threadId: string
  turnId: string
  callId: string
  namespace: string | null
  tool: string
  arguments: unknown
}

export interface DynamicToolCallResponse {
  contentItems: Array<{ type: "inputText"; text: string }>
  success: boolean
}

export interface CodexThreadHandler {
  onEnvelope?: (envelope: CodexAppServerEnvelope) => void
  onDynamicToolCall?: (request: DynamicToolCallRequest) => Promise<DynamicToolCallResponse>
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000
const APP_SERVER_EXIT_MESSAGE = "Codex app-server 已退出；本轮请求不会自动重放"
const APP_SERVER_UPGRADE_MESSAGE = "当前 Codex CLI 不支持 QMAI 主 Agent，请升级 Codex CLI"

function rpcError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  if (typeof error === "string" && error.trim()) return new Error(error)
  return new Error(fallback)
}

export class CodexAppServerClient {
  private nextId = 1
  private generation: number | null = null
  private cwd = ""
  private startPromise: Promise<void> | null = null
  private initializedGeneration: number | null = null
  private pending = new Map<JsonRpcId, PendingRequest>()
  private handlers = new Map<string, CodexThreadHandler>()
  private unlistenEvent: UnlistenFn | null = null
  private unlistenExit: UnlistenFn | null = null
  private listenersPromise: Promise<void> | null = null

  get isolatedCwd(): string {
    return this.cwd
  }

  async ensureStarted(): Promise<void> {
    if (this.generation !== null && this.initializedGeneration === this.generation) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<T> {
    await this.ensureStarted()
    return this.rawCall<T>(method, params, timeoutMs)
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.ensureStarted()
    await this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })
  }

  registerThread(threadId: string, handler: CodexThreadHandler): () => void {
    this.handlers.set(threadId, handler)
    return () => {
      if (this.handlers.get(threadId) === handler) this.handlers.delete(threadId)
    }
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.call("turn/interrupt", { threadId, turnId }).catch(() => undefined)
  }

  async stop(): Promise<void> {
    this.rejectAll(new Error(APP_SERVER_EXIT_MESSAGE))
    this.generation = null
    this.initializedGeneration = null
    this.cwd = ""
    this.handlers.clear()
    await invoke("codex_app_server_stop")
  }

  private async startInternal(): Promise<void> {
    await this.ensureListeners()
    const started = await invoke<StartResult>("codex_app_server_start")
    const changed = this.generation !== started.generation
    this.generation = started.generation
    this.cwd = started.cwd
    if (!changed && this.initializedGeneration === started.generation) return

    try {
      const initialized = await this.rawCall<{ userAgent?: string }>("initialize", {
        clientInfo: { name: "QMaiWrite", title: "QMaiWrite", version: "3.1.8" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      })
      if (!initialized || typeof initialized !== "object") {
        throw new Error("Codex app-server initialize 返回无效")
      }
      await this.send({ jsonrpc: "2.0", method: "initialized" })
      let probe: { instructionSources?: string[] }
      try {
        probe = await this.rawCall("thread/start", {
          cwd: this.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          baseInstructions: "QMAI capability probe. Do not use native tools.",
          developerInstructions: "Use only client-provided dynamic tools.",
          dynamicTools: [{
            type: "function",
            name: "qmai_capability_probe",
            description: "QMAI capability probe; never call it.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          }],
        })
      } catch (error) {
        throw new Error(`${APP_SERVER_UPGRADE_MESSAGE}。${rpcError(error, APP_SERVER_UPGRADE_MESSAGE).message}`)
      }
      if (probe.instructionSources?.length) {
        throw new Error(`QMAI 禁止 Codex 加载本机或项目规则：${probe.instructionSources.join(", ")}`)
      }
      this.initializedGeneration = started.generation
    } catch (error) {
      this.generation = null
      this.initializedGeneration = null
      this.cwd = ""
      await invoke("codex_app_server_stop").catch(() => undefined)
      throw error
    }
  }

  private async ensureListeners(): Promise<void> {
    if (this.unlistenEvent && this.unlistenExit) return
    if (this.listenersPromise) return this.listenersPromise
    this.listenersPromise = (async () => {
      this.unlistenEvent = await listen<EventPayload>("codex-app-server:event", (event) => {
        const payload = event.payload
        if (!payload || payload.generation !== this.generation) return
        this.handleLine(payload.line)
      })
      this.unlistenExit = await listen<ExitPayload>("codex-app-server:exit", (event) => {
        if (event.payload?.generation !== this.generation) return
        this.generation = null
        this.initializedGeneration = null
        this.cwd = ""
        const error = new Error(APP_SERVER_EXIT_MESSAGE)
        this.rejectAll(error)
        for (const handler of this.handlers.values()) {
          handler.onEnvelope?.({ method: "qmai/app-server-exit", params: { message: error.message } })
        }
        this.handlers.clear()
      })
    })().finally(() => {
      this.listenersPromise = null
    })
    return this.listenersPromise
  }

  private rawCall<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server 调用超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      void this.send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      }).catch((error) => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(rpcError(error, `Codex app-server 写入失败：${method}`))
      })
    })
  }

  private async send(envelope: CodexAppServerEnvelope): Promise<void> {
    if (this.generation === null) throw new Error("Codex app-server 未启动")
    await invoke("codex_app_server_write", {
      generation: this.generation,
      data: JSON.stringify(envelope),
    })
  }

  private handleLine(line: string): void {
    let envelope: CodexAppServerEnvelope
    try {
      envelope = JSON.parse(line) as CodexAppServerEnvelope
    } catch {
      return
    }

    if (envelope.id !== undefined && !envelope.method) {
      const pending = this.pending.get(envelope.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(envelope.id)
      if (envelope.error) {
        pending.reject(new Error(envelope.error.message || "Codex app-server 调用失败"))
      } else {
        pending.resolve(envelope.result)
      }
      return
    }

    const threadId = typeof envelope.params?.threadId === "string"
      ? envelope.params.threadId
      : null
    const handler = threadId ? this.handlers.get(threadId) : undefined
    handler?.onEnvelope?.(envelope)

    if (envelope.id === undefined || !envelope.method) return
    if (envelope.method === "item/tool/call" && handler?.onDynamicToolCall) {
      void handler.onDynamicToolCall(envelope.params as unknown as DynamicToolCallRequest)
        .then((result) => this.send({ jsonrpc: "2.0", id: envelope.id!, result }))
        .catch((error) => this.send({
          jsonrpc: "2.0",
          id: envelope.id!,
          result: {
            contentItems: [{ type: "inputText", text: rpcError(error, "QMAI 工具执行失败").message }],
            success: false,
          },
        }))
        .catch(() => undefined)
      return
    }

    void this.send({
      jsonrpc: "2.0",
      id: envelope.id,
      error: {
        code: -32601,
        message: `QMAI 禁止 Codex 原生能力：${envelope.method}`,
      },
    }).catch(() => undefined)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

let sharedClient: CodexAppServerClient | null = null

export function getCodexAppServerClient(): CodexAppServerClient {
  if (!sharedClient) sharedClient = new CodexAppServerClient()
  return sharedClient
}

export function resetCodexAppServerClientForTests(): void {
  sharedClient = null
}
