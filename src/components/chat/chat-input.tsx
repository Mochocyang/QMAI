import { useRef, useState, useCallback, type ReactNode } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isImeComposing } from "@/lib/keyboard-utils"
import { useChatStore } from "@/stores/chat-store"
import {
  clampResizableInputHeight,
  DEFAULT_RESIZABLE_INPUT_HEIGHT,
  resolveResizableInputMaxHeight,
} from "./chat-input-resize"

interface ChatInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
  leadingControls?: ReactNode
  footerControls?: ReactNode
}

function resolveResizePanelHeight(root: HTMLDivElement | null): number {
  let current = root?.parentElement ?? null
  let panelHeight = 0
  while (current) {
    const height = current.getBoundingClientRect().height
    if (Number.isFinite(height)) panelHeight = Math.max(panelHeight, height)
    current = current.parentElement
  }
  return panelHeight
}

export function ChatInput({ onSend, onStop, isStreaming, placeholder, leadingControls, footerControls }: ChatInputProps) {
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const setConversationInputDraft = useChatStore((state) => state.setConversationInputDraft)
  const conversation = useChatStore((state) =>
    activeConversationId
      ? state.conversations.find((c) => c.id === activeConversationId)
      : undefined
  )
  const value = conversation?.inputDraft ?? ""

  const [inputHeight, setInputHeight] = useState(DEFAULT_RESIZABLE_INPUT_HEIGHT)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const setValue = useCallback(
    (draft: string) => {
      if (activeConversationId) {
        setConversationInputDraft(activeConversationId, draft)
      }
    },
    [activeConversationId, setConversationInputDraft]
  )

  const getResizeBounds = useCallback(() => {
    const panelHeight = resolveResizePanelHeight(rootRef.current)
    return {
      minHeight: DEFAULT_RESIZABLE_INPUT_HEIGHT,
      maxHeight: resolveResizableInputMaxHeight({
        panelHeight,
        viewportHeight: window.innerHeight,
      }),
    }
  }, [])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const ta = e.target
    if (ta.scrollHeight > inputHeight) {
      setInputHeight(clampResizableInputHeight(ta.scrollHeight, getResizeBounds()))
    }
  }, [getResizeBounds, inputHeight, setValue])

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    const resizeHandle = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = inputHeight
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = "ns-resize"
    try {
      resizeHandle.setPointerCapture(pointerId)
    } catch {
      // Older WebViews can miss pointer capture support; window listeners still provide a fallback.
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextHeight = startHeight + (startY - pointerEvent.clientY)
      setInputHeight(clampResizableInputHeight(nextHeight, getResizeBounds()))
    }
    const handlePointerUp = () => {
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
  }, [getResizeBounds, inputHeight])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue("")
  }, [value, isStreaming, onSend, setValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't submit on the Enter that commits an IME candidate —
      // the user is mid-composition (Chinese / Japanese / Korean
      // input method picking an English word or phrase) and would
      // see the message fire before they finished typing.
      if (isImeComposing(e)) return
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div ref={rootRef} className="border-t">
      <div
        role="separator"
        aria-label="拖动调整输入框高度"
        title="拖动调整输入框高度"
        className="flex h-2 cursor-ns-resize items-center justify-center"
        onPointerDown={handleResizePointerDown}
      >
        <span className="h-0.5 w-10 rounded-full bg-border" />
      </div>
      {footerControls ?? leadingControls ? (
        <div className="px-3 pb-2">
          {footerControls ?? leadingControls}
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
        {isStreaming ? (
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
        )}
      </div>
    </div>
  )
}
