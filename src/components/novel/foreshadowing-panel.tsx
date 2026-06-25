import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Lightbulb, Loader2 } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { loadForeshadowingTracker, type ForeshadowingStore } from "@/lib/novel/foreshadowing-tracker"

const STATUS_LABELS: Record<string, string> = {
  planted: "已埋设",
  advanced: "推进中",
  resolved: "已回收",
}

const STATUS_COLORS: Record<string, string> = {
  planted: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  advanced: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  resolved: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
}

export function ForeshadowingPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const [store, setStore] = useState<ForeshadowingStore | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!project) return
    setLoading(true)
    loadForeshadowingTracker(project.path)
      .then(setStore)
      .catch(() => setStore(null))
      .finally(() => setLoading(false))
  }, [project])

  const unresolved = store?.items.filter(f => f.status !== "resolved") ?? []
  const resolved = store?.items.filter(f => f.status === "resolved") ?? []

  if (!project) return null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold">{t("novel.foreshadowing.title")}</h2>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("novel.foreshadowing.loading")}
          </div>
        ) : !store || store.items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("novel.foreshadowing.noData")}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {t("novel.foreshadowing.summary", {
                total: store.items.length,
                unresolved: unresolved.length,
                resolved: resolved.length,
              })}
            </div>
            {unresolved.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {t("novel.foreshadowing.unresolved")} ({unresolved.length})
                </h3>
                <div className="space-y-2">
                  {unresolved.map((f) => (
                    <div key={f.id} className="rounded-md border p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{f.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[f.status]}`}>
                          {STATUS_LABELS[f.status]}
                        </span>
                      </div>
                      {f.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("novel.foreshadowing.plantedAt", { chapter: f.plantedChapter })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {resolved.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold text-green-600 dark:text-green-400">
                  {t("novel.foreshadowing.resolved")} ({resolved.length})
                </h3>
                <div className="space-y-2 opacity-60">
                  {resolved.map((f) => (
                    <div key={f.id} className="rounded-md border p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium line-through">{f.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[f.status]}`}>
                          {STATUS_LABELS[f.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("novel.foreshadowing.resolvedAt", { chapter: f.resolvedChapter ?? "?" })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}