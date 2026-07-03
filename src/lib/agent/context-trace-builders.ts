import type { PrePluginChainResult } from "./pipeline"
import type { TraceContextInfo } from "./context-trace"
import type { DataSourceCategory, RouteSource } from "@/lib/novel/classification"
import type { TaskRouteResult } from "@/lib/novel/task-router"
import type { AiWorkflowMode } from "./workflow-mode"

export function buildInitialContextTraceInfo(
  route: TaskRouteResult,
  prePluginResult?: Partial<PrePluginChainResult> | null,
  options?: { workflowMode?: AiWorkflowMode },
): TraceContextInfo {
  return {
    intent: route.intent as any,
    confidence: route.confidence,
    workflowMode: options?.workflowMode,
    routeSource: (prePluginResult?.routeSource as RouteSource | undefined) ?? "default",
    loadedSources: [],
    blockedSources: (prePluginResult?.blockedSources as DataSourceCategory[] | undefined) ?? [],
    webSearches: [],
    mcpCalls: [],
    selectedSkills: prePluginResult?.selectedSkills?.map((skill) => ({
      id: skill.id,
      name: skill.name,
      kind: skill.kind,
      stages: skill.stages,
      modes: skill.modes,
      source: skill.source,
    })),
    selectedCapabilities: prePluginResult?.selectedCapabilities?.map((capability) => ({
      id: capability.id,
      name: capability.name,
      kind: capability.kind,
      permission: capability.permission,
      source: capability.source,
      reason: capability.reason,
    })),
    retrievalHits: [],
    trimmedSections: [],
    fallbackReason: prePluginResult?.classificationFallbackReason as string | undefined,
    classificationVersion: prePluginResult?.classificationVersion as TraceContextInfo["classificationVersion"],
  }
}
