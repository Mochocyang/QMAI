import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { saveNovelConfig } from "@/lib/project-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 分步引导教程（丙-4c）—— 首次进入 AI 对话时自动弹一次。
 *
 * ── 文案归属（照每个文件自己的先例，不要跨文件照抄）──
 * 这里的标题与正文是**硬编码中文**，与最近的同类弹窗一致：
 * `event-outline-wizard-dialog.tsx` 与 `event-outline-card.tsx` 里
 * 没有任何 `useTranslation`。设置里那个「重新查看教程」入口反而是 i18n 的
 * —— 那在 `novel-section.tsx`，那个文件整节都走 `novel.settings.*` 这一族 key。
 *
 * ⚠️ 本文件里**不要**写出形如 `t(` 加带引号 key 的字面量（连注释里也不行）：
 * `src/i18n/i18n-parity.test.ts` 是用正则从源码里刮 key 的，注释里的这种字面量
 * 会被当真、然后因为 zh.json 里没有对应 key 而变红（实测踩过）。
 *
 * ── 用哪个弹窗原语 ──
 * `src/components/ui/dialog.tsx`（基于 `@base-ui/react/dialog`）是仓库里
 * **唯一**的共享对话框原语，没有 Popover 可用。做法照
 * `event-outline-wizard-dialog.tsx`：`open` 为假时直接 `return null`。
 *
 * ⚠️ **不要**引用 `WelcomeScreen`（`58bceeb` 已删除，
 * `ui-test-isolation.spec.ts:7` 是一条反向守卫）。本文件是新写的，
 * 与那个已删除的组件没有任何关系。
 */

interface TutorialStep {
  title: string
  body: string
}

/**
 * 每一步一段文案。最后一步的按钮是「开始使用」，其余是「下一步」。
 *
 * 刻意把「草稿隔离」写进第二步：它是本产品最容易误解、后果最重的一条
 * （AI 写出来的东西先是草稿，只有点「提取记忆」才会进记忆库）。
 */
const USAGE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "欢迎使用青幕 AI 写作",
    body: "用四步把界面讲清楚：目录、编辑器、写作助手各自负责什么，以及「草稿」和「正式章节」的区别。以后想再看一遍，可以在「设置 → 写作设置」里点「重新查看教程」。",
  },
  {
    title: "左边是目录，中间是编辑器",
    body: "章节、大纲、设定都在左边的目录里，点文件名即可打开；目录图标在左上角，可以收起。打开的文件显示在中间的编辑器里。",
  },
  {
    title: "AI 写出来的先是「草稿」",
    body: "编辑器里默认是草稿状态。无论是你写的还是 AI 写的，只有点了工具栏的「提取记忆」才会成为正式章节并进入记忆库 —— 没确认的内容不会污染记忆。",
  },
  {
    title: "右边是写作助手",
    body: "在这里和 AI 对话，用 @ 可以引用章节和资料。空章节还可以点工具栏的「生成章节细纲」，先要一份新章节故事灵感。",
  },
]

interface UsageTutorialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UsageTutorialDialog({ open, onOpenChange }: UsageTutorialDialogProps) {
  const [step, setStep] = useState(0)
  const setNovelConfig = useWikiStore((s) => s.setNovelConfig)
  const projectId = useWikiStore((s) => s.project?.id)
  const projectPath = useWikiStore((s) => s.project?.path)

  /**
   * 每次打开都从第一步开始，并且**显示即记 seen**。
   *
   * 「显示即记」是照 `preview-panel.tsx` 草稿提示那条既有先例
   * （`if (next && !…Seen) { setNovelConfig({…Seen: true}); void saveNovelConfig(…) }`）：
   * 判据在外面（`App.tsx` 用刚加载到的那本书自己的配置决定要不要请求），
   * 这里只负责把「这本书已经看过」落盘 —— 所以本组件**不参与**判据，
   * 也就不会踩到「store 里还残留上一本书配置」那个窗口。
   * 落盘失败只打日志，不影响教程本身。
   */
  useEffect(() => {
    if (!open) return
    /*
     * ⚠️ 这一行是承重的：`open=false` 时本组件**不卸载**（只是 `return null`），
     * 所以 `step` 会留在上一次的位置。没有它，「开始使用」关掉之后从设置里
     * 「重新查看教程」再打开，会直接落在最后一步（用户只看到一句话）。
     * 用例在 `usage-tutorial-dialog.spec.tsx` 的「走到最后一步后关掉再打开」。
     */
    setStep(0)
    const store = useWikiStore.getState()
    if (store.novelConfig.usageTutorialSeen) return
    const config = { ...store.novelConfig, usageTutorialSeen: true }
    setNovelConfig({ usageTutorialSeen: true })
    void saveNovelConfig(config, projectId, projectPath).catch((error) => {
      console.error("记录分步引导教程已提示失败:", error)
    })
  }, [open, projectId, projectPath, setNovelConfig])

  if (!open) return null

  const total = USAGE_TUTORIAL_STEPS.length
  const current = USAGE_TUTORIAL_STEPS[step]
  const isLast = step >= total - 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ui-test-usage-tutorial sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>
        <p className="ui-test-usage-tutorial-progress" role="status" aria-live="polite">
          {`第 ${step + 1} / ${total} 步`}
        </p>
        <DialogFooter>
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>上一步</Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              if (isLast) {
                onOpenChange(false)
                return
              }
              setStep(step + 1)
            }}
          >
            {isLast ? "开始使用" : "下一步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
