import {
  DEFAULT_BODY_FONT_PX,
  DEFAULT_BODY_LETTER_SPACING,
  DEFAULT_BODY_LINE_HEIGHT,
  DEFAULT_BODY_MARGIN_X,
  DEFAULT_BODY_SAFE_BOTTOM,
  DEFAULT_UI_FONT_FAMILY,
  applyBodyFontFamily,
  applyBodyTypography,
  applyUiFontFamily,
  clampBodyFontPx,
  clampBodyLetterSpacing,
  clampBodyLineHeight,
  clampBodyMarginX,
  clampBodySafeBottom,
  clampUiFontSizeScale,
  normalizeBodyFontFamily,
  normalizeUiFontFamily,
  type BodyFontFamily,
  type UiFontFamily,
} from "@/lib/font-settings"
import { readDocumentAppearance } from "@/lib/html-document-appearance"
import { isTauri } from "@/lib/platform"
import { applyTheme } from "@/lib/theme-utils"
import { readUiTestSkin } from "@/lib/ui-test"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 独立窗口的「外观 + 正文排版」快照。
 *
 * ── 为什么必须由主窗口带过去，不能让独立窗口自己读 ──
 * 独立窗口跑在另一个 webview 里，而且用的是**自己的 WebView2 profile**
 * （`reader_window.rs` 的 `data_directory`，每进程一个 `reader-webview-<pid>`）。
 * 这带来两个直接后果：
 *   1. localStorage 不共享 —— 皮肤存在 `qm-uitest-skin` 里，那边永远读到空值、
 *      回退成默认皮肤。用户看到的就是「我设的是静水，独立窗口却不是静水」。
 *   2. 两个窗口各有一份 store —— 正文字体 / 字号 / 行距 / 字距 / 边距 /
 *      安全距离也读不到，全部退回出厂默认。用户看到的就是
 *      「独立窗口没跟随格式设置」。
 * 所以建窗时把这些值塞进 payload（`ReaderWindowPayload.appearance`），
 * 打开之后主窗口再改动时用 Tauri 事件广播一次（`publishReaderWindowAppearance`）。
 *
 * ── 为什么不各自读 app-state.json ──
 * app-state 确实跨窗口共享，但皮肤根本不在里面（只在 localStorage），
 * 且它是异步的 store 读取，页面首帧会先按默认皮肤画一遍再跳变。
 * 快照走 payload 是同步的，首帧就是对的。
 */

/** 皮肤 → 深浅主题。与 `ui-test-shell.tsx` 里「skin 驱动 theme」的规则必须一致。 */
export function readerWindowThemeForSkin(skin: ReaderWindowAppearance["skin"]): "light" | "dark" {
  return skin === "xing" ? "dark" : "light"
}

export interface ReaderWindowAppearance {
  /** 外观皮肤：静水 / 纸间 / 星夜。 */
  skin: "jing" | "zhi" | "xing"
  /** 界面字体（`--qmai-ui-font-family`）。 */
  uiFontFamily: UiFontFamily
  /** 界面字号倍率（写成 `documentElement.style.fontSize` 的百分比）。 */
  uiFontSizeScale: number
  /** 正文字体（`--qmai-body-font-family`）。 */
  bodyFontFamily: BodyFontFamily
  /** 正文字号 px。 */
  bodyFontPx: number
  /** 正文行距（无单位倍数）。 */
  bodyLineHeight: number
  /** 正文字距 px（可为负）。 */
  bodyLetterSpacing: number
  /** 正文左右边距 px；null = 跟随窗口。 */
  bodyMarginX: number | null
  /** 正文底部安全距离 px。 */
  bodySafeBottom: number
}

export function isReaderWindowSkin(value: unknown): value is ReaderWindowAppearance["skin"] {
  return value === "jing" || value === "zhi" || value === "xing"
}

/**
 * 把「任意来源（注入的 payload / 查询串 / 事件体）」归一化成一份可安全应用的值。
 *
 * 与 font-settings 里那批 clamp 的关系：**每个字段都过各自的钳制函数**，
 * 所以存坏的值（例如手改过 app-state、旧版本写进去的倍数）不会把界面弄成
 * 空字体或 0px 行高；而缺字段则落到出厂默认。
 *
 * `skin` 缺失时退回 `readUiTestSkin()`：浏览器里直接开 `index.html?reader-window=…`
 * 验收时（同源、同 localStorage）能拿到真实皮肤，反正是"没有更好来源"的时候。
 */
export function normalizeReaderWindowAppearance(value: unknown): ReaderWindowAppearance | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  return {
    skin: isReaderWindowSkin(raw.skin) ? raw.skin : readUiTestSkin(),
    uiFontFamily: normalizeUiFontFamily(raw.uiFontFamily),
    uiFontSizeScale: clampUiFontSizeScale(raw.uiFontSizeScale),
    bodyFontFamily: normalizeBodyFontFamily(raw.bodyFontFamily),
    bodyFontPx: clampBodyFontPx(raw.bodyFontPx),
    bodyLineHeight: clampBodyLineHeight(raw.bodyLineHeight),
    bodyLetterSpacing: clampBodyLetterSpacing(raw.bodyLetterSpacing),
    bodyMarginX: clampBodyMarginX(raw.bodyMarginX),
    bodySafeBottom: clampBodySafeBottom(raw.bodySafeBottom),
  }
}

/**
 * 主窗口侧的当前值快照（建窗参数、事件广播共用这一个出口）。
 *
 * 皮肤从 `document.documentElement` 读（`readDocumentAppearance`），
 * 其余从 store 读 —— 与 `App.tsx` 里那几条 `apply*` effect 的取值来源一致，
 * 所以「主窗口看到的样子」与「带过去的样子」不可能分叉。
 */
export function readReaderWindowAppearance(): ReaderWindowAppearance {
  const state = useWikiStore.getState()
  return {
    skin: readDocumentAppearance(),
    uiFontFamily: state.uiFontFamily,
    uiFontSizeScale: state.uiFontSizeScale,
    bodyFontFamily: state.uiBodyFontFamily,
    bodyFontPx: state.uiBodyFontPx,
    bodyLineHeight: state.uiBodyLineHeight,
    bodyLetterSpacing: state.uiBodyLetterSpacing,
    bodyMarginX: state.uiBodyMarginX,
    bodySafeBottom: state.uiBodySafeBottom,
  }
}

/** 没带参数时的兜底快照（旧窗口 / 直接开页面验收）。 */
export function defaultReaderWindowAppearance(): ReaderWindowAppearance {
  return {
    skin: readUiTestSkin(),
    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
    uiFontSizeScale: 1,
    bodyFontFamily: "serif-default",
    bodyFontPx: DEFAULT_BODY_FONT_PX,
    bodyLineHeight: DEFAULT_BODY_LINE_HEIGHT,
    bodyLetterSpacing: DEFAULT_BODY_LETTER_SPACING,
    bodyMarginX: DEFAULT_BODY_MARGIN_X,
    bodySafeBottom: DEFAULT_BODY_SAFE_BOTTOM,
  }
}

/**
 * payload → 实际要应用的那份外观。
 *
 * 没有快照时按主题兜底：`dark` 一律落到星夜（深色皮肤的语义就是"夜间"），
 * 其余落到默认浅色皮肤。这样"没有快照"也不会出现「深色窗口配浅色皮肤」的错配。
 */
export function resolveReaderWindowAppearance(
  appearance: unknown,
  theme?: "light" | "dark" | "system" | null,
): ReaderWindowAppearance {
  const normalized = normalizeReaderWindowAppearance(appearance)
  if (normalized) return normalized
  const fallback = defaultReaderWindowAppearance()
  return theme === "dark" ? { ...fallback, skin: "xing" } : fallback
}

/**
 * 落到这个 webview 上。
 *
 * 四件事缺一不可，对应四种不同的失效：
 *   1. `data-ui-test-skin` —— ui-test.css 的**皮肤变体**（纸间 / 星夜）挂在这个属性上，
 *      同时它也是 `html` 侧的整套令牌来源（弹窗、toast 这些挂在 body 上的节点靠它）。
 *   2. `.dark`（经 applyTheme）—— 星夜是深色的，缺了它原生控件
 *      （滚动条、输入框、下拉）仍是浅色。
 *   3. 字体与排版变量 —— 正文的字体 / 字号 / 行距 / 字距 / 边距 / 安全距离
 *      全靠 `--qmai-body-*` 这一组变量；不写它们就一律走 CSS 兜底默认值。
 *   4. 根节点上的 `data-skin`（由调用方渲染，见 reader-window.tsx）——
 *      ⚠ 这一条最容易漏：ui-test.css 把**基础令牌**声明在 `.ui-test-root` 上，
 *      而声明在元素自身的值**优先级高于继承**，所以 html 上那份变体令牌
 *      盖不住 `.ui-test-root` 自己的浅色基础值 —— 结果就是"属性设对了，
 *      但背景还是浅色"（实测：星夜窗口白底黑字）。
 */
export function applyReaderWindowAppearance(value: unknown): ReaderWindowAppearance {
  const appearance = normalizeReaderWindowAppearance(value) ?? defaultReaderWindowAppearance()
  if (typeof document === "undefined") return appearance

  const html = document.documentElement
  html.dataset.uiTestSkin = appearance.skin
  applyTheme(readerWindowThemeForSkin(appearance.skin))
  // 与 App.tsx 完全同一条写法：根字号百分比，界面里的 rem 尺寸随之缩放。
  html.style.fontSize = `${Math.round(clampUiFontSizeScale(appearance.uiFontSizeScale) * 100)}%`
  applyUiFontFamily(appearance.uiFontFamily)
  applyBodyFontFamily(appearance.bodyFontFamily)
  applyBodyTypography({
    fontPx: appearance.bodyFontPx,
    lineHeight: appearance.bodyLineHeight,
    letterSpacing: appearance.bodyLetterSpacing,
    marginX: appearance.bodyMarginX,
    safeBottom: appearance.bodySafeBottom,
  })
  return appearance
}

/**
 * 主窗口 → 所有窗口的外观广播事件名。
 *
 * 用 `emit`（全局广播）而不是 `emitTo`：独立窗口的 label 是路径哈希，
 * 主窗口未必记得每一个；广播给所有窗口，各窗口自己决定要不要理。
 */
export const READER_WINDOW_APPEARANCE_EVENT = "qmai-reader-window-appearance"

/** 拖动滑块时值每帧都在变，逐个 IPC 广播没必要。 */
const PUBLISH_DEBOUNCE_MS = 150

let publishTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 主窗口侧调用：把当前外观广播给已打开的独立窗口。
 *
 * 去抖 + fire-and-forget：这是纯 UI 同步，失败（浏览器环境 / 窗口全关）
 * 不需要打扰用户；下次开窗仍会从 payload 拿到正确值。
 */
export function publishReaderWindowAppearance(): void {
  if (!isTauri()) return
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => {
    publishTimer = null
    void import("@tauri-apps/api/event")
      .then(({ emit }) => emit(READER_WINDOW_APPEARANCE_EVENT, readReaderWindowAppearance()))
      .catch(() => undefined)
  }, PUBLISH_DEBOUNCE_MS)
}
