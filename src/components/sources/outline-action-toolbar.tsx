import { useCallback, useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
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
import {
  runBulkOutlineIngest,
  formatBulkOutlineIngestResult,
  OutlineIngestNotReadyError,
  type BulkOutlineIngestMode,
} from "@/lib/novel/outline-generation"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { openDefaultModelSettings } from "@/lib/open-settings"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useWikiStore } from "@/stores/wiki-store"

interface OutlineActionToolbarProps {
  className?: string
  onBulkIngestResult?: (message: string | null) => void
  onToggleOutlineChat?: () => void
}

export function OutlineActionToolbar({
  className,
  onBulkIngestResult,
  onToggleOutlineChat,
}: OutlineActionToolbarProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const outlineChatOpen = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [bulkIngestRunning, setBulkIngestRunning] = useState(false)
  const [bulkIngestDialogOpen, setBulkIngestDialogOpen] = useState(false)

  const bulkOutlineProgressRunning = useImportProgressStore((s) => (
    project != null && s.tasks.some((task) => (
      task.projectPath === project.path &&
      task.kind === "outline" &&
      task.status === "running"
    ))
  ))

  const bulkIngestActive = bulkIngestRunning || bulkOutlineProgressRunning

  const handleOpenOutlineChat = useCallback(() => {
    if (onToggleOutlineChat) {
      onToggleOutlineChat()
      return
    }
    setOutlineChatOpen(!outlineChatOpen)
    setActiveView("sources")
  }, [onToggleOutlineChat, outlineChatOpen, setActiveView, setOutlineChatOpen])

  const handleBulkIngest = useCallback(async (mode: BulkOutlineIngestMode) => {
    if (!project || bulkIngestActive) return
    setBulkIngestDialogOpen(false)
    setBulkIngestRunning(true)
    onBulkIngestResult?.(null)
    try {
      const result = await runBulkOutlineIngest(project.path, { mode })
      onBulkIngestResult?.(formatBulkOutlineIngestResult(result))
    } catch (err) {
      if (err instanceof OutlineIngestNotReadyError) {
        toast.error(err.message, { onClick: openDefaultModelSettings })
        onBulkIngestResult?.(err.message)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      onBulkIngestResult?.(t("novel.outlineGenerator.bulkIngestError", { message }))
    } finally {
      setBulkIngestRunning(false)
    }
  }, [bulkIngestActive, onBulkIngestResult, project, t])

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      <Button size="sm" variant="outline" onClick={handleOpenOutlineChat} aria-pressed={outlineChatOpen}>
        <MessageSquare className="mr-1 h-4 w-4" />
        AI大纲
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setBulkIngestDialogOpen(true)}
        disabled={bulkIngestActive}
      >
        {bulkIngestActive ? (
          <>
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            {t("novel.outlineGenerator.bulkIngesting")}
          </>
        ) : (
          t("novel.outlineGenerator.bulkIngest")
        )}
      </Button>
      <Dialog
        open={bulkIngestDialogOpen}
        onOpenChange={(open) => {
          if (!open) setBulkIngestDialogOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("novel.outlineGenerator.bulkIngestDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("novel.outlineGenerator.bulkIngestDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {t("novel.outlineGenerator.bulkIngestDialogHint")}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkIngestDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void handleBulkIngest("pending")}>
              {t("novel.outlineGenerator.bulkIngestPending")}
            </Button>
            <Button type="button" onClick={() => void handleBulkIngest("all")}>
              {t("novel.outlineGenerator.bulkIngestAll")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
