import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import { PreviewPanel } from "./preview-panel"
import { PersonaPane } from "@/components/skill-library/persona-pane"

import { clampChatWidth, getInitialChatWidth } from "@/lib/workspace-layout"
import { useWikiStore } from "@/stores/wiki-store"

const ChatPanel = lazy(async () => {
  const mod = await import("@/components/chat/chat-panel")
  return { default: mod.ChatPanel }
})

export function WritingWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null)
  const horizontalResizingRef = useRef(false)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  /** 人物面板开着时，中栏显示人物，不显示文档预览。 */
  const personaPane = useWikiStore((s) => s.personaOutlinePane)
  const setPersonaOutlinePane = useWikiStore((s) => s.setPersonaOutlinePane)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const [chatWidth, setChatWidth] = useState(() => getInitialChatWidth())

  useEffect(() => {
    const savedWidth = Number(localStorage.getItem("lk-chat-right-width"))
    setChatWidth(getInitialChatWidth(savedWidth))
  }, [])

  useEffect(() => {
    localStorage.setItem("lk-chat-right-width", String(chatWidth))
  }, [chatWidth])

  // 窗口缩小时自动 clamp 面板宽度，避免面板超出窗口
  useEffect(() => {
    const handleResize = () => {
      setChatWidth((prev) => {
        const clamped = clampChatWidth(prev)
        return clamped !== prev ? clamped : prev
      })
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  /*
   * 用户去点文件树里的文档时，中栏应切回文档：否则面板一直盖着，
   * 「点了没反应」的观感会从角色节点转移到文件节点上。
   * 用 ref 比较 selectedFile，只在**真的换了文档**时收起，挂载时不误触发。
   */
  const previousFileRef = useRef<string | null>(selectedFile ?? null)
  useEffect(() => {
    const previous = previousFileRef.current
    previousFileRef.current = selectedFile ?? null
    if (previous !== (selectedFile ?? null) && personaPane) setPersonaOutlinePane(null)
  }, [selectedFile, personaPane, setPersonaOutlinePane])

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

  if (chatExpanded) {
    return (
      <div ref={containerRef} className="flex h-full min-h-0 overflow-hidden bg-background">
        <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
          {personaPane ? <PersonaPane /> : <PreviewPanel />}
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
    <div ref={containerRef} className="flex h-full min-h-0 overflow-hidden bg-background">
      <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
        {personaPane ? <PersonaPane /> : <PreviewPanel />}
      </div>
    </div>
  )
}
