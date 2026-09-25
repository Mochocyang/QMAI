import { cn } from "@/lib/utils"
import {
  isCurrentContextHubStats,
  type ContextHubSnapshotRef,
  type ContextHubStats,
} from "@/lib/context-hub/types"
import { ContextHubStatsSummary } from "./context-hub-stats-summary"

interface ContextHubDetailsProps {
  reference: ContextHubSnapshotRef
  timing?: { startedAt: number; finishedAt?: number }
  className?: string
}

/** 上下文中控：仅展示单行摘要，不再提供快照展开与技术详情。 */
export function ContextHubDetails({ reference, timing, className }: ContextHubDetailsProps) {
  const stats = isCurrentContextHubStats(reference.stats) ? reference.stats : null
  if (!stats) return null
  return <div className={cn("ui-test-context-details", className)}><ContextHubStatsSummary stats={stats} timing={timing} /></div>
}

/** Stats-only surface for generation details without a full snapshot body. */
export function ContextHubStatsOnly({
  stats,
  className,
}: {
  stats: ContextHubStats
  className?: string
}) {
  if (!isCurrentContextHubStats(stats)) return null
  return <div className={cn("ui-test-context-details", className)}><ContextHubStatsSummary stats={stats} /></div>
}
