import { useCallback, useState } from "react"
import { Loader2, MessageSquare, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { OutlineGeneratorDialog, type OutlineGeneratorMode } from "@/components/sources/outline-generator-dialog"
import { runBulkOutlineIngest, formatBulkOutlineIngestResult, OutlineIngestNotReadyError } from "@/lib/novel/outline-generation"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
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
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false)
  const [outlineDialogMode, setOutlineDialogMode] = useState<OutlineGeneratorMode>("outline")
  const [bulkIngestRunning, setBulkIngestRunning] = useState(false)

  const bulkOutlineProgressRunning = useImportProgressStore((s) => (
    project != null && s.tasks.some((task) => (
      task.projectPath === project.path &&
      task.kind === "outline" &&
      task.status === "running"
    ))
  ))

  const bulkIngestActive = bulkIngestRunning || bulkOutlineProgressRunning

  function openOutlineDialog(mode: OutlineGeneratorMode) {
    setOutlineDialogMode(mode)
    setOutlineDialogOpen(true)
  }

  const handleOpenOutlineChat = useCallback(() => {
    if (onToggleOutlineChat) {
      onToggleOutlineChat()
      return
    }
    setOutlineChatOpen(true)
    setActiveView("sources")
  }, [onToggleOutlineChat, setActiveView, setOutlineChatOpen])

  const handleBulkIngest = useCallback(async () => {
    if (!project || bulkIngestActive) return
    setBulkIngestRunning(true)
    onBulkIngestResult?.(null)
    try {
      const result = await runBulkOutlineIngest(project.path)
      onBulkIngestResult?.(formatBulkOutlineIngestResult(result))
    } catch (err) {
      if (err instanceof OutlineIngestNotReadyError) {
        toast.error(err.message)
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
    <>
      <div className={cn("flex flex-wrap gap-1", className)}>
        <Button size="sm" onClick={() => openOutlineDialog("outline")}>
          <Sparkles className="mr-1 h-4 w-4" />
          {t("novel.outlineGenerator.title")}
        </Button>
        <Button size="sm" variant="outline" onClick={handleOpenOutlineChat}>
          <MessageSquare className="mr-1 h-4 w-4" />
          AI大纲
        </Button>
        <Button size="sm" variant="outline" onClick={() => openOutlineDialog("refine")}>
          {t("novel.outlineGenerator.refineTitle")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handleBulkIngest()} disabled={bulkIngestActive}>
          {bulkIngestActive ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              {t("novel.outlineGenerator.bulkIngesting")}
            </>
          ) : (
            t("novel.outlineGenerator.bulkIngest")
          )}
        </Button>
      </div>

      <OutlineGeneratorDialog
        open={outlineDialogOpen}
        onOpenChange={setOutlineDialogOpen}
        mode={outlineDialogMode}
      />
    </>
  )
}
