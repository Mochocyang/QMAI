import { Suspense, lazy, useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { OutlineActionToolbar } from "@/components/sources/outline-action-toolbar"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { clampChatHeight, clampChatWidth } from "@/lib/workspace-layout"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"

const OutlineChatPanel = lazy(async () => {
  const mod = await import("@/components/sources/outline-chat-panel")
  return { default: mod.OutlineChatPanel }
})

export function SourcesView() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const chatDockPosition = useWikiStore((s) => s.chatDockPosition)
  const outlineChatOpen = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [chatHeight, setChatHeight] = useState(300)
  const [chatWidth, setChatWidth] = useState(360)
  const [bulkIngestResult, setBulkIngestResult] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const horizontalResizingRef = useRef(false)

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizingRef.current = true
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"

    const handleMouseMove = (nextEvent: MouseEvent) => {
      if (!containerRef.current || !resizingRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newHeight = containerRect.bottom - nextEvent.clientY
      setChatHeight(clampChatHeight(newHeight))
    }

    const handleMouseUp = () => {
      resizingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [])

  const startHorizontalResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    horizontalResizingRef.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const handleMouseMove = (nextEvent: MouseEvent) => {
      if (!containerRef.current || !horizontalResizingRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = containerRect.right - nextEvent.clientX
      setChatWidth(clampChatWidth(newWidth))
    }

    const handleMouseUp = () => {
      horizontalResizingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [])

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t(novelMode ? "novel.sources.title" : "sources.title")}</h2>
        <div className="flex flex-wrap gap-1">
          {novelMode ? (
            <OutlineActionToolbar
              onBulkIngestResult={setBulkIngestResult}
              onToggleOutlineChat={() => setOutlineChatOpen(!outlineChatOpen)}
            />
          ) : null}
        </div>
      </div>
      {bulkIngestResult ? (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {bulkIngestResult}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {outlineChatOpen && novelMode && chatDockPosition === "right" ? (
          <div className="flex h-full min-h-0 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              <PreviewPanel />
            </div>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
              onMouseDown={startHorizontalResize}
            />
            <div className="h-full min-h-0 shrink-0 overflow-hidden border-l bg-background" style={{ width: chatWidth }}>
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
                <OutlineChatPanel onClose={() => setOutlineChatOpen(false)} />
              </Suspense>
            </div>
          </div>
        ) : (
          <PreviewPanel />
        )}
      </div>

      {outlineChatOpen && novelMode && chatDockPosition === "bottom" ? (
        <>
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
            onMouseDown={startResize}
          />
          <div className="shrink-0 overflow-hidden border-t bg-background" style={{ height: chatHeight }}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
              <OutlineChatPanel onClose={() => setOutlineChatOpen(false)} />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  )
}
