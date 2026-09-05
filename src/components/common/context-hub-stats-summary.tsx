import type { ContextHubStats } from "@/lib/context-hub/types"

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString()} Token`
}

interface ContextHubStatsSummaryProps {
  stats: ContextHubStats
  className?: string
}

/** 上下文中控单行摘要：只展示普通用户可读的命中与上下文规模信息。 */
export function ContextHubStatsSummary({ stats, className }: ContextHubStatsSummaryProps) {
  const total =
    stats.cacheHits
    + stats.reloaded
    + stats.empty
    + stats.fallbackUsed
    + stats.readFailed
    + stats.writeFailed

  if (total === 0) {
    return <div className={className}>本轮无上下文数据</div>
  }

  // 任务级（查询依赖）数据源无法跨消息复用，不计入可缓存命中率；旧快照缺失按 0 处理。
  const taskScopedLoaded = stats.taskScopedLoaded ?? 0
  const cacheableTotal = total - taskScopedLoaded
  const hitRate = cacheableTotal > 0
    ? Math.round((stats.cacheHits / cacheableTotal) * 100)
    : 0
  // 实际注入上下文的估算 token（真实尺度）；相比全量候选没发送的部分才叫「节省」。
  const composedTokens = stats.composedTokens ?? 0
  const savedTokens = stats.estimatedSavedTokens ?? 0
  const parts = [
    `本次命中 ${stats.cacheHits.toLocaleString()} 项`,
    `命中率 ${hitRate}%`,
  ]
  if (composedTokens > 0) parts.push(`上下文约 ${formatTokens(composedTokens)}`)
  if (savedTokens > 0) parts.push(`相比全量节省约 ${formatTokens(savedTokens)}`)
  return (
    <div className={className}>
      {parts.join(" · ")}
    </div>
  )
}
