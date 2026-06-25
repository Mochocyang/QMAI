import { useCallback, useEffect, useState } from "react"
import { RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listDirectory } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { useTranslation } from "react-i18next"
import {
  cleanupExpiredTrashItems,
  getTrashDaysRemaining,
  listTrashItems,
  permanentlyDeleteAllTrashItems,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
  readTrashItemContent,
  type TrashItem,
} from "@/lib/trash"

export function TrashPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setSelectedTrashItem = useWikiStore((s) => s.setSelectedTrashItem)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const selectedTrashItem = useWikiStore((s) => s.selectedTrashItem)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)

  const loadTrash = useCallback(async () => {
    if (!project) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const pp = normalizePath(project.path)
      await cleanupExpiredTrashItems(pp)
      setItems(await listTrashItems(pp))
    } catch (err) {
      console.error("[TrashPanel] load failed:", err)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void loadTrash()
  }, [loadTrash])

  const handleItemClick = async (item: TrashItem) => {
    try {
      const content = await readTrashItemContent(item)
      setSelectedTrashItem(item)
      setFileContent(content)
    } catch (err) {
      console.error("[TrashPanel] failed to read trash item content:", err)
    }
  }

  const handleRestore = async (itemId: string) => {
    if (!project || restoringId) return
    setRestoringId(itemId)
    try {
      const pp = normalizePath(project.path)
      const result = await restoreTrashItem(pp, itemId)
      setItems(await listTrashItems(pp))
      try {
        setFileTree(await listDirectory(pp))
      } catch {
        // non-critical
      }
      bumpDataVersion()
      if (result.item.kind !== "history") {
        setActiveView("wiki")
        setSelectedFile(result.restoredPath)
      }
    } catch (err) {
      console.error("[TrashPanel] restore failed:", err)
    } finally {
      setRestoringId(null)
    }
  }

  const handlePermanentDelete = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!project || deletingId || deletingAll) return
    setDeletingId(itemId)
    try {
      const pp = normalizePath(project.path)
      await permanentlyDeleteTrashItem(pp, itemId)
      setItems(await listTrashItems(pp))
      if (selectedTrashItem?.id === itemId) {
        setSelectedTrashItem(null)
      }
    } catch (err) {
      console.error("[TrashPanel] delete failed:", err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteAll = async () => {
    if (!project || deletingAll) return
    setDeletingAll(true)
    try {
      const pp = normalizePath(project.path)
      await permanentlyDeleteAllTrashItems(pp)
      setItems([])
      setSelectedTrashItem(null)
    } catch (err) {
      console.error("[TrashPanel] delete all failed:", err)
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t("trash.title", { defaultValue: "回收站" })}</div>
          <div className="text-xs text-muted-foreground">{t("trash.retention", { defaultValue: "内容默认保留30天" })}</div>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
        {items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deletingAll}
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => void handleDeleteAll()}
          >
            {deletingAll ? "清理中…" : "清空回收站"}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">{t("trash.loading", { defaultValue: "正在加载回收站…" })}</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">{t("trash.empty", { defaultValue: "回收站为空" })}</div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => {
              const remainingDays = getTrashDaysRemaining(item)
              const isRestoring = restoringId === item.id
              const isSelected = selectedTrashItem?.id === item.id
              return (
                <div 
                  key={item.id} 
                  className={`group rounded-md border bg-background px-2 py-2 cursor-pointer transition-colors ${
                    isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  onClick={() => void handleItemClick(item)}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={item.originalPath}>{item.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("trash.remainingDays", { days: remainingDays, defaultValue: "剩余{{days}}天" })} · {item.kind === "chapter" ? t("trash.kindChapter", { defaultValue: "章节" }) : item.kind === "outline" ? t("trash.kindOutline", { defaultValue: "大纲" }) : item.kind === "history" ? t("trash.kindHistory", { defaultValue: "历史记录" }) : t("trash.kindPage", { defaultValue: "页面" })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isRestoring || restoringId !== null}
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      title={t("trash.restoreTitle", { defaultValue: "恢复到原位置；如原位置已有同名文件，会自动改名恢复" })}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRestore(item.id)
                      }}
                    >
                      <RotateCcw className={`h-3.5 w-3.5 ${isRestoring ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={deletingId !== null || deletingAll}
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      title="永久删除"
                      onClick={(e) => void handlePermanentDelete(item.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
