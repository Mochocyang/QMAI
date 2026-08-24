import type { ToolRegistry } from "./registry"
import type { AgentRunCallbacks, AgentRunRecord, ToolCall } from "./types"
import { TOOL_EXECUTE_TIMEOUT_MS } from "./types"
import { isToolErrorResult } from "./tool-result"

function withToolTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  const resolvedTimeoutMs = timeoutMs ?? TOOL_EXECUTE_TIMEOUT_MS
  if (resolvedTimeoutMs <= 0) return operation
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("工具执行超时")), resolvedTimeoutMs)
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export interface ExecuteAgentToolResult {
  record: AgentRunRecord["toolCalls"][number]
  responseText: string
  success: boolean
  /** finalizesRun 工具通过 onFinalContent 交付的终稿，取最后一次交付。 */
  finalContent?: string
}

export function rejectAgentToolCall(
  call: Pick<ToolCall, "id" | "name">,
  message: string,
  callbacks: AgentRunCallbacks,
): ExecuteAgentToolResult {
  const timestamp = Date.now()
  const params: Record<string, unknown> = {}
  const record: AgentRunRecord["toolCalls"][number] = {
    id: call.id,
    name: call.name,
    params,
    result: message,
    status: "error",
    startedAt: timestamp,
    finishedAt: timestamp,
  }
  callbacks.onToolCall({ id: call.id, name: call.name, arguments: params })
  callbacks.onToolEvent?.({
    type: "call_started",
    callId: call.id,
    name: call.name,
    params,
    timestamp,
  })
  callbacks.onToolError(call.id, message)
  callbacks.onToolEvent?.({
    type: "error",
    callId: call.id,
    name: call.name,
    params,
    result: message,
    timestamp,
  })
  return { record, responseText: message, success: false }
}

export async function executeAgentTool(
  call: ToolCall,
  registry: ToolRegistry,
  callbacks: AgentRunCallbacks,
  signal?: AbortSignal,
): Promise<ExecuteAgentToolResult> {
  const startedAt = Date.now()
  const record: AgentRunRecord["toolCalls"][number] = {
    id: call.id,
    name: call.name,
    params: call.arguments,
    result: "",
    status: "running",
    startedAt,
    finishedAt: startedAt,
  }
  callbacks.onToolCall(call)
  callbacks.onToolEvent?.({
    type: "call_started",
    callId: call.id,
    name: call.name,
    params: call.arguments,
    timestamp: startedAt,
  })

  const tool = registry.get(call.name)
  if (!tool) {
    const result = `错误: 未知工具 ${call.name}`
    record.status = "error"
    record.result = result
    record.finishedAt = Date.now()
    callbacks.onToolError(call.id, result)
    callbacks.onToolEvent?.({
      type: "error",
      callId: call.id,
      name: call.name,
      params: call.arguments,
      result,
      timestamp: record.finishedAt,
    })
    return { record, responseText: result, success: false }
  }

  let deliveredFinalContent = ""
  let acceptFinalContent = true
  const executionContext = {
    callId: call.id,
    toolName: call.name,
    onToolEvent: callbacks.onToolEvent,
    onActivityEvent: callbacks.onActivityEvent,
    onRequestTrace: callbacks.onRequestTrace,
    onFinalContent: (content: string) => {
      if (!acceptFinalContent) return
      deliveredFinalContent = content
      callbacks.onFinalContent?.(content)
    },
  }
  const permission = tool.permission ?? (tool.category === "write" ? "confirm" : "auto")
  if (permission === "confirm") {
    // 预览阶段不是真正执行，即使复用 execute 也不得对外交付终稿。
    acceptFinalContent = false
    try {
      const previewFn = tool.generatePreview ?? tool.execute
      const preview = await withToolTimeout(
        previewFn(call.arguments, signal, executionContext),
        tool.executeTimeoutMs,
      )
      record.status = "approval_required"
      record.preview = preview
      record.result = preview
      record.finishedAt = Date.now()
      callbacks.onToolEvent?.({
        type: "approval_required",
        callId: call.id,
        name: call.name,
        params: call.arguments,
        result: preview,
        preview,
        timestamp: record.finishedAt,
      })
      return {
        record,
        responseText: `尚未执行：该操作需要用户确认。\n\n${preview}`,
        success: true,
      }
    } catch (error) {
      const result = `预览生成失败：${error instanceof Error ? error.message : String(error)}`
      record.status = "error"
      record.result = result
      record.finishedAt = Date.now()
      callbacks.onToolError(call.id, result)
      callbacks.onToolEvent?.({
        type: "error",
        callId: call.id,
        name: call.name,
        params: call.arguments,
        result,
        timestamp: record.finishedAt,
      })
      return { record, responseText: result, success: false }
    }
  }

  try {
    const result = await withToolTimeout(
      tool.execute(call.arguments, signal, executionContext),
      tool.executeTimeoutMs,
    )
    record.result = result
    record.finishedAt = Date.now()
    if (isToolErrorResult(result)) {
      record.status = "error"
      callbacks.onToolError(call.id, result)
      callbacks.onToolEvent?.({
        type: "error",
        callId: call.id,
        name: call.name,
        params: call.arguments,
        result,
        timestamp: record.finishedAt,
      })
      return { record, responseText: result, success: false }
    }
    record.status = "done"
    callbacks.onToolResult(call.id, result)
    callbacks.onToolEvent?.({
      type: "result",
      callId: call.id,
      name: call.name,
      params: call.arguments,
      result,
      timestamp: record.finishedAt,
    })
    return {
      record,
      responseText: result,
      success: true,
      ...(deliveredFinalContent ? { finalContent: deliveredFinalContent } : {}),
    }
  } catch (error) {
    const result = `错误: ${error instanceof Error ? error.message : String(error)}`
    record.status = signal?.aborted ? "cancelled" : "error"
    record.result = result
    record.finishedAt = Date.now()
    if (record.status === "cancelled") {
      callbacks.onToolEvent?.({
        type: "cancelled",
        callId: call.id,
        name: call.name,
        params: call.arguments,
        timestamp: record.finishedAt,
      })
    } else {
      callbacks.onToolError(call.id, result)
      callbacks.onToolEvent?.({
        type: "error",
        callId: call.id,
        name: call.name,
        params: call.arguments,
        result,
        timestamp: record.finishedAt,
      })
    }
    return { record, responseText: result, success: false }
  }
}
