import {
  createContextTrace,
  addToolCallToTrace,
  updateToolCallInTrace,
  setContextInfo,
  finishTrace,
  type ContextTrace,
  type TraceContextInfo,
  type TraceToolCall,
} from "./context-trace"
import type { ToolCallStatus } from "./types"

export interface TraceBuilder {
  startNewTrace(traceId: string): void
  getCurrentTrace(): ContextTrace | null
  emitVirtualToolStart(name: string, params: Record<string, unknown>): string
  emitVirtualToolEnd(
    callId: string,
    result?: string,
    status?: ToolCallStatus,
  ): void
  updateTraceContextInfo(info: Partial<TraceContextInfo>): void
  completeCurrentTrace(status?: "done" | "error", errorMessage?: string): void
}

let currentTrace: ContextTrace | null = null
let callIdCounter = 0

export function createTraceBuilder(): TraceBuilder {
  return {
    startNewTrace(traceId: string) {
      currentTrace = createContextTrace(traceId)
      callIdCounter = 0
    },

    getCurrentTrace() {
      return currentTrace
    },

    emitVirtualToolStart(name: string, params: Record<string, unknown>): string {
      if (!currentTrace) return ""
      const callId = `vt_${Date.now()}_${++callIdCounter}`
      const toolCall: TraceToolCall = {
        id: callId,
        name,
        category: "virtual",
        params,
        status: "running",
        startedAt: Date.now(),
      }
      currentTrace = addToolCallToTrace(currentTrace, toolCall)
      return callId
    },

    emitVirtualToolEnd(
      callId: string,
      result?: string,
      status: ToolCallStatus = "done",
    ) {
      if (!currentTrace) return
      currentTrace = updateToolCallInTrace(currentTrace, callId, {
        result,
        status,
        finishedAt: Date.now(),
      })
    },

    updateTraceContextInfo(info: Partial<TraceContextInfo>) {
      if (!currentTrace) return
      const existingInfo = currentTrace.contextInfo
      const updatedInfo: TraceContextInfo = {
        intent: existingInfo?.intent ?? ("general" as any),
        confidence: existingInfo?.confidence ?? 0,
        routeSource: existingInfo?.routeSource ?? ("default" as any),
        loadedSources: existingInfo?.loadedSources ?? [],
        blockedSources: existingInfo?.blockedSources ?? [],
        retrievalHits: existingInfo?.retrievalHits ?? [],
        trimmedSections: existingInfo?.trimmedSections ?? [],
        ...existingInfo,
        ...info,
      }
      currentTrace = setContextInfo(currentTrace, updatedInfo)
    },

    completeCurrentTrace(status: "done" | "error" = "done", errorMessage?: string) {
      if (!currentTrace) return
      currentTrace = finishTrace(currentTrace, status, errorMessage)
    },
  }
}
