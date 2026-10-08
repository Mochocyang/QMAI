import {
  SYSTEM_FONT_PREFIX,
  systemBodyFontCss,
  systemFontCss,
  systemFontNameOf,
} from "@/lib/system-fonts"

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
 *
 * ── 与 `BODY_FONT_OPTIONS` 里同名项的回退链**刻意不同** ──
 * 本表比正文表多若干只在别的平台才可能存在的次选（`STKaiti` / `STFangsong` /
 * `Noto Serif SC` 等）：界面字体要跨平台尽量命中，多一个不会命中的回退项零成本；
 * 正文表更看重衬线连续性，故宁可早收通用族。逐条对照与理由见
 * `BODY_FONT_OPTIONS` 上方注释 —— 那是**设计**，不是漂移，不要抽公共常量合并。
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

export type BuiltinUiFontFamily = (typeof UI_FONT_OPTIONS)[number]["value"]

/**
 * 界面字体的合法取值：内置 id，或阶段 3 枚举来的 `sys:<族名>`。
 *
 * 用模板字面量类型而不是裸 `string`：`sys:` 之外的任意字符串仍是类型错误，
 * 于是"存了个手写的字体名"这种写法在编译期就会被拦下，
 * 而动态字体仍然能安全地流经同一个类型。
 */
export type UiFontFamily = BuiltinUiFontFamily | `sys:${string}`

const UI_FONT_FAMILY_VALUES = new Set<string>(UI_FONT_OPTIONS.map((option) => option.value))

/** 内置默认档的字体栈。动态字体找不到时回退到它，避免掉进"空字体"。 */
const UI_FONT_FALLBACK_STACK = UI_FONT_OPTIONS[0].cssFamily

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
 *
 * ── 阶段 3 追加：动态字体值 ──
 * `sys:<族名>` 也合法，但**族名必须通过清理**（见 `systemFonts.ts`）：
 * 存到本地的值可能来自旧版本或被手工改过，`sys:Foo"Bar` 这种东西必须被拒，
 * 否则它会把 `--qmai-ui-font-family` 的值提前闭合。清理不通过时同样回退默认档。
 */
export function normalizeUiFontFamily(value: unknown): UiFontFamily {
  if (typeof value === "string" && UI_FONT_FAMILY_VALUES.has(value)) {
    return value as BuiltinUiFontFamily
  }
  const sysName = systemFontNameOf(value)
  if (sysName) return `${SYSTEM_FONT_PREFIX}${sysName}` as UiFontFamily
  return DEFAULT_UI_FONT_FAMILY
}

export function getUiFontFamilyCss(value: unknown): string {
  const normalized = normalizeUiFontFamily(value)
  // 动态字体：族名进栈，尾链与默认档一致（见 systemFontCss 的说明）
  const sysCss = systemFontCss(normalized)
  if (sysCss) return sysCss
  return UI_FONT_OPTIONS.find((option) => option.value === normalized)?.cssFamily
    ?? UI_FONT_FALLBACK_STACK
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
 *
 * ── 为什么下面几条的回退链与 `UI_FONT_OPTIONS` 里同名项不一样（刻意，不是漂移）──
 * 实测两组确实不同，且**只应不同**，不要抽公共常量合并：
 *   · 宋体    界面 `SimSun, "Songti SC", "Noto Serif SC", serif`
 *             正文 `SimSun, "Songti SC", serif`
 *   · 楷体    界面 `KaiTi, "Kaiti SC", "STKaiti", serif`   正文 `KaiTi, "Kaiti SC", serif`
 *   · 仿宋    界面 `FangSong, "Fangsong SC", "STFangsong", serif`
 *             正文 `FangSong, "Fangsong SC", serif`
 *   · 微软雅黑 界面 `"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", system-ui, sans-serif`
 *             正文 `"Microsoft YaHei", "Microsoft YaHei UI", system-ui, sans-serif`
 *   （新宋体两边恰好相同，是巧合而非约束。）
 * 两条依据：
 *   ① **界面表要多铺一层跨平台次选**（`STKaiti` / `STFangsong` / `Noto Serif SC`
 *      这类只在别的平台或"阶段 4 随安装包分发"之后才存在的名字）。
 *      界面文字的诉求是"在任何机器上都尽量命中一个像样的中文字形"，
 *      多一个不会命中的回退项零成本；而正文表更看重**衬线连续性** ——
 *      正文是写作软件的主体，楷体/仿宋/宋体之间来回跳一次字形，
 *      读者对整篇文档的观感就断了，所以正文宁可用通用族收尾，
 *      也不为了"多一层保险"把风格不同的字体塞进回退链。
 *   ② **微软雅黑一项的方向相反**：界面表用「微软正黑体（繁体，同样带简体字形）」
 *      作次选，因为它要在雅黑缺失时保住"无衬线现代中文字形"这一观感；
 *      正文表用「Microsoft YaHei UI」作次选，因为正文默认是宋体系，
 *      用户特地选雅黑时是要"正文换成无衬线"，UI 变体是最贴近的同族回退。
 * 读者据此可判断：两表不同是设计，谁把某一项"对齐"过去，就改变了那边的回退语义。
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

export type BuiltinBodyFontFamily = (typeof BODY_FONT_OPTIONS)[number]["value"]

/**
 * 正文字体的合法取值：内置 id，或阶段 3 枚举来的 `sys:<族名>`。
 * 与 `UiFontFamily` 同构（理由见那里）。
 */
export type BodyFontFamily = BuiltinBodyFontFamily | `sys:${string}`

const BODY_FONT_FAMILY_VALUES = new Set<string>(BODY_FONT_OPTIONS.map((option) => option.value))

export function normalizeBodyFontFamily(value: unknown): BodyFontFamily {
  if (typeof value === "string" && BODY_FONT_FAMILY_VALUES.has(value)) {
    return value as BuiltinBodyFontFamily
  }
  // 动态族名同样必须通过清理（存到本地的值不可信）
  const sysName = systemFontNameOf(value)
  if (sysName) return `${SYSTEM_FONT_PREFIX}${sysName}` as BodyFontFamily
  return DEFAULT_BODY_FONT_FAMILY
}

export function getBodyFontFamilyCss(value: unknown): string {
  const normalized = normalizeBodyFontFamily(value)
  // 动态字体走衬线尾链（正文默认是宋体系，掉到黑体是静默视觉回归）
  const sysCss = systemBodyFontCss(normalized)
  if (sysCss) return sysCss
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

/* ────────────────────────── 正文排版参数（字号 / 行距 / 字距 / 边距 / 安全距离） ────────────────────────── */

/**
 * 正文字号的允许范围（单位 px，绝对值）。
 *
 * ── 为什么从「倍数」改成「px」──
 * 旧模型是 `calc(1.125rem * var(--qmai-body-font-scale, 1))`：
 * 正文字号 = 界面字号 × 正文倍数。用户找不到「我要 15px」这个动作
 * —— 只有 85%/100%/125%/150% 四档百分比，且改界面字号会连带改正文。
 * 现在正文是绝对 px，与界面字号彻底解耦（用户已确认接受这一代价）。
 *
 * 上限 32px 低于旧模型的理论上限 40.5px（18 × 1.5 × 1.5），
 * 故裁切 / 溢出风险是**下降**的，不是上升。
 */
export const BODY_FONT_PX_MIN = 12
export const BODY_FONT_PX_MAX = 32
export const DEFAULT_BODY_FONT_PX = 18

/** 旧倍数 → 新 px 的换算基准：倍数 1 等于改造前的 18px。 */
export const BODY_FONT_PX_BASE = 18

/**
 * 把任意输入钳到字号范围并取整。
 *
 * 无效输入退回默认档，而不是被 `Number(null) === 0` 带到下限：
 * 「没有存过值」与「用户想要最小字号」是两件事，不能混为一谈
 * （这条是仓库里已有的教训，与 clampScale 的处理保持一致）。
 */
export function clampBodyFontPx(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_BODY_FONT_PX
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_BODY_FONT_PX
  return Math.max(BODY_FONT_PX_MIN, Math.min(BODY_FONT_PX_MAX, Math.round(n)))
}

/**
 * 旧「正文倍数」一次性迁移成 px。
 *
 * 只在读不到新键时调用，并且**不删除**旧键 —— 用户回滚到旧版本时，
 * 旧设置仍然在。映射：0.85→15 / 1→18 / 1.25→23 / 1.5→27。
 * 用 round：1.25 × 18 = 22.5，取 23 与设置页旧文案的量级一致；
 * 0.85 × 18 = 15.3，取 15（下限档）。
 */
export function bodyFontPxFromScale(scale: unknown): number {
  const n = Number(scale)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BODY_FONT_PX
  return clampBodyFontPx(n * BODY_FONT_PX_BASE)
}

/** 正文字号预设（px）。滑块仍可任意取值，这些只是快速点选。 */
export const BODY_FONT_PX_PRESETS = [
  { label: "小", value: 15 },
  { label: "默认", value: 18 },
  { label: "大", value: 21 },
  { label: "特大", value: 24 },
] as const

/**
 * 行间距范围（无单位倍数）。
 *
 * 必须是**无单位**数字：带单位（如 32px）会让行高不随字号变化，
 * 用户调大字号后行距被"吃掉"、文字挤在一起。
 * 下限 1.2 是「紧凑但可读」的经验下限，上限 2.6 再往上单屏放不下几行。
 */
export const BODY_LINE_HEIGHT_MIN = 1.2
export const BODY_LINE_HEIGHT_MAX = 2.6
export const DEFAULT_BODY_LINE_HEIGHT = 1.95

export function clampBodyLineHeight(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_BODY_LINE_HEIGHT
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_BODY_LINE_HEIGHT
  // 两位小数：滑块步长 0.05，两位足够；同时避免浮点误差反复漂移
  return Math.max(BODY_LINE_HEIGHT_MIN, Math.min(BODY_LINE_HEIGHT_MAX, Number(n.toFixed(2))))
}

/**
 * 字间距范围（px）。
 *
 * 允许负值：中文排版里轻微收紧（-0.5px）能让密排的宋体更整齐，
 * 这是真实存在的排版诉求，不是笔误。
 */
export const BODY_LETTER_SPACING_MIN = -1
export const BODY_LETTER_SPACING_MAX = 6
export const DEFAULT_BODY_LETTER_SPACING = 0

export function clampBodyLetterSpacing(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_BODY_LETTER_SPACING
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_BODY_LETTER_SPACING
  return Math.max(BODY_LETTER_SPACING_MIN, Math.min(BODY_LETTER_SPACING_MAX, Number(n.toFixed(1))))
}

/**
 * 左右边距范围（px）。`null` 是一个**有意义的取值**：跟随窗口。
 *
 * 改造前正文两侧的间距是响应式的 `clamp(20px, 4vw, 48px)`。
 * 若把默认值直接定成某个固定 px，所有现有用户打开后版面都会变 ——
 * 那是一次没人要求的视觉回归。所以默认是 null：不写这个变量，
 * 让 CSS 的 clamp 兜底，行为与改造前逐位相同；用户拖动滑块之后才固定。
 */
export const BODY_MARGIN_X_MIN = 0
export const BODY_MARGIN_X_MAX = 160
export const DEFAULT_BODY_MARGIN_X: number | null = null

export function clampBodyMarginX(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(BODY_MARGIN_X_MIN, Math.min(BODY_MARGIN_X_MAX, Math.round(n)))
}

/**
 * 底部安全距离范围（px）。
 *
 * 这是用户报的核心不适感：写作时当前行总贴在窗口最下沿，视线被迫一直在最下面。
 * 默认 51px 是用户确认的值（改造前是写死的 36px，窄屏还有条 28px 覆盖）。
 */
export const BODY_SAFE_BOTTOM_MIN = 0
export const BODY_SAFE_BOTTOM_MAX = 240
export const DEFAULT_BODY_SAFE_BOTTOM = 51

export function clampBodySafeBottom(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_BODY_SAFE_BOTTOM
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_BODY_SAFE_BOTTOM
  return Math.max(BODY_SAFE_BOTTOM_MIN, Math.min(BODY_SAFE_BOTTOM_MAX, Math.round(n)))
}

export interface BodyTypographySettings {
  fontPx: number
  lineHeight: number
  letterSpacing: number
  /** null = 跟随窗口，见 clampBodyMarginX 上方说明。 */
  marginX: number | null
  safeBottom: number
}

/**
 * 把 5 个排版参数写到 `documentElement` 的行内样式。
 *
 * ── 变量命名与那条「不能重复声明」的约束 ──
 * 这里写的 5 个变量（--qmai-body-font-px / --qmai-body-leading /
 * --qmai-body-letter-spacing / --qmai-body-margin-x / --qmai-body-safe-bottom）
 * 是**用户值的唯一入口**，`ui-test.css` 里**不得**再为它们声明字面量默认值。
 *
 * 原因：`.ui-test-root` 比 `html` 更靠近正文。若在 `.ui-test-root` 块里也声明
 * 同名变量，就会盖掉这里写的行内样式，表现为「设置保存了但界面不变」。
 * CSS 侧因此一律写成 `var(--qmai-body-xxx, 兜底值)`。
 * （旧代码的 --qmai-body-font-scale 没这个问题，因为字体栈那条读的是
 *   **继承**下来的值，而这里读的是**本元素自己的**声明。）
 *
 * marginX 为 null 时**移除**该属性：留着空字符串同样会盖掉 CSS 的 clamp。
 */
export function applyBodyTypography(settings: BodyTypographySettings, root?: HTMLElement): void {
  if (typeof document === "undefined" && !root) return
  const target = root ?? document.documentElement
  target.style.setProperty("--qmai-body-font-px", `${clampBodyFontPx(settings.fontPx)}px`)
  target.style.setProperty("--qmai-body-leading", String(clampBodyLineHeight(settings.lineHeight)))
  target.style.setProperty("--qmai-body-letter-spacing", `${clampBodyLetterSpacing(settings.letterSpacing)}px`)
  target.style.setProperty("--qmai-body-safe-bottom", `${clampBodySafeBottom(settings.safeBottom)}px`)
  const marginX = clampBodyMarginX(settings.marginX)
  if (marginX === null) target.style.removeProperty("--qmai-body-margin-x")
  else target.style.setProperty("--qmai-body-margin-x", `${marginX}px`)
}
