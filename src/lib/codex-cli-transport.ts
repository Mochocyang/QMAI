import type { LlmConfig } from "@/stores/wiki-store"
import { resolveCodexCliTimeoutMinutes } from "@/lib/codex-cli-timeout"
import { codexAppServerServiceTier } from "@/lib/codex-cli-speed"
import type { ChatMessage, ContentBlock, RequestOverrides } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"
import { getCodexAppServerClient, type CodexAppServerEnvelope } from "./codex-app-server-client"

interface ThreadStartResponse {
  thread: { id: string }
  instructionSources?: string[]
}

interface TurnStartResponse {
  turn: { id: string }
}

const NATIVE_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageGeneration",
  "hookPrompt",
])

const NATIVE_METHOD_PREFIXES = [
  "app/",
  "command/",
  "environment/",
  "fs/",
  "hook/",
  "mcpServer/",
  "plugin/",
  "process/",
  "skills/",
  "thread/backgroundTerminals/",
]

export function restrictedCodexConfig(): Record<string, unknown> {
  return {
    features: {
      apps: false,
      browser_use: false,
      browser_use_external: false,
      browser_use_full_cdp_access: false,
      computer_use: false,
      image_generation: false,
      in_app_browser: false,
      multi_agent: false,
      multi_agent_v2: false,
      plugins: false,
      remote_plugin: false,
      shell_snapshot: false,
      shell_tool: false,
      skill_mcp_dependency_install: false,
      skill_search: false,
    },
    web_search: "disabled",
    project_doc_max_bytes: 0,
    project_doc_fallback_filenames: [],
    project_root_markers: [],
    tools: {
      view_image: false,
      web_search: false,
    },
  }
}

export function codexReasoningEffort(config: LlmConfig): string | null {
  const mode = config.reasoning?.mode
  if (!mode || mode === "auto" || mode === "off" || mode === "custom") return null
  return mode
}

function contentText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n")
}

export function buildCodexTurnInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const nonSystem = messages.filter((message) => message.role !== "system")
  const text = nonSystem
    .map((message) => `<${message.role.toUpperCase()}>\n${contentText(message.content)}\n</${message.role.toUpperCase()}>`)
    .join("\n\n")
  const input: Array<Record<string, unknown>> = [{ type: "text", text, text_elements: [] }]
  for (const message of nonSystem) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type !== "image") continue
      input.push({
        type: "image",
        url: `data:${block.mediaType};base64,${block.dataBase64}`,
      })
    }
  }
  return input
}

export function codexNativeBoundaryError(
  envelope: CodexAppServerEnvelope,
  allowDynamicTools = false,
): Error | null {
  if (envelope.method === "qmai/app-server-exit") {
    return new Error(String(envelope.params?.message || "Codex app-server 已退出"))
  }
  if (envelope.method && NATIVE_METHOD_PREFIXES.some((prefix) => envelope.method!.startsWith(prefix))) {
    return new Error(`QMAI 禁止 Codex 原生能力：${envelope.method}`)
  }
  if (envelope.id !== undefined && envelope.method && !(allowDynamicTools && envelope.method === "item/tool/call")) {
    return new Error(`QMAI 禁止 Codex 原生能力：${envelope.method}`)
  }
  if (envelope.method !== "item/started" && envelope.method !== "item/completed") return null
  const item = envelope.params?.item
  if (!item || typeof item !== "object") return null
  const type = (item as Record<string, unknown>).type
  return typeof type === "string" && NATIVE_ITEM_TYPES.has(type)
    ? new Error(`QMAI 禁止 Codex 原生能力：${type}`)
    : null
}

export async function streamCodexCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  _overrides?: RequestOverrides,
): Promise<void> {
  const client = getCodexAppServerClient()
  let threadId = ""
  let turnId = ""
  let finished = false
  let emittedText = false
  const agentMessagePhases = new Map<string, string | null>()
  let unregister = () => {}
  let resolveTurn = () => {}
  let rejectTurn = (_error: Error) => {}
  const turnDone = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve
    rejectTurn = reject
  })
  const timeoutMinutes = resolveCodexCliTimeoutMinutes(config.codexCliTimeoutMinutes)
  const serviceTier = codexAppServerServiceTier(config.codexSpeedMode)
  const timeoutMs = timeoutMinutes * 60_000
  const timeout = setTimeout(() => {
    if (!finished) {
      if (threadId && turnId) void client.interrupt(threadId, turnId)
      fail(new Error(`Codex app-server 超时（${timeoutMinutes} 分钟）`))
    }
  }, timeoutMs)

  const fail = (error: Error) => {
    if (finished) return
    finished = true
    rejectTurn(error)
  }

  try {
    await client.ensureStarted()
    const systemPrompt = messages
      .filter((message) => message.role === "system")
      .map((message) => contentText(message.content))
      .join("\n\n")
    const started = await client.call<ThreadStartResponse>("thread/start", {
      model: config.model.trim() || null,
      cwd: client.isolatedCwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      baseInstructions: systemPrompt || "You are QMAI's text generation model.",
      developerInstructions: "Only produce the requested text. Never use native tools, shell, file changes, MCP, plugins, skills, apps, browser, or subagents.",
      config: restrictedCodexConfig(),
      ...(serviceTier ? { serviceTier } : {}),
    })
    if (started.instructionSources?.length) {
      throw new Error(`QMAI 禁止 Codex 加载本机或项目规则：${started.instructionSources.join(", ")}`)
    }
    threadId = started.thread.id
    unregister = client.registerThread(threadId, {
      onEnvelope: (envelope) => {
        const boundaryError = codexNativeBoundaryError(envelope)
        if (boundaryError) {
          fail(boundaryError)
          if (turnId) void client.interrupt(threadId, turnId)
          return
        }
        if (envelope.method === "item/started") {
          const item = envelope.params?.item as Record<string, unknown> | undefined
          if (item?.type === "agentMessage" && typeof item.id === "string") {
            agentMessagePhases.set(item.id, typeof item.phase === "string" ? item.phase : null)
          }
        } else if (envelope.method === "item/agentMessage/delta") {
          const delta = envelope.params?.delta
          const itemId = typeof envelope.params?.itemId === "string" ? envelope.params.itemId : ""
          if (typeof delta === "string" && delta && agentMessagePhases.get(itemId) !== "commentary") {
            emittedText = true
            callbacks.onToken(delta)
          }
        } else if (
          envelope.method === "item/reasoning/summaryTextDelta" ||
          envelope.method === "item/reasoning/textDelta"
        ) {
          const delta = envelope.params?.delta
          if (typeof delta === "string" && delta) callbacks.onReasoningToken?.(delta)
        } else if (envelope.method === "thread/tokenUsage/updated") {
          const last = (envelope.params?.tokenUsage as Record<string, unknown> | undefined)?.last as Record<string, unknown> | undefined
          if (last) {
            callbacks.onUsage?.({
              inputTokens: Number(last.inputTokens) || 0,
              outputTokens: Number(last.outputTokens) || 0,
              totalTokens: Number(last.totalTokens) || 0,
              cachedInputTokens: Number(last.cachedInputTokens) || 0,
              cacheWriteInputTokens: Number(last.cacheWriteInputTokens) || 0,
            })
          }
        } else if (envelope.method === "item/completed" && !emittedText) {
          const item = envelope.params?.item as Record<string, unknown> | undefined
          if (item?.type === "agentMessage" && item.phase !== "commentary" && typeof item.text === "string") {
            emittedText = true
            callbacks.onToken(item.text)
          }
        } else if (envelope.method === "turn/completed") {
          const turn = envelope.params?.turn as Record<string, unknown> | undefined
          if (turn?.status === "failed") {
            const error = turn.error as Record<string, unknown> | undefined
            fail(new Error(String(error?.message || "Codex app-server turn 失败")))
          } else if (turn?.status === "interrupted") {
            fail(new Error("操作已取消"))
          } else if (!finished) {
            finished = true
            resolveTurn()
          }
        }
      },
    })
    const turn = await client.call<TurnStartResponse>("turn/start", {
      threadId,
      input: buildCodexTurnInput(messages),
      cwd: client.isolatedCwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      model: config.model.trim() || null,
      effort: codexReasoningEffort(config),
      ...(serviceTier ? { serviceTier } : {}),
    })
    turnId = turn.turn.id
    if (finished) void client.interrupt(threadId, turnId)
    const abort = () => {
      if (turnId) void client.interrupt(threadId, turnId)
      fail(new Error("操作已取消"))
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await turnDone
    } finally {
      signal?.removeEventListener("abort", abort)
    }
    callbacks.onDone()
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  } finally {
    clearTimeout(timeout)
    unregister()
  }
}
