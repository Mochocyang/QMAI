/**
 * File Edit Preview - 显示 AI 建议的文件修改 diff
 * 用户可以选择"应用修改"或"忽略"
 */

import { useState } from "react"
import { Check, X, FileText, AlertCircle } from "lucide-react"
import type { FileEditAction } from "@/lib/novel/agent-parser"
import type { FileEditResult } from "@/lib/novel/agent-tools"

interface FileEditPreviewProps {
  edits: FileEditAction[]
  onApply: (edits: FileEditAction[]) => Promise<FileEditResult[]>
  onDismiss: () => void
  applied?: boolean
  results?: FileEditResult[]
}

export function FileEditPreview({ edits, onApply, onDismiss, applied, results }: FileEditPreviewProps) {
  const [applying, setApplying] = useState(false)

  const handleApply = async () => {
    setApplying(true)
    try {
      await onApply(edits)
    } finally {
      setApplying(false)
    }
  }

  if (applied && results) {
    return (
      <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
          <Check className="h-4 w-4" />
          修改已应用
        </div>
        <div className="mt-1 space-y-1">
          {results.map((r, i) => (
            <div key={i} className="text-xs text-emerald-700 dark:text-emerald-300">
              {r.success ? `✓ ${r.filePath}` : `✗ ${r.filePath}: ${r.error}`}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <FileText className="h-4 w-4" />
          AI 建议修改 {edits.length} 处
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleApply()}
            disabled={applying}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
            {applying ? "应用中..." : "应用修改"}
          </button>
          <button
            onClick={onDismiss}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="h-3 w-3" />
            忽略
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {edits.map((edit, i) => (
          <div key={i} className="rounded border bg-background p-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{edit.filePath}</div>
            <div className="space-y-1">
              <div className="rounded bg-red-50 px-2 py-1 text-xs dark:bg-red-950/30">
                <span className="font-mono text-red-700 dark:text-red-300">- {edit.search.split("\n").slice(0, 3).join("\n- ")}{edit.search.split("\n").length > 3 ? "\n  ..." : ""}</span>
              </div>
              <div className="rounded bg-emerald-50 px-2 py-1 text-xs dark:bg-emerald-950/30">
                <span className="font-mono text-emerald-700 dark:text-emerald-300">+ {edit.replace.split("\n").slice(0, 3).join("\n+ ")}{edit.replace.split("\n").length > 3 ? "\n  ..." : ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle className="h-3 w-3" />
        点击「应用修改」后文件将被直接更新
      </div>
    </div>
  )
}
