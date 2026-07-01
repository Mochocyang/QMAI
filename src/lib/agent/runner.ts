import { streamChat } from "../llm-client"
import type { StreamCallbacks } from "../llm-client"
import { accumulateToolCalls } from "./tool-call-parser"
import { toOpenAITools } from "./tools-schema"
import type { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, AgentRunRecord, ToolCall, ToolCallDelta } from "./types"
import { DEFAULT_MAX_ROUNDS, TOOL_EXECUTE_TIMEOUT_MS } from "./types"
import type { ChatMessage } from "../llm-providers"

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

    for (let round = 0; round < maxRounds; round++) {
      record.roundsUsed = round + 1

      if (signal?.aborted) {
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

      try {
        const openaiTools = config.tools.length > 0 ? toOpenAITools(config.tools) : undefined
        await streamChat(
          config.llmConfig,
          workingMessages as ChatMessage[],
          streamCallbacks,
          signal,
          openaiTools ? { tools: openaiTools as any, toolChoice: "auto" } : undefined,
        )
      } catch (err) {
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

        const params = (() => {
          try { return JSON.parse(tc.function.arguments || "{}") }
          catch { return {} }
        })()

        const toolCallRecord: {
          id: string
          name: string
          params: Record<string, unknown>
          result: string
          status: "done" | "error"
          startedAt: number
          finishedAt: number
        } = {
          id: tc.id,
          name: toolName,
          params,
          result: "",
          status: "done",
          startedAt: Date.now(),
          finishedAt: Date.now(),
        }

        const callbackToolCall: ToolCall = { id: tc.id, name: toolName, arguments: params }
        callbacks.onToolCall(callbackToolCall)

        if (!tool) {
          const errorMsg = `错误: 未知工具 ${toolName}`
          callbacks.onToolError(tc.id, errorMsg)
          toolCallRecord.status = "error"
          toolCallRecord.result = errorMsg
          toolCallRecord.finishedAt = Date.now()
          record.toolCalls.push(toolCallRecord)
          workingMessages.push({ role: "tool", content: toolCallRecord.result, tool_call_id: tc.id, name: toolName })
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
        } catch (err) {
          toolCallRecord.status = "error"
          toolCallRecord.result = `错误: ${err instanceof Error ? err.message : String(err)}`
          toolCallRecord.finishedAt = Date.now()
          callbacks.onToolError(tc.id, toolCallRecord.result)
        }

        record.toolCalls.push(toolCallRecord)
        workingMessages.push({ role: "tool", content: toolCallRecord.result, tool_call_id: tc.id, name: toolName })
      }

      // Continue loop
      if (signal?.aborted) {
        callbacks.onError(new Error("操作已取消"))
        return record
      }
    }

    // Exceeded max rounds
    callbacks.onError(new Error(`Agent 已达到最大调用轮次（${maxRounds}），请尝试减少引用内容或拆分任务`))
    return record
  }
}
