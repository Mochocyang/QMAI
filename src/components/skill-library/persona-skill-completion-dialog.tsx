import { useEffect } from "react"

import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** 弹窗自动关闭时长。 */
const AUTO_CLOSE_MS = 5000

/**
 * 章节摄取后人物 Skill 学习完成时的提示。挂载在 App 层，全局唯一。
 *
 * 无 props：直接从 store 读 `personaSkillCompletion`，null 即不显示。
 * 5 秒后自动关闭；「现在勾选」会跳到统一技能库的「人物 Skill」页。
 */
export function PersonaSkillCompletionDialog() {
  const completion = useWikiStore((s) => s.personaSkillCompletion)
  const setPersonaSkillCompletion = useWikiStore((s) => s.setPersonaSkillCompletion)

  useEffect(() => {
    if (!completion) return
    const timer = setTimeout(() => {
      useWikiStore.getState().setPersonaSkillCompletion(null)
    }, AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [completion])

  const dismiss = () => setPersonaSkillCompletion(null)

  const goSelect = () => {
    setPersonaSkillCompletion(null)
    useWikiStore.getState().setActiveView("personaSkillLibrary")
    useWikiStore.getState().bumpDataVersion()
  }

  return (
    <Dialog
      open={completion !== null}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <DialogContent className="max-w-md" data-testid="persona-skill-completion-dialog">
        <DialogHeader>
          <DialogTitle>记忆提取完成，人物 Skill 生成成功</DialogTitle>
          <DialogDescription>以下人物档案已生成或更新。</DialogDescription>
        </DialogHeader>
        {completion && (
          <div className="flex flex-col gap-1 text-sm">
            {completion.created.length > 0 && (
              <div>
                <span className="text-muted-foreground">新增：</span>
                {completion.created.join("、")}
              </div>
            )}
            {completion.updated.length > 0 && (
              <div>
                <span className="text-muted-foreground">更新：</span>
                {completion.updated.join("、")}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            取消
          </Button>
          <Button onClick={goSelect}>现在勾选</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
