/**
 * 插槽里的单个 action 按钮。
 *
 * 两种形态（设计 §4.2 / §6.1）：
 *   - `toolbar`：工具栏里的一排小按钮（图标 + 标题）
 *   - `menu`：右键菜单里的一行（标题 + 来源插件）
 *
 * **为什么一定要显示/隐藏"来源插件"而不是永远显示**：只有一个 action 时，
 * 用户点的是"生成书名"，插件名是噪音；并列多个插件时才需要区分来源
 * （否则"两个生成书名"到底是谁的？）。判断放在 `showPluginName` 上，由调用方
 * （`SlotActions`）按条目数量决定。
 */
import { Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SlotActionEntry } from "@/lib/plugins/slots"

export interface ActionButtonProps {
  entry: SlotActionEntry
  onClick: () => void
  variant?: "toolbar" | "menu"
  /** 是否在按钮上补一行/一段来源插件说明（多插件并列时打开）。 */
  showPluginName?: boolean
  disabled?: boolean
  /** 禁用原因（同时用作 tooltip，避免"按钮灰着但不知道为什么"）。 */
  disabledReason?: string
}

/** 按钮的悬停说明：把标题、来源、作者写的描述拼一句，够用且不会太长。 */
export function describeActionEntry(entry: SlotActionEntry, showPluginName: boolean): string {
  const parts = [entry.action.title]
  if (entry.action.description) parts.push(entry.action.description)
  if (showPluginName) parts.push(`来自插件「${entry.pluginName}」`)
  return parts.join(" · ")
}

export function ActionButton({
  entry,
  onClick,
  variant = "toolbar",
  showPluginName = false,
  disabled = false,
  disabledReason,
}: ActionButtonProps) {
  const tooltip = disabled && disabledReason ? disabledReason : describeActionEntry(entry, showPluginName)

  if (variant === "menu") {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        title={tooltip}
        data-plugin-action={entry.action.id}
        data-plugin-id={entry.pluginId}
        className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Puzzle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.action.title}</span>
        </span>
        {showPluginName ? (
          <span className="shrink-0 text-[0.625rem] text-muted-foreground">{entry.pluginName}</span>
        ) : null}
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      data-plugin-action={entry.action.id}
      data-plugin-id={entry.pluginId}
    >
      <Puzzle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{entry.action.title}</span>
    </Button>
  )
}
