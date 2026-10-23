/**
 * 「在独立窗口打开」的纯函数层：URL 约定 + 窗口 label。
 *
 * 为什么走 URL 参数而不是 IPC 传数据：独立窗口是**另一个 webview**，
 * 有自己独立的一份 JS 上下文与 store 实例 —— 主窗口里的 `selectedFile` /
 * `fileContent` 在那边根本读不到，目标文档只能通过 URL 带过去。
 *
 * 这也正是这个功能的意义所在：主窗口继续编辑第二章，独立窗口里照样
 * 翻第一章，两边互不覆盖。
 */

import type { ReaderWindowAppearance } from "@/lib/reader-window-appearance"
import { normalizeReaderWindowAppearance } from "@/lib/reader-window-appearance"

export type ReaderWindowKind = "chapter" | "outline"

/** 主题只在建窗时取一次快照（主窗口当前是深色还是浅色），之后不再跟随。 */
export type ReaderWindowTheme = "light" | "dark"

export interface ReaderWindowPayload {
  kind: ReaderWindowKind
  /** 文档绝对路径（.md）。 */
  path: string
  /** 项目根目录，只用于解析正文里的相对图片路径。 */
  projectPath?: string | null
  theme?: ReaderWindowTheme
  /**
   * 外观皮肤 + 正文排版快照（见 `reader-window-appearance.ts`）。
   *
   * 必须在建窗那一刻带过来：独立窗口有自己的 WebView2 profile，
   * localStorage 与 store 都不共享，它自己读不到用户的皮肤和字体设置。
   */
  appearance?: ReaderWindowAppearance
}

/**
 * 查询参数名刻意不是裸 `reader`：这个词太容易和业务字段撞车，
 * 而 `parseReaderWindowSearch` 只在 main.tsx 启动时判一次，
 * 误判会让整个应用被替换成阅读窗口。
 */
export const READER_WINDOW_PARAM = "reader-window"

declare global {
  interface Window {
    /**
     * Rust 侧建窗时用 `initialization_script` 注入的参数。
     *
     * 生产环境走这条路（不经过 URL）；浏览器里点开验收时退回查询串解析。
     */
    __QMAI_READER_PAYLOAD__?: ReaderWindowPayload
  }
}

export function isReaderWindowKind(value: string | null): value is ReaderWindowKind {
  return value === "chapter" || value === "outline"
}

/**
 * 窗口 label：同一份文档重复打开时复用同一个窗口，免得目录树上多点两下
 * 就长出一排内容相同的窗。
 *
 * 用路径哈希而不是完整路径：Tauri 的 label 会进 webview 的 data 目录与
 * 权限匹配，中文路径、斜杠拼进 label 都是坑。
 */
export function readerWindowLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  let hash = 5381
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) >>> 0
  }
  return `reader-${hash.toString(36)}`
}

/**
 * 独立窗口的 URL。
 *
 * `base` 传主窗口的 `location.href` 即可：开发态解析到 vite dev server，
 * 打包态解析到 tauri 的自定义协议，两边都能命中 `index.html`。
 */
export function buildReaderWindowUrl(payload: ReaderWindowPayload, base?: string): string {
  const params = new URLSearchParams()
  params.set(READER_WINDOW_PARAM, payload.kind)
  params.set("path", payload.path)
  if (payload.projectPath) params.set("project", payload.projectPath)
  if (payload.theme) params.set("theme", payload.theme)
  /*
   * 外观快照用**一串扁平键**而不是 base64 的 JSON：
   * 这条路径只在浏览器里验收布局时走（生产走 Rust 注入的 payload），
   * 出问题时能直接在地址栏里看清是哪个值不对，比一串编码短得多；
   * 也免了"URL 里塞 `{`/`}` 被某些代理改写"这类无谓风险。
   * 边距的 null 有语义（跟随窗口），所以显式写成 `auto`。
   */
  const appearance = payload.appearance
  if (appearance) {
    params.set("skin", appearance.skin)
    params.set("ui-font", appearance.uiFontFamily)
    params.set("ui-scale", String(appearance.uiFontSizeScale))
    params.set("body-font", appearance.bodyFontFamily)
    params.set("font-px", String(appearance.bodyFontPx))
    params.set("leading", String(appearance.bodyLineHeight))
    params.set("spacing", String(appearance.bodyLetterSpacing))
    params.set("margin-x", appearance.bodyMarginX === null ? "auto" : String(appearance.bodyMarginX))
    params.set("safe-bottom", String(appearance.bodySafeBottom))
  }
  const relative = `index.html?${params.toString()}`
  if (!base) return relative
  return new URL(relative, base).toString()
}

/**
 * 从查询串还原外观快照；一个外观键都没有时返回 undefined。
 *
 * 数值不做这里的校验（原样交给 `normalizeReaderWindowAppearance`）：
 * 钳制规则只有一份，写两处必然漂移。
 */
function parseAppearanceParams(params: URLSearchParams): ReaderWindowAppearance | undefined {
  if (!params.has("skin")) return undefined
  const number = (key: string) => params.get(key) ?? undefined
  return normalizeReaderWindowAppearance({
    skin: params.get("skin"),
    uiFontFamily: number("ui-font"),
    uiFontSizeScale: number("ui-scale"),
    bodyFontFamily: number("body-font"),
    bodyFontPx: number("font-px"),
    bodyLineHeight: number("leading"),
    bodyLetterSpacing: number("spacing"),
    bodyMarginX: params.get("margin-x") === "auto" ? null : number("margin-x"),
    bodySafeBottom: number("safe-bottom"),
  }) ?? undefined
}

/** 独立窗口启动时解析自己的 URL；返回 null 表示「这是主窗口，正常启动」。 */
export function parseReaderWindowSearch(search: string): ReaderWindowPayload | null {
  if (!search) return null
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const kind = params.get(READER_WINDOW_PARAM)
  const path = params.get("path")
  if (!isReaderWindowKind(kind) || !path) return null
  const theme = params.get("theme")
  const appearance = parseAppearanceParams(params)
  return {
    kind,
    path,
    projectPath: params.get("project") || null,
    theme: theme === "dark" ? "dark" : theme === "light" ? "light" : undefined,
    // 只有真带了这个键才写进对象：`appearance: undefined` 与"没有这个字段"
    // 在业务上是同一件事，但会让对象的键集合变得难以断言。
    ...(appearance ? { appearance } : {}),
  }
}

function normalizePayload(value: ReaderWindowPayload | null | undefined): ReaderWindowPayload | null {
  if (!value || !isReaderWindowKind(value.kind) || !value.path) return null
  const theme = value.theme
  const appearance = normalizeReaderWindowAppearance(value.appearance)
  return {
    kind: value.kind,
    path: value.path,
    projectPath: value.projectPath || null,
    theme: theme === "dark" ? "dark" : theme === "light" ? "light" : undefined,
    ...(appearance ? { appearance } : {}),
  }
}

/**
 * 读 Rust 侧注入的建窗参数。
 *
 * 注入发生在页面脚本之前，所以只要窗口是 `open_reader_window` 建的，
 * 这里一定有值 —— 拿不到就说明当前是主窗口（或浏览器里直接打开的）。
 */
export function readInjectedReaderPayload(): ReaderWindowPayload | null {
  if (typeof window === "undefined") return null
  return normalizePayload(window.__QMAI_READER_PAYLOAD__)
}

/** 注入优先、查询串兜底：两条入口（生产 / 浏览器验收）都落在同一份参数上。 */
export function resolveReaderWindowPayload(search: string): ReaderWindowPayload | null {
  return readInjectedReaderPayload() ?? parseReaderWindowSearch(search)
}
