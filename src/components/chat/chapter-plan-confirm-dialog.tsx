import { useState, useCallback, useEffect, useRef } from "react"
import { X, Check, SkipForward, Edit3, ListChecks } from "lucide-react"
export { buildChapterPlanSelfCheckPrompt } from "@/lib/novel/chapter-plan-self-check"

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
  return [
    `${CHAPTER_PLAN_CONFIRMED_PREFIX}，现在进入执行阶段。`,
    "请调用 run_chapter_workflow 工具生成正文，并把下面这份已确认的章节计划原文作为 planBlueprint 参数完整传入。",
    "不要再次输出计划，不要再次等待确认，不要把计划改写或省略，直接进入正文生成。",
    "",
    "=== 已确认的章节计划 ===",
    plan,
  ].join("\n")
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
  onSelfCheck?: (planContent: string) => Promise<string> | string
  onRevisePlan?: (planContent: string, selfCheckResult: string) => Promise<string> | string
  onCancel: () => void
}

export function ChapterPlanConfirmDialog({
  open,
  planContent,
  aiWorkflowMode,
  onConfirm,
  onSkip,
  onModify,
  onSelfCheck,
  onRevisePlan,
  onCancel,
}: ChapterPlanConfirmDialogProps) {
  const [editing, setEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(planContent)
  const [selfChecking, setSelfChecking] = useState(false)
  const [selfCheckResult, setSelfCheckResult] = useState("")
  const [selfCheckError, setSelfCheckError] = useState("")
  const [revisingPlan, setRevisingPlan] = useState(false)
  const [reviseError, setReviseError] = useState("")
  const selfCheckRequestRef = useRef(0)

  useEffect(() => {
    selfCheckRequestRef.current += 1
    setSelfChecking(false)
    setSelfCheckResult("")
    setSelfCheckError("")
    setRevisingPlan(false)
    setReviseError("")
  }, [open, planContent])

  const handleStartEdit = useCallback(() => {
    setEditedContent(planContent)
    setEditing(true)
  }, [planContent])

  const handleSubmitEdit = useCallback(() => {
    if (!onModify) return;
    onModify(editedContent)
    setEditing(false)
  }, [editedContent, onModify])

  const handleConfirm = useCallback(() => {
    if (editing && onModify) {
      onModify(editedContent)
      setEditing(false)
      return
    }
    onConfirm()
  }, [editedContent, editing, onConfirm, onModify])

  const handleSelfCheck = useCallback(async () => {
    if (!onSelfCheck) return
    const requestId = selfCheckRequestRef.current + 1
    selfCheckRequestRef.current = requestId
    setSelfChecking(true)
    setSelfCheckResult("")
    setSelfCheckError("")
    try {
      const targetPlan = editing ? editedContent : planContent
      const result = await onSelfCheck(targetPlan)
      if (selfCheckRequestRef.current !== requestId) return
      setSelfCheckResult(result.trim() || "自检完成，未返回具体结果。")
    } catch (error) {
      if (selfCheckRequestRef.current !== requestId) return
      setSelfCheckError(error instanceof Error ? error.message : String(error))
    } finally {
      if (selfCheckRequestRef.current === requestId) {
        setSelfChecking(false)
      }
    }
  }, [editedContent, editing, onSelfCheck, planContent])

  const handleRevisePlan = useCallback(async () => {
    if (!onRevisePlan || !selfCheckResult.trim()) return
    setRevisingPlan(true)
    setReviseError("")
    try {
      const targetPlan = editing ? editedContent : planContent
      const revised = await onRevisePlan(targetPlan, selfCheckResult)
      setEditedContent(revised.trim() || targetPlan)
      setEditing(true)
    } catch (error) {
      setReviseError(error instanceof Error ? error.message : String(error))
    } finally {
      setRevisingPlan(false)
    }
  }, [editedContent, editing, onRevisePlan, planContent, selfCheckResult])

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
          {(selfChecking || selfCheckResult || selfCheckError) && (
            <div className="mt-3 rounded-md border bg-background p-3 text-sm">
              <div className="mb-2 font-medium">计划自检结果</div>
              {selfChecking && <div className="text-muted-foreground">正在自检计划...</div>}
              {selfCheckResult && <div className="whitespace-pre-wrap leading-relaxed">{selfCheckResult}</div>}
              {selfCheckError && <div className="text-destructive">自检失败：{selfCheckError}</div>}
              {reviseError && <div className="mt-2 text-destructive">修订失败：{reviseError}</div>}
              {onRevisePlan && selfCheckResult && (
                <button
                  onClick={handleRevisePlan}
                  disabled={revisingPlan}
                  className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revisingPlan ? "修订中..." : "按自检建议修正"}
                </button>
              )}
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
            {onSelfCheck && (
              <button
                onClick={handleSelfCheck}
                disabled={selfChecking}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ListChecks className="h-4 w-4" />
                {selfChecking ? "自检中..." : "自检计划"}
              </button>
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
              onClick={handleConfirm}
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
