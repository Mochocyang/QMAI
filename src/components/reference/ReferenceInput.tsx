import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react"
import { ArrowUp, AtSign } from "lucide-react"
import { isImeComposing } from "@/lib/keyboard-utils"
import type { ReferenceToken } from "@/lib/reference/types"
import { ReferenceChip } from "./ReferenceChip"

export type InsertReferenceTokens = ((tokens: ReferenceToken[]) => void) | null

interface ReferenceInputProps {
  value?: string
  tokens: ReferenceToken[]
  placeholder?: string
  disabled?: boolean
  onChange?: (plainText: string, tokens: ReferenceToken[]) => void
  onTokensChange?: (tokens: ReferenceToken[]) => void
  onSubmit: (plainText: string, tokens: ReferenceToken[]) => void
  onAtTrigger?: () => void
  insertTokensRef?: MutableRefObject<InsertReferenceTokens>
}

function extractPlainText(editor: HTMLDivElement | null): string {
  if (!editor) return ""
  return Array.from(editor.childNodes)
    .filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) return true
      if (node instanceof HTMLElement) {
        return !node.hasAttribute("data-reference-id")
      }
      return false
    })
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\u00a0/g, " ")
}

export function ReferenceInput({
  value,
  tokens,
  placeholder = "输入提示词，或 @ 引用内容...",
  disabled = false,
  onChange,
  onTokensChange,
  onSubmit,
  onAtTrigger,
  insertTokensRef,
}: ReferenceInputProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isControlled = value !== undefined
  const [draft, setDraft] = useState("")
  const text = isControlled ? value : draft
  const canSubmit = text.trim().length > 0 && !disabled

  const notifyChange = useCallback(
    (nextText: string, nextTokens: ReferenceToken[]) => {
      if (!isControlled) setDraft(nextText)
      onChange?.(nextText, nextTokens)
    },
    [isControlled, onChange],
  )

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
      editorRef.current?.focus()
    }
    return () => {
      insertTokensRef.current = null
    }
  }, [insertTokensRef, tokens, updateTokens])

  const handleInput = useCallback(() => {
    notifyChange(extractPlainText(editorRef.current), tokens)
  }, [notifyChange, tokens])

  const handleRemoveToken = useCallback(
    (id: string) => {
      updateTokens(tokens.filter((token) => token.id !== id))
    },
    [tokens, updateTokens],
  )

  const handleSubmit = useCallback(() => {
    const plainText = text.trim()
    if (!plainText || disabled) return
    onSubmit(plainText, tokens)
  }, [disabled, onSubmit, text, tokens])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isImeComposing(event)) return

      if (event.key === "@" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        onAtTrigger?.()
        return
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, onAtTrigger],
  )

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
    <div className="rounded-lg border bg-background shadow-sm focus-within:ring-2 focus-within:ring-blue-400">
      <div className="relative px-3 py-2">
        <div
          ref={editorRef}
          className="min-h-[48px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words text-sm outline-none disabled:cursor-not-allowed"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          aria-label="引用输入框"
        >
          {renderedTokens}
          {text}
        </div>
        {!text.trim() && tokens.length === 0 && (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-2 py-1.5">
        <button
          type="button"
          className="rounded-md p-1.5 text-gray-500 hover:bg-accent hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onAtTrigger?.()}
          disabled={disabled}
          title="引用内容"
          aria-label="引用内容"
        >
          <AtSign className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-md bg-blue-500 p-1.5 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          disabled={!canSubmit}
          onClick={handleSubmit}
          title="发送消息"
          aria-label="发送消息"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
