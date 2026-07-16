import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ConversationHistoryClearDialogProps {
  open: boolean
  count: number
  onCancel: () => void
  onConfirm: () => void
}

export function ConversationHistoryClearDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: ConversationHistoryClearDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("chat.clearHistoryTitle")}</DialogTitle>
          <DialogDescription>{t("chat.clearHistoryDescription", { count })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("chat.clearHistoryCancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t("chat.clearHistoryConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
