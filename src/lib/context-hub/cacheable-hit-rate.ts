import type { ContextHubStats } from "./types"

export function cacheableHitRate(stats: Pick<
  ContextHubStats,
  "cacheHits" | "reloaded" | "empty" | "fallbackUsed" | "readFailed" | "writeFailed" | "taskScopedLoaded" | "taskScopedHits"
>): number {
  const total =
    stats.cacheHits
    + stats.reloaded
    + stats.empty
    + stats.fallbackUsed
    + stats.readFailed
    + stats.writeFailed
  const cacheableHits = stats.cacheHits - (stats.taskScopedHits ?? 0)
  const cacheableTotal = total - (stats.taskScopedLoaded ?? 0)
  return cacheableTotal > 0
    ? Math.round((cacheableHits / cacheableTotal) * 100)
    : 0
}
