import { useEffect, useState } from "react"
import { Plus, Link2, Unlink } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import {
  useStorySimulationStore,
} from "@/stores/story-simulation-store"
import { loadFrameworks } from "@/lib/novel/story-simulation/framework-store"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import { Button } from "@/components/ui/button"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"

import { FrameworkBindingDialog } from "./framework-binding-dialog"

interface FrameworkListProps {
  onSelectFramework: (framework: StoryFramework) => void
  onNewFramework: () => void
}

export function FrameworkList({
  onSelectFramework,
  onNewFramework,
}: FrameworkListProps) {
  const projectPath = useWikiStore((s) => s.project?.path)
  const frameworks = useStorySimulationStore((s) => s.frameworks)
  const setFrameworks = useStorySimulationStore((s) => s.setFrameworks)
  const binding = useStorySimulationStore((s) => s.binding)
  const setBinding = useStorySimulationStore((s) => s.setBinding)

  const [loading, setLoading] = useState(true)
  const [dialogFramework, setDialogFramework] =
    useState<StoryFramework | null>(null)

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
  }, [projectPath, setFrameworks, setBinding])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        请先打开一个项目
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">故事框架</h3>
        <Button size="sm" onClick={onNewFramework}>
          <Plus className="mr-1 h-4 w-4" />
          新建框架
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          加载中...
        </div>
      ) : frameworks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          暂无故事框架
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-auto">
          {frameworks.map((framework) => {
            const isBound = binding?.frameworkId === framework.id
            return (
              <div
                key={framework.id}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
              >
                <button
                  type="button"
                  className="flex flex-1 flex-col items-start gap-1 text-left"
                  onClick={() => onSelectFramework(framework)}
                >
                  <span className="font-medium">{framework.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {framework.nodes.length} 个节点 · 目标{" "}
                    {framework.targetWords} 字
                  </span>
                </button>
                <Button
                  size="sm"
                  variant={isBound ? "outline" : "default"}
                  onClick={() => setDialogFramework(framework)}
                >
                  {isBound ? (
                    <>
                      <Unlink className="mr-1 h-4 w-4" />
                      取消绑定
                    </>
                  ) : (
                    <>
                      <Link2 className="mr-1 h-4 w-4" />
                      绑定到 AI 会话
                    </>
                  )}
                </Button>
              </div>
            )
          })}
        </div>
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
