export const DEFAULT_UI_FONT_FAMILY = "system" as const

export const UI_FONT_OPTIONS = [
  {
    value: "system",
    label: "本机默认",
    /*
     * 这个栈必须与改造前 `ui-test.css` 里 `--ui` 的取值**逐字一致**。
     *
     * 原因：`--ui` 现在派生自 `--qmai-ui-font-family`（见 ui-test.css），
     * 而本项就是默认选中项。若这里换成另一套顺序（例如把 system-ui 提到
     * "PingFang SC" 之前），默认档渲染出的字形就会改变 ——
     * 用户没有做任何选择，界面却变了样，属视觉回归。
     *
     * 保留 "Microsoft YaHei UI"：它属于旧栈，在 Windows 上正是实际命中的
     * 那一个（"PingFang SC" 是 macOS 字体，本机没有，会继续往下回退）。
     * 去掉它会让默认档从「微软雅黑 UI」变成别的字形。
     * 已由 verify-ui-font-applies.mjs --compare 守住"默认档指纹不变"。
     */
    cssFamily:
      '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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

/* ────────────────────────── 正文字体（独立于界面字体） ────────────────────────── */

export const DEFAULT_BODY_FONT_FAMILY = "serif-default" as const

/**
 * 正文字体选项。与界面字体**完全独立**：写的是另一个 CSS 变量
 * （`--qmai-body-font-family`），用户改其中任一个都不会影响另一个。
 *
 * 为什么需要它：`--serif`（正文衬线层）原先是一套固定字体栈，
 * 用户想换正文观感只能忍受系统默认。现在集中在这里配置。
 *
 * 约定：只列中文字体（与界面字体同一条产品决定）。列出 Arial 这类西文字体时，
 * 中文仍会回退到系统字体，用户会觉得"选了没用"。
 */
export const BODY_FONT_OPTIONS = [
  {
    value: "serif-default",
    label: "默认（宋体系）",
    // 必须与改造前 ui-test.css 里 --serif 的取值逐字一致，
    // 否则默认档的正文与共用 --serif 的几个标题会换字形。
    cssFamily: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  },
  {
    value: "follow-ui",
    label: "跟随界面字体",
    /*
     * 必须是**变量引用**，不能把界面字体的栈复制一份：
     * 复制来的副本在用户之后修改界面字体时不会跟着变，
     * 表现为"我选了跟随界面字体，但界面字体改了它却没变"。
     */
    cssFamily: "var(--qmai-ui-font-family)",
  },
  { value: "simsun", label: "宋体", cssFamily: 'SimSun, "Songti SC", serif' },
  { value: "nsimsun", label: "新宋体", cssFamily: 'NSimSun, SimSun, "Songti SC", serif' },
  { value: "kaiti", label: "楷体", cssFamily: 'KaiTi, "Kaiti SC", serif' },
  { value: "fangsong", label: "仿宋", cssFamily: 'FangSong, "Fangsong SC", serif' },
  {
    value: "source-han-serif",
    label: "思源宋体",
    cssFamily: '"Source Han Serif SC", "Noto Serif SC", SimSun, serif',
  },
  {
    value: "source-han-sans",
    label: "思源黑体",
    cssFamily: '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  {
    value: "microsoft-yahei",
    label: "微软雅黑",
    cssFamily: '"Microsoft YaHei", "Microsoft YaHei UI", system-ui, sans-serif',
  },
] as const

export type BodyFontFamily = (typeof BODY_FONT_OPTIONS)[number]["value"]

const BODY_FONT_FAMILY_VALUES = new Set<string>(BODY_FONT_OPTIONS.map((option) => option.value))

export function normalizeBodyFontFamily(value: unknown): BodyFontFamily {
  return typeof value === "string" && BODY_FONT_FAMILY_VALUES.has(value)
    ? (value as BodyFontFamily)
    : DEFAULT_BODY_FONT_FAMILY
}

export function getBodyFontFamilyCss(value: unknown): string {
  const normalized = normalizeBodyFontFamily(value)
  return BODY_FONT_OPTIONS.find((option) => option.value === normalized)?.cssFamily
    ?? BODY_FONT_OPTIONS[0].cssFamily
}

/**
 * 只写 `--qmai-body-font-family`，**绝不触碰** `--qmai-ui-font-family`。
 * 两者互不干扰是用户明确确认的边界（`ui-test.css` 的 `--serif` 从前者派生）。
 */
export function applyBodyFontFamily(value: unknown, root?: HTMLElement): void {
  if (typeof document === "undefined" && !root) return
  const target = root ?? document.documentElement
  target.style.setProperty("--qmai-body-font-family", getBodyFontFamilyCss(value))
}
