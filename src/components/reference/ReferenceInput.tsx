import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { EditorContextMenu, type EditorContextAction } from "@/components/editor/editor-context-menu"
import { ArrowUp, AtSign, Square } from "lucide-react"
import { isImeComposing } from "@/lib/keyboard-utils"
import { UI_TEST_STORAGE_PREFIX } from "@/lib/ui-test"
import type { ReferenceToken } from "@/lib/reference/types"
import { ReferenceChip } from "./ReferenceChip"

export type InsertReferenceTokens = ((tokens: ReferenceToken[]) => void) | null

const REFERENCE_INPUT_HEIGHT_KEY = `${UI_TEST_STORAGE_PREFIX}reference-input-height`
// 正式版保留模式菜单所需的原高度；测试版按图稿使用独立高度与偏好。
const DEFAULT_REFERENCE_INPUT_HEIGHT = 128
const MIN_REFERENCE_INPUT_HEIGHT = 112
const MAX_REFERENCE_INPUT_HEIGHT = 300

const CLIPBOARD_ACTIONS = ["copy", "cut", "paste"] as const

interface ReferenceInputProps {
  enableClipboardMenu?: boolean
  clipboardScope?: string | null
  value?: string
  tokens: ReferenceToken[]
  placeholder?: string
  disabled?: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string
  isStreaming?: boolean
  leftFooterControls?: ReactNode
  rightControls?: ReactNode
  onChange?: (plainText: string, tokens: ReferenceToken[]) => void
  onTokensChange?: (tokens: ReferenceToken[]) => void
  onSubmit: (plainText: string, tokens: ReferenceToken[]) => void
  onStop?: () => void
  onAtTrigger?: () => void
  insertTokensRef?: MutableRefObject<InsertReferenceTokens>
  renderTextOverlay?: (text: string) => ReactNode
}

function clampInputHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_REFERENCE_INPUT_HEIGHT
  return Math.min(MAX_REFERENCE_INPUT_HEIGHT, Math.max(MIN_REFERENCE_INPUT_HEIGHT, Math.round(height)))
}

function loadSavedInputHeight(): number {
  if (typeof localStorage === "undefined") return DEFAULT_REFERENCE_INPUT_HEIGHT
  const raw = localStorage.getItem(REFERENCE_INPUT_HEIGHT_KEY)
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) ? clampInputHeight(parsed) : DEFAULT_REFERENCE_INPUT_HEIGHT
}

function saveInputHeight(height: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(REFERENCE_INPUT_HEIGHT_KEY, String(clampInputHeight(height)))
}

export function ReferenceInput({
  value,
  enableClipboardMenu = false,
  clipboardScope,
  tokens,
  placeholder = "输入提示词，或 @ 引用内容...",
  disabled = false,
  submitDisabled = false,
  submitDisabledReason,
  isStreaming = false,
  leftFooterControls,
  rightControls,
  onChange,
  onTokensChange,
  onSubmit,
  onStop,
  onAtTrigger,
  insertTokensRef,
  renderTextOverlay,
}: ReferenceInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [clipboardMenu, setClipboardMenu] = useState<{ x: number; y: number; start: number; end: number; value: string; scope?: string | null; input: HTMLTextAreaElement } | null>(null)
  const [clipboardError, setClipboardError] = useState("")
  const isControlled = value !== undefined
  const [draft, setDraft] = useState("")
  const [inputHeight, setInputHeight] = useState(loadSavedInputHeight)
  const text = isControlled ? value : draft
  const inputDisabled = disabled || isStreaming
  const canSubmit = text.trim().length > 0 && !inputDisabled && !submitDisabled

  const notifyChange = useCallback(
    (nextText: string, nextTokens: ReferenceToken[]) => {
      if (!isControlled) setDraft(nextText)
      onChange?.(nextText, nextTokens)
    },
    [isControlled, onChange],
  )

  const clipboardContextRef = useRef({ scope: clipboardScope, tokens, notifyChange })
  clipboardContextRef.current = { scope: clipboardScope, tokens, notifyChange }
  useEffect(() => { setClipboardMenu(null); setClipboardError("") }, [clipboardScope, inputDisabled])

  const closeClipboardMenu = useCallback(() => {
    setClipboardMenu(null)
    textareaRef.current?.focus()
  }, [])

  const openClipboardMenu = (input: HTMLTextAreaElement, x: number, y: number) => {
    if (!enableClipboardMenu || inputDisabled) return
    const rect = input.getBoundingClientRect()
    setClipboardError("")
    setClipboardMenu({ x: x || rect.left + 12, y: y || rect.top + 12, start: input.selectionStart, end: input.selectionEnd, value: input.value, scope: clipboardScope, input })
  }

  const runClipboardAction = async (action: EditorContextAction) => {
    if (!clipboardMenu || !CLIPBOARD_ACTIONS.some(item => item === action)) return
    const snapshot = clipboardMenu
    const selected = snapshot.value.slice(snapshot.start, snapshot.end)
    const label = action === "copy" ? "复制" : action === "cut" ? "剪切" : "粘贴"
    try {
      if (action !== "paste") {
        if (!selected) return
        await navigator.clipboard.writeText(selected)
        if (action === "copy") return
      }
      const inserted = action === "paste" ? await navigator.clipboard.readText() : ""
      const input = textareaRef.current
      if (!input || input !== snapshot.input || !input.isConnected || input.disabled || clipboardContextRef.current.scope !== snapshot.scope) return
      if (input.value !== snapshot.value) {
        setClipboardError("输入内容已变化，本次操作已取消，请重新选择文字。")
        return
      }
      input.focus()
      input.setSelectionRange(snapshot.start, snapshot.end)
      // 原生插入保留桌面WebView撤销栈；不支持时仍通过原onChange链路更新。
      let insertedNatively = false
      try { insertedNatively = typeof document.execCommand === "function" && document.execCommand("insertText", false, inserted) } catch { /* 使用原输入更新链路 */ }
      if (!insertedNatively) {
        input.setRangeText(inserted, snapshot.start, snapshot.end, "end")
        clipboardContextRef.current.notifyChange(input.value, clipboardContextRef.current.tokens)
      }
      input.setSelectionRange(snapshot.start + inserted.length, snapshot.start + inserted.length)
    } catch {
      if (textareaRef.current === snapshot.input) setClipboardError(`${label}失败，请检查剪贴板权限后重试。`)
    }
  }

  const updateTokens = useCallback(
    (nextTokens: ReferenceToken[]) => {
      onTokensChange?.(nextTokens)
      onChange?.(text, nextTokens)
    },
    [onChange, onTokensChange, text],
  )

  useEffect(() => {
    if (!insertTokensRef) return
    insertTokensRef.current = (nextTokens) => {
      if (nextTokens.length === 0) return
      updateTokens([...tokens, ...nextTokens])
      textareaRef.current?.focus()
    }
    return () => {
      insertTokensRef.current = null
    }
  }, [insertTokensRef, tokens, updateTokens])

  const handleTextareaChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      notifyChange(event.target.value, tokens)
    },
    [notifyChange, tokens],
  )

  const handleRemoveToken = useCallback(
    (id: string) => {
      updateTokens(tokens.filter((token) => token.id !== id))
    },
    [tokens, updateTokens],
  )

  const handleSubmit = useCallback(() => {
    const plainText = (textareaRef.current?.value ?? text).trim()
    if (!plainText || inputDisabled || submitDisabled) return
    onSubmit(plainText, tokens)
  }, [inputDisabled, onSubmit, submitDisabled, text, tokens])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) return
      if (enableClipboardMenu && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
        event.preventDefault()
        openClipboardMenu(event.currentTarget, 0, 0)
        return
      }

      if (event.key === "@" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        onAtTrigger?.()
        return
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, onAtTrigger, enableClipboardMenu, inputDisabled, clipboardScope],
  )

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    const startY = event.clientY
    const startHeight = inputHeight
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const previousCursor = document.body.style.cursor
    let savedHeight = startHeight
    document.body.style.cursor = "row-resize"

    try {
      handle.setPointerCapture(pointerId)
    } catch {
      // Older WebViews can miss pointer capture; window listeners still cover dragging.
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextHeight = clampInputHeight(startHeight + (startY - pointerEvent.clientY))
      savedHeight = nextHeight
      setInputHeight(nextHeight)
    }

    const handlePointerUp = () => {
      saveInputHeight(savedHeight)
      try {
        handle.releasePointerCapture(pointerId)
      } catch {
        // Ignore release errors when capture has already been cancelled.
      }
      document.body.style.cursor = previousCursor
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
  }, [inputHeight])

  const resetInputHeight = useCallback(() => {
    setInputHeight(DEFAULT_REFERENCE_INPUT_HEIGHT)
    saveInputHeight(DEFAULT_REFERENCE_INPUT_HEIGHT)
  }, [])

  const renderedTokens = useMemo(
    () => tokens.map((token) => (
      <ReferenceChip
        key={token.id}
        token={token}
        onRemove={handleRemoveToken}
      />
    )),
    [handleRemoveToken, tokens],
  )

  return (
    <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div
        role="separator"
        aria-label="拖动调整输入框高度"
        title="拖动调整输入框高度，双击恢复默认高度"
        className="flex h-2 cursor-row-resize items-center justify-center bg-muted/20 transition-colors hover:bg-muted/50"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={resetInputHeight}
      >
        <span className="h-0.5 w-10 rounded-full bg-border" />
      </div>

      <div className="relative px-3 py-2">
        {tokens.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {renderedTokens}
          </div>
        ) : null}
        {renderTextOverlay ? (
          <div className="ui-test-command-overlay" aria-hidden="true">{renderTextOverlay(text)}</div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={text}
          className="w-full resize-none overflow-y-auto bg-transparent px-0 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: inputHeight, maxHeight: inputHeight }}
          placeholder={placeholder}
          spellCheck={false}
          disabled={inputDisabled}
          rows={1}
          onContextMenu={enableClipboardMenu ? (event) => {
            event.preventDefault()
            event.stopPropagation()
            openClipboardMenu(event.currentTarget, event.clientX, event.clientY)
          } : undefined}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          aria-label="引用输入框"
        />
      </div>

      {clipboardError ? <p role="status" className="px-3 py-1 text-xs text-destructive">{clipboardError}</p> : null}
      {enableClipboardMenu && clipboardMenu && !inputDisabled ? createPortal(
        <EditorContextMenu position={clipboardMenu} actions={CLIPBOARD_ACTIONS} disabled={{ copy: clipboardMenu.start === clipboardMenu.end, cut: clipboardMenu.start === clipboardMenu.end }} onAction={action => void runClipboardAction(action)} onClose={closeClipboardMenu} />,
        document.body,
      ) : null}
      <div
        data-reference-input-footer
        className="flex items-center justify-between gap-2 border-t px-2 py-1.5"
      >
        {leftFooterControls ? (
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            {leftFooterControls}
          </div>
        ) : null}
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onAtTrigger?.()}
          disabled={inputDisabled}
          title="引用内容"
          aria-label="引用内容"
        >
          <AtSign className="h-4 w-4" />
        </button>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          {rightControls}
          {isStreaming ? (
            <button
              type="button"
              className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!onStop}
              onClick={onStop}
              title="停止生成"
              aria-label="停止生成"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              disabled={!canSubmit}
              onClick={handleSubmit}
              title={submitDisabled ? (submitDisabledReason ?? "暂时无法发送") : "发送消息"}
              aria-label="发送消息"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
