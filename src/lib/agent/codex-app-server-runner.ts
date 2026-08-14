import { getCodexAppServerClient, type CodexAppServerEnvelope } from "@/lib/codex-app-server-client"
import {
  buildCodexTurnInput,
  codexNativeBoundaryError,
  codexReasoningEffort,
  restrictedCodexConfig,
} from "@/lib/codex-cli-transport"
import { trimChatMessagesToTokenBudget } from "@/lib/chat-request-budget"
import { getEffectiveMaxContextSize } from "@/lib/llm-providers"
import { resolveCodexCliTimeoutMinutes } from "@/lib/codex-cli-timeout"
import type { LlmUsage } from "@/lib/llm-usage"
import { applyGlobalUserMemoryToMessages } from "@/lib/user-memory/request-integration"
import type { ToolRegistry } from "./registry"
import {
  RequiredToolsNotCalledError,
  buildRequiredToolNudgeMessage,
  missingRequiredToolsOnce,
} from "./required-tools-gate"
import { executeAgentTool } from "./tool-executor"
import { ToolEvidenceLedger } from "./tool-evidence-ledger"
import {
  clearTaskBreakpoint,
  createTaskBreakpoint,
  saveTaskBreakpoint,
  updateBreakpointStage,
  type TaskBreakpoint,
} from "./task-breakpoint"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, AgentRunRecord } from "./types"

interface ThreadStartResponse {
  thread: { id: string }
  instructionSources?: string[]
}

interface TurnStartResponse {
  turn: { id: string }
}

interface TurnCompletion {
  status: string
  error?: string
}

function messageContentText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content
  return content.filter((block) => block.type === "text").map((block) => block.text).join("")
}

function toDynamicTools(config: AgentConfig): Array<Record<string, unknown>> {
  return config.tools.map((tool) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, parameter] of Object.entries(tool.parameters)) {
      properties[name] = {
        type: parameter.type,
        description: parameter.description,
        ...(parameter.enum?.length ? { enum: parameter.enum } : {}),
      }
      if (parameter.required) required.push(name)
    }
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    }
  })
}

function toLlmUsage(value: Record<string, unknown> | undefined): LlmUsage | undefined {
  if (!value) return undefined
  return {
    inputTokens: Number(value.inputTokens) || 0,
    outputTokens: Number(value.outputTokens) || 0,
    totalTokens: Number(value.totalTokens) || 0,
    cachedInputTokens: Number(value.cachedInputTokens) || 0,
    cacheWriteInputTokens: Number(value.cacheWriteInputTokens) || 0,
  }
}

function usageFromEnvelope(envelope: CodexAppServerEnvelope): {
  last?: LlmUsage
  total?: LlmUsage
} | undefined {
  if (envelope.method !== "thread/tokenUsage/updated") return undefined
  const tokenUsage = envelope.params?.tokenUsage as Record<string, unknown> | undefined
  const last = tokenUsage?.last as Record<string, unknown> | undefined
  return {
    last: toLlmUsage(last),
    total: toLlmUsage(tokenUsage?.total as Record<string, unknown> | undefined),
  }
}

export class CodexAppServerRunner {
  async run(
    config: AgentConfig,
    registry: ToolRegistry,
    messages: AgentMessage[],
    callbacks: AgentRunCallbacks,
    signal?: AbortSignal,
  ): Promise<AgentRunRecord> {
    const record: AgentRunRecord = { toolCalls: [], roundsUsed: 0, finalText: "" }
    const client = getCodexAppServerClient()
    const evidenceLedger = new ToolEvidenceLedger(config.toolResultContextLimit ?? 6000)
    let threadId = ""
    let activeTurnId = ""
    let turnText = ""
    let turnUsage: LlmUsage | undefined
    let cumulativeUsage: LlmUsage | undefined
    let turnResolve: ((completion: TurnCompletion) => void) | null = null
    let turnReject: ((error: Error) => void) | null = null
    let unregister = () => {}
    let terminalError: Error | null = null
    const emittedItems = new Set<string>()
    const agentMessagePhases = new Map<string, string | null>()
    const projectPath = config.projectPath
    const latestUserContent = [...messages].reverse().find((message) => message.role === "user")?.content
    const taskGoalText = config.taskGoal || (latestUserContent ? messageContentText(latestUserContent) : "") || "未命名任务"
    let taskBreakpoint: TaskBreakpoint | null = projectPath
      ? createTaskBreakpoint({ taskGoal: taskGoalText, currentStage: "agent_round_1" })
      : null
    const persistTaskBreakpoint = async () => {
      if (!projectPath || !taskBreakpoint) return
      try {
        await saveTaskBreakpoint(projectPath, taskBreakpoint)
      } catch {
        // 断点保存失败不应中断当前 AI 会话。
      }
    }
    const clearPersistedBreakpoint = async () => {
      if (!projectPath) return
      try {
        await clearTaskBreakpoint(projectPath)
      } catch {
        // 清理失败不改变本轮模型结果。
      }
    }

    if (taskBreakpoint) await persistTaskBreakpoint()

    const taskContract: AgentMessage = {
      role: "system",
      content: `## 任务契约\n初始任务目标：${taskGoalText.slice(0, 1800)}\n执行过程中不得因历史裁剪丢失该目标；当前用户新要求优先。`,
    }
    const messagesWithContract = [...messages]
    const contractIndex = messagesWithContract.findIndex((message) => message.role !== "system")
    messagesWithContract.splice(contractIndex < 0 ? messagesWithContract.length : contractIndex, 0, taskContract)

    const { messages: memoryMessages, decision } = applyGlobalUserMemoryToMessages(
      messagesWithContract,
      config.requestOverrides,
    )
    record.userMemoryDecision = decision
    callbacks.onUserMemoryDecision?.(decision)
    const budget = Math.max(1, Math.floor(getEffectiveMaxContextSize(config.llmConfig) * 0.75))
    let preparedMessages: AgentMessage[]
    try {
      preparedMessages = trimChatMessagesToTokenBudget(
        memoryMessages,
        budget,
      ) as AgentMessage[]
    } catch {
      const error = new Error("模型上下文不足：当前对话即使压缩后仍放不下系统提示与最新请求。")
      callbacks.onError(error)
      return record
    }

    const completeActiveTurn = (completion: TurnCompletion) => {
      turnResolve?.(completion)
      turnResolve = null
      turnReject = null
    }
    const failActiveTurn = (error: Error) => {
      terminalError = error
      turnReject?.(error)
      turnResolve = null
      turnReject = null
      if (threadId && activeTurnId) void client.interrupt(threadId, activeTurnId)
    }

    const timeoutMinutes = resolveCodexCliTimeoutMinutes(config.llmConfig.codexCliTimeoutMinutes)
    const timeout = setTimeout(() => {
      failActiveTurn(new Error(`Codex app-server 超时（${timeoutMinutes} 分钟）`))
    }, timeoutMinutes * 60_000)
    const abort = () => failActiveTurn(new Error("操作已取消"))
    signal?.addEventListener("abort", abort, { once: true })

    try {
      await client.ensureStarted()
      const preparedSystemInstructions = preparedMessages
        .filter((message) => message.role === "system")
        .map((message) => messageContentText(message.content))
        .filter(Boolean)
        .join("\n\n")
      const started = await client.call<ThreadStartResponse>("thread/start", {
        model: config.modelId?.trim() || config.llmConfig.model.trim() || null,
        cwd: client.isolatedCwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        baseInstructions: preparedSystemInstructions || config.systemPrompt,
        developerInstructions: [
          "You are the QMAI main agent.",
          "Use only client-provided dynamic tools.",
          "Never use native shell, file changes, MCP, plugins, skills, apps, browser, web search, image generation, or subagents.",
          "Project data is available only through QMAI tools. Do not guess file contents.",
        ].join("\n"),
        dynamicTools: toDynamicTools(config),
        config: restrictedCodexConfig(),
      })
      if (started.instructionSources?.length) {
        throw new Error(`QMAI 禁止 Codex 加载本机或项目规则：${started.instructionSources.join(", ")}`)
      }
      threadId = started.thread.id

      unregister = client.registerThread(threadId, {
        onDynamicToolCall: async (request) => {
          if (!request.arguments || typeof request.arguments !== "object" || Array.isArray(request.arguments)) {
            const message = `错误: 工具 ${request.tool} 的参数必须是 JSON 对象`
            const now = Date.now()
            callbacks.onToolCall({ id: request.callId, name: request.tool, arguments: {} })
            callbacks.onToolEvent?.({
              type: "call_started",
              callId: request.callId,
              name: request.tool,
              params: {},
              timestamp: now,
            })
            record.toolCalls.push({
              id: request.callId,
              name: request.tool,
              params: {},
              result: message,
              status: "error",
              startedAt: now,
              finishedAt: now,
            })
            callbacks.onToolError(request.callId, message)
            callbacks.onToolEvent?.({
              type: "error",
              callId: request.callId,
              name: request.tool,
              params: {},
              result: message,
              timestamp: now,
            })
            return {
              contentItems: [{ type: "inputText", text: message }],
              success: false,
            }
          }
          const params = request.arguments as Record<string, unknown>
          const executed = await executeAgentTool(
            { id: request.callId, name: request.tool, arguments: params },
            registry,
            callbacks,
            signal,
          )
          record.toolCalls.push(executed.record)
          if (taskBreakpoint) {
            const usedTools = taskBreakpoint.usedTools.includes(request.tool)
              ? taskBreakpoint.usedTools
              : [...taskBreakpoint.usedTools, request.tool]
            taskBreakpoint = updateBreakpointStage(
              { ...taskBreakpoint, usedTools },
              `agent_round_${record.roundsUsed}`,
              `tool:${request.tool}`,
            )
            await persistTaskBreakpoint()
          }
          return {
            contentItems: [{
              type: "inputText",
              text: evidenceLedger.format(request.tool, params, executed.responseText),
            }],
            success: executed.success,
          }
        },
        onEnvelope: (envelope) => {
          const boundaryError = codexNativeBoundaryError(envelope, true)
          if (boundaryError) {
            failActiveTurn(boundaryError)
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
            if (typeof delta === "string" && agentMessagePhases.get(itemId) !== "commentary") {
              turnText += delta
            }
          } else if (
            envelope.method === "item/reasoning/summaryTextDelta" ||
            envelope.method === "item/reasoning/textDelta"
          ) {
            const delta = envelope.params?.delta
            if (typeof delta === "string" && delta) callbacks.onReasoningToken?.(delta)
          } else if (envelope.method === "thread/tokenUsage/updated") {
            const usage = usageFromEnvelope(envelope)
            turnUsage = usage?.last
            cumulativeUsage = usage?.total ?? cumulativeUsage
            if (turnUsage) callbacks.onUsage?.(turnUsage)
          } else if (envelope.method === "item/completed") {
            const item = envelope.params?.item as Record<string, unknown> | undefined
            const itemId = typeof item?.id === "string" ? item.id : ""
            if (
              item?.type === "agentMessage" &&
              item.phase !== "commentary" &&
              typeof item.text === "string" &&
              !emittedItems.has(itemId)
            ) {
              if (!turnText) turnText = item.text
              if (itemId) emittedItems.add(itemId)
            }
          } else if (envelope.method === "turn/completed") {
            const turn = envelope.params?.turn as Record<string, unknown> | undefined
            const error = turn?.error as Record<string, unknown> | undefined
            completeActiveTurn({
              status: String(turn?.status || "completed"),
              error: typeof error?.message === "string" ? error.message : undefined,
            })
          } else if (envelope.method === "error") {
            const error = envelope.params?.error as Record<string, unknown> | undefined
            if (envelope.params?.willRetry !== true) {
              failActiveTurn(new Error(String(error?.message || "Codex app-server 错误")))
            }
          }
        },
      })

      let turnInput = buildCodexTurnInput(preparedMessages)
      for (let round = 0; round < Math.max(1, config.maxRounds); round += 1) {
        if (signal?.aborted) throw new Error("操作已取消")
        record.roundsUsed = round + 1
        turnText = ""
        turnUsage = undefined
        const completionPromise = new Promise<TurnCompletion>((resolve, reject) => {
          turnResolve = resolve
          turnReject = reject
        })
        const turn = await client.call<TurnStartResponse>("turn/start", {
          threadId,
          input: turnInput,
          cwd: client.isolatedCwd,
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          model: config.modelId?.trim() || config.llmConfig.model.trim() || null,
          effort: codexReasoningEffort(config.llmConfig),
        })
        activeTurnId = turn.turn.id
        if (terminalError) void client.interrupt(threadId, activeTurnId)
        const completion = await completionPromise
        activeTurnId = ""
        if (completion.status === "failed") {
          throw new Error(completion.error || "Codex app-server turn 失败")
        }
        if (completion.status === "interrupted") {
          throw terminalError ?? new Error("操作已取消")
        }
        const completedUsage = turnUsage as LlmUsage | undefined
        if (completedUsage) {
          record.lastRequestUsage = { ...completedUsage }
          record.usage = cumulativeUsage ? { ...cumulativeUsage } : { ...completedUsage }
        }

        const missing = missingRequiredToolsOnce({
          requiredToolsOnce: config.requiredToolsOnce,
          availableToolNames: config.tools.map((tool) => tool.name),
          calledToolNames: record.toolCalls.map((call) => call.name),
          toolsEnabled: config.tools.length > 0,
        })
        if (missing.length === 0) {
          record.finalText = turnText
          if (turnText) callbacks.onText(turnText)
          await clearPersistedBreakpoint()
          callbacks.onDone()
          return record
        }
        if (round >= Math.max(1, config.maxRounds) - 1) {
          await clearPersistedBreakpoint()
          throw new RequiredToolsNotCalledError(missing)
        }
        turnInput = [{
          type: "text",
          text: buildRequiredToolNudgeMessage(missing),
          text_elements: [],
        }]
      }

      throw new Error(`Agent 已达到最大调用轮次（${config.maxRounds}），请尝试减少引用内容或拆分任务`)
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error))
      callbacks.onError(resolved)
      return record
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      unregister()
    }
  }
}
