import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock, Loader2 } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { getTimelineEvents, type TimelineEntry } from "@/lib/novel/timeline"

export function TimelineView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const [events, setEvents] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!project) return
    setLoading(true)
    ;(async () => {
      try {
        const entries = await getTimelineEvents(project.path)
        setEvents(entries)
      } catch {
        setEvents([])
      } finally {
        setLoading(false)
      }
    })()
  }, [project])

  if (!project) return null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("novel.timeline.title")}</h2>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("novel.timeline.loading")}
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("novel.timeline.noEvents")}
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-6 top-0 h-full w-px bg-border" />
            <div className="space-y-0">
              {events.map((item, i) => (
                <div key={i} className="relative flex items-start gap-4 px-4 py-2 pl-10">
                  <div className="absolute left-[18px] top-3 h-3 w-3 rounded-full border-2 border-primary bg-background" />
                  <div className="min-w-[60px] text-xs font-medium text-primary">
                    {t("novel.timeline.chapter", { num: item.chapterNumber })}
                  </div>
                  <div className="text-sm text-foreground">{item.event}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}