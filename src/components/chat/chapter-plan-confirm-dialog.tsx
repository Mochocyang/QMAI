import { useState, useCallback } from "react"
import { X, Check, SkipForward, Edit3, ListChecks } from "lucide-react"

export const CHAPTER_PLAN_MARKER_START = "<!-- chapter_plan -->"
export const CHAPTER_PLAN_MARKER_END = "<!-- /chapter_plan -->"
const CHAPTER_PLAN_CONFIRMED_PREFIX = "章节计划已确认"
const CHAPTER_PLAN_SKIPPED_PREFIX = "跳过章节计划"

export function extractChapterPlan(fullContent: string): { plan: string; body: string } | null {
  const startIdx = fullContent.indexOf(CHAPTER_PLAN_MARKER_START)
  if (startIdx < 0) return null
  const contentStart = startIdx + CHAPTER_PLAN_MARKER_START.length
  const endIdx = fullContent.indexOf(CHAPTER_PLAN_MARKER_END, contentStart)
  if (endIdx < 0) return null
  const plan = fullContent.slice(contentStart, endIdx).trim()
  const beforePlan = fullContent.slice(0, startIdx).trim()
  const afterPlan = fullContent.slice(endIdx + CHAPTER_PLAN_MARKER_END.length).trim()
  const body = [beforePlan, afterPlan].filter(Boolean).join("\n").trim()
  return { plan, body }
}

export function buildPlanConfirmMessage(plan: string): string {
  return `${CHAPTER_PLAN_CONFIRMED_PREFIX}，现在进入执行阶段。请按以下计划写正文。不要再次输出计划，不要再次等待确认，直接输出正文。\n\n=== 已确认的章节计划 ===\n${plan}`
}

export function buildPlanSkipMessage(): string {
  return `${CHAPTER_PLAN_SKIPPED_PREFIX}，现在进入执行阶段。请直接写正文，不要输出计划，不要输出分析过程，不要再次等待确认。`
}

export function isChapterPlanExecutionFollowup(content: string): boolean {
  const normalized = content.trim()
  return normalized.startsWith(CHAPTER_PLAN_CONFIRMED_PREFIX) ||
    normalized.startsWith(CHAPTER_PLAN_SKIPPED_PREFIX)
}

interface ChapterPlanConfirmDialogProps {
  open: boolean
  planContent: string
  aiWorkflowMode: "fast" | "standard" | "strict"
  onConfirm: () => void
  onSkip: () => void
  onModify?: (modifiedPlan: string) => void
  onCancel: () => void
}

export function ChapterPlanConfirmDialog({
  open,
  planContent,
  aiWorkflowMode,
  onConfirm,
  onSkip,
  onModify,
  onCancel,
}: ChapterPlanConfirmDialogProps) {
  const [editing, setEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(planContent)

  const handleStartEdit = useCallback(() => {
    setEditedContent(planContent)
    setEditing(true)
  }, [planContent])

  const handleSubmitEdit = useCallback(() => {
    if (!onModify) return;
    onModify(editedContent)
    setEditing(false)
  }, [editedContent, onModify])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[75vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-blue-500" />
            <div>
              <h3 className="font-semibold">章节创作计划</h3>
              <p className="text-xs text-muted-foreground">
                {aiWorkflowMode === "strict" ? "严格模式" : "标准模式"} · 请确认 AI 的创作计划
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 hover:bg-accent" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {editing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="h-full w-full resize-none rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-relaxed">
              {planContent}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              取消生成
            </button>
            {onModify && (
              editing ? (
                <button
                  onClick={handleSubmitEdit}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Check className="h-4 w-4" />
                  按修改后的计划写正文
                </button>
              ) : (
                <button
                  onClick={handleStartEdit}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <Edit3 className="h-4 w-4" />
                  修改计划
                </button>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSkip}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              <SkipForward className="h-4 w-4" />
              跳过计划，直接写
            </button>
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              <Check className="h-4 w-4" />
              确认，按此计划写正文
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
