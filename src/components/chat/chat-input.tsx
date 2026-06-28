import { useRef, useState, useCallback, useEffect, type ReactNode } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isImeComposing } from "@/lib/keyboard-utils"
import { useChatStore } from "@/stores/chat-store"
import {
  clampResizableInputHeight,
  DEFAULT_RESIZABLE_INPUT_HEIGHT,
  getResizeBoundsForElement,
  createResizeContext,
  resolveMaxHeightFromContext,
  isHeightAtMax,
  isHeightAtMin,
  type ResizeContext,
  type ResizableInputBounds,
} from "./chat-input-resize"

const CHAT_INPUT_HEIGHT_KEY = "lk-chat-input-height"

function loadSavedInputHeight(): number | null {
  if (typeof localStorage === "undefined") return null
  const raw = localStorage.getItem(CHAT_INPUT_HEIGHT_KEY)
  if (!raw) return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= DEFAULT_RESIZABLE_INPUT_HEIGHT ? Math.round(v) : null
}

function saveInputHeight(h: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(CHAT_INPUT_HEIGHT_KEY, String(Math.round(h)))
}

interface ChatInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
  leadingControls?: ReactNode
  footerControls?: ReactNode
  inlineSendButton?: boolean
  value?: string
  onChange?: (value: string) => void
}

export function ChatInput({ onSend, onStop, isStreaming, placeholder, leadingControls, footerControls, inlineSendButton = true, value: controlledValue, onChange }: ChatInputProps) {
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const setConversationInputDraft = useChatStore((state) => state.setConversationInputDraft)
  const conversation = useChatStore((state) =>
    activeConversationId
      ? state.conversations.find((c) => c.id === activeConversationId)
      : undefined
  )
  const isControlled = controlledValue !== undefined
  const [fallbackDraft, setFallbackDraft] = useState("")
  const storeValue = conversation?.inputDraft ?? ""
  const value = isControlled ? controlledValue : activeConversationId ? storeValue : fallbackDraft

  const savedHeight = useRef<number | null>(loadSavedInputHeight())
  const [inputHeight, setInputHeight] = useState<number>(() => savedHeight.current ?? DEFAULT_RESIZABLE_INPUT_HEIGHT)
  const [userSetMinHeight, setUserSetMinHeight] = useState<number | null>(savedHeight.current)
  const userSetMinHeightRef = useRef<number | null>(savedHeight.current)
  const [isDragging, setIsDragging] = useState(false)
  const [isAtLimitTop, setIsAtLimitTop] = useState(false)
  const [isAtLimitBottom, setIsAtLimitBottom] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const resizeContextRef = useRef<ResizeContext | null>(null)
  const dragHeightRef = useRef<number>(inputHeight)
  const inputHeightRef = useRef<number>(inputHeight)

  useEffect(() => {
    inputHeightRef.current = inputHeight
  }, [inputHeight])

  const updateLimitState = useCallback((height: number) => {
    const bounds = getResizeBoundsForElement(rootRef.current)
    setIsAtLimitTop(isHeightAtMax(height, bounds))
    setIsAtLimitBottom(isHeightAtMin(height, bounds))
  }, [])

  useEffect(() => {
    updateLimitState(inputHeight)
  }, [inputHeight, updateLimitState])

  useEffect(() => {
    userSetMinHeightRef.current = userSetMinHeight
  }, [userSetMinHeight])

  useEffect(() => {
    const handleResize = () => {
      const userMin = userSetMinHeightRef.current
      const ta = textareaRef.current

      if (userMin != null) {
        // 用户已手动设置高度：窗口 resize 时只做上下边界检查，保持高度尽量不变
        const bounds = getResizeBoundsForElement(rootRef.current)
        const current = inputHeightRef.current
        const next = clampResizableInputHeight(current, bounds)
        if (next !== current) {
          if (ta) {
            ta.style.height = `${next}px`
          }
          setInputHeight(next)
          setUserSetMinHeight(next)
        }
        setIsAtLimitTop(isHeightAtMax(next, bounds))
        setIsAtLimitBottom(isHeightAtMin(next, bounds))
        return
      }

      if (ta) {
        const bounds = getResizeBoundsForElement(rootRef.current)
        ta.style.height = "auto"
        const contentHeight = ta.scrollHeight
        const current = inputHeightRef.current
        const next = clampResizableInputHeight(Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, contentHeight, current), bounds)
        ta.style.height = `${next}px`
        setInputHeight(next)
      } else {
        const bounds = getResizeBoundsForElement(rootRef.current)
        setInputHeight((prev) => clampResizableInputHeight(prev, bounds))
      }
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const autoFitTextarea = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const userMin = userSetMinHeightRef.current

    // 用户已手动设置高度：保持固定高度，不随内容自适应
    // 内容超出时 textarea 内部自动滚动，高度始终不变
    if (userMin != null) {
      return
    }

    const bounds = getResizeBoundsForElement(rootRef.current)
    ta.style.height = "auto"
    const contentHeight = ta.scrollHeight
    const next = clampResizableInputHeight(Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, contentHeight), bounds)
    ta.style.height = `${next}px`
    setInputHeight(next)
    setIsAtLimitTop(isHeightAtMax(next, bounds))
    setIsAtLimitBottom(isHeightAtMin(next, bounds))
  }, [])

  useEffect(() => {
    autoFitTextarea()
  }, [value, autoFitTextarea])

  const setValue = useCallback(
    (draft: string) => {
      if (isControlled) {
        onChange?.(draft)
      } else if (activeConversationId) {
        setConversationInputDraft(activeConversationId, draft)
      } else {
        setFallbackDraft(draft)
      }
    },
    [isControlled, onChange, activeConversationId, setConversationInputDraft]
  )

  const getStaticBounds = useCallback(() => {
    return getResizeBoundsForElement(rootRef.current)
  }, [])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    requestAnimationFrame(() => {
      autoFitTextarea()
    })
  }, [setValue, autoFitTextarea])

  const resetHeight = useCallback(() => {
    setUserSetMinHeight(null)
    const ta = textareaRef.current
    const bounds = getResizeBoundsForElement(rootRef.current)
    if (ta) {
      ta.style.height = "auto"
      const next = clampResizableInputHeight(Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, ta.scrollHeight), bounds)
      ta.style.height = `${next}px`
      setInputHeight(next)
    } else {
      setInputHeight(DEFAULT_RESIZABLE_INPUT_HEIGHT)
    }
  }, [])

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    const resizeHandle = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = inputHeight
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = "ns-resize"
    setIsDragging(true)

    const ctx = createResizeContext(rootRef.current, startHeight)
    resizeContextRef.current = ctx
    dragHeightRef.current = startHeight

    try {
      resizeHandle.setPointerCapture(pointerId)
    } catch {
      // Older WebViews can miss pointer capture support; window listeners still provide a fallback.
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextHeight = startHeight + (startY - pointerEvent.clientY)
      let maxHeight: number
      let bounds: ResizableInputBounds
      if (resizeContextRef.current) {
        maxHeight = resolveMaxHeightFromContext(resizeContextRef.current, nextHeight)
        bounds = { minHeight: DEFAULT_RESIZABLE_INPUT_HEIGHT, maxHeight }
      } else {
        bounds = getStaticBounds()
      }
      const clamped = clampResizableInputHeight(nextHeight, bounds)
      dragHeightRef.current = clamped
      const ta = textareaRef.current
      if (ta) {
        ta.style.height = `${clamped}px`
      }
      setInputHeight(clamped)
      setIsAtLimitTop(isHeightAtMax(clamped, bounds))
      setIsAtLimitBottom(isHeightAtMin(clamped, bounds))
    }
    const handlePointerUp = () => {
      const finalHeight = dragHeightRef.current
      setUserSetMinHeight(finalHeight)
      saveInputHeight(finalHeight)
      resizeContextRef.current = null
      setIsDragging(false)
      try {
        resizeHandle.releasePointerCapture(pointerId)
      } catch {
        // Ignore release errors when the pointer was already cancelled by the WebView.
      }
      document.body.style.cursor = previousCursor
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
  }, [inputHeight, getStaticBounds])

  const handleDoubleClick = useCallback(() => {
    resetHeight()
  }, [resetHeight])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue("")
    setUserSetMinHeight(null)
    setInputHeight(DEFAULT_RESIZABLE_INPUT_HEIGHT)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = `${DEFAULT_RESIZABLE_INPUT_HEIGHT}px`
    }
  }, [value, isStreaming, onSend, setValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(e)) return
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleBarColor = isDragging
    ? isAtLimitTop
      ? "bg-destructive/60"
      : "bg-primary/60"
    : isAtLimitTop
      ? "bg-destructive/30"
      : isAtLimitBottom
        ? "bg-border"
        : "bg-primary/30"

  const resizeTitle = isAtLimitBottom
    ? "向上拖动拉高输入框，双击重置高度"
    : isAtLimitTop
      ? "已达最大高度，向下拖动缩小，双击重置"
      : "拖动调整输入框高度，双击重置"

  return (
    <div ref={rootRef} className="border-t">
      <div
        role="separator"
        aria-label="拖动调整输入框高度"
        title={resizeTitle}
        className="flex h-2 cursor-ns-resize items-center justify-center transition-colors"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        <span className={`h-0.5 w-10 rounded-full transition-colors ${handleBarColor}`} />
      </div>
      {leadingControls ? (
        <div className="px-3 pb-2">
          {leadingControls}
        </div>
      ) : null}
      <div className="flex items-end gap-2 px-3 pb-3">
        <textarea
          ref={textareaRef}
          value={value}
          dir="auto"
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "输入消息，Enter 发送，Shift+Enter 换行"}
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: inputHeight, maxHeight: inputHeight, overflowY: "auto" }}
        />
        {inlineSendButton && (isStreaming ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={onStop}
            className="shrink-0"
            title="停止生成"
            aria-label="停止生成"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!value.trim()}
            className="shrink-0"
            title="发送消息"
            aria-label="发送消息"
          >
            <Send className="h-4 w-4" />
          </Button>
        ))}
      </div>
      {footerControls ? (
        <div className="px-3 pb-2">
          {footerControls}
        </div>
      ) : null}
    </div>
  )
}
