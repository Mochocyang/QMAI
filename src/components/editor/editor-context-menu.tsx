import { useEffect, useRef } from "react"

export type EditorContextAction = "continue" | "undo" | "redo" | "copy" | "cut" | "paste" | "selectAll" | "find" | "replace"

/**
 * 「动作 → 文案」的映射。
 *
 * 刻意**不**做成「数组项里带 label」的一张表：那张表同时会被当成默认菜单项用，
 * 而「续写」不能出现在默认项里 —— 大纲的 Milkdown 编辑器与章节正文共用这个
 * 组件，它是富文本、没有「正文偏移」这个锚点概念，菜单里长出「续写」是错的。
 * 拆成两张表后，「续写」只有调用方显式列进 `actions` 才会出现。
 */
const ITEM_LABELS: Record<EditorContextAction, string> = {
  continue: "续写",
  undo: "撤销",
  redo: "重做",
  copy: "复制",
  cut: "剪切",
  paste: "粘贴",
  selectAll: "全选",
  find: "查找",
  replace: "替换",
}

/** 默认菜单项：**不含**「续写」。不传 `actions` 的调用方拿到的就是这一份。 */
const DEFAULT_ITEMS: readonly EditorContextAction[] = [
  "undo",
  "redo",
  "copy",
  "cut",
  "paste",
  "selectAll",
  "find",
  "replace",
]

export function EditorContextMenu({ position, disabled, onAction, onClose, actions }: {
  position: { x: number; y: number } | null
  actions?: readonly EditorContextAction[]
  disabled?: Partial<Record<EditorContextAction, boolean>>
  onAction: (action: EditorContextAction) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const items = (actions ?? DEFAULT_ITEMS).map((action) => ({ action, label: ITEM_LABELS[action] }))
  useEffect(() => {
    if (!position) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-editor-context-menu]")) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return }
      if (!actions || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
      if (!buttons.length) return
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
      buttons[next].focus()
    }
    if (actions) menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey) }
  }, [position, onClose, actions])
  if (!position) return null
  const left = Math.max(8, Math.min(position.x, window.innerWidth - 148))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - (actions ? items.length * 32 + 16 : 280)))
  return (
    <div ref={menuRef} data-editor-context-menu="true" role="menu" className="fixed z-50 grid w-32 rounded-md border bg-background p-1 shadow-lg" style={{ left, top }}>
      {items.map((item) => (
        <button key={item.action} type="button" role="menuitem" disabled={disabled?.[item.action]} className="rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" onMouseDown={actions ? event => event.preventDefault() : undefined} onClick={() => { onAction(item.action); onClose() }}>
          {item.label}
        </button>
      ))}
    </div>
  )
}
