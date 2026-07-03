import { streamChat } from "../llm-client"
import type { StreamCallbacks } from "../llm-client"
import { accumulateToolCalls } from "./tool-call-parser"
import { toOpenAITools } from "./tools-schema"
import { formatToolResultForModel } from "./tool-result"
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

export class ModelDoesNotSupportToolsError extends Error {
  constructor() {
    super("当前模型不支持工具调用")
    this.name = "ModelDoesNotSupportToolsError"
  }
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
      [...messages].reverse().find((m) => m.role === "user")?.content ||
      "未命名任务"
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
      let streamError: Error | undefined

      const streamCallbacks: StreamCallbacks = {
        onToken: (t: string) => {
          roundText += t
        },
        onToolCallDelta: (delta: ToolCallDelta) => {
          toolCallDeltas.push(delta)
        },
        onDone: () => {
          // stream finished
        },
        onError: (err: Error) => {
          streamError = err
        },
      }

      const openaiTools = config.tools.length > 0 ? toOpenAITools(config.tools) : undefined
      const requestOverrides = openaiTools
        ? { ...config.requestOverrides, tools: openaiTools as any, toolChoice: "auto" as const }
        : config.requestOverrides
      try {
        await streamChat(
          config.llmConfig,
          workingMessages as ChatMessage[],
          streamCallbacks,
          signal,
          requestOverrides,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (openaiTools && /tool|function.?call|unsupported|不支持工具/i.test(msg)) {
          const modelErr = new ModelDoesNotSupportToolsError()
          callbacks.onError(modelErr)
          return record
        }
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
        return record
      }

      if (streamError) {
        callbacks.onError(streamError)
        return record
      }

      // Check for tool calls
      const toolCalls = accumulateToolCalls(toolCallDeltas)

      if (toolCalls.length === 0) {
        finalText = roundText
        record.finalText = finalText
        if (roundText) callbacks.onText(roundText)
        await clearPersistedBreakpoint()
        callbacks.onDone()
        return record
      }

      // Add assistant message with tool calls
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: roundText || "",
        tool_calls: toolCalls,
      }
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
          workingMessages.push({ role: "tool", content: toolCallRecord.result, tool_call_id: tc.id, name: toolName })
          await saveToolProgress()
          continue
        }

        const permission = tool.permission ?? (tool.category === "write" ? "confirm" : "auto")
        if (permission === "confirm") {
          let preview = ""
          try {
            const previewFn = tool.generatePreview ?? tool.execute
            preview = await Promise.race([
              previewFn(params, signal),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("工具执行超时")), TOOL_EXECUTE_TIMEOUT_MS),
              ),
            ])
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
          workingMessages.push({ role: "tool", content: preview, tool_call_id: tc.id, name: toolName })
          await saveToolProgress()
          continue
        }

        try {
          const result = await Promise.race([
            tool.execute(params, signal),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("工具执行超时")), TOOL_EXECUTE_TIMEOUT_MS)),
          ])
          toolCallRecord.result = result
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
          content: formatToolResultForModel(toolName, toolCallRecord.result, config.toolResultContextLimit),
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
