import { useEffect, useRef, lazy, Suspense } from "react"
import "./monaco-environment"

interface MonacoDiffEditorProps {
  originalValue: string
  modifiedValue: string
  onChange: (value: string) => void
  language?: string
}

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.DiffEditor })),
)

export function MonacoDiffEditor({
  originalValue,
  modifiedValue,
  onChange,
  language = "markdown",
}: MonacoDiffEditorProps) {
  const editorRef = useRef<Parameters<NonNullable<import("@monaco-editor/react").DiffEditorProps["onMount"]>>[0] | null>(null)
  const preventSync = useRef(false)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const modified = editor.getModifiedEditor()
    const disposable = modified.onDidChangeModelContent(() => {
      if (preventSync.current) return
      onChange(modified.getValue())
    })
    return () => disposable.dispose()
  }, [onChange])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const currentModified = model.modified.getValue()
    if (currentModified !== modifiedValue) {
      preventSync.current = true
      model.modified.setValue(modifiedValue)
      preventSync.current = false
    }
  }, [modifiedValue])

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          正在加载编辑器…
        </div>
      }
    >
      <MonacoEditor
        height="100%"
        language={language}
        original={originalValue}
        modified={modifiedValue}
        onMount={(editor) => {
          editorRef.current = editor
          editor.getModifiedEditor().updateOptions({ readOnly: false })
        }}
        options={{
          readOnly: false,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          lineNumbers: "on",
          wordWrap: "on",
          automaticLayout: true,
          originalEditable: false,
          diffCodeLens: false,
          folding: false,
          renderOverviewRuler: true,
        }}
      />
    </Suspense>
  )
}
