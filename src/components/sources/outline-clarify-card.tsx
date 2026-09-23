import { useMemo, useRef, useState } from "react"

import {
  findOutlinePlanElementSpec,
  getOutlinePlanRequiredElements,
} from "@/lib/novel/outline-plan-elements"
import {
  OUTLINE_PLAN_CUSTOM_OPTION_ID,
  type OutlinePlanAnswer,
  type OutlinePlanProtocol,
  type OutlinePlanQuestion,
} from "@/lib/novel/outline-plan-protocol"

interface OutlineClarifyCardProps {
  protocol: OutlinePlanProtocol
  onSubmitAnswers: (answers: OutlinePlanAnswer[]) => Promise<boolean>
  disabled?: boolean
  disabledReason?: string
}

interface QuestionSelection {
  optionIds: string[]
  custom: string
}

function isCustomOption(optionId: string): boolean {
  return optionId.toUpperCase() === OUTLINE_PLAN_CUSTOM_OPTION_ID
}

function toggleSelection(
  selection: QuestionSelection,
  optionId: string,
  multiple: boolean,
): QuestionSelection {
  if (!multiple) {
    return {
      optionIds: selection.optionIds.includes(optionId) ? [] : [optionId],
      custom: selection.custom,
    }
  }
  return {
    optionIds: selection.optionIds.includes(optionId)
      ? selection.optionIds.filter((id) => id !== optionId)
      : [...selection.optionIds, optionId],
    custom: selection.custom,
  }
}

function buildAnswerValue(
  question: OutlinePlanQuestion,
  selection: QuestionSelection,
): string {
  const labels = selection.optionIds
    .filter((optionId) => !isCustomOption(optionId))
    .map((optionId) => question.options.find((option) => option.id === optionId)?.label ?? "")
    .filter(Boolean)
  const custom = selection.optionIds.some(isCustomOption) ? selection.custom.trim() : ""
  return [...labels, custom].filter(Boolean).join("；")
}

export function OutlineClarifyCard({
  protocol,
  onSubmitAnswers,
  disabled = false,
  disabledReason,
}: OutlineClarifyCardProps) {
  const [selections, setSelections] = useState<Record<string, QuestionSelection>>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const elementSpecs = useMemo(
    () => getOutlinePlanRequiredElements(protocol.module),
    [protocol.module],
  )

  if (protocol.status !== "needs_input" || protocol.questions.length === 0) return null

  const getSelection = (questionId: string): QuestionSelection =>
    selections[questionId] ?? { optionIds: [], custom: "" }

  const answers = protocol.questions.map((question) => ({
    key: question.key || question.id,
    label: findOutlinePlanElementSpec(elementSpecs, question.key)?.label || question.key || question.id,
    question: question.question,
    value: buildAnswerValue(question, getSelection(question.id)),
  }))
  const answered = answers.every((answer) => answer.value.trim())
  const interactionDisabled = disabled || submitting

  const handleToggle = (question: OutlinePlanQuestion, optionId: string) => {
    if (interactionDisabled) return
    setSelections((current) => ({
      ...current,
      [question.id]: toggleSelection(
        current[question.id] ?? { optionIds: [], custom: "" },
        optionId,
        question.multiple,
      ),
    }))
  }

  const handleCustomChange = (questionId: string, value: string) => {
    setSelections((current) => ({
      ...current,
      [questionId]: { ...(current[questionId] ?? { optionIds: [], custom: "" }), custom: value },
    }))
  }

  const handleSubmit = async () => {
    if (interactionDisabled || !answered || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onSubmitAnswers(answers)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-50/30 p-3 dark:bg-amber-950/10">
      <div className="mb-2 text-sm font-medium">
        生成「{protocol.module}」还缺少要素，请补齐后再生成计划
      </div>
      {protocol.missing.length ? (
        <div className="mb-3 text-xs text-muted-foreground">
          待补要素：{protocol.missing.join("、")}
        </div>
      ) : null}
      <div className="space-y-4">
        {protocol.questions.map((question) => {
          const selection = getSelection(question.id)
          const customSelected = selection.optionIds.some(isCustomOption)
          return (
            <div key={question.id} className="space-y-2">
              <div className="text-sm font-medium">
                {question.question}
                {question.multiple ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">可多选</span>
                ) : null}
              </div>
              <div className="space-y-2">
                {question.options.map((option) => {
                  const selected = selection.optionIds.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected ? "border-amber-500 bg-amber-100/60 dark:bg-amber-900/30" : ""
                      }`}
                      onClick={() => handleToggle(question, option.id)}
                      disabled={interactionDisabled}
                      title={disabled ? disabledReason : undefined}
                    >
                      <div className="font-medium">{option.label}</div>
                      {option.description ? (
                        <div className="text-xs text-muted-foreground">{option.description}</div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              {customSelected ? (
                <textarea
                  value={selection.custom}
                  onChange={(event) => handleCustomChange(question.id, event.target.value)}
                  disabled={interactionDisabled}
                  aria-label={`${question.question} 自定义补充`}
                  placeholder="请补充你的具体要求"
                  className="min-h-16 w-full resize-y rounded-md border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          aria-label="提交补充要素"
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleSubmit()}
          disabled={interactionDisabled || !answered}
          title={disabled ? disabledReason : undefined}
          aria-busy={submitting || undefined}
        >
          {submitting ? "提交中..." : "提交并继续"}
        </button>
        {!answered ? (
          <span className="text-xs text-muted-foreground">每个问题都要选一项或填写补充说明</span>
        ) : null}
      </div>
    </div>
  )
}
