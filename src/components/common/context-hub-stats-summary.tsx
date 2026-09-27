import { useState } from "react"
import { Clock3, Database } from "lucide-react"
import type { ContextHubStats } from "@/lib/context-hub/types"
import { cn } from "@/lib/utils"

interface ContextHubStatsSummaryProps {
  stats: ContextHubStats
  className?: string
  timing?: { startedAt: number; finishedAt?: number }
}

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}K tokens`
  return `${Math.round(tokens)} tokens`
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
  const localCacheRate = stats && stats.cacheableLoaded
    ? Math.round(((stats.cacheableHits ?? 0) / stats.cacheableLoaded) * 1000) / 10
    : undefined
  const cacheRate = input && cached !== undefined
    ? Math.round((cached / input) * 1000) / 10
    : localCacheRate
  const duration = timing?.finishedAt ? formatDuration(timing.finishedAt - timing.startedAt) : "—"
  const finished = timing?.finishedAt ? formatFinishTime(timing.finishedAt) : "—"
  const value = (tokens: number | undefined) => tokens === undefined ? "未提供" : `${tokens.toLocaleString()} tokens`
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
  return <UiTestGenerationStats stats={stats} timing={timing} className={className} />
}
