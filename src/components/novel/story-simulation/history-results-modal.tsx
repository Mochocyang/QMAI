import { useEffect, useState } from "react"
import { X, Loader2, Trash2, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { loadSimulationResults, deleteSimulationResult } from "@/lib/novel/story-simulation/framework-store"
import type { SimulationResultStatus } from "@/lib/novel/story-simulation/types"

interface HistoryResultsModalProps {
  open: boolean
  projectPath: string | undefined
  frameworkId: string | undefined
  onSelectResult: (resultId: string) => void
  onContinueResult?: (resultId: string) => void
  onClose: () => void
}

interface ResultItem {
  id: string
  createdAt: string
  summary: string
  hasDraft: boolean
  status: SimulationResultStatus
}

export function HistoryResultsModal({
  open,
  projectPath,
  frameworkId,
  onSelectResult,
  onContinueResult,
  onClose,
}: HistoryResultsModalProps) {
  const [results, setResults] = useState<ResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !projectPath || !frameworkId) return
    setLoading(true)
    setError(null)

    loadSimulationResults(projectPath, frameworkId)
      .then((data) => {
        setResults(
          data.map((r) => ({
            id: r.id,
            createdAt: r.report.createdAt,
            summary: r.report.recommendation || "查看推演结果",
            hasDraft: !!r.draft,
            status: r.status,
          })),
        )
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "加载失败")
        setResults([])
      })
      .finally(() => setLoading(false))
  }, [open, projectPath, frameworkId])

  const handleDelete = async (e: React.MouseEvent, resultId: string) => {
    e.stopPropagation()
    if (!projectPath) return
    if (!confirm("确定要删除这个推演结果吗？此操作不可撤销。")) return

    setDeletingId(resultId)
    try {
      await deleteSimulationResult(projectPath, frameworkId!, resultId)
      setResults((prev) => prev.filter((r) => r.id !== resultId))
    } catch {
      // 删除失败，忽略
    } finally {
      setDeletingId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="mx-4 flex max-h-[70vh] w-full max-w-md flex-col rounded-lg bg-background shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">历史推演结果</span>
            {results.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({results.length})
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 内容 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="px-2 py-8 text-center text-sm text-destructive">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              暂无历史推演结果
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="group flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => onSelectResult(result.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">
                        {new Date(result.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {result.hasDraft && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          草稿
                        </span>
                      )}
                      {(result.status ?? "complete") !== "complete" && (
                        <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                          未完成
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.summary.slice(0, 40)}
                    </span>
                  </div>
                  {(result.status ?? "complete") !== "complete" && onContinueResult && (
                    <button
                      type="button"
                      className="shrink-0 rounded px-2 py-1 text-xs text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        onContinueResult(result.id)
                      }}
                    >
                      继续推演
                    </button>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => void handleDelete(e, result.id)}
                    disabled={deletingId === result.id}
                    title="删除此结果"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
