import { useRef, useState } from "react"

import {
  formatOutlinePlanMarkdown,
  type OutlinePlanProtocol,
} from "@/lib/novel/outline-plan-protocol"

interface OutlinePlanCardProps {
  protocol: OutlinePlanProtocol
  /** 确认后按计划正文进入生成阶段；planText 为用户可能编辑过的计划。 */
  onConfirm: (planText: string) => Promise<boolean>
  /** 补充信息：聚焦输入框，允许用户再追加要素后重跑要素盘点。 */
  onSupplement: () => void
  onCancel: () => void
  disabled?: boolean
  disabledReason?: string
}

export function OutlinePlanCard({
  protocol,
  onConfirm,
  onSupplement,
  onCancel,
  disabled = false,
  disabledReason,
}: OutlinePlanCardProps) {
  const plan = protocol.plan
  const [editing, setEditing] = useState(false)
  const [editedPlan, setEditedPlan] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  if (protocol.status !== "ready" || !plan) return null

  const planMarkdown = formatOutlinePlanMarkdown(plan)
  const interactionDisabled = disabled || submitting

  const handleStartEdit = () => {
    if (interactionDisabled) return
    setEditedPlan(planMarkdown)
    setEditing(true)
  }

  const handleConfirm = async () => {
    if (interactionDisabled || submittingRef.current) return
    const planText = editing ? editedPlan.trim() : planMarkdown
    if (!planText) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onConfirm(planText)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const confirmLabel = submitting
    ? "生成中..."
    : editing
      ? "按修改后的计划生成"
      : "确认，按此计划生成"

  return (
    <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-50/30 p-3 dark:bg-emerald-950/10">
      <div className="mb-2 text-sm font-medium">「{protocol.module}」生成计划，确认后才开始写</div>

      {protocol.elements.length ? (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">已确认要素</div>
          <ul className="space-y-0.5 text-xs">
            {protocol.elements.filter((element) => element.satisfied).map((element) => (
              <li key={element.key}>
                <span className="font-medium">{element.key}</span>：{element.value}
                <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">
                  {element.source}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <textarea
          value={editedPlan}
          onChange={(event) => setEditedPlan(event.target.value)}
          disabled={interactionDisabled}
          aria-label="编辑生成计划"
          className="min-h-48 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      ) : (
        <div className="space-y-3 text-sm">
          {plan.summary ? <div>{plan.summary}</div> : null}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">生成步骤</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs">
              {plan.steps.map((step) => (
                <li key={step.id}>
                  <span className="font-medium">{step.title}</span>
                  {step.detail ? `：${step.detail}` : ""}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">待写文件</div>
            <ul className="space-y-0.5 text-xs">
              {plan.files.map((file) => (
                <li key={`${file.targetFolder}/${file.fileName}`}>
                  {[file.targetFolder, file.fileName].filter(Boolean).join("/")}
                  <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">
                    {[file.fileType, file.writeMode].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {plan.order ? (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">生成顺序：</span>
              {plan.order}
            </div>
          ) : null}
          {plan.risks.length ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">风险</div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {plan.risks.map((risk) => <li key={risk}>{risk}</li>)}
              </ul>
            </div>
          ) : null}
          {plan.openQuestions.length ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">遗留问题</div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {plan.openQuestions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="确认生成计划"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleConfirm()}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
          aria-busy={submitting || undefined}
        >
          {confirmLabel}
        </button>
        {editing ? null : (
          <button
            type="button"
            aria-label="修改生成计划"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleStartEdit}
            disabled={interactionDisabled}
            title={disabled ? disabledReason : undefined}
          >
            修改计划
          </button>
        )}
        <button
          type="button"
          aria-label="补充生成要素"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onSupplement}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
        >
          补充信息
        </button>
        <button
          type="button"
          aria-label="取消生成计划"
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onCancel}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
        >
          取消
        </button>
      </div>
    </div>
  )
}
