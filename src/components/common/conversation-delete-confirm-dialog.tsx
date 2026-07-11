import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ConversationDeleteConfirmDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConversationDeleteConfirmDialog({ open, onCancel, onConfirm }: ConversationDeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>停止并删除会话？</DialogTitle>
          <DialogDescription>该会话仍在生成。确认后将先停止任务，再删除会话。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>停止并删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}