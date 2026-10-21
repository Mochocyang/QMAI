import { useEffect } from "react"
import { Compass, Play, RotateCcw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GUIDE_CHAPTERS, GUIDE_STEPS, getGuideChapter } from "@/lib/guide/guide-steps"
import { useGuideStore } from "@/lib/guide/guide-store"
import { GUIDE_RESTART_EVENT } from "@/lib/guide/guide-events"
import type { GuideChapterId } from "@/lib/guide/guide-types"

/**
 * 设置 → 新手引导。
 *
 * 存在的理由（用户原话）：「有些用户完成引导后可能还是不会用，需要能重新进行引导」。
 * 所以这里不是一份静态说明，而是**可执行的重播面板**：
 *   · 重新开始整段引导；
 *   · 或者只重播某一节（例如只想再看一次「大纲模式」怎么用）；
 *   · 也可以彻底关掉，不再自动弹。
 *
 * 重播后要退出设置页：整段引导的第一步是「在书架点设置」，人若还站在设置里，
 * 第一步会指着一个已经点过的按钮。退出动作交给外壳（见 `ui-test-shell.tsx`
 * 对 `qmai-guide-restart` 事件的监听），这里只负责发信号。
 */

function formatFinishedAt(timestamp?: number): string {
  if (!timestamp) return ""
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return ""
  }
}

export function OnboardingSection() {
  const status = useGuideStore((s) => s.status)
  const stepIndex = useGuideStore((s) => s.stepIndex)
  const skippedChapters = useGuideStore((s) => s.skippedChapters)
  const finishedAt = useGuideStore((s) => s.finishedAt)
  const hydrate = useGuideStore((s) => s.hydrate)
  const start = useGuideStore((s) => s.start)
  const turnOff = useGuideStore((s) => s.dismiss)

  // 直接打开设置页时也要读一次持久化进度（外壳可能还没跑 hydrate）。
  useEffect(() => {
    hydrate()
  }, [hydrate])

  const currentStep = GUIDE_STEPS[stepIndex]
  const currentChapter = currentStep ? getGuideChapter(currentStep.chapter) : undefined

  const restart = (chapterId?: GuideChapterId) => {
    start(chapterId)
    window.dispatchEvent(new CustomEvent(GUIDE_RESTART_EVENT))
  }

  const statusText = status === "running"
    ? `进行中 · 第 ${stepIndex + 1} / ${GUIDE_STEPS.length} 步${currentChapter ? `（${currentChapter.title}）` : ""}`
    : status === "done"
      ? `已完成${finishedAt ? ` · ${formatFinishedAt(finishedAt)}` : ""}`
      : status === "off"
        ? "已关闭，不会自动弹出"
        : "尚未开始"

  return (
    <div className="space-y-5" data-ui="settings-onboarding">
      <div>
        <h2 className="text-xl font-semibold">新手引导</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          带你走一遍「配模型 → 新建小说 → 生成大纲 → 写第一章 → 提取记忆」。随时可以重播，只看其中一节也行。
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Compass className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{statusText}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              引导不会修改你的正文；示例大纲与示例章节都是内置内容，不调用模型、不消耗 Token。
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => restart()} size="sm">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            重新开始完整引导
          </Button>
          {status === "running" ? (
            <Button variant="outline" size="sm" onClick={turnOff}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              结束当前引导
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">按阶段重播</h3>
        {GUIDE_CHAPTERS.map((chapter, index) => {
          const steps = GUIDE_STEPS.filter((step) => step.chapter === chapter.id)
          const skipped = skippedChapters.includes(chapter.id)
          return (
            <div key={chapter.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{index + 1}. {chapter.title}</span>
                  <span className="text-[0.6875rem] text-muted-foreground">{steps.length} 步</span>
                  {skipped ? <span className="rounded border px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">曾跳过</span> : null}
                </div>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{chapter.summary}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => restart(chapter.id)}>
                <Play className="mr-1 h-3 w-3" />
                从这里开始
              </Button>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="text-xs leading-5 text-muted-foreground">
          关闭后不会自动弹出。需要时回到这一页重新开始即可；进度保存在本机，不会上传。
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={turnOff}>
          关闭自动引导
        </Button>
      </div>
    </div>
  )
}
