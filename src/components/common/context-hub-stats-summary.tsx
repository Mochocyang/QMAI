import { useState } from "react"
import { Clock3, Database } from "lucide-react"
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
  timing?: { startedAt: number; finishedAt?: number }
}

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M tok`
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}K tok`
  return `${Math.round(tokens)} tok`
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

function formatFinishTime(time: number): string {
  return new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
}

/** 本地资料复用与供应商输入缓存分开呈现，缺失统计不视为零。 */
export function UiTestGenerationStats({ stats, timing, className }: { stats?: ContextHubStats | null; timing?: { startedAt: number; finishedAt?: number }; className?: string }) {
  const [usageOpen, setUsageOpen] = useState(false)
  const diagnostics = stats?.requestDiagnostics
  const totals = diagnostics?.usageTotals
  const input = diagnostics?.inputTokens ?? totals?.inputTokens
  const cached = diagnostics?.cacheReadTokens ?? totals?.cachedInputTokens
  const output = diagnostics?.outputTokens ?? totals?.outputTokens
  const uncached = input !== undefined && cached !== undefined ? Math.max(0, input - cached) : undefined
  const total = [input, output].every((value) => value !== undefined) ? input! + (cached ?? 0) + output! : undefined
  const cacheRate = input && cached !== undefined ? Math.round((cached / input) * 1000) / 10 : undefined
  const duration = timing?.finishedAt ? formatDuration(timing.finishedAt - timing.startedAt) : "—"
  const finished = timing?.finishedAt ? formatFinishTime(timing.finishedAt) : "—"
  const value = (tokens: number | undefined) => tokens === undefined ? "未提供" : `${tokens.toLocaleString()} tok`
  return (
    <div className={cn("ui-test-context-stats", className)}>
      <div className="relative">
        <button type="button" aria-expanded={usageOpen} aria-label="查看本轮用量" onClick={() => setUsageOpen((open) => !open)}>
          <Database aria-hidden="true" />{total === undefined ? "未提供" : compactTokens(total)}
        </button>
        {usageOpen ? (
          <div role="dialog" aria-label="本轮用量" className="ui-test-usage-popover">
            <div><span>缓存命中</span><strong>{cacheRate === undefined ? "未提供" : `${cacheRate}%`}</strong></div>
            <div><span>未缓存输入</span><strong>{value(uncached)}</strong></div>
            <div><span>缓存读取</span><strong>{value(cached)}</strong></div>
            <div><span>输出</span><strong>{value(output)}</strong></div>
          </div>
        ) : null}
      </div>
      <span title={`用时 ${duration}`} aria-label={`用时 ${duration}`}><Clock3 aria-hidden="true" />{duration}</span>
      <time>{finished}</time>
    </div>
  )
}

export function ContextHubStatsSummary({ stats, className, timing }: ContextHubStatsSummaryProps) {
  const [usageOpen, setUsageOpen] = useState(false)
  const localRate = cacheHitRate(stats.cacheableHits, stats.cacheableLoaded)
  const localSummary = localRate !== undefined
    ? `${localRate}%（复用 ${stats.cacheableHits?.toLocaleString()}/${stats.cacheableLoaded?.toLocaleString()} 项，不含任务型）`
    : `暂不可用${stats.cacheableLoaded === 0 && stats.cacheableHits === 0 ? "（无可缓存项）" : ""}`

  // 总账已包含工作流请求，不能重加明细；旧字段只能代表当前请求。
  const diagnostics = stats.requestDiagnostics
  const totals = diagnostics?.usageTotals
  const inputTokens = diagnostics ? diagnostics.inputTokens ?? totals?.inputTokens : stats.providerInputTokens
  const cachedTokens = diagnostics ? diagnostics.cacheReadTokens ?? totals?.cachedInputTokens : stats.providerCachedTokens
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
  if (IS_UI_TEST_BUILD) return <UiTestGenerationStats stats={stats} timing={timing} className={className} />
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
