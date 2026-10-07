export const DEFAULT_UI_FONT_FAMILY = "system" as const

/**
 * 界面字体选项。
 *
 * ── 产品决定：只列中文字体，不列纯拉丁字体 ──
 * 用户明确要求「只能选择中文字体库，不能选择英文字体库」。
 * 技术上这也是唯一说得通的做法：纯拉丁字体对中文界面文字毫无作用，
 * 中文仍会回退到系统字体，用户看到的就是"选了没反应"——
 * 正是本次修复要根除的病症。因此原先的 Arial 选项已删除，
 * 旧配置里存着的 "arial" 会平滑回退到默认档（见 normalizeUiFontFamily 上方说明）。
 *
 * ── 每一项的字体栈为什么是这个顺序 ──
 * 一律三段式：
 *   ① 打头的是**本机实测可用**的那个字体名（证据见
 *      docs/font-scaling-fix-20261007/probe-installed-fonts.mjs 的实测表）。
 *      中文名可用就写中文名，不可用就必须写英文名 ——
 *      「微软正黑体」就是只能写英文名 `Microsoft JhengHei` 的例子：
 *      实测本机中文名「微软正黑体」不可用（三基准均无变化），
 *      英文名可用（渲染为「微軟正黑體」）。
 *      所以本文件的规矩是「以实测可用的名字为准」，不是「以好看的中文名为准」。
 *   ② 中间放 macOS 自带字体、以及阶段 4 将随安装包分发的开源字体，作跨平台次选。
 *   ③ 必须用通用族（serif / sans-serif）收尾：连次选都没有时，
 *      回退到哪里应该是浏览器可预期的，而不是又一次"什么都没生效"。
 *
 * ── 为什么没有「苹方（PingFang SC）」这一项 ──
 * 实测苹方在 Windows 上不可用（三基准均无变化），选中后必然静默回退，
 * 那正是本次要修的病症。它与「思源黑体 / 思源宋体」的区别是
 * **可预期的未来可用 vs 永远不可用**，这就是本次取舍的依据：
 *   · 思源系列是 OFL 授权的开源字体，阶段 4 会随安装包分发，届时所有用户都会有，
 *     现在就列出来是面向未来的（本机碰巧已装，故今天实测也可用）；
 *   · 苹方是 Apple 专有字体，在 Windows 上**永远不会存在**，只能交给后续
 *     「读取本机已安装字体」的枚举功能在 macOS 上自动列出。
 * 注意苹方仍出现在下面若干项的栈里作为**回退项** —— 那是 macOS 上的正确取值，
 * 与「把它列成一个用户可选项」是两回事。
 */
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
  /*
   * 微软雅黑。实测本机可用（Microsoft YaHei / Microsoft YaHei UI 均可用）。
   * 次选微软正黑体：繁体中文用户装的是它，且同样带简体字形，
   * 是 Windows 上雅黑之外最合理的备选。
   * "PingFang SC" 给 macOS 用；通用族收尾。
   */
  {
    value: "microsoft-yahei",
    label: "微软雅黑",
    cssFamily: '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", system-ui, sans-serif',
  },
  /*
   * 微软正黑体。**必须写英文名 `Microsoft JhengHei`**：
   * 实测本机中文名「微软正黑体」不可用（三基准均无变化），
   * 而英文名可用（Chromium 报告的真实渲染族为「微軟正黑體」）。
   * 写中文名就等于给用户一个"选了没反应"的选项。
   */
  {
    value: "microsoft-jhenghei",
    label: "微软正黑体",
    cssFamily: '"Microsoft JhengHei", "Microsoft YaHei", system-ui, sans-serif',
  },
  /*
   * 黑体。实测本机可用（SimHei）。
   * "Heiti SC" 是 macOS 上的对应黑体；微软雅黑作最后的中文兜底
   * （它没有衬线、观感上仍属黑体一路），故这里不收 serif 通用族。
   */
  {
    value: "simhei",
    label: "黑体",
    cssFamily: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif',
  },
  /*
   * 宋体。实测本机可用（SimSun）。
   * "Songti SC" 是 macOS 对应项；思源宋体（Noto Serif SC）作开源兜底，
   * 与正文字体默认栈同一族，跨机器表现最稳定。
   */
  {
    value: "simsun",
    label: "宋体",
    cssFamily: 'SimSun, "Songti SC", "Noto Serif SC", serif',
  },
  /*
   * 新宋体。实测本机可用（NSimSun）—— 注意本机 `monospace` 的默认回退
   * 恰好就是 NSimSun，单基准对照法会把它误判为不可用，是改用三基准才纠正的
   * （见 probe-installed-fonts.mjs 头注释）。这里如实列出。
   * 它是等宽宋体，故回退仍走 SimSun → 宋体系。
   */
  {
    value: "nsimsun",
    label: "新宋体",
    cssFamily: 'NSimSun, SimSun, "Songti SC", serif',
  },
  /*
   * 楷体。实测本机可用（KaiTi）。
   * "Kaiti SC" / "STKaiti" 覆盖 macOS；楷体属衬线一路，故收 serif。
   */
  {
    value: "kaiti",
    label: "楷体",
    cssFamily: 'KaiTi, "Kaiti SC", "STKaiti", serif',
  },
  /*
   * 仿宋。实测本机可用（FangSong）。
   * "Fangsong SC" / "STFangsong" 覆盖 macOS。
   */
  {
    value: "fangsong",
    label: "仿宋",
    cssFamily: 'FangSong, "Fangsong SC", "STFangsong", serif',
  },
  /*
   * 等线。实测本机可用（DengXian）。
   * 它是无衬线体，本机没有对应的话退到微软雅黑比退到通用 sans-serif 更接近
   * 用户点这个选项时的预期（等线与雅黑都是 Windows 现代中文字形）。
   */
  {
    value: "dengxian",
    label: "等线",
    cssFamily: 'DengXian, "Microsoft YaHei", system-ui, sans-serif',
  },
  /*
   * 思源黑体。实测本机可用（Noto Sans SC）。
   * 注意 "Source Han Sans SC" 是本机实测**不可用**的旧名（三基准均无变化）——
   * 它作为第二项留着是为了兼容已装了 Adobe 原版 Source Han 的机器，
   * 本机命中的始终是打头的 Noto Sans SC。与苹方不同，思源系列是 OFL 开源字体，
   * 阶段 4 会随安装包分发，所以不存在"永远没有"的风险。
   */
  {
    value: "noto-sans",
    label: "思源黑体",
    cssFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  },
  /*
   * 思源宋体。实测本机可用（Noto Serif SC）。第二项 "Source Han Serif SC"
   * 是 Adobe 原版名，本机实测同样可用（渲染族报告为 Source Han Serif SC Heavy），
   * 故两者都能真正命中，不属"列了没用"的名字。
   * 与正文字体默认栈同族，是跨机器最稳的宋体系选项。
   */
  {
    value: "noto-serif",
    label: "思源宋体",
    cssFamily: '"Noto Serif SC", "Source Han Serif SC", SimSun, serif',
  },
] as const

export type UiFontFamily = (typeof UI_FONT_OPTIONS)[number]["value"]

const UI_FONT_FAMILY_VALUES = new Set<string>(UI_FONT_OPTIONS.map((option) => option.value))

/**
 * 把任意已存/传入的取值归一化到合法选项；无法识别的一律退回默认档。
 *
 * ── 迁移说明：`"arial"` 不再合法，旧值会平滑回退 ──
 * Arial 选项已随「只列中文字体」这条产品决定（用户原话：
 * 「只能选择中文字体库，不能选择英文字体库」）被移除。
 * 因此老用户配置里存着的 `"arial"` 走到这里会命中 `else` 分支、
 * 返回 `DEFAULT_UI_FONT_FAMILY`（"system"）—— 这是**预期行为，不是缺陷**：
 *   · 它不抛错、不产生空字体，界面照常渲染，不会出现"字体失效"的观感；
 *   · `applyUiFontFamily` 用的是同一个归一化结果，所以设置页显示"本机默认"
 *     与实际生效的字体栈一定一致，不会出现"显示 A、实际 B"的错位；
 *   · Arial 本就不该出现在这里：它不对中文生效，用户当初选中它时
 *     中文界面文字其实一直是回退字体 —— 回退到默认档只是把既成事实写明。
 * 这条行为由 `font-settings.spec.ts` 的
 * 「旧值 arial 平滑回退到默认，不抛错」一条钉住。
 */
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
function clampScale(value: unknown, min: number, max: number): number {
  if (value === null || value === undefined || value === "") return 1
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(min, Math.min(max, Number(n.toFixed(2))))
}

export function clampUiFontSizeScale(value: unknown): number {
  return clampScale(value, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX)
}

/** 界面字号预设。与上面同一份范围定义放在一起，避免与滑块边界脱节。 */
export const UI_FONT_SIZE_PRESETS = [
  { label: "小", value: 0.85 },
  { label: "默认", value: 1 },
  { label: "大", value: 1.25 },
  { label: "特大", value: 1.5 },
] as const

/**
 * 正文字号倍率的允许范围（与界面字号**独立**的一份定义）。
 *
 * 为什么不能与界面字号共用常量：下限不同 —— 界面下限 80% 是为了
 * 让想缩小界面的用户能更小；正文下限 85% 是因为正文再小就影响阅读，
 * 而正文是写作软件的核心内容。共用会让其中一个被迫迁就另一个。
 *
 * 上下限相乘的语义：文档最终字号 = 界面字号 × 正文字号。
 * 上限 1.5 × 1.5 = 2.25 倍（正文 18px → 约 40.5px），
 * 该组合已实测无裁切、无溢出（见 overflow 报告）。
 */
export const BODY_FONT_SIZE_MIN = 0.85
export const BODY_FONT_SIZE_MAX = 1.5
export const DEFAULT_BODY_FONT_SIZE_SCALE = 1

export function clampBodyFontSizeScale(value: unknown): number {
  return clampScale(value, BODY_FONT_SIZE_MIN, BODY_FONT_SIZE_MAX)
}

/** 正文字号预设。85% 是下限档，故没有单独的"小"档位。 */
export const BODY_FONT_SIZE_PRESETS = [
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
