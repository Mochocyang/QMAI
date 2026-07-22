import { useEffect, useRef } from "react"

interface MonacoDiffEditorProps {
  originalValue: string
  modifiedValue: string
  onChange: (value: string) => void
  language?: string
}

export function MonacoDiffEditor({
  originalValue,
  modifiedValue,
  onChange,
}: MonacoDiffEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const preventSync = useRef(false)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (textarea.value !== modifiedValue) {
      preventSync.current = true
      textarea.value = modifiedValue
      preventSync.current = false
    }
  }, [modifiedValue])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const handler = () => {
      if (preventSync.current) return
      onChange(textarea.value)
    }
    textarea.addEventListener("input", handler)
    return () => textarea.removeEventListener("input", handler)
  }, [onChange])

  return (
    <div className="grid h-full grid-cols-2 divide-x overflow-hidden">
      <div className="flex flex-col overflow-hidden">
        <div className="border-b bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          原始内容
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-muted-foreground">
          {originalValue || "（该文件尚不存在）"}
        </pre>
      </div>
      <div className="flex flex-col overflow-hidden">
        <div className="border-b bg-muted/40 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400">
          最新内容
        </div>
        <textarea
          ref={textareaRef}
          aria-label="最新源码"
          className="flex-1 resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
