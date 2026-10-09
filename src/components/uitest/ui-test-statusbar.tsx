import { useEffect, useRef, useState } from "react"
import { ProgressRing } from "@/components/common/progress-ring"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import { cn } from "@/lib/utils"

/**
 * 完成率对应的环色。
 *
 * 用户要求「颜色用灰色一些」：不再按完成率分档报警（此前红/橙/绿三档），
 * 平时就是一枚安静的灰环，只有**真正达标（≥100%）**才转绿 —— 一个
 * 一眼可辨的正反馈，而不是一路用红橙催人。灰色偏中性（不带饱和绿），
 * 免得太监色反而抢眼。
 */
export function writingGoalRingClass(ratio: number): string {
  return ratio >= 1 ? "text-[#22c55e]" : "text-[#96a09a]"
}

/** 千分位。2–3 百万字的小说里「1837250」远不如「1,837,250」好读。 */
export function formatWordCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return Math.max(0, Math.round(value)).toLocaleString("en-US")
}

/** 完成率百分比（整数、不封顶，好让用户看到「今天写超了」）。 */
export function writingGoalPercent(written: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0
  if (!Number.isFinite(written) || written <= 0) return 0
  return Math.round((written / target) * 100)
}

export interface WritingStatusBarProps {
  className?: string
}

/**
 * 底部「写作字数」状态栏。
 *
 * 四项数据常显在栏上（用户选定：不做可折叠菜单），左端是今日目标完成率圆环。
 * 目标字数直接点开改，不必为了调一个数字跳去设置页。
 */
export function WritingStatusBar({ className }: WritingStatusBarProps) {
  const totalChars = useWritingStatsStore((s) => s.totalChars)
  const humanChars = useWritingStatsStore((s) => s.humanChars)
  const aiChars = useWritingStatsStore((s) => s.aiChars)
  const dailyTargetChars = useWritingStatsStore((s) => s.dailyTargetChars)
  const setDailyTarget = useWritingStatsStore((s) => s.setDailyTarget)

  const [editingTarget, setEditingTarget] = useState(false)
  const [targetDraft, setTargetDraft] = useState("")
  const targetInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTarget) targetInputRef.current?.select()
  }, [editingTarget])

  const todayWritten = humanChars + aiChars
  const ratio = dailyTargetChars > 0 ? todayWritten / dailyTargetChars : 0
  const percent = writingGoalPercent(todayWritten, dailyTargetChars)

  const beginEditTarget = () => {
    setTargetDraft(String(dailyTargetChars))
    setEditingTarget(true)
  }

  const commitTarget = () => {
    // 空串或纯空白视为「放弃修改」，不要悄悄把目标改成最小值。
    const trimmed = targetDraft.trim()
    if (trimmed) {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) setDailyTarget(parsed)
    }
    setEditingTarget(false)
  }

  const targetControl = editingTarget ? (
    <input
      ref={targetInputRef}
      className="ui-test-statusbar-target-input"
      aria-label="今日目标字数"
      inputMode="numeric"
      value={targetDraft}
      onChange={(event) => setTargetDraft(event.target.value.replace(/[^\d]/g, ""))}
      onBlur={commitTarget}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commitTarget()
        } else if (event.key === "Escape") {
          event.preventDefault()
          setEditingTarget(false)
        }
      }}
    />
  ) : (
    <button
      type="button"
      className="ui-test-statusbar-target"
      title="点击修改今日目标字数"
      aria-label={`今日目标字数 ${dailyTargetChars}，点击修改`}
      onClick={beginEditTarget}
    >
      {formatWordCount(dailyTargetChars)}
    </button>
  )

  return (
    <footer className={cn("ui-test-statusbar", className)} aria-label="写作字数">
      <div className="ui-test-statusbar-inner">
        <ul className="ui-test-statusbar-metrics">
          <li className="ui-test-statusbar-metric">
            <span className="ui-test-statusbar-label">总字数</span>
            <span className="ui-test-statusbar-value" data-metric="total">
              {formatWordCount(totalChars)}
            </span>
          </li>
          <li className="ui-test-statusbar-metric">
            <span className="ui-test-statusbar-label">今日目标</span>
            <span className="ui-test-statusbar-value" data-metric="target">
              {targetControl}
            </span>
          </li>
          <li className="ui-test-statusbar-metric">
            <span className="ui-test-statusbar-label">今日 AI 生成</span>
            <span className="ui-test-statusbar-value" data-metric="ai">
              {formatWordCount(aiChars)}
            </span>
          </li>
          <li className="ui-test-statusbar-metric">
            <span className="ui-test-statusbar-label">手写</span>
            <span className="ui-test-statusbar-value" data-metric="human">
              {formatWordCount(humanChars)}
            </span>
          </li>
        </ul>
        {/* 手机电量那种读法：小环在左，百分比紧跟在环右侧，而**整组**贴在
            状态栏最右端（四项数据居中，见 .ui-test-statusbar-inner 的 grid）。
            百分比刻意不放进环心 —— 环太小，字挤在里面既糊又显大。 */}
        <span className="ui-test-statusbar-goal" title={`今日写作目标完成率 ${percent}%（${todayWritten} / ${dailyTargetChars} 字）`}>
          <ProgressRing
            ratio={ratio}
            size={12}
            strokeWidth={1.5}
            className={writingGoalRingClass(ratio)}
            title={`今日写作目标完成率 ${percent}%（${todayWritten} / ${dailyTargetChars} 字）`}
          />
          <span className="ui-test-statusbar-percent">{percent}%</span>
        </span>
      </div>
    </footer>
  )
}
