import { useEffect, useState } from "react"
import { HelpCircle, X, MessageCircle } from "lucide-react"
import type { NovelTaskIntent } from "@/lib/novel/task-router"

export interface ClarificationCandidate {
  intent: NovelTaskIntent
  label: string
  confidence?: number
}

interface IntentClarificationDialogProps {
  open: boolean
  userMessage: string
  candidates: ClarificationCandidate[]
  onConfirm: (intent: NovelTaskIntent | null, customText?: string) => void
  onCancel: () => void
}

export function IntentClarificationDialog({
  open,
  userMessage,
  candidates,
  onConfirm,
  onCancel,
}: IntentClarificationDialogProps) {
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")

  useEffect(() => {
    if (open) {
      setCustomMode(false)
      setCustomText("")
    }
  }, [open])

  if (!open) return null

  const handleSelect = (intent: NovelTaskIntent) => {
    onConfirm(intent)
  }

  const handleCustomSubmit = () => {
    if (customText.trim()) {
      onConfirm(null, customText.trim())
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-lg border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-amber-500" />
            <div>
              <h3 className="font-semibold">请确认你的意图</h3>
              <p className="text-xs text-muted-foreground">
                我不太确定你想要做什么，请选择一个选项
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 hover:bg-accent"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b px-4 py-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              <span>你的输入</span>
            </div>
            <p className="line-clamp-3">{userMessage || "（空）"}</p>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto p-3">
          {!customMode ? (
            <div className="space-y-2">
              {candidates.map((candidate, index) => (
                <button
                  key={index}
                  onClick={() => handleSelect(candidate.intent)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  <span className="font-medium">{candidate.label}</span>
                  {candidate.confidence !== undefined && candidate.confidence > 0 && (
                    <span className="text-xs text-muted-foreground">
                      置信度 {Math.round(candidate.confidence * 100)}%
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={() => setCustomMode(true)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                我想描述得更清楚一些...
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => setCustomMode(false)}
                className="text-sm text-primary hover:underline"
              >
                ← 返回选择
              </button>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="请更详细地描述你想做什么..."
                className="h-32 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancel}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  取消
                </button>
                <button
                  onClick={handleCustomSubmit}
                  disabled={!customText.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  确认
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3">
          <button
            onClick={onCancel}
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
