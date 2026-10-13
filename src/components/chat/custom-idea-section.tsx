/**
 * 「其他想法」：点开后在卡片内展开输入框，把作者自己写的走向交给 AI 重新推演。
 *
 * 从 `chapter-discuss-card.tsx` 里搬出来成一个独立模块，因为 2026-10-13 起它有了
 * **第二个宿主**：事件细纲卡片在「共创判了『前文不足以推演』」时也要挂这枚入口
 * （用户要求把这几个动作整合到同一张卡里）。留两份必然漂移 —— 一次改文案、一次改
 * 校验，两边就长得不一样了，而用户看到的是同一枚按钮。
 *
 * 刻意仍是**内联展开**（不额外弹窗），与大纲共创卡的自定义输入保持同一套交互。
 */
export function CustomIdeaSection({
  open,
  value,
  onOpenChange,
  onValueChange,
  onSubmit,
  disabled,
  disabledReason,
  submitting,
}: {
  open: boolean
  value: string
  onOpenChange: (open: boolean) => void
  onValueChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
  disabledReason?: string
  submitting: boolean
}) {
  const locked = disabled || submitting
  return (
    <>
      <button
        type="button"
        aria-label="其他想法"
        aria-expanded={open}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onOpenChange(!open)}
        disabled={locked}
        title={disabled ? disabledReason : undefined}
      >
        其他想法
      </button>
      {open ? (
        <div className="w-full space-y-2">
          <textarea
            aria-label="输入你的想法"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            disabled={locked}
            placeholder="说说你希望后面怎么发展，AI 会按这个想法重新推演方向"
            className="min-h-16 w-full resize-y rounded-md border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="按这个想法重新推演"
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onSubmit}
              disabled={locked || !value.trim()}
              aria-busy={submitting || undefined}
            >
              {submitting ? "推演中..." : "按这个想法重新推演"}
            </button>
            <button
              type="button"
              aria-label="取消想法输入"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
