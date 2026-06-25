import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface TextTransformPreviewDialogProps {
  open: boolean
  title: string
  description?: string
  sourceLabel: string
  candidateLabel: string
  sourceContent: string
  candidateContent: string
  applyLabel: string
  secondaryActionLabel?: string
  applyDisabled?: boolean
  secondaryActionDisabled?: boolean
  onCandidateContentChange?: (content: string) => void
  onApply: () => void
  onSecondaryAction?: () => void
  onClose: () => void
}

export function TextTransformPreviewDialog({
  open,
  title,
  description,
  sourceLabel,
  candidateLabel,
  sourceContent,
  candidateContent,
  applyLabel,
  secondaryActionLabel,
  applyDisabled = false,
  secondaryActionDisabled = false,
  onCandidateContentChange,
  onApply,
  onSecondaryAction,
  onClose,
}: TextTransformPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">{sourceLabel}</div>
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm leading-6 whitespace-pre-wrap">
              {sourceContent}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">{candidateLabel}</div>
            {onCandidateContentChange ? (
              <Textarea
                className="min-h-40 max-h-96 resize-y overflow-y-auto bg-muted/20 text-sm leading-6 whitespace-pre-wrap"
                value={candidateContent}
                onChange={(event) => onCandidateContentChange(event.target.value)}
              />
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm leading-6 whitespace-pre-wrap">
                {candidateContent}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {secondaryActionLabel && onSecondaryAction ? (
            <Button variant="outline" onClick={onSecondaryAction} disabled={secondaryActionDisabled}>{secondaryActionLabel}</Button>
          ) : null}
          <Button onClick={onApply} disabled={applyDisabled}>{applyLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
