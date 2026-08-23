import { isOutputTruncatedError, streamChat } from "../llm-client"
import type { StreamCallbacks } from "../llm-client"
import { isFunctionCallingEnabled, providerUsesTextToolCalls } from "./config"
import { accumulateToolCalls, parseTextToolCalls } from "./tool-call-parser"
import { toOpenAITools } from "./tools-schema"
import type { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, AgentRunRecord, ToolCall, ToolCallDelta } from "./types"
import { DEFAULT_MAX_ROUNDS } from "./types"
import type { TaskBreakpoint } from "./task-breakpoint"
import {
  clearTaskBreakpoint,
  createTaskBreakpoint,
  saveTaskBreakpoint,
  updateBreakpointStage,
} from "./task-breakpoint"
import { getEffectiveMaxContextSize, type ChatMessage } from "../llm-providers"
import { isReasoningDisabled, isReasoningOnlyResponseError, withReasoningDisabled } from "../reasoning-retry"
import { addLlmUsage, mergeLlmUsageSnapshot, type LlmUsage } from "../llm-usage"
import { LlmRequestTraceCollector, type LlmRequestCacheTrace } from "../llm-request-trace"
import { trimChatMessagesToTokenBudget } from "../chat-request-budget"
import { logReasoningReplay } from "../reasoning-replay-debug"
import { ToolEvidenceLedger } from "./tool-evidence-ledger"
import { DEFAULT_TOOL_RESULT_CONTEXT_LIMIT } from "./tool-result"
import {
  RequiredToolsNotCalledError,
  buildRequiredToolNudgeMessage,
  missingRequiredToolsOnce,
} from "./required-tools-gate"
import { executeAgentTool, rejectAgentToolCall } from "./tool-executor"
import {
  executeRequiredToolFallback,
  isRequiredToolExecutionFulfilled,
} from "./required-tool-fallback"
import { CodexAppServerRunner } from "./codex-app-server-runner"
import { withWritingWakeLock } from "../writing-wake-lock"

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

export class AgentRunner {
  async run(
    config: AgentConfig,
    registry: ToolRegistry,
    messages: AgentMessage[],
    callbacks: AgentRunCallbacks,
    signal?: AbortSignal,
  ): Promise<AgentRunRecord> {
    return withWritingWakeLock(true, () => this.runHeld(config, registry, messages, callbacks, signal))
  }

  private async runHeld(
    config: AgentConfig,
    registry: ToolRegistry,
    messages: AgentMessage[],
    callbacks: AgentRunCallbacks,
    signal?: AbortSignal,
  ): Promise<AgentRunRecord> {
    if (config.llmConfig.provider === "codex-cli") {
      return new CodexAppServerRunner().run(config, registry, messages, callbacks, signal)
    }
    const record: AgentRunRecord = { toolCalls: [], roundsUsed: 0, finalText: "" }
    const requestTraceCollector = new LlmRequestTraceCollector()
    const onRequestTrace = (trace: LlmRequestCacheTrace) => {
      requestTraceCollector.record(trace)
      const snapshot = requestTraceCollector.snapshot()
      record.requestTraces = snapshot.requests
      record.omittedRequestTraceCount = snapshot.omittedRequestCount
      callbacks.onRequestTrace?.(trace)
    }
    const workingMessages = [...messages]
    let finalText = ""
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS
    const projectPath = config.projectPath
    const taskGoal =
      config.taskGoal ||
      messageContentText([...messages].reverse().find((m) => m.role === "user")?.content ?? "") ||
      "未命名任务"
    const taskContract = `## 任务契约\n初始任务目标：${taskGoal.slice(0, 1800)}\n执行过程中不得因历史裁剪丢失该目标；当前用户新要求优先。`
    const requiredTools = [...new Set((config.requiredToolsOnce ?? []).filter((name) => name.trim()))]
    const satisfiedRequiredTools = new Set<string>()
    let fallbackConvergenceChecked = false
    if (requiredTools.length > 0) {
      record.requiredToolDiagnostics = {
        requiredTools,
        satisfiedTools: [],
        missingTools: [...requiredTools],
        fallbackAttempted: false,
        provider: config.llmConfig.provider,
        model: config.modelId?.trim() || config.llmConfig.model,
        reasoningMode: config.requestOverrides?.reasoning?.mode ?? config.llmConfig.reasoning?.mode ?? "auto",
        roundsUsed: 0,
        finishReasons: [],
        observedToolCalls: [],
      }
    }
    const contractInsertIndex = workingMessages.findIndex((message) => message.role !== "system")
    workingMessages.splice(contractInsertIndex < 0 ? workingMessages.length : contractInsertIndex, 0, {
      role: "system",
      content: taskContract,
    })
    const evidenceLedger = new ToolEvidenceLedger(config.toolResultContextLimit ?? DEFAULT_TOOL_RESULT_CONTEXT_LIMIT)
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

    const refreshRequiredToolDiagnostics = () => {
      const diagnostics = record.requiredToolDiagnostics
      if (!diagnostics) return
      diagnostics.satisfiedTools = [...satisfiedRequiredTools]
      diagnostics.missingTools = requiredTools.filter((name) => !satisfiedRequiredTools.has(name))
    }

    const missingRequiredTools = () => missingRequiredToolsOnce({
      requiredToolsOnce: requiredTools,
      availableToolNames: config.tools.map((tool) => tool.name),
      calledToolNames: satisfiedRequiredTools,
      toolsEnabled: config.tools.length > 0,
    })

    const attemptRequiredToolFallback = async (): Promise<"success" | "error" | "unavailable"> => {
      if (fallbackConvergenceChecked) return "unavailable"
      fallbackConvergenceChecked = true
      const missing = missingRequiredTools()
      refreshRequiredToolDiagnostics()
      if (missing.length === 0) return "success"

      const fallback = await executeRequiredToolFallback({
        missingTools: missing,
        taskGoal,
        registry,
        callbacks: { ...callbacks, onRequestTrace },
        record,
        signal,
      })
      const diagnostics = record.requiredToolDiagnostics
      if (!fallback.attempted) {
        if (diagnostics) diagnostics.fallbackStatus = "unavailable"
        return "unavailable"
      }
      if (diagnostics) {
        diagnostics.fallbackAttempted = true
        diagnostics.fallbackTool = fallback.toolName
      }
      if (fallback.error) {
        if (diagnostics) {
          diagnostics.fallbackStatus = "error"
          diagnostics.fallbackError = fallback.error.message
        }
        refreshRequiredToolDiagnostics()
        await clearPersistedBreakpoint()
        callbacks.onError(fallback.error)
        return "error"
      }

      fallback.satisfiedTools.forEach((name) => satisfiedRequiredTools.add(name))
      refreshRequiredToolDiagnostics()
      if (diagnostics) diagnostics.fallbackStatus = "success"
      if (fallback.finalContent) {
        finalText = fallback.finalContent
        record.finalText = finalText
        await clearPersistedBreakpoint()
        callbacks.onDone()
        return "success"
      }
      return missingRequiredTools().length === 0 ? "success" : "unavailable"
    }

    if (taskBreakpoint) {
      await persistTaskBreakpoint()
    }

    if (config.forceRequiredToolsImmediately && requiredTools.length > 0) {
      const outcome = await attemptRequiredToolFallback()
      if (outcome === "success" || outcome === "error") return record
    }

    for (let round = 0; round < maxRounds; round++) {
      record.roundsUsed = round + 1
      if (record.requiredToolDiagnostics) {
        record.requiredToolDiagnostics.roundsUsed = record.roundsUsed
      }

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
      let roundUsage: LlmUsage | undefined

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
          const diagnostics = record.requiredToolDiagnostics
          if (diagnostics) {
            const existing = diagnostics.observedToolCalls.find(
              (item) => item.round === round + 1 && item.index === delta.index,
            )
            if (existing) {
              if (delta.name) existing.name = delta.name
            } else {
              diagnostics.observedToolCalls.push({
                round: round + 1,
                index: delta.index,
                ...(delta.name ? { name: delta.name } : {}),
              })
            }
          }
        },
        onFinishReason: (reason: string) => {
          const finishReasons = record.requiredToolDiagnostics?.finishReasons
          if (finishReasons && finishReasons[finishReasons.length - 1] !== reason) {
            finishReasons.push(reason)
          }
        },
        onUsage: (usage) => {
          roundUsage = mergeLlmUsageSnapshot(roundUsage, usage)
          if (roundUsage) callbacks.onUsage?.(roundUsage)
        },
        onRequestTrace,
        onUserMemoryDecision: (decision) => {
          if (record.userMemoryDecision === undefined) {
            record.userMemoryDecision = decision
            callbacks.onUserMemoryDecision?.(decision)
          }
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
        // maxContextSize is already a token count; the remaining quarter of the
        // window covers the response and prompt scaffolding.
        const effectiveContext = getEffectiveMaxContextSize(config.llmConfig)
        const internalBudget = Math.max(1, Math.floor(effectiveContext * 0.75))
        let compacted: AgentMessage[]
        try {
          compacted = trimChatMessagesToTokenBudget(
            workingMessages as ChatMessage[],
            internalBudget,
          ) as AgentMessage[]
        } catch {
          // streamChat retries with a 512-token output floor before giving up;
          // surface a readable reason instead of the bare budget error.
          throw new Error(
            "模型上下文不足：当前对话即使压缩后仍放不下系统提示与最新请求。请缩短输入，或在设置中调高该模型的上下文窗口。",
          )
        }
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
        roundUsage = undefined
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
        roundUsage = undefined
        requestOverrides = buildRequestOverrides(withReasoningDisabled(config.requestOverrides))
        try {
          await streamRound()
        } catch (err) {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)))
          return record
        }
      }

      if (roundUsage) {
        record.lastRequestUsage = { ...roundUsage }
        record.usage = addLlmUsage(record.usage, roundUsage)
      }

      if (streamError) {
        if (attemptedToolsFallback) {
          return failToolsUnsupported()
        }
        // Token-limit truncation: keep the partial round text so callers
        // can show it and offer continuation, instead of dropping the
        // whole round on the floor.
        if (
          isOutputTruncatedError(streamError) &&
          toolCallDeltas.length === 0 &&
          roundText.trim()
        ) {
          finalText = roundText
          record.finalText = finalText
          callbacks.onText(roundText)
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
        const missingRequired = missingRequiredToolsOnce({
          requiredToolsOnce: requiredTools,
          availableToolNames: config.tools.map((tool) => tool.name),
          calledToolNames: satisfiedRequiredTools,
          toolsEnabled: Boolean(openaiTools),
        })
        refreshRequiredToolDiagnostics()
        if (missingRequired.length > 0) {
          const fallbackOutcome = await attemptRequiredToolFallback()
          if (fallbackOutcome === "success" || fallbackOutcome === "error") return record
          if (roundText.trim() || roundReasoningContent.trim()) {
            workingMessages.push({
              role: "assistant",
              content: roundText || "",
              ...(roundReasoningContent.trim() ? { reasoning_content: roundReasoningContent } : {}),
            })
          }
          workingMessages.push({
            role: "system",
            content: buildRequiredToolNudgeMessage(missingRequired),
          })
          const isLastRound = round >= maxRounds - 1
          if (isLastRound) {
            await clearPersistedBreakpoint()
            callbacks.onError(new RequiredToolsNotCalledError(missingRequired))
            return record
          }
          continue
        }

        finalText = roundText
        record.finalText = finalText
        if (roundText) callbacks.onText(roundText)
        await clearPersistedBreakpoint()
        callbacks.onDone()
        return record
      }

      // Add assistant message with tool calls.
      // 只回传非空思考：DeepSeek thinking 把空串当成没传，会 400。
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: roundText || "",
        tool_calls: toolCalls,
        ...(roundReasoningContent.trim() ? { reasoning_content: roundReasoningContent } : {}),
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
      let deliveredFinalContent = ""
      for (const tc of toolCalls) {
        const toolName = tc.function.name

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

        let params: Record<string, unknown> = {}
        let argumentError = ""
        try {
          const parsed = JSON.parse(tc.function.arguments || "{}")
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            argumentError = "工具参数必须是 JSON 对象"
          } else {
            params = parsed as Record<string, unknown>
          }
        } catch (error) {
          argumentError = `工具参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`
        }
        const executed = argumentError
          ? rejectAgentToolCall(
              { id: tc.id, name: toolName },
              `错误: ${argumentError}`,
              callbacks,
            )
          : await executeAgentTool(
              { id: tc.id, name: toolName, arguments: params } satisfies ToolCall,
              registry,
              { ...callbacks, onRequestTrace },
              signal,
            )
        record.toolCalls.push(executed.record)
        await saveToolProgress()
        const registeredTool = registry.get(toolName)
        if (isRequiredToolExecutionFulfilled(registeredTool, executed)) {
          satisfiedRequiredTools.add(toolName)
          refreshRequiredToolDiagnostics()
        }
        if (
          executed.record.status === "done" &&
          executed.finalContent?.trim() &&
          registeredTool?.finalizesRun
        ) {
          deliveredFinalContent = executed.finalContent.trim()
        }
        workingMessages.push({
          role: "tool",
          content: evidenceLedger.format(toolName, params, executed.responseText),
          tool_call_id: tc.id,
          name: toolName,
        })
      }

      // 终结型工具已把终稿交付给用户，再让模型复述一遍只会拖时间并可能改坏正文。
      if (deliveredFinalContent) {
        finalText = deliveredFinalContent
        record.finalText = finalText
        await clearPersistedBreakpoint()
        callbacks.onDone()
        return record
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
    const missingAtLimit = missingRequiredTools()
    refreshRequiredToolDiagnostics()
    if (missingAtLimit.length > 0) {
      const fallbackOutcome = await attemptRequiredToolFallback()
      if (fallbackOutcome === "success" || fallbackOutcome === "error") return record
      await clearPersistedBreakpoint()
      callbacks.onError(new RequiredToolsNotCalledError(missingAtLimit))
      return record
    }
    callbacks.onError(new Error(`Agent 已达到最大调用轮次（${maxRounds}），请尝试减少引用内容或拆分任务`))
    return record
  }
}
