import { X } from "lucide-react"
import {
  CONTINUATION_POPOVER_MAX_HEIGHT,
  CONTINUATION_POPOVER_WIDTH,
  countContinuationChars,
  type ContinuationPopoverPosition,
} from "@/lib/novel/continuation"

export type ContinuationPhase = "idle" | "streaming" | "done" | "error"

export interface ContinuationPopoverProps {
  phase: ContinuationPhase
  position: ContinuationPopoverPosition
  instruction: string
  candidate: string
  errorMessage: string
  /** 模型是被输出上限截断的（finish reason 命中 length / max_tokens）。 */
  truncated: boolean
  onInstructionChange: (value: string) => void
  onStart: () => void
  onInsert: () => void
  onRegenerate: () => void
  onStop: () => void
  onClose: () => void
}

const BUTTON_CLASS =
  "rounded px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"

/**
 * 续写浮层。
 *
 * 刻意做成哑组件：不读 store、不发请求，只把状态画出来并把点击转成回调。
 * 这样它能在 jsdom 里被完整断言，而所有业务判断都留在 preview-panel 里。
 */
export function ContinuationPopover({
  phase,
  position,
  instruction,
  candidate,
  errorMessage,
  truncated,
  onInstructionChange,
  onStart,
  onInsert,
  onRegenerate,
  onStop,
  onClose,
}: ContinuationPopoverProps) {
  const streaming = phase === "streaming"
  const charCount = countContinuationChars(candidate)

  return (
    <div
      data-continuation-popover="true"
      role="dialog"
      aria-label="续写"
      className="fixed z-50 flex flex-col gap-2 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-lg"
      style={{
        left: position.left,
        top: position.top,
        width: CONTINUATION_POPOVER_WIDTH,
        maxHeight: CONTINUATION_POPOVER_MAX_HEIGHT,
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-medium">续写</div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label="关闭续写"
          title="关闭续写"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input
        type="text"
        data-continuation-instruction="true"
        value={instruction}
        disabled={streaming}
        placeholder="想写什么？可留空直接续写"
        onChange={(event) => onInstructionChange(event.target.value)}
        onKeyDown={(event) => {
          // 回车即续写，跟搜索框一致；但生成中不能再触发第二次。
          if (event.key === "Enter" && !streaming) onStart()
        }}
        className="w-full rounded border bg-background px-2 py-1 text-xs outline-none disabled:opacity-60"
      />

      {streaming ? (
        <div
          data-continuation-streaming="true"
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background px-2 py-1.5 text-xs leading-relaxed"
        >
          {candidate || <span className="text-muted-foreground">正在续写…</span>}
        </div>
      ) : null}

      {phase === "done" ? (
        <div
          data-continuation-candidate="true"
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background px-2 py-1.5 text-xs leading-relaxed"
        >
          {candidate}
        </div>
      ) : null}

      {phase === "error" ? (
        <div
          data-continuation-error="true"
          className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          {errorMessage}
        </div>
      ) : null}

      {truncated && phase === "done" ? (
        <div className="px-1 text-xs text-amber-600 dark:text-amber-500">
          输出达到长度上限，已截断。可以插入，也可以重新生成。
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-1 px-1">
        <span className="text-xs text-muted-foreground">{candidate ? `${charCount} 字` : ""}</span>
        <div className="flex items-center gap-1">
          {streaming ? (
            <button type="button" className={BUTTON_CLASS} onClick={onStop}>停止</button>
          ) : phase === "done" ? (
            <>
              <button type="button" className={BUTTON_CLASS} onClick={onInsert}>插入正文</button>
              <button type="button" className={BUTTON_CLASS} onClick={onRegenerate}>重新生成</button>
            </>
          ) : (
            <button type="button" className={BUTTON_CLASS} onClick={onStart}>续写</button>
          )}
        </div>
      </div>
    </div>
  )
}
