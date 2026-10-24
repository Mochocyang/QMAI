/**
 * 通用开关（role="switch"）。
 *
 * 沿用设置页既有的 `.model-switch` 视觉（36×21 胶囊 + 滑块），
 * 不新造一套外观；后续其他手写开关可以逐步收编到这里。
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

export function Switch({ checked, onChange, disabled, label, className, "data-ui": dataUi }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-ui={dataUi}
      onClick={() => onChange(!checked)}
      className={cn("model-switch cursor-pointer disabled:cursor-not-allowed disabled:opacity-50", className)}
    >
      <span />
    </button>
  )
}
