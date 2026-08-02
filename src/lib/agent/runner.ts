import { streamChat } from "../llm-client"
import type { StreamCallbacks } from "../llm-client"
import { isFunctionCallingEnabled, providerUsesTextToolCalls } from "./config"
import { accumulateToolCalls, parseTextToolCalls } from "./tool-call-parser"
import { toOpenAITools } from "./tools-schema"
import type { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, AgentRunRecord, ToolCall, ToolCallDelta } from "./types"
import { DEFAULT_MAX_ROUNDS, TOOL_EXECUTE_TIMEOUT_MS } from "./types"
import type { TaskBreakpoint } from "./task-breakpoint"
import {
  clearTaskBreakpoint,
  createTaskBreakpoint,
  saveTaskBreakpoint,
  updateBreakpointStage,
} from "./task-breakpoint"
import type { ChatMessage } from "../llm-providers"
import { isReasoningDisabled, isReasoningOnlyResponseError, withReasoningDisabled } from "../reasoning-retry"
import { addLlmUsage } from "../llm-usage"
import { trimChatMessagesToBudget } from "../chat-request-budget"
import { logReasoningReplay } from "../reasoning-replay-debug"
import { ToolEvidenceLedger } from "./tool-evidence-ledger"

export class ModelDoesNotSupportToolsError extends Error {
  constructor() {
    super("当前模型不支持工具调用")
    this.name = "ModelDoesNotSupportToolsError"
  }
}

function messageContentText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
}

function withToolTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  const resolvedTimeoutMs = timeoutMs ?? TOOL_EXECUTE_TIMEOUT_MS
  if (resolvedTimeoutMs <= 0) return operation
  return Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("工具执行超时")), resolvedTimeoutMs),
    ),
  ])
}

export class AgentRunner {
  async run(
    config: AgentConfig,
    registry: ToolRegistry,
    messages: AgentMessage[],
    callbacks: AgentRunCallbacks,
    signal?: AbortSignal,
  ): Promise<AgentRunRecord> {
    const record: AgentRunRecord = { toolCalls: [], roundsUsed: 0, finalText: "" }
    const workingMessages = [...messages]
    let finalText = ""
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS
    const projectPath = config.projectPath
    const taskGoal =
      config.taskGoal ||
      messageContentText([...messages].reverse().find((m) => m.role === "user")?.content ?? "") ||
      "未命名任务"
    const taskContract = `## 任务契约\n初始任务目标：${taskGoal.slice(0, 1800)}\n执行过程中不得因历史裁剪丢失该目标；当前用户新要求优先。`
    const contractInsertIndex = workingMessages.findIndex((message) => message.role !== "system")
    workingMessages.splice(contractInsertIndex < 0 ? workingMessages.length : contractInsertIndex, 0, {
      role: "system",
      content: taskContract,
    })
    const evidenceLedger = new ToolEvidenceLedger(config.toolResultContextLimit ?? 6000)
    let taskBreakpoint: TaskBreakpoint | null = projectPath
      ? createTaskBreakpoint({
          taskGoal,
          currentStage: "agent_round_1",
        })
      : null

    const persistTaskBreakpoint = async () => {
      if (!projectPath || !taskBreakpoint) return
      try {
        await saveTaskBreakpoint(projectPath, taskBreakpoint)
      } catch {
        // 断点保存失败不应中断当前 AI 会话
      }
    }

    const clearPersistedBreakpoint = async () => {
      if (!projectPath) return
      try {
        await clearTaskBreakpoint(projectPath)
      } catch {
        // clearTaskBreakpoint 内部已吞掉错误，这里保持双保险
      }
    }

    if (taskBreakpoint) {
      await persistTaskBreakpoint()
    }

    for (let round = 0; round < maxRounds; round++) {
      record.roundsUsed = round + 1

      if (signal?.aborted) {
        for (const tc of record.toolCalls) {
          if (tc.status === "running") {
            tc.status = "cancelled"
            tc.finishedAt = Date.now()
            callbacks.onToolEvent?.({
              type: "cancelled",
              callId: tc.id,
              name: tc.name,
              params: tc.params,
              timestamp: tc.finishedAt,
            })
          }
        }
        callbacks.onError(new Error("操作已取消"))
        return record
      }

      const toolCallDeltas: ToolCallDelta[] = []
      let roundText = ""
      let roundReasoningContent = ""
      let streamError: Error | undefined

      const streamCallbacks: StreamCallbacks = {
        onToken: (t: string) => {
          roundText += t
        },
        onReasoningToken: (t: string) => {
          roundReasoningContent += t
          callbacks.onReasoningToken?.(t)
        },
        onToolCallDelta: (delta: ToolCallDelta) => {
          toolCallDeltas.push(delta)
        },
        onUsage: (usage) => {
          record.usage = addLlmUsage(record.usage, usage)
        },
        onDone: () => {
          // stream finished
        },
        onError: (err: Error) => {
          streamError = err
        },
      }

      const toolsAllowed = isFunctionCallingEnabled(config.llmConfig) && config.tools.length > 0
      let openaiTools = toolsAllowed ? toOpenAITools(config.tools) : undefined
      let attemptedToolsFallback = false
      const buildRequestOverrides = (baseOverrides = config.requestOverrides) =>
        openaiTools
          ? { ...baseOverrides, tools: openaiTools as any, toolChoice: "auto" as const }
          : baseOverrides
      let requestOverrides = buildRequestOverrides()
      const isToolUnsupportedError = (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        return /function[\s_.-]*call|tool_choice|tools?\s+(?:is|are)\s+not\s+supported|does\s+not\s+support\s+(?:function|tools?)|unsupported\s+(?:function|tools?|tool_choice)|不支持\s*(?:工具|function\s*call|FunctionCall)/i.test(msg)
      }
      const failToolsUnsupported = () => {
        callbacks.onError(new ModelDoesNotSupportToolsError())
        return record
      }
      const streamRound = async () => {
        const internalBudget = Math.max(1, Math.floor((config.llmConfig.maxContextSize || 204_800) * 0.75))
        const compacted = trimChatMessagesToBudget(workingMessages as ChatMessage[], internalBudget) as AgentMessage[]
        workingMessages.splice(0, workingMessages.length, ...compacted)
        await streamChat(
          config.llmConfig,
          workingMessages as ChatMessage[],
          streamCallbacks,
          signal,
          requestOverrides,
        )
      }
      const retryWithoutTools = async () => {
        attemptedToolsFallback = true
        openaiTools = undefined
        roundText = ""
        roundReasoningContent = ""
        toolCallDeltas.length = 0
        streamError = undefined
        requestOverrides = buildRequestOverrides(config.requestOverrides)
        await streamRound()
      }
      try {
        await streamRound()
      } catch (err) {
        if (openaiTools && isToolUnsupportedError(err)) {
          try {
            await retryWithoutTools()
          } catch {
            return failToolsUnsupported()
          }
        } else {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)))
          return record
        }
      }

      if (
        streamError &&
        openaiTools &&
        isToolUnsupportedError(streamError)
      ) {
        try {
          await retryWithoutTools()
        } catch {
          return failToolsUnsupported()
        }
      }

      if (
        streamError &&
        isReasoningOnlyResponseError(streamError) &&
        !isReasoningDisabled(config.llmConfig, requestOverrides)
      ) {
        roundText = ""
        roundReasoningContent = ""
        toolCallDeltas.length = 0
        streamError = undefined
        requestOverrides = buildRequestOverrides(withReasoningDisabled(config.requestOverrides))
        try {
          await streamRound()
        } catch (err) {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)))
          return record
        }
      }

      if (streamError) {
        if (attemptedToolsFallback) {
          return failToolsUnsupported()
        }
        callbacks.onError(streamError)
        return record
      }

      // Check for tool calls (native deltas, or text JSON for cursor-cli bridge)
      let toolCalls = accumulateToolCalls(toolCallDeltas)
      if (
        toolCalls.length === 0 &&
        openaiTools &&
        providerUsesTextToolCalls(config.llmConfig.provider)
      ) {
        const parsed = parseTextToolCalls(
          roundText,
          new Set(config.tools.map((tool) => tool.name)),
        )
        if (parsed.toolCalls.length > 0) {
          toolCalls = parsed.toolCalls
          roundText = parsed.residualText
        }
      }

      if (toolCalls.length === 0) {
        finalText = roundText
        record.finalText = finalText
        if (roundText) callbacks.onText(roundText)
        await clearPersistedBreakpoint()
        callbacks.onDone()
        return record
      }

      // Add assistant message with tool calls.
      // DeepSeek/Kimi thinking mode requires reasoning_content on every
      // tool-call assistant message in subsequent rounds — even "".
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: roundText || "",
        tool_calls: toolCalls,
        reasoning_content: roundReasoningContent,
      }
      logReasoningReplay("agent.round.tool_assistant", {
        round: round + 1,
        contentLen: (roundText || "").length,
        reasoningLen: roundReasoningContent.length,
        toolNames: toolCalls.map((call) => call.function.name),
        workingMessageCount: workingMessages.length + 1,
      })
      workingMessages.push(assistantMsg)

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name
        const tool = registry.get(toolName)

        const saveToolProgress = async () => {
          if (!taskBreakpoint) return
          const usedTools = taskBreakpoint.usedTools.includes(toolName)
            ? taskBreakpoint.usedTools
            : [...taskBreakpoint.usedTools, toolName]
          taskBreakpoint = updateBreakpointStage(
            { ...taskBreakpoint, usedTools },
            `agent_round_${round + 1}`,
            `tool:${toolName}`,
          )
          await persistTaskBreakpoint()
        }

        const params = (() => {
          try { return JSON.parse(tc.function.arguments || "{}") }
          catch { return {} }
        })()

        const toolCallRecord: AgentRunRecord["toolCalls"][number] = {
          id: tc.id,
          name: toolName,
          params,
          result: "",
          status: "running",
          startedAt: Date.now(),
          finishedAt: Date.now(),
        }

        const callbackToolCall: ToolCall = { id: tc.id, name: toolName, arguments: params }
        const executionContext = {
          callId: tc.id,
          toolName,
          onToolEvent: callbacks.onToolEvent,
          onActivityEvent: callbacks.onActivityEvent,
        }
        callbacks.onToolCall(callbackToolCall)
        callbacks.onToolEvent?.({
          type: "call_started",
          callId: tc.id,
          name: toolName,
          params,
          timestamp: toolCallRecord.startedAt,
        })

        if (!tool) {
          const errorMsg = `错误: 未知工具 ${toolName}`
          callbacks.onToolError(tc.id, errorMsg)
          toolCallRecord.status = "error"
          toolCallRecord.result = errorMsg
          toolCallRecord.finishedAt = Date.now()
          record.toolCalls.push(toolCallRecord)
          callbacks.onToolEvent?.({
            type: "error",
            callId: tc.id,
            name: toolName,
            params,
            result: errorMsg,
            timestamp: toolCallRecord.finishedAt,
          })
          workingMessages.push({
            role: "tool",
            content: evidenceLedger.format(toolName, params, toolCallRecord.result),
            tool_call_id: tc.id,
            name: toolName,
          })
          await saveToolProgress()
          continue
        }

        const permission = tool.permission ?? (tool.category === "write" ? "confirm" : "auto")
        if (permission === "confirm") {
          let preview = ""
          try {
            const previewFn = tool.generatePreview ?? tool.execute
            preview = await withToolTimeout(previewFn(params, signal, executionContext), tool.executeTimeoutMs)
          } catch (e) {
            preview = `预览生成失败：${e instanceof Error ? e.message : String(e)}`
          }
          toolCallRecord.status = "approval_required"
          ;(toolCallRecord as any).preview = preview
          toolCallRecord.result = preview
          toolCallRecord.finishedAt = Date.now()
          record.toolCalls.push(toolCallRecord)
          callbacks.onToolEvent?.({
            type: "approval_required",
            callId: tc.id,
            name: toolName,
            params,
            result: preview,
            preview,
            timestamp: toolCallRecord.finishedAt,
          })
          workingMessages.push({
            role: "tool",
            content: evidenceLedger.format(toolName, params, preview),
            tool_call_id: tc.id,
            name: toolName,
          })
          await saveToolProgress()
          continue
        }

        try {
          const result = await withToolTimeout(tool.execute(params, signal, executionContext), tool.executeTimeoutMs)
          toolCallRecord.result = result
          toolCallRecord.status = "done"
          toolCallRecord.finishedAt = Date.now()
          callbacks.onToolResult(tc.id, result)
          callbacks.onToolEvent?.({
            type: "result",
            callId: tc.id,
            name: toolName,
            params,
            result,
            timestamp: toolCallRecord.finishedAt,
          })
        } catch (err) {
          toolCallRecord.status = "error"
          toolCallRecord.result = `错误: ${err instanceof Error ? err.message : String(err)}`
          toolCallRecord.finishedAt = Date.now()
          callbacks.onToolError(tc.id, toolCallRecord.result)
          callbacks.onToolEvent?.({
            type: "error",
            callId: tc.id,
            name: toolName,
            params,
            result: toolCallRecord.result,
            timestamp: toolCallRecord.finishedAt,
          })
        }

        record.toolCalls.push(toolCallRecord)
        await saveToolProgress()
        workingMessages.push({
          role: "tool",
          content: evidenceLedger.format(toolName, params, toolCallRecord.result),
          tool_call_id: tc.id,
          name: toolName,
        })
      }

      // Continue loop
      if (signal?.aborted) {
        for (const tc of record.toolCalls) {
          if (tc.status === "running") {
            tc.status = "cancelled"
            tc.finishedAt = Date.now()
            callbacks.onToolEvent?.({
              type: "cancelled",
              callId: tc.id,
              name: tc.name,
              params: tc.params,
              timestamp: tc.finishedAt,
            })
          }
        }
        callbacks.onError(new Error("操作已取消"))
        return record
      }
    }

    // Exceeded max rounds
    callbacks.onError(new Error(`Agent 已达到最大调用轮次（${maxRounds}），请尝试减少引用内容或拆分任务`))
    return record
  }
}
