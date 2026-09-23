import { cacheableHitRate } from "@/lib/context-hub/cacheable-hit-rate"
import type { ContextHubStats } from "@/lib/context-hub/types"
import { cn } from "@/lib/utils"
import { IS_UI_TEST_BUILD } from "@/lib/ui-test"

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString()} Token`
}

function cacheHitRate(hits: number | undefined, total: number | undefined): number | undefined {
  if (
    typeof hits !== "number" || !Number.isSafeInteger(hits) || hits < 0
    || typeof total !== "number" || !Number.isSafeInteger(total) || total <= 0
    || hits > total
  ) return undefined
  return Math.round((hits / total) * 100)
}

interface ContextHubStatsSummaryProps {
  stats: ContextHubStats
  className?: string
}

/** 本地资料复用与供应商输入缓存分开呈现，缺失统计不视为零。 */
export function ContextHubStatsSummary({ stats, className }: ContextHubStatsSummaryProps) {
  const localRate = cacheHitRate(stats.cacheableHits, stats.cacheableLoaded)
  const localSummary = localRate !== undefined
    ? `${localRate}%（复用 ${stats.cacheableHits?.toLocaleString()}/${stats.cacheableLoaded?.toLocaleString()} 项，不含任务型）`
    : `暂不可用${stats.cacheableLoaded === 0 && stats.cacheableHits === 0 ? "（无可缓存项）" : ""}`

  // 总账已包含工作流请求，不能重加明细；旧字段只能代表当前请求。
  const diagnostics = stats.requestDiagnostics
  const inputTokens = diagnostics ? diagnostics.inputTokens : stats.providerInputTokens
  const cachedTokens = diagnostics ? diagnostics.cacheReadTokens : stats.providerCachedTokens
  const providerScope = diagnostics
    ? diagnostics.usageScope === "provider_thread" ? "供应商会话" : "本轮工作流"
    : "仅当前请求"
  const providerRate = cacheHitRate(cachedTokens, inputTokens)
  const providerSummary = cachedTokens === undefined
    ? "供应商未提供缓存数据"
    : providerRate !== undefined ? `${providerRate}%` : "暂不可用"

  const estimates: string[] = []
  if ((stats.composedTokens ?? 0) > 0) estimates.push(`上下文约 ${formatTokens(stats.composedTokens!)}`)
  if (stats.estimatedSavedTokens > 0) {
    estimates.push(`相比全量，估算少发送约 ${formatTokens(stats.estimatedSavedTokens)}（不代表缓存价格折扣）`)
  }
  if (IS_UI_TEST_BUILD) {
    const compactTokens = stats.composedTokens ?? 0
    const compactLocal = localRate !== undefined ? `${localRate}%` : "—"
    const compactProvider = providerRate !== undefined ? `${providerRate}%` : "—"
    return (
      <div className={cn("ui-test-context-stats", className)}>
        <span title={`上下文约 ${formatTokens(compactTokens)}`}>{formatTokens(compactTokens)}</span>
        <span title={`模型输入缓存命中率 ${providerSummary}（${providerScope}）`}>{compactProvider}</span>
        <span title={`本地资料复用率 ${localSummary}`}>{compactLocal}</span>
      </div>
    )
  }
  const total = stats.cacheHits + stats.reloaded + stats.empty + stats.fallbackUsed + stats.readFailed + stats.writeFailed
  const hitRate = cacheableHitRate(stats)
  const legacyParts = [
    `本次命中 ${stats.cacheHits.toLocaleString()} 项`,
    `命中率 ${hitRate}%`,
  ]
  if ((stats.composedTokens ?? 0) > 0) legacyParts.push(`上下文约 ${formatTokens(stats.composedTokens!)}`)
  if ((stats.estimatedSavedTokens ?? 0) > 0) legacyParts.push(`相比全量节省约 ${formatTokens(stats.estimatedSavedTokens)}`)
  return (
    <div className={cn("min-w-0 whitespace-normal break-words", className)}>
      <div>本地资料复用率 {localSummary}</div>
      <div>模型输入缓存命中率 {providerSummary}（{providerScope}）</div>
      {total > 0 && <div>{legacyParts.join(" · ")}</div>}
      {estimates.length > 0 && <div>{estimates.join(" · ")}</div>}
    </div>
  )
}
