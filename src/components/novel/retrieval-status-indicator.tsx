import { useState } from "react"
import { AlertTriangle, RefreshCw, Database, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export interface OutdatedStatus {
  total: number
  outdated: number
  maybeOutdated: number
  conflict: number
  chapterNumbers: {
    maybeOutdated: number[]
    conflict: number[]
  }
}

interface RetrievalStatusIndicatorProps {
  status: OutdatedStatus | null
  onRefresh: () => void
  isRefreshing?: boolean
}

export function RetrievalStatusIndicator({ status, onRefresh, isRefreshing = false }: RetrievalStatusIndicatorProps) {
  const [expanded, setExpanded] = useState(false)

  if (!status || status.outdated === 0) {
    return null
  }

  const hasConflict = status.conflict > 0
  const hasMaybeOutdated = status.maybeOutdated > 0

  const tooltipText = [
    hasMaybeOutdated ? `${status.maybeOutdated} 章索引可能过期` : null,
    hasConflict ? `${status.conflict} 章存在冲突` : null,
  ].filter(Boolean).join("，")

  return (
    <TooltipProvider delay={200}>
      <div className="relative">
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
                aria-label="检索索引状态"
              >
                <div className="relative">
                  <Database className={`h-4 w-4 ${hasConflict ? "text-amber-600" : "text-amber-500"}`} />
                  <span
                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-background ${
                      hasConflict ? "bg-red-500" : "bg-amber-500"
                    }`}
                  />
                </div>
              </button>
            )}
          />
          <TooltipContent side="top" className="max-w-xs leading-5">
            {tooltipText}
          </TooltipContent>
        </Tooltip>

        {expanded && (
          <div className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border bg-background p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">检索索引状态</span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mb-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>索引总章数</span>
                <span className="font-medium text-foreground">{status.total} 章</span>
              </div>
              {hasMaybeOutdated && (
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    可能过期
                  </span>
                  <span className="font-medium text-amber-600">{status.maybeOutdated} 章</span>
                </div>
              )}
              {hasConflict && (
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    存在冲突
                  </span>
                  <span className="font-medium text-red-600">{status.conflict} 章</span>
                </div>
              )}
            </div>

            {(hasMaybeOutdated || hasConflict) && (
              <div className="mb-3 max-h-32 overflow-y-auto rounded-md border bg-muted/20 p-2 text-xs">
                {hasMaybeOutdated && (
                  <div className="mb-2">
                    <div className="mb-1 font-medium text-amber-700 dark:text-amber-400">可能过期：</div>
                    <div className="flex flex-wrap gap-1">
                      {status.chapterNumbers.maybeOutdated.slice(0, 20).map((ch) => (
                        <span
                          key={ch}
                          className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          第{ch}章
                        </span>
                      ))}
                      {status.chapterNumbers.maybeOutdated.length > 20 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{status.chapterNumbers.maybeOutdated.length - 20} 章
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {hasConflict && (
                  <div>
                    <div className="mb-1 font-medium text-red-700 dark:text-red-400">存在冲突：</div>
                    <div className="flex flex-wrap gap-1">
                      {status.chapterNumbers.conflict.slice(0, 20).map((ch) => (
                        <span
                          key={ch}
                          className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                        >
                          第{ch}章
                        </span>
                      ))}
                      {status.chapterNumbers.conflict.length > 20 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{status.chapterNumbers.conflict.length - 20} 章
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="w-full gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "重新生成中..." : "重新生成索引"}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
