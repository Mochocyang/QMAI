import { useEffect, useState } from "react"
import { Archive, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type {
  BackupExportOptions,
  ProjectBackupInfo,
  ProjectBackupSection,
} from "@/lib/backup/types"

interface BackupExportDialogProps {
  open: boolean
  projects: ProjectBackupInfo[]
  exporting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: BackupExportOptions) => void
}

type BackupMode = "full" | "projects-only" | "custom"

const ALL_SECTIONS: ProjectBackupSection[] = [
  "content",
  "memory",
  "analysis",
  "indexes",
  "trash",
]

const SECTION_LABELS: Record<ProjectBackupSection, string> = {
  content: "项目正文与资料",
  memory: "结构化记忆与章节快照",
  analysis: "拆书、推演与 AI 工作数据",
  indexes: "向量与检索索引",
  trash: "回收站",
}

export function BackupExportDialog({
  open,
  projects,
  exporting,
  onOpenChange,
  onConfirm,
}: BackupExportDialogProps) {
  const [mode, setMode] = useState<BackupMode>("full")
  const [includeGlobalConfig, setIncludeGlobalConfig] = useState(true)
  const [includeUiPreferences, setIncludeUiPreferences] = useState(true)
  const [includeCredentials, setIncludeCredentials] = useState(true)
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    () => new Set(projects.map((project) => project.id)),
  )
  const [selectedSections, setSelectedSections] = useState<Set<ProjectBackupSection>>(
    () => new Set(ALL_SECTIONS),
  )

  useEffect(() => {
    if (!open) return
    setMode("full")
    setIncludeGlobalConfig(true)
    setIncludeUiPreferences(true)
    setIncludeCredentials(true)
    setSelectedProjectIds(new Set(projects.map((project) => project.id)))
    setSelectedSections(new Set(ALL_SECTIONS))
  }, [open, projects])

  function selectMode(nextMode: BackupMode) {
    setMode(nextMode)
    const projectIds = new Set(projects.map((project) => project.id))
    setSelectedProjectIds(projectIds)
    setSelectedSections(new Set(ALL_SECTIONS))

    if (nextMode === "full") {
      setIncludeGlobalConfig(true)
      setIncludeUiPreferences(true)
      setIncludeCredentials(true)
      return
    }
    if (nextMode === "projects-only") {
      setIncludeGlobalConfig(false)
      setIncludeUiPreferences(false)
      setIncludeCredentials(false)
      return
    }
    setIncludeGlobalConfig(true)
    setIncludeUiPreferences(true)
    setIncludeCredentials(false)
  }

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  function toggleSection(section: ProjectBackupSection) {
    setSelectedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const hasProjectContent = selectedProjectIds.size > 0 && selectedSections.size > 0
  const canExport = includeGlobalConfig || includeUiPreferences || hasProjectContent

  function confirmExport() {
    if (!canExport) return
    const sections = ALL_SECTIONS.filter((section) => selectedSections.has(section))
    onConfirm({
      includeGlobalConfig,
      includeUiPreferences,
      includeCredentials,
      projects: sections.length === 0
        ? []
        : projects
          .filter((project) => selectedProjectIds.has(project.id))
          .map((project) => ({ ...project, sections })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !exporting && onOpenChange(nextOpen)}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col sm:max-w-[720px]"
      >
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-primary" />
            <DialogTitle>选择备份内容</DialogTitle>
          </div>
          <DialogDescription>
            选择需要写入 ZIP 的配置、项目和数据类别。未选择的内容不会在导入时被覆盖。
          </DialogDescription>
        </DialogHeader>

        <div data-backup-export-scroll className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">备份模式</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ["full", "完整备份"],
                ["projects-only", "仅项目内容"],
                ["custom", "自定义备份"],
              ] as const).map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer border px-3 py-2 text-sm ${mode === value ? "border-primary bg-accent" : "hover:bg-accent/50"}`}
                >
                  <input
                    type="radio"
                    name="backup-mode"
                    value={value}
                    aria-label={label}
                    checked={mode === value}
                    onChange={() => selectMode(value)}
                    disabled={exporting}
                    className="mr-2"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">全局数据</legend>
            <label className="flex items-start gap-3 border px-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label="模型与 AI 配置"
                checked={includeGlobalConfig}
                onChange={(event) => setIncludeGlobalConfig(event.target.checked)}
                disabled={exporting || mode !== "custom"}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">模型与 AI 配置</span>
                <span className="text-xs text-muted-foreground">模型供应商、Embedding、Rerank、搜索和写作配置</span>
              </span>
            </label>
            <label className="flex items-start gap-3 border px-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label="界面与软件偏好"
                checked={includeUiPreferences}
                onChange={(event) => setIncludeUiPreferences(event.target.checked)}
                disabled={exporting || mode !== "custom"}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">界面与软件偏好</span>
                <span className="text-xs text-muted-foreground">主题、语言、字体、侧栏、图谱显示和布局偏好</span>
              </span>
            </label>
            <label className="flex items-start gap-3 border px-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label="API Key 和其他凭据"
                checked={includeCredentials}
                onChange={(event) => setIncludeCredentials(event.target.checked)}
                disabled={exporting || mode !== "custom"}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">API Key 和其他凭据</span>
                <span className="text-xs text-muted-foreground">关闭时保留模型设置，但不写入密钥字段</span>
              </span>
            </label>
            {includeCredentials && (
              <div className="flex items-start gap-2 border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>备份文件未加密，包含 API Key 时请勿分享给他人。</p>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">项目</legend>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="选择全部项目"
                  onClick={() => setSelectedProjectIds(new Set(projects.map((project) => project.id)))}
                  disabled={exporting}
                >
                  全选
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="取消选择全部项目"
                  onClick={() => setSelectedProjectIds(new Set())}
                  disabled={exporting}
                >
                  清空
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">已选择 {selectedProjectIds.size} / {projects.length} 个项目</p>
            <div className="max-h-40 space-y-1 overflow-y-auto border p-2">
              {projects.length === 0 && <p className="p-2 text-sm text-muted-foreground">当前没有可备份的项目。</p>}
              {projects.map((project) => (
                <label key={project.id} data-backup-project className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    aria-label={`导出项目 ${project.name}`}
                    checked={selectedProjectIds.has(project.id)}
                    onChange={() => toggleProject(project.id)}
                    disabled={exporting}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{project.path}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">项目数据类别</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_SECTIONS.map((section) => (
                <label key={section} data-backup-section className="flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    aria-label={SECTION_LABELS[section]}
                    checked={selectedSections.has(section)}
                    onChange={() => toggleSection(section)}
                    disabled={exporting || mode !== "custom"}
                  />
                  {SECTION_LABELS[section]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            取消
          </Button>
          <Button type="button" onClick={confirmExport} disabled={exporting || !canExport}>
            {exporting ? "正在导出..." : "开始导出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
