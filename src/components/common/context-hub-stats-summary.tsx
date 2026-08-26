import type { ContextHubStats } from "@/lib/context-hub/types"

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString()} Token`
}

interface ContextHubStatsSummaryProps {
  stats: ContextHubStats
  className?: string
}

/** 上下文中控单行摘要：只展示普通用户可读的命中与节省信息。 */
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

  const hitRate = Math.round((stats.cacheHits / total) * 100)
  return (
    <div className={className}>
      {`本次命中 ${stats.cacheHits.toLocaleString()} 项 · 命中率 ${hitRate}% · 节省约 ${formatTokens(stats.estimatedSavedTokens)}`}
    </div>
  )
}
