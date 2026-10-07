import { useEffect, useMemo, useState } from "react"
import { Link2, Search, Trash2 } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import {
  useStorySimulationStore,
} from "@/stores/story-simulation-store"
import { deleteFramework, loadFrameworks } from "@/lib/novel/story-simulation/framework-store"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import { Button } from "@/components/ui/button"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"

import { FrameworkBindingDialog } from "./framework-binding-dialog"

interface FrameworkListProps {
  onSelectFramework: (framework: StoryFramework) => void
  onNewFramework: () => void
  /** 刷新计数：外部 bump 时触发重新加载 */
  refreshKey?: number
}

/** 计算卡片显示标题：优先 shortTitle，否则截取 title 前 8 字。 */
function displayTitle(fw: StoryFramework): string {
  if (fw.shortTitle && fw.shortTitle.trim().length > 0) {
    return fw.shortTitle
  }
  if (fw.title.length <= 8) return fw.title
  return fw.title.slice(0, 8) + "..."
}

export function FrameworkList({
  onSelectFramework,
  onNewFramework,
  refreshKey,
}: FrameworkListProps) {
  const projectPath = useWikiStore((s) => s.project?.path)
  const frameworks = useStorySimulationStore((s) => s.frameworks)
  const setFrameworks = useStorySimulationStore((s) => s.setFrameworks)
  const binding = useStorySimulationStore((s) => s.binding)
  const setBinding = useStorySimulationStore((s) => s.setBinding)
  const currentFrameworkId = useStorySimulationStore(
    (s) => s.currentFramework?.id ?? null,
  )
  const listRefreshKey = useStorySimulationStore((s) => s.listRefreshKey)

  const [loading, setLoading] = useState(true)
  const [dialogFramework, setDialogFramework] =
    useState<StoryFramework | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  // 过滤框架
  const filteredFrameworks = useMemo(() => {
    if (!searchQuery.trim()) return frameworks
    const q = searchQuery.toLowerCase().trim()
    return frameworks.filter(
      (fw) =>
        fw.title.toLowerCase().includes(q) ||
        (fw.shortTitle && fw.shortTitle.toLowerCase().includes(q)) ||
        fw.premise.toLowerCase().includes(q),
    )
  }, [frameworks, searchQuery])

  useEffect(() => {
    if (!projectPath) {
      setLoading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const [list, currentBinding] = await Promise.all([
          loadFrameworks(projectPath),
          loadBinding(projectPath),
        ])
        if (cancelled) return
        setFrameworks(list)
        setBinding(currentBinding)
      } catch {
        // 加载失败时保持空列表，不阻塞 UI
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, setFrameworks, setBinding, refreshKey, listRefreshKey])

  const handleDelete = async (framework: StoryFramework) => {
    if (!projectPath) return
    const confirmed = window.confirm(
      `确定删除框架「${framework.title}」吗？删除后不可恢复。`,
    )
    if (!confirmed) return
    setDeletingId(framework.id)
    try {
      await deleteFramework(projectPath, framework.id)
      const list = await loadFrameworks(projectPath)
      setFrameworks(list)
    } catch {
      // 删除失败不做额外提示
    } finally {
      setDeletingId(null)
    }
  }

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        请先打开一个项目
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          加载中...
        </div>
      ) : frameworks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
          <div className="text-xs text-muted-foreground">暂无故事框架</div>
          <Button size="sm" variant="outline" onClick={onNewFramework}>
            新建框架
          </Button>
        </div>
      ) : (
        <>
          {/* 搜索框 */}
          {frameworks.length > 3 && (
            <div className="shrink-0 px-2 pt-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索框架..."
                  className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                />
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {filteredFrameworks.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                无匹配框架
              </div>
            ) : (
              filteredFrameworks.map((framework) => {
                const isBound = binding?.frameworkId === framework.id
                const isSelected = currentFrameworkId === framework.id
                return (
                  <div
                    key={framework.id}
                    className={`group flex w-full items-center gap-1 rounded-md border px-2 py-1.5 text-left transition ${
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-col items-start"
                      onClick={() => onSelectFramework(framework)}
                    >
                      <span
                        className="w-full truncate text-sm font-medium"
                        title={framework.title}
                      >
                        {displayTitle(framework)}
                      </span>
                      <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {framework.nodes.length} 节点 · {framework.targetWords} 字
                        {isBound ? " · 已绑定" : ""}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={isBound ? "管理绑定" : "绑定到 AI 会话"}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDialogFramework(framework)
                        }}
                      >
                        <Link2
                          className={`h-3.5 w-3.5 ${isBound ? "text-primary" : ""}`}
                        />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="删除框架"
                        disabled={deletingId === framework.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(framework)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}

      {dialogFramework && (
        <FrameworkBindingDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialogFramework(null)
          }}
          framework={dialogFramework}
          onBound={() => setDialogFramework(null)}
        />
      )}
    </div>
  )
}
