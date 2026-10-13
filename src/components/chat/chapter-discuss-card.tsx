import { useRef, useState } from "react"

import { CustomIdeaSection } from "@/components/chat/custom-idea-section"
import type {
  ChapterDiscussDecision,
  ChapterDiscussDirection,
  ChapterDiscussProtocol,
} from "@/lib/novel/chapter-discuss-protocol"

interface ChapterDiscussCardProps {
  protocol: ChapterDiscussProtocol
  /** 卡片已被使用过（重载后置灰）。 */
  decided?: ChapterDiscussDecision
  onSelect: (direction: ChapterDiscussDirection) => void | Promise<void>
  onRegenerate: () => void | Promise<void>
  /** 「其他想法」：把作者自己的想法交给 AI，按它重新推演方向。 */
  onCustom: (idea: string) => void | Promise<void>
  disabled?: boolean
  disabledReason?: string
}

/**
 * 章节「共创」的方向卡片。
 *
 * 与大纲的决策卡不同：这里是一批**方向候选单选** —— 每个方向带一个故事类型徽标、
 * 标题与约 200-300 字的后续介绍（要求是大白话，只讲剧情怎么走，见
 * `CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES`）。作者有三种处置方式：
 * 「按这个方向写」（选定后进正文生成）、「换一批」（整批重推）、
 * 「其他想法」（把自己的想法交给 AI，按它重新推演）。
 */
export function ChapterDiscussCard({
  protocol,
  decided,
  onSelect,
  onRegenerate,
  onCustom,
  disabled = false,
  disabledReason,
}: ChapterDiscussCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const decidedAlready = Boolean(decided)
  const interactionDisabled = disabled || submitting || decidedAlready
  const selected = protocol.directions.find((direction) => direction.id === selectedId) ?? null

  const runBusy = async (action: () => void | Promise<void>) => {
    if (interactionDisabled || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await action()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const customSection = (
    <CustomIdeaSection
      open={customOpen}
      value={customText}
      onOpenChange={setCustomOpen}
      onValueChange={setCustomText}
      onSubmit={() => {
        const idea = customText.trim()
        if (!idea) return
        void runBusy(() => onCustom(idea))
      }}
      disabled={disabled || decidedAlready}
      disabledReason={disabledReason}
      submitting={submitting}
    />
  )

  if (protocol.status === "insufficient") {
    return (
      <div
        data-chapter-discuss-card
        data-chapter-discuss-status={protocol.status}
        className="mt-3 rounded-md border border-amber-500/30 bg-amber-50/40 p-3 dark:bg-amber-950/10"
      >
        <div className="mb-2 text-sm font-medium">{protocol.module || "本章"}：前文不足以推演</div>
        {protocol.judgment ? (
          <div className="mb-3 text-xs text-muted-foreground">{protocol.judgment}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="换一批"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void runBusy(onRegenerate)}
            disabled={interactionDisabled}
            title={disabled ? disabledReason : undefined}
          >
            换一批
          </button>
          {customSection}
        </div>
      </div>
    )
  }

  if (protocol.directions.length === 0) return null

  return (
    <div
      data-chapter-discuss-card
      data-chapter-discuss-status={protocol.status}
      className="mt-3 rounded-md border border-sky-500/30 bg-sky-50/30 p-3 dark:bg-sky-950/10"
    >
      <div className="mb-2 text-sm font-medium">
        需要你选一个「{protocol.module || "本章"}」的后续走向
      </div>
      {protocol.judgment ? (
        <div className="mb-3 text-xs text-muted-foreground">{protocol.judgment}</div>
      ) : null}
      <div className="space-y-2" role="listbox" aria-label="章节后续方向">
        {protocol.directions.map((direction) => {
          const isSelected = direction.id === selectedId
          const isPreferred = Boolean(protocol.preferenceId) && direction.id === protocol.preferenceId
          return (
            <button
              key={direction.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected ? "border-sky-500 bg-sky-100/60 dark:bg-sky-900/30" : ""
              }`}
              onClick={() => {
                if (interactionDisabled) return
                setSelectedId(direction.id)
              }}
              disabled={interactionDisabled}
              title={disabled ? disabledReason : undefined}
            >
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span className="rounded border border-sky-500/40 px-1.5 py-0.5 text-[0.6875rem] font-normal text-sky-700 dark:text-sky-300">
                  {direction.storyType}
                </span>
                <span>{direction.title}</span>
                {isPreferred ? (
                  <span className="rounded border border-emerald-500/40 px-1 text-[0.625rem] font-normal text-emerald-700 dark:text-emerald-300">
                    AI 推荐
                  </span>
                ) : null}
              </div>
              {direction.summary ? (
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{direction.summary}</div>
              ) : null}
            </button>
          )
        })}
      </div>
      {isPreferredReasonVisible(protocol) ? (
        <div className="mt-2 text-xs text-muted-foreground">
          推荐「{protocol.directions.find((d) => d.id === protocol.preferenceId)?.title}」：
          {protocol.preferenceReason}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="选定该方向开始写"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (!selected) return
            void runBusy(() => onSelect(selected))
          }}
          disabled={interactionDisabled || !selected}
          title={disabled ? disabledReason : undefined}
          aria-busy={submitting || undefined}
        >
          {submitting ? "处理中..." : "按这个方向写"}
        </button>
        <button
          type="button"
          aria-label="换一批"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void runBusy(onRegenerate)}
          disabled={interactionDisabled}
          title={disabled ? disabledReason : undefined}
        >
          换一批
        </button>
        {customSection}
        {decidedAlready ? (
          <span className="text-xs text-muted-foreground">该轮讨论已处理过，请在最新消息里继续。</span>
        ) : null}
      </div>
    </div>
  )
}

/*
 * 「其他想法」的输入块已搬到 `custom-idea-section.tsx`：2026-10-13 起事件细纲卡片
 * 也要挂同一枚入口（共创判「前文不足以推演」时把这几个动作整合进一张卡），
 * 两处共用一份实现，避免按钮文案与交互各长一套。
 */

function isPreferredReasonVisible(protocol: ChapterDiscussProtocol): boolean {
  return Boolean(protocol.preferenceId && protocol.preferenceReason)
    && protocol.directions.some((direction) => direction.id === protocol.preferenceId)
}
