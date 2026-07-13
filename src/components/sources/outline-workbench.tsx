import { PreviewPanel } from "@/components/layout/preview-panel"
import { OutlineChatPanel } from "@/components/sources/outline-chat-panel"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useCallback, useEffect, useRef, useState } from "react"

const OUTLINE_CHAT_WIDTH_KEY = "qmai-outline-chat-right-width"
const OUTLINE_CHAT_MIN_WIDTH = 320

function getInitialOutlineChatWidth(): string | number {
  if (typeof localStorage === "undefined") return "50%"
  const saved = Number(localStorage.getItem(OUTLINE_CHAT_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0 ? saved : "50%"
}

export function OutlineWorkbench() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const project = useWikiStore((s) => s.project)
  const outlineChatOpen = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [outlineChatWidth, setOutlineChatWidth] = useState<string | number>(() => getInitialOutlineChatWidth())

  useEffect(() => {
    if (typeof outlineChatWidth === "number" && typeof localStorage !== "undefined") {
      localStorage.setItem(OUTLINE_CHAT_WIDTH_KEY, String(outlineChatWidth))
    }
  }, [outlineChatWidth])

  // 窗口缩小时自动 clamp 面板宽度，避免面板超出容器 50%
  useEffect(() => {
    const handleResize = () => {
      setOutlineChatWidth((prev) => {
        if (typeof prev !== "number") return prev
        if (!containerRef.current) return prev
        const rect = containerRef.current.getBoundingClientRect()
        const maxWidth = Math.max(OUTLINE_CHAT_MIN_WIDTH, Math.floor(rect.width * 0.5))
        return prev > maxWidth ? maxWidth : prev
      })
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const startHorizontalResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.dataset.panelResizing = "true"

    const handleMouseMove = (nextEvent: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const maxWidth = Math.max(OUTLINE_CHAT_MIN_WIDTH, Math.floor(rect.width * 0.5))
      const nextWidth = Math.max(OUTLINE_CHAT_MIN_WIDTH, Math.min(maxWidth, rect.right - nextEvent.clientX))
      setOutlineChatWidth(nextWidth)
    }

    const handleMouseUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      delete document.body.dataset.panelResizing
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请先打开项目
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 overflow-hidden bg-background"
      data-testid="outline-workbench"
    >
      <div className="h-full min-w-0 flex-1 overflow-hidden" data-testid="outline-editor-pane">
        <PreviewPanel />
      </div>

      {outlineChatOpen ? (
        <>
          <div
            className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
            data-testid="outline-ai-resize-handle"
            onMouseDown={startHorizontalResize}
          />
          <div
            className="h-full min-h-0 shrink-0 overflow-hidden border-l bg-background"
            style={{ width: outlineChatWidth }}
            data-testid="outline-ai-pane"
          >
            <OutlineChatPanel onClose={() => setOutlineChatOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  )
}
