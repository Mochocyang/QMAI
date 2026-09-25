import { useEffect, useRef, useState } from "react"
import type { OutlineSourcePayload } from "@/lib/outline-source-format"
import type { OutlineToolbarAction } from "./outline-toolbar-actions"

type Item = { action: OutlineToolbarAction; label: string; title: string }

const COMMON: Item[] = [
  { action: "bold", label: "B", title: "加粗" },
  { action: "italic", label: "I", title: "斜体" },
  { action: "strike", label: "S", title: "删除线" },
  { action: "underline", label: "U", title: "下划线" },
]
const HEADINGS: Item[] = ["一级", "二级", "三级", "四级", "五级", "六级"].map((title, index) => ({ action: `h${index + 1}` as OutlineToolbarAction, label: `H${index + 1}`, title: `${title}标题` }))

export function OutlineFormatToolbar({ position, onAction }: { position: { top: number; left: number } | null; onAction: (action: OutlineToolbarAction, payload?: OutlineSourcePayload) => void }) {
  const [headingOpen, setHeadingOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!headingOpen) return
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setHeadingOpen(false) }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [headingOpen])
  if (!position) return null
  return (
    <div ref={rootRef} data-outline-format-toolbar="true" className="fixed z-40 flex items-center gap-0.5 rounded-md border bg-background/95 p-1 shadow-lg" style={{ top: position.top, left: position.left, transform: "translate(-50%, -110%)" }} onMouseDown={(event) => event.preventDefault()}>
      {COMMON.map((item) => <button key={item.action} type="button" title={item.title} aria-label={item.title} className={`h-7 min-w-7 rounded px-1 text-xs hover:bg-accent ${item.action === "bold" ? "font-bold" : ""} ${item.action === "italic" ? "italic" : ""} ${item.action === "strike" ? "line-through" : ""} ${item.action === "underline" ? "underline" : ""}`} onClick={() => onAction(item.action)}>{item.label}</button>)}
      <div className="relative">
        <button type="button" aria-label="标题" title="标题" aria-expanded={headingOpen} className="h-7 min-w-7 rounded px-1 text-xs font-semibold hover:bg-accent" onClick={() => setHeadingOpen((open) => !open)}>H</button>
        {headingOpen ? <div role="menu" aria-label="标题样式" className="absolute left-0 top-8 z-50 grid w-28 gap-0.5 rounded-md border bg-background p-1 shadow-lg">{HEADINGS.map((item) => <button key={item.action} type="button" role="menuitem" className="rounded px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => { setHeadingOpen(false); onAction(item.action) }}>{item.label}</button>)}</div> : null}
      </div>
    </div>
  )
}
