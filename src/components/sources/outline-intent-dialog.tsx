/**
 * 需求分析浮层：把「意图不清晰」时的澄清做成贴在输入框上方的浮动面板。
 *
 * 背景 1：模型经常把候选范围全塞进 missingItems 而把 options 留空，
 * 旧的内联卡片就只剩一大段分析文字、一个可点的按钮都没有。
 * 背景 2：早先用全局居中 Dialog + 全屏黑色遮罩，视觉上等同全屏弹窗。
 * 现在改为面板内锚定浮层：宽度跟随 AI 会话面板，底边对齐面板底部、
 * 叠在输入区上层，并且不带遮罩。
 *
 * 布局约定：本组件是 absolute 定位，宿主必须是一个 relative 的容器
 * （大纲面板根节点已声明 relative），否则会以整页为参照跑偏。
 *
 * 关闭约定：浮层不带遮罩，但也不做「点击外部关闭」——拖动窗口和点击
 * 其他功能区都会冒泡出 pointerdown，容易被误判成取消。关闭只认 ✕、Esc、
 * 选中选项这三种显式操作，是否关闭由上层按消息 ID 持久化。
 */

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OutlineListEntry } from "@/lib/agent/tools/outline-list-helpers"
import type { IntentClarityResult } from "@/lib/novel/outline-intent-clarity"
import {
  CUSTOM_INTENT_OPTION_ID,
  isCustomIntentOption,
  resolveIntentOptions,
} from "@/lib/novel/outline-intent-options"
import { cn } from "@/lib/utils"

interface OutlineIntentDialogProps {
  open: boolean
  result: IntentClarityResult
  /** 项目里真实存在的大纲文档，用于兜底出「补充/修订」候选。 */
  entries?: OutlineListEntry[]
  /** 该轮已经处理过（用户已选过），不再重复弹出。 */
  decided?: boolean
  onSelect: (optionId: string, scope: string) => void
  onOpenChange?: (open: boolean) => void
}

export function OutlineIntentDialog({
  open,
  result,
  entries = [],
  decided = false,
  onSelect,
  onOpenChange,
}: OutlineIntentDialogProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState("")

  // 换了一条消息就重置自定义输入，避免把上一轮的文字带过来。
  useEffect(() => {
    setCustomOpen(false)
    setCustomText("")
  }, [result])

  // 关闭出口只有显式的三种：✕、Esc、选中某个选项。
  // 刻意不做「点击浮层外部关闭」：浮层不带遮罩，而拖动窗口（顶栏
  // data-tauri-drag-region）、点击其他功能都会在文档上冒泡出 pointerdown，
  // 一旦把它们当成取消，浮层会被误关且不再出现。
  useEffect(() => {
    if (!open || decided) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange?.(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, decided, onOpenChange])

  if (!open) return null
  if (decided) return null
  if (result.clarity !== "needs_input") return null

  const options = resolveIntentOptions(result, entries)
  const trimmedCustom = customText.trim()

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="需求分析"
      data-testid="outline-intent-dialog"
      className={cn(
        // inset-x-0 + bottom-0：宽度跟随 AI 会话面板，底边贴面板底部并盖在输入区上层。
        "absolute inset-x-0 bottom-0 z-50 flex max-h-[78%] min-w-0 flex-col gap-2.5",
        "overflow-y-auto rounded-t-xl border-t bg-popover p-3 text-sm text-popover-foreground",
        "shadow-[0_-10px_30px_-6px_rgba(0,0,0,0.22)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {result.question || "请选择本次要生成的范围"}
          </div>
          {result.module ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              本次目标：{result.module}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="关闭需求分析"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => onOpenChange?.(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {options.map((option) => {
          const custom = isCustomIntentOption(option.id)
          return (
            <button
              key={option.id}
              type="button"
              aria-label={option.label}
              aria-pressed={custom ? customOpen : undefined}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                custom && customOpen && "border-primary bg-accent",
              )}
              onClick={() => {
                if (custom) {
                  setCustomOpen(true)
                  return
                }
                onSelect(option.id, option.label)
              }}
            >
              <div className="font-medium">{option.label}</div>
              {option.description && !custom ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {option.description}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      {customOpen ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[68px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            placeholder="填写本次要生成的范围，例如：第四卷 无名样本 的折叠树卷纲"
            value={customText}
            aria-label="自定义生成范围"
            onChange={(event) => setCustomText(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCustomOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!trimmedCustom}
              onClick={() => onSelect(CUSTOM_INTENT_OPTION_ID, trimmedCustom)}
            >
              生成
            </Button>
          </div>
        </div>
      ) : null}

      {result.analysis ? (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer list-none text-muted-foreground">
            判断依据
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
            {result.analysis}
          </p>
        </details>
      ) : null}
    </div>
  )
}
