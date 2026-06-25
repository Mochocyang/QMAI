import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Folder, Play, RefreshCw } from "lucide-react"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import { useWikiStore } from "@/stores/wiki-store"
import { scanAndImport } from "@/lib/scheduled-import"
import { pickDirectory } from "@/lib/platform"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function ScheduledImportSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const scheduledImportConfig = useWikiStore((s) => s.scheduledImportConfig)
  const [isScanning, setIsScanning] = useState(false)

  const handleSelectDirectory = async () => {
    const dir = await pickDirectory()
    if (dir) setDraft("scheduledImportPath", dir)
  }

  const handleManualScan = useCallback(async () => {
    if (!project || isScanning) return

    setIsScanning(true)
    try {
      await scanAndImport(project, draft.scheduledImportPath)
    } catch (err) {
      console.error("[Scheduled Import] Manual scan failed:", err)
    } finally {
      setIsScanning(false)
    }
  }, [project, draft.scheduledImportPath, isScanning])

  const lastScanDate = scheduledImportConfig.lastScan
    ? new Date(scheduledImportConfig.lastScan).toLocaleString()
    : t("settings.sections.scheduledImport.never", { defaultValue: "从未扫描" })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.scheduledImport.title", {
            defaultValue: "定时导入",
          })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.scheduledImport.description", {
            defaultValue: "自动监控目录，并按固定间隔导入新增或更新的文件。",
          })}
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.scheduledImportEnabled}
          onChange={(e) => setDraft("scheduledImportEnabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          {t("settings.sections.scheduledImport.enable", {
            defaultValue: "启用定时导入",
          })}
        </span>
      </label>

      {draft.scheduledImportEnabled && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t("settings.sections.scheduledImport.privacyNotice", {
            defaultValue: "所选目录中的文件可能会被复制到当前项目，并在摄取时发送给已配置的大模型。源目录删除文件后，项目内不会自动删除。",
          })}
        </div>
      )}

      <div className="space-y-2">
        <Label>
          {t("settings.sections.scheduledImport.directory", {
            defaultValue: "监控目录",
          })}
        </Label>
        <div className="flex gap-2">
          <Input
            value={draft.scheduledImportPath}
            onChange={(e) => setDraft("scheduledImportPath", e.target.value)}
            placeholder="raw/sources"
            disabled={!draft.scheduledImportEnabled}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleSelectDirectory}
            disabled={!draft.scheduledImportEnabled}
            title={t("settings.sections.scheduledImport.browse", {
              defaultValue: "浏览目录",
            })}
          >
            <Folder className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.directoryHelp", {
            defaultValue: "该目录及其子目录中的文件会自动导入；新增文件会复制到素材区，修改后的文件会重新摄取。",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheduled-import-interval">
          {t("settings.sections.scheduledImport.interval", {
            defaultValue: "扫描间隔（分钟）",
          })}
        </Label>
        <Input
          id="scheduled-import-interval"
          type="number"
          min={1}
          max={1440}
          value={draft.scheduledImportInterval}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (!isNaN(val) && val >= 1) {
              setDraft("scheduledImportInterval", val)
            }
          }}
          disabled={!draft.scheduledImportEnabled}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.intervalHelp", {
            defaultValue: "多久检查一次变更，最短为 1 分钟。",
          })}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualScan}
          disabled={!draft.scheduledImportEnabled || !draft.scheduledImportPath || isScanning}
        >
          {isScanning ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isScanning
            ? t("settings.sections.scheduledImport.scanning", { defaultValue: "扫描中..." })
            : t("settings.sections.scheduledImport.scanNow", { defaultValue: "立即扫描" })}
        </Button>

        <span className="text-xs text-muted-foreground">
          {t("settings.sections.scheduledImport.lastScan", {
            defaultValue: "上次扫描：{{time}}",
            time: lastScanDate,
          })}
        </span>
      </div>
    </div>
  )
}
