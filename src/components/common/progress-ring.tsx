import { cn } from "@/lib/utils"

export interface ProgressRingProps {
  /** 完成率。大于 1 会画满一圈，负数按 0 处理。 */
  ratio: number
  /** 直径（px）。底部状态栏用 30 左右，比 22 的上下文环更大以便看清数字。 */
  size?: number
  strokeWidth?: number
  /** 环内文字。省略则不画文字。 */
  label?: string
  /** 环内文字字号（px）。默认按 `size` 推算。 */
  fontSize?: number
  className?: string
  /** 无障碍名称；环本身是图形，读屏需要一句人话。 */
  title?: string
}

/**
 * 完成率圆环。
 *
 * 从 `context-usage-ring` 里的那段 SVG 几何抽出来复用：那里只有上下文用量一个
 * 调用点，而它把「画环」和「上下文业务」揉在了一起，直接照抄会出现第二份
 * `2 * Math.PI * radius`。这里只保留几何 + 文字，颜色由调用方通过 className
 * 或 `stroke` 决定，因为「多少算达标」是业务判断。
 */
export function ProgressRing({
  ratio,
  size = 30,
  strokeWidth = 3,
  label,
  fontSize,
  className,
  title,
}: ProgressRingProps) {
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0
  const clamped = Math.min(1, safeRatio)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {label === undefined ? null : (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={fontSize ?? Math.round(size * 0.34)}
          fill="currentColor"
          // 环内数字不参与「完成率」的读屏朗读，上面已经用 title 说清楚了。
          aria-hidden="true"
        >
          {label}
        </text>
      )}
    </svg>
  )
}
