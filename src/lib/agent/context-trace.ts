import type { NovelTaskIntent } from "@/lib/novel/task-router"
import type { DataSourceCategory, RouteSource } from "@/lib/novel/classification"
import type { ToolCallStatus } from "./types"
import type { AiWorkflowMode } from "./workflow-mode"
import type { SkillKind, SkillMode, SkillStage } from "@/lib/novel/skill-library"
import type { CapabilityKind, CapabilityPermission } from "./capabilities/types"
import type { ContextHubStats } from "@/lib/context-hub/types"

export type TraceToolCategory = "read" | "write" | "action" | "virtual"

export interface TraceToolCall {
  id: string
  name: string
  category: TraceToolCategory
  params: Record<string, unknown>
  result?: string
  preview?: string
  status: ToolCallStatus
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface TraceRetrievalHit {
  type: string
  title: string
  relevance?: number
}

export interface TraceContextBudget {
  limit: number
  used: number
}

export interface TraceSelectedSkill {
  id: string
  name: string
  description: string
  kind: SkillKind[]
  stages: SkillStage[]
  modes: SkillMode[]
  content: string
  source: "built-in" | "project" | "uploaded" | "linked"
}

export interface TraceWebSearch {
  query: string
  provider: string
  status: "ok" | "not_configured" | "error"
  resultCount: number
  sources: string[]
  message?: string
  searchedAt: number
}

export interface TraceMcpCall {
  serverId: string
  serverName: string
  toolName: string
  status: "ok" | "error"
  summary?: string
  message?: string
  calledAt: number
}

export interface TraceSelectedCapability {
  id: string
  name: string
  kind: CapabilityKind
  permission: CapabilityPermission
  source?: string
  reason: string
}

export interface ClassificationVersionInfo {
  upToDate: boolean
  currentVersion: string
  latestVersion: string
  needsUpgrade: boolean
}

  export interface TraceResultProtocol {
    type: "chapter" | "outline" | "memory" | "other"
    valid: boolean
    wordCount?: number
  nodeCount?: number
  hasFrontmatter?: boolean
  hasTitle?: boolean
  warnings: string[]
  errors: string[]
    validatedAt: number
  }

  export interface PostWriteCheckItem {
    name: string
    passed: boolean
    detail: string
    severity?: "info" | "warning" | "error"
    evidence?: string
    suggestion?: string
  }

  export interface PostWriteCheck {
    items: PostWriteCheckItem[]
    passedCount: number
    totalCount: number
    allPassed: boolean
  }

  export interface TraceContextInfo {
    intent: NovelTaskIntent
  confidence: number
  workflowMode?: AiWorkflowMode
  routeSource: RouteSource
  loadedSources: DataSourceCategory[]
  blockedSources: DataSourceCategory[]
  selectedSkills?: TraceSelectedSkill[]
  selectedCapabilities?: TraceSelectedCapability[]
  webSearches?: TraceWebSearch[]
  mcpCalls?: TraceMcpCall[]
  retrievalHits: TraceRetrievalHit[]
  trimmedSections: string[]
  contextBudget?: TraceContextBudget
  contextHub?: ContextHubStats
    resultProtocol?: TraceResultProtocol
    postWriteCheck?: PostWriteCheck
    fallbackReason?: string
    postWriteCheckMeta?: { source: "ai" | "rule"; fallbackReason?: string }
  classificationVersion?: ClassificationVersionInfo
}

export type ContextTraceStatus = "running" | "done" | "error"

export interface ContextTrace {
  id: string
  startedAt: number
  finishedAt?: number
  contextInfo?: TraceContextInfo
  toolCalls: TraceToolCall[]
  status: ContextTraceStatus
  errorMessage?: string
}

export function createContextTrace(id: string): ContextTrace {
  return {
    id,
    startedAt: Date.now(),
    toolCalls: [],
    status: "running",
  }
}

export function addToolCallToTrace(trace: ContextTrace, toolCall: TraceToolCall): ContextTrace {
  return {
    ...trace,
    toolCalls: [...trace.toolCalls, toolCall],
  }
}

export function updateToolCallInTrace(
  trace: ContextTrace,
  callId: string,
  updates: Partial<TraceToolCall>,
): ContextTrace {
  return {
    ...trace,
    toolCalls: trace.toolCalls.map((call) =>
      call.id === callId ? { ...call, ...updates } : call,
    ),
  }
}

export function setContextInfo(trace: ContextTrace, info: TraceContextInfo): ContextTrace {
  return {
    ...trace,
    contextInfo: info,
  }
}

export function finishTrace(
  trace: ContextTrace,
  status: ContextTraceStatus,
  errorMessage?: string,
): ContextTrace {
  return {
    ...trace,
    status,
    finishedAt: Date.now(),
    errorMessage,
  }
}
