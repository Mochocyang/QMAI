import { useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { isImeComposing } from "@/lib/keyboard-utils"

export interface TextareaFindBarProps {
  open: boolean
  query: string
  activeMatchIndex: number
  matchCount: number
  onQueryChange: (query: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export function TextareaFindBar({
  open,
  query,
  activeMatchIndex,
  matchCount,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: TextareaFindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open])

  if (!open) return null

  const statusLabel = query
    ? matchCount > 0
      ? `${activeMatchIndex + 1}/${matchCount}`
      : "未找到"
    : ""

  return (
    <div
      data-find-bar="true"
      className="sticky top-2 z-40 ml-auto flex w-fit items-center gap-1 rounded-md border border-border/80 bg-background/95 px-2 py-1 shadow-lg backdrop-blur"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return
          if (e.key === "Enter") {
            e.preventDefault()
            if (e.shiftKey) {
              onPrevious()
            } else {
              onNext()
            }
            return
          }
          if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder="查找"
        aria-label="查找正文"
        className="h-7 w-44 rounded border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <span className="min-w-10 text-center text-xs text-muted-foreground">{statusLabel}</span>
      <button
        type="button"
        aria-label="上一条"
        title="上一条"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPrevious}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="下一条"
        title="下一条"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="关闭查找"
        title="关闭"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
