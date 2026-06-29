import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface DeAiPreviewDialogProps {
  open: boolean
  sourceContent: string
  candidateContent: string
  skillName?: string
  onApply: () => void
  onSaveDraft: () => void
  onClose: () => void
}

export function DeAiPreviewDialog({
  open,
  sourceContent,
  candidateContent,
  skillName,
  onApply,
  onSaveDraft,
  onClose,
}: DeAiPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>去AI味预览</DialogTitle>
          {skillName ? (
            <div className="text-xs text-muted-foreground">本次使用 Skill：{skillName}</div>
          ) : null}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">原文</div>
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm leading-6 whitespace-pre-wrap">
              {sourceContent}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">去AI味稿</div>
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm leading-6 whitespace-pre-wrap">
              {candidateContent}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="outline" onClick={onSaveDraft}>另存草稿</Button>
          <Button onClick={onApply}>替换正文</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
