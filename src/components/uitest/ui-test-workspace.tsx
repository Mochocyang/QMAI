import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { FileText, Sparkles } from "lucide-react"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { getUiTestPanelLayout, resizeUiTestAiByKey, UI_TEST_AI_DEFAULT_WIDTH, UI_TEST_AI_MAX_WIDTH, UI_TEST_AI_MIN_WIDTH } from "@/lib/ui-test-layout"
import { useUiTestWidth } from "./use-ui-test-width"

const ChatPanel = lazy(async () => ({ default: (await import("@/components/chat/chat-panel")).ChatPanel }))
const OutlineChatPanel = lazy(async () => ({ default: (await import("@/components/sources/outline-chat-panel")).OutlineChatPanel }))

interface UiTestWorkspaceProps {
  mode: "chapter" | "outline"
  requestedWidth: number
  viewportWidth: number
  onWidthChange: (width: number) => void
}

export function UiTestWorkspace({ mode, requestedWidth, viewportWidth, onWidthChange }: UiTestWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const previousSelection = useRef("")
  const width = useUiTestWidth(containerRef)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const outlineExpanded = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineExpanded = useOutlineGenerationStore((s) => s.setPanelOpen)
  const assistantOpen = mode === "outline" ? outlineExpanded : chatExpanded
  const [mobilePage, setMobilePage] = useState<"editor" | "ai">("editor")
  const layout = getUiTestPanelLayout(width, requestedWidth, viewportWidth)

  useEffect(() => {
    if (!assistantOpen) setMobilePage("editor")
    else if (layout.mode === "tabs") setMobilePage("ai")
  }, [assistantOpen, mode])

  useEffect(() => () => {
    if (!dragging.current) return
    document.body.style.userSelect = previousSelection.current
    document.body.style.cursor = ""
    delete document.body.dataset.panelResizing
  }, [])

  const endResize = () => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.userSelect = previousSelection.current
    document.body.style.cursor = ""
    delete document.body.dataset.panelResizing
  }

  return (
    <div className="ui-test-writing-workspace" data-mode={mode}>
      {assistantOpen && layout.mode === "tabs" && (
        <div className="ui-test-workspace-tabs" role="tablist" aria-label="写作工作区">
          <button type="button" role="tab" aria-selected={mobilePage === "editor"} aria-controls="ui-test-editor-pane" onClick={() => setMobilePage("editor")}><FileText />正文</button>
          <button type="button" role="tab" aria-selected={mobilePage === "ai"} aria-controls="ui-test-ai-pane" onClick={() => setMobilePage("ai")}><Sparkles />AI 对话</button>
        </div>
      )}
      <div className="ui-test-writing-panes" ref={containerRef} data-layout={layout.mode}>
        <div id="ui-test-editor-pane" className="ui-test-editor-pane" hidden={assistantOpen && layout.mode === "tabs" && mobilePage === "ai"}>
          <PreviewPanel />
        </div>
        {assistantOpen && (
          <>
            {layout.mode === "split" && <div
              className="ui-test-resize-handle"
              role="separator"
              aria-label="调整 AI 对话宽度"
              aria-orientation="vertical"
              aria-valuemin={UI_TEST_AI_MIN_WIDTH}
              aria-valuemax={layout.maxAiWidth}
              aria-valuenow={layout.aiWidth}
              tabIndex={0}
              onDoubleClick={() => onWidthChange(UI_TEST_AI_DEFAULT_WIDTH)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
                event.preventDefault()
                onWidthChange(resizeUiTestAiByKey(layout.aiWidth, event.key))
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                dragging.current = true
                previousSelection.current = document.body.style.userSelect
                document.body.style.userSelect = "none"
                document.body.style.cursor = "col-resize"
                document.body.dataset.panelResizing = "true"
              }}
              onPointerMove={(event) => {
                if (!dragging.current || !containerRef.current) return
                const right = containerRef.current.getBoundingClientRect().right
                onWidthChange(Math.max(UI_TEST_AI_MIN_WIDTH, Math.min(UI_TEST_AI_MAX_WIDTH, right - event.clientX)))
              }}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onLostPointerCapture={endResize}
            ><span /></div>}
            <aside id="ui-test-ai-pane" className="ui-test-ai-pane" aria-label={mode === "outline" ? "大纲助手" : "写作助手"}
              hidden={layout.mode === "tabs" && mobilePage !== "ai"}
              style={{ width: layout.mode === "tabs" ? "100%" : layout.aiWidth }}>
              <Suspense fallback={<div className="ui-test-loading" role="status">正在打开助手…</div>}>
                {mode === "outline" ? <OutlineChatPanel onClose={() => setOutlineExpanded(false)} /> : <ChatPanel />}
              </Suspense>
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
