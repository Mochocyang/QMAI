import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { X, RefreshCw } from "lucide-react"
import { loadCognitionState, type CognitionState } from "@/lib/novel/character-cognition"
import { useWikiStore } from "@/stores/wiki-store"

interface Props {
  projectPath: string
  onClose: () => void
}

export function CognitionPanel({ projectPath, onClose }: Props) {
  const { t } = useTranslation()
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [state, setState] = useState<CognitionState | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const s = await loadCognitionState(projectPath)
      setState(s)
    } catch {
      setState(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectPath, dataVersion])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{t("novel.cognition.title")}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            title={t("novel.cognition.refresh")}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {loading ? (
          <p className="text-muted-foreground">{t("novel.cognition.loading")}</p>
        ) : !state || (state.characters.length === 0 && state.readerKnows.length === 0) ? (
          <div className="flex flex-col items-center gap-2 pt-8 text-muted-foreground">
            <p>{t("novel.cognition.noData")}</p>
            <p className="text-xs">
              {t("novel.cognition.noDataHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {state.lastUpdatedChapter > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("novel.cognition.lastUpdated", { chapter: state.lastUpdatedChapter })}
              </p>
            )}
            {state.characters.map((char) => (
              <div key={char.character} className="rounded-lg border p-3">
                <p className="font-semibold text-foreground">{char.character}</p>
                {char.knows.length > 0 && (
                  <div className="mt-1.5">
                    <span className="text-xs font-medium text-green-600 dark:text-green-400">
                      {t("novel.cognition.knows")}
                    </span>
                    <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {char.knows.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {char.doesNotKnow.length > 0 && (
                  <div className="mt-1.5">
                    <span className="text-xs font-medium text-red-600 dark:text-red-400">
                      {t("novel.cognition.doesNotKnow")}
                    </span>
                    <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {char.doesNotKnow.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            {state.readerKnows.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <p className="font-semibold text-foreground">{t("novel.cognition.readerKnows")}</p>
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                  {state.readerKnows.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
