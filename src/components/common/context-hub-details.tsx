import { Database } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isCurrentContextHubStats,
  type ContextHubSnapshotRef,
  type ContextHubStats,
} from "@/lib/context-hub/types"
import { ContextHubStatsSummary } from "./context-hub-stats-summary"

interface ContextHubDetailsProps {
  reference: ContextHubSnapshotRef
  className?: string
}

/** 上下文中控：仅展示单行摘要，不再提供快照展开与技术详情。 */
export function ContextHubDetails({ reference, className }: ContextHubDetailsProps) {
  const stats = isCurrentContextHubStats(reference.stats) ? reference.stats : null
  if (!stats) return null

  return (
    <div className={cn("mt-2 min-w-0 border-t border-border/60 pt-2", className)}>
      <div className="flex w-full min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
          <Database aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">上下文中控</div>
          <ContextHubStatsSummary stats={stats} />
        </div>
      </div>
    </div>
  )
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
  return (
    <div className={cn("mt-2 min-w-0 border-t border-border/60 pt-2", className)}>
      <div className="flex w-full min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
          <Database aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">上下文中控</div>
          <ContextHubStatsSummary stats={stats} />
        </div>
      </div>
    </div>
  )
}
