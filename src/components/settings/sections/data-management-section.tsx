import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  Download,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { exportBackup } from "@/lib/backup/export"
import { importBackup } from "@/lib/backup/import"
import type {
  ExportResult,
  ImportResult,
  ImportStrategy,
  BackupProgressPayload,
} from "@/lib/backup/types"

export function DataManagementSection() {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>("full")
  const [progress, setProgress] = useState<BackupProgressPayload | null>(null)

  const handleProgress = useCallback((payload: BackupProgressPayload) => {
    setProgress(payload)
  }, [])

  async function handleExport() {
    setIsExporting(true)
    setExportResult(null)
    setProgress(null)
    try {
      const result = await exportBackup(handleProgress)
      setExportResult(result)
    } catch (err) {
      setExportResult({
        success: false,
        warnings: [],
        fileCount: 0,
        totalSize: 0,
        error: String(err),
      })
    } finally {
      setIsExporting(false)
      setProgress((p) => (p && p.stage === "done" ? p : null))
    }
  }

  async function handleImport() {
    setIsImporting(true)
    setImportResult(null)
    setProgress(null)
    try {
      const result = await importBackup(importStrategy, undefined, handleProgress)
      setImportResult(result)
    } catch (err) {
      setImportResult({
        success: false,
        appState: null,
        localStorageData: null,
        projects: [],
        warnings: [],
        error: String(err),
      })
    } finally {
      setIsImporting(false)
      setProgress((p) => (p && p.stage === "done" ? p : null))
    }
  }

  const isBusy = isExporting || isImporting

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.dataManagement.title", { defaultValue: "数据管理" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.dataManagement.description", {
            defaultValue: "备份和恢复你的所有数据，包括模型配置、AI对话、小说内容、大纲、记忆库、拆书结果等。",
          })}
        </p>
      </div>

      {progress && isBusy && (
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm font-medium">{progress.message}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.current} / {progress.total}
          </p>
        </div>
      )}

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h3 className="font-medium">
            {t("settings.sections.dataManagement.exportTitle", { defaultValue: "导出备份" })}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.sections.dataManagement.exportDescription", {
            defaultValue: "将所有数据打包为一个 zip 文件，用于重装系统前备份。包含：全局配置、所有项目数据、UI偏好。",
          })}
        </p>
        <Button onClick={handleExport} disabled={isBusy}>
          {isExporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("settings.sections.dataManagement.exporting", { defaultValue: "导出中..." })}
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              {t("settings.sections.dataManagement.exportButton", { defaultValue: "导出备份" })}
            </>
          )}
        </Button>
        {exportResult && (
          <div className="text-sm space-y-1">
            {exportResult.success ? (
              <div className="flex items-start gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p>{t("settings.sections.dataManagement.exportSuccess", { defaultValue: "导出成功" })}</p>
                  <p className="text-muted-foreground">
                    {t("settings.sections.dataManagement.fileCount", {
                      defaultValue: "共 {{count}} 个文件，{{size}}",
                      count: exportResult.fileCount,
                      size: formatSize(exportResult.totalSize),
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>{exportResult.error}</p>
              </div>
            )}
            {exportResult.warnings.length > 0 && (
              <div className="text-yellow-600 text-xs space-y-1">
                {exportResult.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" />
          <h3 className="font-medium">
            {t("settings.sections.dataManagement.importTitle", { defaultValue: "导入备份" })}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.sections.dataManagement.importDescription", {
            defaultValue: "从 zip 备份文件恢复数据。项目数据会立即刷新，全局配置更改可能需要重启软件生效。",
          })}
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t("settings.sections.dataManagement.importStrategy", { defaultValue: "导入方式" })}
          </label>
          <div className="space-y-1">
            {([
              { value: "full" as const, label: "完全覆盖（清除当前所有数据）" },
              { value: "global-only" as const, label: "仅导入全局配置（模型、UI偏好）" },
              { value: "selective" as const, label: "选择性导入项目" },
            ]).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="import-strategy"
                  value={opt.value}
                  checked={importStrategy === opt.value}
                  onChange={(e) => setImportStrategy(e.target.value as ImportStrategy)}
                  className="cursor-pointer"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <Button onClick={handleImport} disabled={isBusy} variant="outline">
          {isImporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("settings.sections.dataManagement.importing", { defaultValue: "导入中..." })}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {t("settings.sections.dataManagement.importButton", { defaultValue: "导入备份" })}
            </>
          )}
        </Button>

        {importResult && (
          <div className="text-sm space-y-1">
            {importResult.success ? (
              <div className="flex items-start gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p>{t("settings.sections.dataManagement.importSuccess", { defaultValue: "导入成功，项目数据已自动刷新，部分全局配置可能需要重启生效" })}</p>
                  {importResult.projects.length > 0 && (
                    <p className="text-muted-foreground">
                      {t("settings.sections.dataManagement.restoredProjects", {
                        defaultValue: "已恢复 {{count}} 个项目",
                        count: importResult.projects.filter((p) => p.success).length,
                      })}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>{importResult.error}</p>
              </div>
            )}
            {importResult.warnings.length > 0 && (
              <div className="text-yellow-600 text-xs space-y-1">
                {importResult.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}
            {importResult.projects.some((p) => !p.success) && (
              <div className="text-red-600 text-xs space-y-1">
                {importResult.projects.filter((p) => !p.success).map((p, i) => (
                  <p key={i}>✗ {p.id}: {p.error}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>
            {t("settings.sections.dataManagement.securityWarning", {
              defaultValue: "备份文件包含 API 密钥等敏感信息，请妥善保管，不要分享给他人。",
            })}
          </p>
        </div>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
