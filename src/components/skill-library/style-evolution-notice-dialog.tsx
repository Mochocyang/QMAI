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

const AUTO_CLOSE_MS = 8000

/**
 * 文风自进化写出新候选时的提示。挂载在 App 层，全局唯一。
 *
 * 候选需要用户在文风库里点一下才启用（引擎从不自动启用）；
 * 不提示的话，用户根本不知道有一份候选在等他确认。
 */
export function StyleEvolutionNoticeDialog() {
  const notice = useWikiStore((s) => s.styleEvolutionNotice)
  const setNotice = useWikiStore((s) => s.setStyleEvolutionNotice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => {
      useWikiStore.getState().setStyleEvolutionNotice(null)
    }, AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const dismiss = () => setNotice(null)

  const goView = () => {
    setNotice(null)
    useWikiStore.getState().setActiveView("writingStyleLibrary")
    useWikiStore.getState().bumpDataVersion()
  }

  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <DialogContent className="max-w-md" data-testid="style-evolution-notice-dialog">
        <DialogHeader>
          <DialogTitle>文风自进化生成了新候选</DialogTitle>
          <DialogDescription>
            {notice?.outcome === "kept"
              ? `「${notice.name}」在试写对比里更接近你最近的写法。`
              : `已根据你最近的章节建立第一份文风画像「${notice?.name ?? ""}」。`}
            候选不会自动启用，去文风库点一下才会生效。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            稍后
          </Button>
          <Button onClick={goView}>去文风库查看</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
