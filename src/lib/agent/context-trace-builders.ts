import type { PrePluginChainResult } from "./pipeline"
import type { TraceContextInfo } from "./context-trace"
import type { DataSourceCategory, RouteSource } from "@/lib/novel/classification"
import type { TaskRouteResult } from "@/lib/novel/task-router"
import type { AiWorkflowMode } from "./workflow-mode"
import type { ContextHubStats } from "@/lib/context-hub/types"

export function buildInitialContextTraceInfo(
  route: TaskRouteResult,
  prePluginResult?: Partial<PrePluginChainResult> | null,
  options?: { workflowMode?: AiWorkflowMode; contextHub?: ContextHubStats },
): TraceContextInfo {
  return {
    intent: route.intent as any,
    confidence: route.confidence,
    workflowMode: options?.workflowMode,
    contextHub: options?.contextHub,
    routeSource: (prePluginResult?.routeSource as RouteSource | undefined) ?? "default",
    loadedSources: [],
    blockedSources: (prePluginResult?.blockedSources as DataSourceCategory[] | undefined) ?? [],
    webSearches: [],
    mcpCalls: [],
    selectedSkills: prePluginResult?.selectedSkills?.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      stages: skill.stages,
      modes: skill.modes,
      content: skill.content,
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
