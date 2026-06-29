import { useEffect, useState } from "react"
import { FolderOpen, Plus, Clock, X, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { importBackup } from "@/lib/backup/import"
import logoImg from "@/assets/QM-LOGO.png"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
}

export function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onSelectProject,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    const updated = await getRecentProjects()
    setRecentProjects(updated)
  }

  async function handleRestoreBackup() {
    if (isRestoring) return
    setIsRestoring(true)
    try {
      const result = await importBackup("full", undefined, (progress) => {
        console.log("[数据恢复]", progress.stage, progress.message)
      })
      if (result.success) {
        // 恢复成功后刷新最近项目列表
        const updated = await getRecentProjects()
        setRecentProjects(updated)
        alert(`恢复成功！共恢复 ${result.projects.filter(p => p.success).length} 个项目。\n请在列表中选择项目打开。`)
      } else {
        alert(`恢复失败：${result.error || "未知错误"}`)
      }
    } catch (e) {
      alert(`恢复失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <img
            src={logoImg}
            alt={t(novelMode ? "novel.app.title" : "app.title")}
            className="h-12 w-12 rounded-[22%]"
          />
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {t(novelMode ? "novel.app.title" : "app.title")}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {t(novelMode ? "novel.app.subtitle" : "app.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={onCreateProject}>
            <Plus className="mr-2 h-4 w-4" />
            {t("welcome.newProject")}
          </Button>
          <Button variant="outline" onClick={onOpenProject}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("welcome.openProject")}
          </Button>
          <Button variant="secondary" onClick={handleRestoreBackup} disabled={isRestoring}>
            <Database className="mr-2 h-4 w-4" />
            {isRestoring ? "恢复中..." : "恢复数据"}
          </Button>
        </div>

        {recentProjects.length > 0 && (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("welcome.recentProjects")}
            </div>
            <div className="rounded-lg border">
              {recentProjects.map((proj) => (
                <button
                  key={proj.path}
                  onClick={() => onSelectProject(proj)}
                  className="group flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{proj.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {proj.path}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemoveRecent(e, proj.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRemoveRecent(e as unknown as React.MouseEvent, proj.path)
                    }}
                    className="ml-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
