import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import { PreviewPanel } from "./preview-panel"
import { clampChatHeight, clampChatWidth } from "@/lib/workspace-layout"
import { useWikiStore } from "@/stores/wiki-store"
import { shouldShowRightDockChat, shouldShowWritingChat } from "./chat-layout"

const ChatPanel = lazy(async () => {
  const mod = await import("@/components/chat/chat-panel")
  return { default: mod.ChatPanel }
})

export function WritingWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const horizontalResizingRef = useRef(false)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const chatDockPosition = useWikiStore((s) => s.chatDockPosition)
  const [chatHeight, setChatHeight] = useState(260)
  const [chatWidth, setChatWidth] = useState(360)

  useEffect(() => {
    const saved = Number(localStorage.getItem("lk-chat-height") ?? "260")
    if (Number.isFinite(saved) && saved > 0) {
      setChatHeight(clampChatHeight(saved))
    }
    const savedWidth = Number(localStorage.getItem("lk-chat-right-width") ?? "360")
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      setChatWidth(clampChatWidth(savedWidth))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("lk-chat-height", String(chatHeight))
  }, [chatHeight])

  useEffect(() => {
    localStorage.setItem("lk-chat-right-width", String(chatWidth))
  }, [chatWidth])

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizingRef.current = true
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"
    document.body.dataset.panelResizing = "true"

    const handleMouseMove = (nextEvent: MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const nextHeight = rect.bottom - nextEvent.clientY
      setChatHeight(clampChatHeight(nextHeight))
    }

    const handleMouseUp = () => {
      resizingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      delete document.body.dataset.panelResizing
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
    document.body.dataset.panelResizing = "true"

    const handleMouseMove = (nextEvent: MouseEvent) => {
      if (!horizontalResizingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const nextWidth = rect.right - nextEvent.clientX
      setChatWidth(clampChatWidth(nextWidth))
    }

    const handleMouseUp = () => {
      horizontalResizingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      delete document.body.dataset.panelResizing
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [])

  if (shouldShowRightDockChat(chatExpanded, chatDockPosition)) {
    return (
      <div ref={containerRef} className="flex h-full min-h-0 overflow-hidden bg-background">
        <div className="min-w-0 flex-1 overflow-hidden">
          <PreviewPanel />
        </div>
        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
          onMouseDown={startHorizontalResize}
        />
        <div className="h-full min-h-0 shrink-0 overflow-hidden border-l bg-background" style={{ width: chatWidth }}>
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
            <ChatPanel />
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        <PreviewPanel />
      </div>
      {shouldShowWritingChat(chatExpanded, chatDockPosition) && (
        <>
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
            onMouseDown={startResize}
          />
          <div className="shrink-0 overflow-hidden border-t bg-background" style={{ height: chatHeight }}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
              <ChatPanel />
            </Suspense>
          </div>
        </>
      )}
    </div>
  )
}
