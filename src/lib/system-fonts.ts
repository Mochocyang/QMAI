/**
 * 阶段 3：本机已安装的**中文字体**（由 Rust 侧 DirectWrite 枚举提供）。
 *
 * ── 为什么要有这个模块 ──
 * 用户要求两种字体来源：
 *   ① 读取本机已安装的字体（**只列中文，不列英文**）；
 *   ② 随安装包分发常见写作字体。
 * 本模块负责 ①。它解决的是本次修复的原始病症：下拉里列一个本机没有的字体，
 * 用户选中后浏览器**静默回退**，观感就是"选了没反应"。
 * 由真实枚举驱动的列表不可能出现这种项。
 *
 * ── 为什么判定放在 Rust 侧 ──
 * CSS 无法枚举系统字体。前端只能"写个字体名再看文本宽度变不变"来试探，
 * 那种探测既不可靠（度量相近的字体测不出差别，正文里已验证过一次同类失败）
 * 又昂贵（每个候选一次布局+测量）。DirectWrite 能直接回答"这个族有没有这个字"。
 *
 * ── 值的表示法：`sys:` 前缀 ──
 * 内置选项用固定的 id（`microsoft-yahei`…）。枚举来的字体没有固定 id，
 * 故用 `sys:<族名>` 作为持久化取值。这样做的三个好处：
 *   · **自描述**：存的值本身就说明了字体从哪来，读日志/读存储时不必查表；
 *   · **归一化保持纯函数**：`normalizeUiFontFamily` 不需要访问动态列表
 *     就能判断合法性（只看前缀与名字清理结果），否则加载顺序会影响校验结果；
 *   · **字体被卸载后优雅降级**：族名写进 CSS 回退栈，找不到就继续往后回退，
 *     不会产生空字体或报错。
 */
import { isTauri } from "@/lib/platform"

/** 持久化取值的动态字体前缀。改动它等于让老配置失效，勿轻易改。 */
export const SYSTEM_FONT_PREFIX = "sys:"

export interface SystemCjkFont {
  /** CSS 里应使用的族名（Rust 侧优先给英文名）。 */
  family: string
  /** 面向用户展示的名字（优先中文名）。 */
  display: string
}

/**
 * 族名里**不允许**出现的字符。
 *
 * 为什么是"拒绝"而不是"清洗掉"：把危险字符删掉可能得到一个**真实存在的
 * 另一个字体名**（例如 `Foo"Bar` 删成 `FooBar`），于是界面显示的是 A、
 * 实际生效的是 B —— 比"这个字体不列出"糟得多。故一律整条丢弃。
 *
 * 为什么只有这几类：
 *   · `"` 与 `\` 会在双引号 CSS 字符串里提前闭合/转义，是唯一的真危险字符；
 *   · 控制字符（含换行）不能出现在 CSS 字符串里；
 *   · 其余字符（`'` `(` `)` `[` `]` `-` `_` `.` 空格、CJK、字母数字）都是
 *     合法且常见的族名字符 —— 列成白名单反而会误杀正常字体。
 */
const UNSAFE_NAME_CHARS = /["\\\u0000-\u001f\u007f]/

/** 族名最大长度：超过这个长度不可能是真实族名，多半是坏数据。 */
const MAX_FAMILY_NAME_LENGTH = 128

/**
 * 清理一个来自系统的族名；不可安全使用时返回 `null`（调用方应跳过该字体）。
 *
 * 这是纯函数并有独立用例，因为它同时是**注入防线**：族名最终会进入 CSS
 * 自定义属性 `--qmai-ui-font-family` 的值里，一个带 `"` 的名字能改变整条栈。
 */
export function sanitizeFontFamilyName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.trim()
  if (!name) return null
  if (name.length > MAX_FAMILY_NAME_LENGTH) return null
  if (UNSAFE_NAME_CHARS.test(name)) return null
  return name
}

/** 把族名包成持久化取值。族名不安全时返回 `null`。 */
export function systemFontValue(family: unknown): string | null {
  const safe = sanitizeFontFamilyName(family)
  return safe ? `${SYSTEM_FONT_PREFIX}${safe}` : null
}

/** 判断一个取值是否为动态字体取值（**不校验**族名是否安全，只认前缀形状）。 */
export function isSystemFontValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SYSTEM_FONT_PREFIX)
    && value.length > SYSTEM_FONT_PREFIX.length
}

/**
 * 从动态取值里取出**安全的**族名；不是动态取值或不安全时返回 `null`。
 *
 * 注意这里**再校验一次**：`isSystemFontValue` 只看前缀，而存到本地的值可能
 * 是旧版本/被手工改过的（例如 `sys:Foo"Bar`）。消费端始终按"不可信输入"处理。
 */
export function systemFontNameOf(value: unknown): string | null {
  if (!isSystemFontValue(value)) return null
  return sanitizeFontFamilyName(value.slice(SYSTEM_FONT_PREFIX.length))
}

/**
 * 动态字体在 CSS 里的回退尾链（界面字体用）。
 *
 * 与内置默认档的尾链保持一致：动态字体找不到时（已卸载/名字变了），
 * 应该回退到"用户本来就会看到的中文字体"，而不是直接掉到通用族。
 */
const SYSTEM_FONT_FALLBACK_TAIL =
  'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'

/**
 * 正文用动态字体的回退尾链：**必须以衬线族收尾**。
 *
 * 正文的默认档是宋体系（`--serif`），若这里掉到 `sans-serif`，
 * 一个被卸载的正文动态字体会让整篇小说从宋体变成黑体 —— 静默的视觉回归。
 * 这与 `BODY_FONT_OPTIONS` 各内置项的收尾方式一致。
 */
const SYSTEM_BODY_FONT_FALLBACK_TAIL = '"Songti SC", SimSun, serif'

/** 把动态取值转成 CSS 字体栈；非法取值返回 `null`。 */
export function systemFontCss(value: unknown, tail: string = SYSTEM_FONT_FALLBACK_TAIL): string | null {
  const name = systemFontNameOf(value)
  if (!name) return null
  return `"${name}", ${tail}`
}

/** 正文用：动态取值 → CSS 栈（衬线尾链）。 */
export function systemBodyFontCss(value: unknown): string | null {
  return systemFontCss(value, SYSTEM_BODY_FONT_FALLBACK_TAIL)
}

/**
 * 从内置选项的 `cssFamily` 里取出**第一个**族名。
 *
 * 用途：动态列表要把"内置选项已经覆盖的字体"去掉，否则同一个字体在下拉里
 * 出现两次（一次叫「微软雅黑」，一次叫「Microsoft YaHei」），用户无从选择。
 * 只取第一个是因为内置项的第一段一律是"本机实测可用的那个名字"
 * （见 `font-settings.ts` 的规矩注释），后面的都是跨平台次选/通用族。
 */
export function firstFamilyOfCssStack(cssFamily: string): string | null {
  const m = /^\s*"([^"]+)"|^\s*([^,]+)/.exec(cssFamily)
  const raw = m?.[1] ?? m?.[2]
  return raw ? raw.trim().toLowerCase() : null
}

/**
 * 过滤掉已被内置选项覆盖的动态字体，并去掉重复族名。
 *
 * `builtinCssStacks` 传入内置选项的 `cssFamily` 列表。
 */
export function newSystemFontsOnly(
  fonts: readonly SystemCjkFont[],
  builtinCssStacks: readonly string[],
): SystemCjkFont[] {
  const covered = new Set(
    builtinCssStacks.map(firstFamilyOfCssStack).filter((n): n is string => n !== null),
  )
  const seen = new Set<string>()
  const out: SystemCjkFont[] = []
  for (const f of fonts) {
    const safe = sanitizeFontFamilyName(f.family)
    if (!safe) continue
    const key = safe.toLowerCase()
    if (covered.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ family: safe, display: sanitizeFontFamilyName(f.display) ?? safe })
  }
  return out
}

/*
 * ── 加载 ──
 *
 * 结果只取一次并缓存：枚举要遍历系统字体集（本机 300+ 族、每族 13 次
 * HasCharacter 询问），设置页每次重渲染都调用一次是不可接受的。
 * 失败也缓存（记住错误），避免在渲染循环里反复重试同一次失败调用。
 */

let cached: SystemCjkFont[] | null = null
let cachedError: string | null = null
let inflight: Promise<void> | null = null

/** 仅供测试使用：清空模块级缓存。 */
export function __resetSystemFontCacheForTests(): void {
  cached = null
  cachedError = null
  inflight = null
}

async function fetchOnce(): Promise<void> {
  if (!isTauri()) {
    // 纯浏览器/测试环境没有这台命令。**不是错误** —— 返回空列表即可，
    // 记成错误会让测试环境里的界面显示一条吓人的红色提示。
    cached = []
    return
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const raw = await invoke<SystemCjkFont[]>("list_system_cjk_fonts")
    cached = Array.isArray(raw)
      ? raw.filter((f) => sanitizeFontFamilyName(f?.family) !== null)
      : []
  } catch (e) {
    cached = []
    cachedError = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 读取本机中文字体（带缓存）。
 *
 * 返回 `{ fonts, error }`：`error` 非空表示**枚举失败**（与"本机确实没有
 * 中文字体"不同）。两者必须区分 —— 把失败说成"没有中文字体"是个会被用户
 * 信以为真的假结论。
 */
export async function loadSystemCjkFonts(): Promise<{ fonts: SystemCjkFont[]; error: string | null }> {
  if (cached !== null) return { fonts: cached, error: cachedError }
  if (!inflight) inflight = fetchOnce()
  await inflight
  return { fonts: cached ?? [], error: cachedError }
}
