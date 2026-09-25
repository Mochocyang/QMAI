import { useEffect } from "react"

export type EditorContextAction = "undo" | "redo" | "copy" | "cut" | "paste" | "selectAll" | "find" | "replace"

const ITEMS: Array<{ action: EditorContextAction; label: string }> = [
  { action: "undo", label: "撤销" },
  { action: "redo", label: "重做" },
  { action: "copy", label: "复制" },
  { action: "cut", label: "剪切" },
  { action: "paste", label: "粘贴" },
  { action: "selectAll", label: "全选" },
  { action: "find", label: "查找" },
  { action: "replace", label: "替换" },
]

export function EditorContextMenu({ position, disabled, onAction, onClose }: {
  position: { x: number; y: number } | null
  disabled?: Partial<Record<EditorContextAction, boolean>>
  onAction: (action: EditorContextAction) => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!position) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-editor-context-menu]")) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey) }
  }, [position, onClose])
  if (!position) return null
  const left = Math.min(position.x, window.innerWidth - 148)
  const top = Math.min(position.y, window.innerHeight - 280)
  return (
    <div data-editor-context-menu="true" role="menu" className="fixed z-50 grid w-32 rounded-md border bg-background p-1 shadow-lg" style={{ left, top }}>
      {ITEMS.map((item) => (
        <button key={item.action} type="button" role="menuitem" disabled={disabled?.[item.action]} className="rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { onAction(item.action); onClose() }}>
          {item.label}
        </button>
      ))}
    </div>
  )
}
