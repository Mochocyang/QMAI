import { Play, RotateCcw } from "lucide-react"

import {
  STOPPED_GENERATION_CONTINUE_LABEL,
  STOPPED_GENERATION_RETRY_LABEL,
} from "@/lib/novel/stopped-generation"

/**
 * 停止生成后，紧贴在「已停止生成」下方的两个补救动作。
 *
 * 用户停止生成往往不是因为写崩了，而是想换个模型再试一遍 —— 停止按钮是这个应用里
 * 唯一「先停下、再换模型、再继续」的入口。所以停下来之后必须马上给出下一步动作，
 * 而不是让用户自己去翻工具栏：
 *
 *   重试 —— 用**当前**选中的模型把上一条请求重新发一遍（换过模型后点它即可）。
 *   继续 —— 保留已经生成的部分，让模型从停下的地方接着往下写。
 *
 * 两个面板（章节的 ChatMessage、大纲的 OutlineAssistantMessage）共用这一个组件，
 * 保证按钮文案、图标、无障碍名称完全一致；判定「要不要显示」的逻辑也不在各自面板里
 * 各写一遍，统一用 stopped-generation.ts 的 isStoppedGenerationMessage。
 */
export function StoppedGenerationActions({
  onRetry,
  onContinue,
  disabled = false,
  className = "",
}: {
  onRetry?: () => void
  onContinue?: () => void
  disabled?: boolean
  className?: string
}) {
  // 两个动作都没有回调时不必占位（比如历史消息、或调用方没接回调）。
  if (!onRetry && !onContinue) return null

  const buttonClass =
    "inline-flex h-7 items-center gap-1 rounded border px-2 text-[0.6875rem] transition-colors " +
    "text-muted-foreground hover:bg-accent disabled:opacity-50"

  return (
    <div
      className={`flex w-full flex-wrap items-center gap-1 ${className}`}
      data-ui-stopped-generation-actions="true"
    >
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className={buttonClass}
          title={`${STOPPED_GENERATION_RETRY_LABEL}：用当前模型把上一条请求重新生成一遍`}
          aria-label={`${STOPPED_GENERATION_RETRY_LABEL}：用当前模型把上一条请求重新生成一遍`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {STOPPED_GENERATION_RETRY_LABEL}
        </button>
      ) : null}
      {onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={disabled}
          className={buttonClass}
          title={`${STOPPED_GENERATION_CONTINUE_LABEL}：保留已生成内容，从停下的地方接着写`}
          aria-label={`${STOPPED_GENERATION_CONTINUE_LABEL}：保留已生成内容，从停下的地方接着写`}
        >
          <Play className="h-3.5 w-3.5" />
          {STOPPED_GENERATION_CONTINUE_LABEL}
        </button>
      ) : null}
    </div>
  )
}
