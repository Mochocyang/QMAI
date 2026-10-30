/**
 * 通用开关（role="switch"）。
 *
 * ── 为什么样式写在这里，而不是靠 `.model-switch` 那个全局类 ──────────────
 * 早先它只挂 `className="model-switch"`，而那套样式定义在
 * `components/uitest/models/model-settings.css` 里 —— **没有全局引入**，
 * 只在少数设置页组件里局部 `import`。
 *
 * 于是任何"没顺手 import 那个 css"的调用方，拿到的都是一个**零尺寸的隐形按钮**：
 * 功能是好的、DOM 也在，但用户完全看不见。插件页的「已安装」行就正是这样——
 * 开关明明渲染了，截图上却只有一个「⋯」。
 *
 * 现在改用 Tailwind（项目全局启用）自带尺寸与配色，调用方不需要记得 import
 * 任何东西。视觉仍是 36×21 胶囊 + 滑块，与设置页那套一致。
 */

import { cn } from "@/lib/utils"

export interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  className?: string
  "data-ui"?: string
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
  "data-ui": dataUi,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-ui={dataUi}
      onClick={() => onChange(!checked)}
      className={cn(
        // 尺寸与圆角：36×21 胶囊（与设置页 `.model-switch` 一致）
        "inline-flex h-[21px] w-9 shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors",
        // 轨道颜色：开=主色，关=中性底
        checked ? "bg-primary" : "bg-muted-foreground/30",
        // 滑块：靠 flex 的两端对齐来移动，避免再算一次 translate
        checked ? "justify-end" : "justify-start",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // 键盘可达性：焦点环
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className,
      )}
    >
      <span className="block h-[15px] w-[15px] rounded-full bg-background shadow-sm transition-transform" />
    </button>
  )
}
