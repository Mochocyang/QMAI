import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

import {
  OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  type OutlineDiscussAnswer,
  type OutlineDiscussDecision,
  type OutlineDiscussProtocol,
} from "@/lib/novel/outline-discuss-protocol"

interface OutlineDiscussCardProps {
  protocol: OutlineDiscussProtocol
  onSubmitAnswers: (answers: OutlineDiscussAnswer[]) => Promise<boolean>
  onConfirm: () => Promise<boolean>
  onContinue: () => void
  disabled?: boolean
  disabledReason?: string
}

interface DecisionSelection {
  optionIds: string[]
  custom: string
}

function isCustomOption(optionId: string): boolean {
  return optionId.toUpperCase() === OUTLINE_DISCUSS_CUSTOM_OPTION_ID
}

function toggleSelection(selection: DecisionSelection, optionId: string): DecisionSelection {
  return {
    optionIds: selection.optionIds.includes(optionId) ? [] : [optionId],
    custom: selection.custom,
  }
}

function buildAnswerValue(
  decision: OutlineDiscussDecision,
  selection: DecisionSelection,
): string {
  const labels = selection.optionIds
    .filter((optionId) => !isCustomOption(optionId))
    .map((optionId) => decision.options.find((option) => option.id === optionId)?.label ?? "")
    .filter(Boolean)
  const custom = selection.optionIds.some(isCustomOption) ? selection.custom.trim() : ""
  return [...labels, custom].filter(Boolean).join("；")
}

export function OutlineDiscussCard({
  protocol,
  onSubmitAnswers,
  onConfirm,
  onContinue,
  disabled = false,
  disabledReason,
}: OutlineDiscussCardProps) {
  const [selections, setSelections] = useState<Record<string, DecisionSelection>>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  if (protocol.status === "needs_decision") {
    return (
      <OutlineDiscussDecisionCard
        protocol={protocol}
        selections={selections}
        setSelections={setSelections}
        submitting={submitting}
        submittingRef={submittingRef}
        setSubmitting={setSubmitting}
        onSubmitAnswers={onSubmitAnswers}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    )
  }

  if (protocol.status === "ready") {
    return (
      <OutlineDiscussFinalizeCard
        protocol={protocol}
        submitting={submitting}
        submittingRef={submittingRef}
        setSubmitting={setSubmitting}
        onConfirm={onConfirm}
        onContinue={onContinue}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    )
  }

  return null
}

function OutlineDiscussDecisionCard({
  protocol,
  selections,
  setSelections,
  submitting,
  submittingRef,
  setSubmitting,
  onSubmitAnswers,
  disabled,
  disabledReason,
}: {
  protocol: OutlineDiscussProtocol
  selections: Record<string, DecisionSelection>
  setSelections: Dispatch<SetStateAction<Record<string, DecisionSelection>>>
  submitting: boolean
  submittingRef: MutableRefObject<boolean>
  setSubmitting: (value: boolean) => void
  onSubmitAnswers: (answers: OutlineDiscussAnswer[]) => Promise<boolean>
  disabled: boolean
  disabledReason?: string
}) {
  if (protocol.decisions.length === 0) return null

  const getSelection = (decisionId: string): DecisionSelection =>
    selections[decisionId] ?? { optionIds: [], custom: "" }

  const answers = protocol.decisions.map((decision) => ({
    id: decision.id,
    question: decision.question,
    value: buildAnswerValue(decision, getSelection(decision.id)),
  }))
  const answered = answers.every((answer) => answer.value.trim())
  const interactionDisabled = disabled || submitting

  const handleToggle = (decision: OutlineDiscussDecision, optionId: string) => {
    if (interactionDisabled) return
    setSelections((current) => ({
      ...current,
      [decision.id]: toggleSelection(
        current[decision.id] ?? { optionIds: [], custom: "" },
        optionId,
      ),
    }))
  }

  const handleCustomChange = (decisionId: string, value: string) => {
    setSelections((current) => ({
      ...current,
      [decisionId]: { ...(current[decisionId] ?? { optionIds: [], custom: "" }), custom: value },
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
    <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-50/30 p-3 dark:bg-sky-950/10">
      <div className="mb-2 text-sm font-medium">需要你拍板「{protocol.module}」的分歧</div>
      {protocol.judgment ? (
        <div className="mb-3 text-xs text-muted-foreground">{protocol.judgment}</div>
      ) : null}
      <div className="space-y-4">
        {protocol.decisions.map((decision) => {
          const selection = getSelection(decision.id)
          const customSelected = selection.optionIds.some(isCustomOption)
          const preferred = decision.options.find((option) => option.id === decision.preferenceId)
          return (
            <div key={decision.id} className="space-y-2">
              <div className="text-sm font-medium">{decision.question}</div>
              {preferred && decision.preferenceReason ? (
                <div className="text-xs text-muted-foreground">
                  倾向「{preferred.label}」：{decision.preferenceReason}
                </div>
              ) : null}
              <div className="space-y-2">
                {decision.options.map((option) => {
                  const selected = selection.optionIds.includes(option.id)
                  const isPreference = option.id === decision.preferenceId
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected ? "border-sky-500 bg-sky-100/60 dark:bg-sky-900/30" : ""
                      }`}
                      onClick={() => handleToggle(decision, option.id)}
                      disabled={interactionDisabled}
                      title={disabled ? disabledReason : undefined}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <span>{option.label}</span>
                        {isPreference ? (
                          <span className="rounded border border-sky-500/40 px-1 text-[10px] font-normal text-sky-700 dark:text-sky-300">
                            AI 倾向
                          </span>
                        ) : null}
                      </div>
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
                  onChange={(event) => handleCustomChange(decision.id, event.target.value)}
                  disabled={interactionDisabled}
                  aria-label={`${decision.question} 自定义补充`}
                  placeholder="请补充你的具体方案"
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
          aria-label="选定继续讨论"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleSubmit()}
          disabled={interactionDisabled || !answered}
          title={disabled ? disabledReason : undefined}
          aria-busy={submitting || undefined}
        >
          {submitting ? "提交中..." : "选定，继续讨论"}
        </button>
        {!answered ? (
          <span className="text-xs text-muted-foreground">每个分歧都要选一项或填写补充说明</span>
        ) : null}
      </div>
    </div>
  )
}

function OutlineDiscussFinalizeCard({
  protocol,
  submitting,
  submittingRef,
  setSubmitting,
  onConfirm,
  onContinue,
  disabled,
  disabledReason,
}: {
  protocol: OutlineDiscussProtocol
  submitting: boolean
  submittingRef: MutableRefObject<boolean>
  setSubmitting: (value: boolean) => void
  onConfirm: () => Promise<boolean>
  onContinue: () => void
  disabled: boolean
  disabledReason?: string
}) {
  const interactionDisabled = disabled || submitting

  const handleConfirm = async () => {
    if (interactionDisabled || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-50/30 p-3 dark:bg-emerald-950/10">
      <div className="mb-2 text-sm font-medium">「{protocol.module}」可以定稿，确认后才开始写</div>
      {protocol.judgment ? (
        <div className="mb-3 text-sm">{protocol.judgment}</div>
      ) : null}
      {protocol.agreed.length ? (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">已拍板</div>
          <ul className="space-y-0.5 text-xs">
            {protocol.agreed.map((item) => (
              <li key={item.id || item.question}>
                <span className="font-medium">{item.question}</span>：{item.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {protocol.nextStep ? (
        <div className="mb-3 text-xs text-muted-foreground">{protocol.nextStep}</div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="定稿开始生成"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleConfirm()}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
          aria-busy={submitting || undefined}
        >
          {submitting ? "生成中..." : "定稿，开始生成"}
        </button>
        <button
          type="button"
          aria-label="继续讨论"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onContinue}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
        >
          继续讨论
        </button>
      </div>
    </div>
  )
}
