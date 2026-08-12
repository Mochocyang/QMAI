import type {
  ContextHubStats,
  StablePrefixStatus,
} from "@/lib/context-hub/types"

const STABLE_PREFIX_LABELS: Record<StablePrefixStatus, string> = {
  unchanged: "未变化",
  updated: "已更新",
  persist_failed: "持久化失败",
}

export interface ContextHubStatsSummaryProps {
  stats: ContextHubStats
  warnings?: string[]
  /** Show composed/budget row (default true). */
  showComposed?: boolean
  /** Show memory row when present (default true). */
  showMemory?: boolean
  className?: string
}

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString()} Token`
}

export function ProviderCacheUsage({ stats }: { stats: ContextHubStats }) {
  const cachedTokens = stats.providerCachedTokens
  const inputTokens = stats.providerInputTokens
  const hitPercent = cachedTokens !== undefined && inputTokens !== undefined && inputTokens > 0
    ? Math.min(100, Math.round((cachedTokens / inputTokens) * 100))
    : null

  return (
    <>
      {cachedTokens !== undefined ? (
        cachedTokens > 0 ? (
          <div className="font-medium text-green-600 dark:text-green-400">
            供应商已确认命中 {cachedTokens.toLocaleString()} Token
            {hitPercent !== null ? `（输入占比 ${hitPercent}%）` : ""}
          </div>
        ) : (
          <div>供应商已确认本次未命中缓存（0 Token）</div>
        )
      ) : stats.providerUsageReported ? (
        <div>供应商已返回 Token 用量，但未提供缓存命中明细</div>
      ) : stats.providerCacheEnabled ? (
        <div>已发送稳定前缀，是否命中以供应商返回为准</div>
      ) : null}
      {(stats.providerCacheWriteTokens ?? 0) > 0 && (
        <div>供应商新写入缓存 {stats.providerCacheWriteTokens?.toLocaleString()} Token</div>
      )}
    </>
  )
}

export function ContextHubStatsSummary({
  stats,
  warnings = [],
  showComposed = true,
  showMemory = true,
  className,
}: ContextHubStatsSummaryProps) {
  const failures = stats.readFailed + stats.writeFailed
  const diagnostics = stats.requestDiagnostics

  return (
    <div className={className}>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {`本轮数据源：命中 ${stats.cacheHits.toLocaleString()}，重载 ${stats.reloaded.toLocaleString()}，无数据 ${stats.empty.toLocaleString()}，fallback ${stats.fallbackUsed.toLocaleString()}，失败 ${failures.toLocaleString()}`}
      </div>
      {stats.stablePrefixStatus ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          稳定前缀：{STABLE_PREFIX_LABELS[stats.stablePrefixStatus]}
        </div>
      ) : null}
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {`稳定核心 ${formatTokens(stats.stableTokens)}　会话摘要 ${formatTokens(stats.summaryTokens)}　动态片段 ${formatTokens(stats.dynamicTokens)}`}
      </div>
      {showComposed && stats.composedTokens !== undefined && stats.budgetTokens !== undefined ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          中控注入 {stats.composedTokens.toLocaleString()} / 中控预算 {stats.budgetTokens.toLocaleString()}
          （{stats.utilizationPercent ?? 0}%）
        </div>
      ) : null}
      {showMemory && stats.memoryCandidateCount !== undefined ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          用户记忆：候选 {stats.memoryCandidateCount}，命中 {stats.memorySelectedCount ?? 0}，
          过滤 {stats.memoryFilteredCount ?? 0}，注入约 {stats.memoryEstimatedTokens ?? 0} Token
        </div>
      ) : null}
      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        <div>
          上下文压缩预计减少 {formatTokens(stats.estimatedSavedTokens)}（{stats.estimatedSavedPercent}%）
        </div>
        <div>低置信度扩展：{stats.expanded ? "已启用" : "未启用"}</div>
        <ProviderCacheUsage stats={stats} />
        {diagnostics ? (
          diagnostics.providerUsageAvailable ? (
            <div>
              工作流累计实际用量：请求 {diagnostics.requestCount}，
              输入 {(diagnostics.inputTokens ?? 0).toLocaleString()}，
              输出 {(diagnostics.outputTokens ?? 0).toLocaleString()}，
              缓存读 {(diagnostics.cacheReadTokens ?? 0).toLocaleString()}，
              缓存写 {(diagnostics.cacheWriteTokens ?? 0).toLocaleString()}
            </div>
          ) : (
            <div>实际用量不可用</div>
          )
        ) : stats.providerUsageReported ? (
          <div>
            工作流累计实际用量：输入 {(stats.providerInputTokens ?? 0).toLocaleString()}
            {stats.providerCachedTokens !== undefined
              ? `，缓存读 ${stats.providerCachedTokens.toLocaleString()}`
              : ""}
          </div>
        ) : (
          <div>实际用量不可用</div>
        )}
      </div>
      {warnings.length > 0 ? (
        <div className="mt-1 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
          <div className="font-medium">警告（{warnings.length}）</div>
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
