export const DEFAULT_UI_FONT_FAMILY = "system" as const

export const UI_FONT_OPTIONS = [
  {
    value: "system",
    label: "本机默认",
    cssFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  },
  {
    value: "microsoft-yahei",
    label: "微软雅黑",
    cssFamily: '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", system-ui, sans-serif',
  },
  {
    value: "simsun",
    label: "宋体",
    cssFamily: 'SimSun, "Songti SC", serif',
  },
  {
    value: "kaiti",
    label: "楷体",
    cssFamily: 'KaiTi, "Kaiti SC", serif',
  },
  {
    value: "fangsong",
    label: "仿宋",
    cssFamily: 'FangSong, "Fangsong SC", serif',
  },
  {
    value: "dengxian",
    label: "等线",
    cssFamily: 'DengXian, "Microsoft YaHei", system-ui, sans-serif',
  },
  {
    value: "arial",
    label: "Arial",
    cssFamily: 'Arial, "Microsoft YaHei", system-ui, sans-serif',
  },
] as const

export type UiFontFamily = (typeof UI_FONT_OPTIONS)[number]["value"]

const UI_FONT_FAMILY_VALUES = new Set<string>(UI_FONT_OPTIONS.map((option) => option.value))

export function normalizeUiFontFamily(value: unknown): UiFontFamily {
  return typeof value === "string" && UI_FONT_FAMILY_VALUES.has(value)
    ? (value as UiFontFamily)
    : DEFAULT_UI_FONT_FAMILY
}

export function getUiFontFamilyCss(value: unknown): string {
  const normalized = normalizeUiFontFamily(value)
  return UI_FONT_OPTIONS.find((option) => option.value === normalized)?.cssFamily
    ?? UI_FONT_OPTIONS[0].cssFamily
}

export function applyUiFontFamily(value: unknown, root?: HTMLElement): void {
  if (typeof document === "undefined" && !root) return
  const target = root ?? document.documentElement
  target.style.setProperty("--qmai-ui-font-family", getUiFontFamilyCss(value))
}

/**
 * 界面字号倍率的允许范围（单一来源）。
 *
 * 为什么必须集中定义：这个值原先在两处各自硬编码
 * （`wiki-store.ts` 读取已存值时、`setUiFontSizeScale` 写入时）——
 * 只改一处会造成"设成 150% 后下次启动被读回时截成 130%"这种极难排查的缺陷。
 * 现在两处都引用这里的 clamp，改动只需一处，也不可能再漂移。
 *
 * 范围 80%–150% 由用户确认：下限照顾想缩小界面的用户，
 * 上限与正文字号上限相乘为 1.5 × 1.5 = 2.25 倍（约 40.5px），已实测无裁切。
 */
export const UI_FONT_SIZE_MIN = 0.8
export const UI_FONT_SIZE_MAX = 1.5

/**
 * 把任意输入钳制到允许范围。
 *
 * 无效输入（null / undefined / 空串 / 非有限值）退回默认档 **1**，
 * 而不是被 `Number(null) === 0` 这种隐式转换带到下限 0.8 ——
 * "没有存过值"与"用户想要最小字号"是两件事，不能混为一谈。
 */
export function clampUiFontSizeScale(value: unknown): number {
  if (value === null || value === undefined || value === "") return 1
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(UI_FONT_SIZE_MIN, Math.min(UI_FONT_SIZE_MAX, Number(n.toFixed(2))))
}

/** 界面字号预设。与上面同一份范围定义放在一起，避免与滑块边界脱节。 */
export const UI_FONT_SIZE_PRESETS = [
  { label: "小", value: 0.85 },
  { label: "默认", value: 1 },
  { label: "大", value: 1.25 },
  { label: "特大", value: 1.5 },
] as const
