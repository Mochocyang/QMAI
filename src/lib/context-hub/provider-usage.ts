import type { LlmUsage } from "@/lib/llm-usage"
import {
  copyLlmRequestCacheTrace,
  type LlmRequestCacheTrace,
} from "@/lib/llm-request-trace"
import type { UserMemoryDecision } from "@/lib/user-memory/decision-trace"
import type {
  ContextHub,
  ContextHubResult,
  ContextHubSnapshotRef,
  ContextHubStats,
  LlmRequestDiagnostics,
} from "./types"

export interface PersistContextHubProviderUsageOptions {
  memoryDecision?: UserMemoryDecision | null
  requestDiagnostics?: LlmRequestDiagnostics | null
}

export function buildLlmRequestDiagnostics(
  usage: LlmUsage | undefined,
  requestCount = 1,
  traceOptions: {
    requests?: LlmRequestCacheTrace[]
    omittedRequestCount?: number
    requestCountAvailable?: boolean
    usageScope?: "workflow" | "provider_thread"
  } = {},
): LlmRequestDiagnostics {
  const tracedRequestCount = (traceOptions.requests?.length ?? 0)
    + Math.max(0, traceOptions.omittedRequestCount ?? 0)
  const requestCountAvailable = traceOptions.requestCountAvailable ?? true
  const effectiveRequestCount = requestCountAvailable
    ? (tracedRequestCount > 0 ? tracedRequestCount : requestCount)
    : 0
  const scopeFields = {
    ...(traceOptions.requestCountAvailable !== undefined ? { requestCountAvailable } : {}),
    ...(traceOptions.usageScope ? { usageScope: traceOptions.usageScope } : {}),
  }
  const hasAny = Boolean(
    usage
    && (
      usage.inputTokens !== undefined
      || usage.outputTokens !== undefined
      || usage.cachedInputTokens !== undefined
      || usage.cacheWriteInputTokens !== undefined
    ),
  )
  if (!hasAny || !usage) {
    return {
      requestCount: Math.max(0, effectiveRequestCount),
      ...scopeFields,
      providerUsageAvailable: false,
      ...(traceOptions.requests ? { requests: traceOptions.requests.map(copyLlmRequestCacheTrace) } : {}),
      ...(traceOptions.omittedRequestCount !== undefined
        ? { omittedRequestCount: Math.max(0, traceOptions.omittedRequestCount) }
        : {}),
    }
  }
  return {
    requestCount: requestCountAvailable ? Math.max(1, effectiveRequestCount) : 0,
    ...scopeFields,
    providerUsageAvailable: true,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteInputTokens,
    ...(traceOptions.requests ? { requests: traceOptions.requests.map(copyLlmRequestCacheTrace) } : {}),
    ...(traceOptions.omittedRequestCount !== undefined
      ? { omittedRequestCount: Math.max(0, traceOptions.omittedRequestCount) }
      : {}),
  }
}

export function mergeLlmRequestDiagnostics(
  existing: LlmRequestDiagnostics | undefined,
  usage: LlmUsage | undefined,
): LlmRequestDiagnostics {
  const base: LlmRequestDiagnostics = existing ?? {
    requestCount: 0,
    providerUsageAvailable: false,
  }
  if (!usage) return { ...base }
  const hasAny = usage.inputTokens !== undefined
    || usage.outputTokens !== undefined
    || usage.cachedInputTokens !== undefined
    || usage.cacheWriteInputTokens !== undefined
  if (!hasAny) {
    return {
      ...base,
      requestCount: base.requestCountAvailable === false ? base.requestCount : base.requestCount + 1,
      providerUsageAvailable: base.providerUsageAvailable,
    }
  }
  return {
    ...base,
    requestCount: base.requestCountAvailable === false ? base.requestCount : base.requestCount + 1,
    providerUsageAvailable: true,
    inputTokens: (base.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (base.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    cacheReadTokens: (base.cacheReadTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    cacheWriteTokens: (base.cacheWriteTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0),
  }
}

export function applyProviderUsageToStats(
  stats: ContextHubStats,
  usage: LlmUsage,
  memoryDecision?: UserMemoryDecision | null,
  requestDiagnostics?: LlmRequestDiagnostics | null,
): ContextHubStats {
  const diagnostics = requestDiagnostics
    ?? mergeLlmRequestDiagnostics(stats.requestDiagnostics, usage)
  return {
    ...stats,
    providerUsageReported: diagnostics.providerUsageAvailable,
    ...(usage.inputTokens !== undefined ? { providerInputTokens: usage.inputTokens } : {}),
    ...(usage.cachedInputTokens !== undefined ? { providerCachedTokens: usage.cachedInputTokens } : {}),
    ...(usage.cacheWriteInputTokens !== undefined
      ? { providerCacheWriteTokens: usage.cacheWriteInputTokens }
      : {}),
    requestDiagnostics: diagnostics,
    ...(memoryDecision ? {
      memoryCandidateCount: memoryDecision.candidateCount,
      memorySelectedCount: memoryDecision.selectedRuleIds.length,
      memoryFilteredCount: memoryDecision.filtered.length,
      memoryInjectedChars: memoryDecision.injectedChars,
      memoryEstimatedTokens: memoryDecision.estimatedTokens,
    } : {}),
  }
}

export async function persistContextHubProviderUsage(
  contextHub: Pick<ContextHub, "saveSnapshot">,
  snapshotId: string,
  result: ContextHubResult,
  usage: LlmUsage | undefined,
  options: PersistContextHubProviderUsageOptions = {},
): Promise<ContextHubSnapshotRef | null> {
  if (!usage && !options.requestDiagnostics) return null
  const diagnostics = options.requestDiagnostics
    ?? (usage ? mergeLlmRequestDiagnostics(result.stats.requestDiagnostics, usage) : undefined)
  if (usage) {
    result.stats = applyProviderUsageToStats(
      result.stats,
      usage,
      options.memoryDecision,
      diagnostics,
    )
  } else if (diagnostics || options.memoryDecision) {
    result.stats = {
      ...result.stats,
      ...(diagnostics ? { requestDiagnostics: diagnostics } : {}),
      ...(options.memoryDecision ? {
        memoryCandidateCount: options.memoryDecision.candidateCount,
        memorySelectedCount: options.memoryDecision.selectedRuleIds.length,
        memoryFilteredCount: options.memoryDecision.filtered.length,
        memoryInjectedChars: options.memoryDecision.injectedChars,
        memoryEstimatedTokens: options.memoryDecision.estimatedTokens,
      } : {}),
    }
  }
  return contextHub.saveSnapshot(snapshotId, result)
}
