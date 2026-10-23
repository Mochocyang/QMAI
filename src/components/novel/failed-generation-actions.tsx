import { Play, RotateCcw } from "lucide-react"

import {
  FAILED_GENERATION_CONTINUE_LABEL,
  FAILED_GENERATION_RETRY_LABEL,
} from "@/lib/novel/failed-generation"

/**
 * 生成失败后，紧挨着「保存 / 复制 / 引用资料」那排图标出现的两枚补救动作。
 *
 * 为什么要有：失败时正文里只剩一句「出错：…」，而那一刻正是用户最需要
 * "下一步点哪里"的时候 —— 让他自己去翻工具栏或重新打一遍请求，等于把失败
 * 变成一次额外的操作成本。所以失败消息下方必须当场给出：
 *
 *   重试 —— 用**当前**选中的模型把上一条请求整条重发（可以先换个模型再点）。
 *   继续 —— 保留已经生成的那半截，让模型从断点接着往下写。
 *
 * 外观刻意与同一排的其它按钮一致（28px 命中区、16px 图标、无底无框、
 * 悬停才浮出淡色底），这样它读起来是"这一排里多出来的两个动作"，
 * 而不是另一套突兀的按钮组。章节与大纲两个面板共用本组件。
 *
 * ⚠️ 「继续」在没有已生成内容时是**禁用**而非隐藏：用户明确要求失败时
 * 两个按钮都要在。把"什么都没有、无从继续"如实做成禁用态（title 说明原因），
 * 比留一个点下去只会再失败一次的按钮诚实。
 */
export function FailedGenerationActions({
  onRetry,
  onContinue,
  continueDisabled = false,
  disabled = false,
  className = "",
}: {
  onRetry?: () => void
  onContinue?: () => void
  /** 一个字都没生成过时，「继续」没有可接的断点。 */
  continueDisabled?: boolean
  disabled?: boolean
  className?: string
}) {
  // 两个动作都没接回调时不占位（例如历史消息、或调用方没接）。
  if (!onRetry && !onContinue) return null

  const buttonClass =
    "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground " +
    "hover:bg-accent transition-colors disabled:opacity-40"

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      data-ui-failed-generation-actions="true"
    >
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className={buttonClass}
          title={`${FAILED_GENERATION_RETRY_LABEL}：用当前模型把上一条请求重新生成一遍`}
          aria-label={FAILED_GENERATION_RETRY_LABEL}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={disabled || continueDisabled}
          className={buttonClass}
          title={
            continueDisabled
              ? "本次没有已生成的内容，无法继续；请点「重试」重新生成"
              : `${FAILED_GENERATION_CONTINUE_LABEL}：保留已生成内容，从断开的地方接着写`
          }
          aria-label={FAILED_GENERATION_CONTINUE_LABEL}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
