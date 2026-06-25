import { useEffect, useMemo, useState } from "react"
import { SearchView } from "@/components/search/search-view"
import { useWikiStore } from "@/stores/wiki-store"
import { SEARCH_CONTEXT_EVENT, SEARCH_OPEN_FILE_EVENT, type SearchOpenFilePayload, type SearchWindowContext } from "@/lib/search-window"
import { isTauri } from "@/lib/platform"

interface SearchWindowViewProps {
  initialContext: SearchWindowContext | null
}

export function SearchWindowView({ initialContext }: SearchWindowViewProps) {
  const setProject = useWikiStore((s) => s.setProject)
  const setNovelMode = useWikiStore((s) => s.setNovelMode)
  const [context, setContext] = useState<SearchWindowContext | null>(initialContext)

  useEffect(() => {
    if (!context) return
    setProject({
      id: context.projectId,
      name: context.projectName,
      path: context.projectPath,
    })
    setNovelMode(context.novelMode)
  }, [context, setNovelMode, setProject])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | null = null

    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        unlisten = await getCurrentWebviewWindow().listen<SearchWindowContext>(
          SEARCH_CONTEXT_EVENT,
          (event) => {
            if (!cancelled) {
              setContext(event.payload)
            }
          },
        )
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const handleOpenFile = useMemo(() => {
    return async (payload: SearchOpenFilePayload) => {
      if (!isTauri()) return
      const [{ getCurrentWebview }, { getCurrentWebviewWindow }] = await Promise.all([
        import("@tauri-apps/api/webview"),
        import("@tauri-apps/api/webviewWindow"),
      ])
      await getCurrentWebview().emitTo("main", SEARCH_OPEN_FILE_EVENT, payload)
      await getCurrentWebviewWindow().close()
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium">独立搜索</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {context ? `当前项目：${context.projectName}` : "正在加载搜索上下文..."}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {context ? <SearchView onOpenFile={handleOpenFile} /> : null}
      </div>
    </div>
  )
}
