/**
 * 一个插槽里的一排 action 按钮（`toolbar`）或一列菜单项（`menu`）。
 *
 * 这是插槽的**唯一挂载组件**：宿主各处（章节工具栏、大纲工具栏、右键菜单…）
 * 只需要给一份 `SlotActionEntry[]`，剩下的"点开对话框、跑表单、流式生成、
 * 执行 targets"都在这里收口。挂载点因此只有一行 JSX，不会把生成逻辑复制到
 * 每个页面里（复制三份之后必然只有一份被修）。
 *
 * 为什么插槽里不出现任何插件自带的标记：见 `slots.ts` 文件头（XSS 面）。
 */
import { useMemo, useState } from "react"
import { createDefaultRunDeps } from "@/lib/plugins/declarative/api"
import type { RunActionDeps } from "@/lib/plugins/declarative/run"
import type { SlotActionEntry } from "@/lib/plugins/slots"
import { cn } from "@/lib/utils"
import { ActionButton } from "./ActionButton"
import { ActionDialog, defaultTargetApplier, type TargetApplier } from "./ActionDialog"

export interface SlotActionsProps {
  entries: SlotActionEntry[]
  variant?: "toolbar" | "menu"
  /** 执行依赖（模型调用器、项目读取…）；不传则用"未接线"的默认实现。 */
  deps?: RunActionDeps
  /** 目标执行器；不传则只支持剪贴板（见 `defaultTargetApplier`）。 */
  onApplyTarget?: TargetApplier
  editorAvailable?: boolean
  className?: string
}

export function SlotActions({
  entries,
  variant = "toolbar",
  deps,
  onApplyTarget,
  editorAvailable = false,
  className,
}: SlotActionsProps) {
  const [active, setActive] = useState<SlotActionEntry | null>(null)

  // 默认依赖只造一次：每次渲染都新建会让 ActionDialog 的 useEffect 依赖抖动。
  const fallbackDeps = useMemo(() => createDefaultRunDeps(), [])
  const resolvedDeps = deps ?? fallbackDeps

  // 插槽为空时什么都不渲染：不留一格空白，也不留"暂无"之类的噪音文案
  // （空插槽是常态，宿主工具栏不该被插件系统占位）。
  if (entries.length === 0) return null

  const showPluginName = entries.length > 1

  return (
    <>
      <div
        className={cn(variant === "toolbar" ? "flex flex-wrap items-center gap-1" : "flex flex-col", className)}
        role={variant === "menu" ? "menu" : undefined}
        data-plugin-slot-actions={variant}
        data-plugin-slot-count={entries.length}
      >
        {entries.map((entry) => (
          <ActionButton
            key={`${entry.pluginId}:${entry.action.id}`}
            entry={entry}
            variant={variant}
            showPluginName={showPluginName}
            onClick={() => setActive(entry)}
          />
        ))}
      </div>

      {active ? (
        <ActionDialog
          open
          entry={active}
          onClose={() => setActive(null)}
          deps={resolvedDeps}
          onApplyTarget={onApplyTarget ?? defaultTargetApplier}
          editorAvailable={editorAvailable}
        />
      ) : null}
    </>
  )
}
