import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { OutlineActionToolbar } from "@/components/sources/outline-action-toolbar"
import { OutlineWorkbench } from "@/components/sources/outline-workbench"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { openDefaultModelSettings } from "@/lib/open-settings"
import { cn } from "@/lib/utils"

export function SourcesView() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const [bulkIngestResult, setBulkIngestResult] = useState<string | null>(null)
  const ingestNoLlm = t("novel.outlineGenerator.ingestNoLlm")
  const canOpenDefaultModel = Boolean(bulkIngestResult?.includes(ingestNoLlm))

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {t(novelMode ? "novel.sources.title" : "sources.title")}
        </h2>
        <div className="flex flex-wrap gap-1">
          {novelMode ? (
            <OutlineActionToolbar onBulkIngestResult={setBulkIngestResult} />
          ) : null}
        </div>
      </div>

      {bulkIngestResult ? (
        <div
          className={cn(
            "border-b px-4 py-2 text-xs whitespace-pre-line",
            canOpenDefaultModel
              ? "cursor-pointer text-destructive hover:underline"
              : "text-muted-foreground",
          )}
          role={canOpenDefaultModel ? "button" : undefined}
          onClick={canOpenDefaultModel ? openDefaultModelSettings : undefined}
        >
          {bulkIngestResult}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {novelMode ? <OutlineWorkbench /> : <PreviewPanel />}
      </div>
    </div>
  )
}
