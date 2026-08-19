import { useEffect, useRef, useState } from "react"
import ReactDiffViewer, { DiffMethod, type ReactDiffViewerStylesOverride } from "react-diff-viewer-continued"
import { prepareDiffText } from "@/lib/utils/diff"

interface SourceDiffEditorProps {
  originalValue: string
  modifiedValue: string
  onChange: (value: string) => void
  originalLabel?: string
  modifiedLabel?: string
  readOnly?: boolean
}

const DIFF_STYLES: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: "transparent",
    },
    dark: {
      diffViewerBackground: "transparent",
    },
  },
  diffContainer: {
    width: "100%",
    fontSize: "0.75rem",
    lineHeight: 1.625,
    border: "none",
    pre: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "0.75rem",
      lineHeight: 1.625,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    },
  },
  content: {
    width: "100%",
  },
  contentText: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.75rem",
    lineHeight: 1.625,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
}

function useDocumentDarkClass(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  )

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setIsDark(root.classList.contains("dark"))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

export function SourceDiffEditor({
  originalValue,
  modifiedValue,
  onChange,
  originalLabel = "原始内容",
  modifiedLabel = "最新内容",
  readOnly = false,
}: SourceDiffEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const preventSync = useRef(false)
  const isDark = useDocumentDarkClass()
  const hasContent = originalValue.length > 0 || modifiedValue.length > 0
  const originalForDiff = prepareDiffText(originalValue)
  const modifiedForDiff = prepareDiffText(modifiedValue)

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
    <div className="grid h-full min-h-0 grid-cols-1 overflow-y-auto md:grid-cols-2 md:divide-x md:overflow-hidden">
      <div className="flex min-h-48 flex-col overflow-hidden border-b md:min-h-0 md:border-b-0">
        <div className="border-b bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          {originalLabel} / 逐行差异
        </div>
        <div
          aria-label="逐行差异"
          className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-relaxed"
        >
          {hasContent ? (
            <ReactDiffViewer
              oldValue={originalForDiff}
              newValue={modifiedForDiff}
              splitView={false}
              compareMethod={DiffMethod.CHARS}
              showDiffOnly={false}
              hideLineNumbers={false}
              hideSummary
              useDarkTheme={isDark}
              disableWorker
              styles={DIFF_STYLES}
            />
          ) : (
            <div className="px-3 py-2 text-muted-foreground">暂无差异</div>
          )}
        </div>
      </div>
      <div className="flex min-h-48 flex-col overflow-hidden md:min-h-0">
        <div className="border-b bg-muted/40 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400">
          {modifiedLabel}{readOnly ? "" : "（可编辑）"}
        </div>
        <textarea
          ref={textareaRef}
          aria-label="最新源码"
          className="flex-1 resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
          spellCheck={false}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}
