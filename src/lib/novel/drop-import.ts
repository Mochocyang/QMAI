import { isChapterImportablePath } from "./chapter-import"
import { isOutlineImportablePath } from "./outline-import"

/**
 * 「把桌面上的文件拖进大纲/章节列表」这件事里，跟 DOM 和 Tauri 都无关的那部分。
 *
 * 拖拽本身由 Tauri 的原生事件驱动（`onDragDropEvent`），坐标是**物理像素**，
 * 而 DOM 的 getBoundingClientRect 给的是 CSS 像素；扩展名过滤又要和「点菜单导入」
 * 用同一套规则。这三件事都很容易写错，所以都放在这里，可以脱开 Tauri 单测。
 */

export type ListKind = "chapter" | "outline"

export interface DropPoint {
  x: number
  y: number
}

export interface DropRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Tauri 原生拖拽给的是物理像素（和窗口缩放有关），DOM 矩形是 CSS 像素。
 * 不换算的话，在 125% / 150% 缩放的高分屏上，判定框会整体偏掉，
 * 表现为"文件明明拖在列表上却没反应"或者"拖在空白处反而导入了"。
 */
export function toLogicalDropPoint(
  position: { x: number; y: number },
  devicePixelRatio: number,
): DropPoint {
  // DPR 异常（0、负数、NaN）时按 1 处理：宁可判错位置，也不能让坐标变成 NaN
  // 而把整次拖拽静默吞掉。
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
  return { x: position.x / ratio, y: position.y / ratio }
}

/** 落点在不在列表矩形里。 */
export function isPointInsideDropRect(point: DropPoint, rect: DropRect): boolean {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom
}

/**
 * 从矩形取判定范围；矩形整体没有尺寸时返回 null —— 那说明列表还没布局出来
 * （没挂载、被折叠、或者宽度为 0），此时任何落点都不该被当成"拖到了列表上"。
 */
export function dropRectFromBounds(bounds: {
  left: number
  top: number
  right: number
  bottom: number
}): DropRect | null {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null
  return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
}

/**
 * 落点是否命中列表。`rect` 为 null（没布局）时一律不命中。
 */
export function isDropInsideList(
  position: { x: number; y: number },
  rect: DropRect | null,
  devicePixelRatio: number,
): boolean {
  if (!rect) return false
  return isPointInsideDropRect(toLogicalDropPoint(position, devicePixelRatio), rect)
}

/**
 * 把拖进来的路径过滤成真正能导入的那些，并去掉目录。
 *
 * 拖拽和「选文件」不同：用户可能一次拖进来一整个文件夹、一张图片、
 * 一个压缩包。这些既不是章节也不是大纲，必须在这里挡掉，
 * 否则导入流程会拿着一个目录路径去 readFile 然后报看不懂的错。
 *
 * 目录无法在这里可靠判断（要读盘），所以按扩展名过滤就够了：
 * 目录名通常没有这些扩展名。
 */
export function filterDroppablePaths(paths: readonly string[], kind: ListKind): string[] {
  const accepts = kind === "chapter" ? isChapterImportablePath : isOutlineImportablePath
  return paths.filter((path) => typeof path === "string" && path.length > 0 && accepts(path))
}

/** 拖进来但没有一个能导入时的提示文案。 */
export function describeUnsupportedDrop(paths: readonly string[], kind: ListKind): string {
  const what = kind === "chapter" ? "章节文档" : "大纲文档"
  const extensions = kind === "chapter" ? "txt、md、mdx、doc、docx" : "md、txt、docx、pptx、xlsx 等文档格式"
  return `拖入的 ${paths.length} 个文件里没有可导入的${what}。支持的格式：${extensions}。`
}
