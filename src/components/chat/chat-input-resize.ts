export const DEFAULT_RESIZABLE_INPUT_HEIGHT = 44
const INPUT_BOTTOM_RESERVED = 80
const MIN_MESSAGE_AREA_MIN = 80
const MIN_MESSAGE_AREA_RATIO = 0.15

export interface ResizableInputBounds {
  minHeight: number
  maxHeight: number
}

export interface ResizeContext {
  startRootTop: number
  startRootHeight: number
  startInputHeight: number
  viewportHeight: number
  containerHeight: number
  fixedOverhead: number
}

function computeMinMessageAreaHeight(containerHeight: number): number {
  return Math.max(MIN_MESSAGE_AREA_MIN, Math.floor(containerHeight * MIN_MESSAGE_AREA_RATIO))
}

export function createResizeContext(rootEl: HTMLDivElement | null, currentInputHeight: number): ResizeContext | null {
  if (!rootEl) return null
  const rootRect = rootEl.getBoundingClientRect()
  const containerEl = findChatContainer(rootEl)
  const containerRect = containerEl?.getBoundingClientRect()
  const containerHeight = containerRect?.height ?? window.innerHeight
  const textareaEl = rootEl.querySelector("textarea")
  const textareaRect = textareaEl?.getBoundingClientRect()
  const actualTextareaHeight = textareaRect?.height ?? currentInputHeight
  const fixedOverhead = Math.max(0, rootRect.height - actualTextareaHeight)
  return {
    startRootTop: rootRect.top,
    startRootHeight: rootRect.height,
    startInputHeight: currentInputHeight,
    viewportHeight: window.innerHeight,
    containerHeight,
    fixedOverhead,
  }
}

function findChatContainer(root: HTMLDivElement): HTMLElement | null {
  let current: HTMLElement | null = root.parentElement
  let fallback: HTMLElement | null = null
  for (let i = 0; i < 8 && current; i++) {
    const tag = current.tagName
    if (tag === "BODY" || tag === "HTML") break
    const style = window.getComputedStyle(current)
    const isFlexColumn = style.display === "flex" && style.flexDirection === "column"
    if (isFlexColumn) {
      const hasConstrainedHeight = style.height !== "auto" && style.height !== ""
      const hasOverflowClip = style.overflowY === "hidden" || style.overflowY === "auto" || style.overflowY === "scroll"
      if (hasConstrainedHeight || hasOverflowClip) {
        return current
      }
      if (!fallback) {
        fallback = current
      }
    }
    current = current.parentElement
  }
  return fallback ?? root.parentElement
}

export function resolveMaxHeightFromContext(ctx: ResizeContext, nextHeight: number): number {
  const predictedRootTop = ctx.startRootTop - (nextHeight - ctx.startInputHeight)
  const viewportAvailable = ctx.viewportHeight - predictedRootTop - INPUT_BOTTOM_RESERVED
  const minMessageArea = computeMinMessageAreaHeight(ctx.containerHeight)
  const containerAvailable = ctx.containerHeight - minMessageArea - ctx.fixedOverhead
  const effectiveMax = Math.min(
    Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, Math.floor(viewportAvailable)),
    Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, Math.floor(containerAvailable)),
  )
  return effectiveMax
}

export function getResizeBoundsForElement(rootEl: HTMLDivElement | null): ResizableInputBounds {
  if (!rootEl) {
    return { minHeight: DEFAULT_RESIZABLE_INPUT_HEIGHT, maxHeight: 200 }
  }
  const containerEl = findChatContainer(rootEl)
  const containerRect = containerEl?.getBoundingClientRect()
  const containerHeight = containerRect?.height ?? window.innerHeight
  const rootRect = rootEl.getBoundingClientRect()
  const textareaEl = rootEl.querySelector("textarea")
  const textareaHeight = textareaEl?.getBoundingClientRect().height ?? DEFAULT_RESIZABLE_INPUT_HEIGHT
  const fixedOverhead = Math.max(0, rootRect.height - textareaHeight)
  const minMessageArea = computeMinMessageAreaHeight(containerHeight)
  const containerMax = Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, Math.floor(containerHeight - minMessageArea - fixedOverhead))
  const viewportMax = Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, Math.floor(window.innerHeight - rootRect.top - INPUT_BOTTOM_RESERVED))
  return {
    minHeight: DEFAULT_RESIZABLE_INPUT_HEIGHT,
    maxHeight: Math.min(containerMax, viewportMax),
  }
}

export function clampResizableInputHeight(
  nextHeight: number,
  bounds: ResizableInputBounds,
): number {
  const minHeight = Math.max(1, Math.floor(bounds.minHeight))
  const maxHeight = Math.max(minHeight, Math.floor(bounds.maxHeight))
  if (!Number.isFinite(nextHeight)) return minHeight
  return Math.min(maxHeight, Math.max(minHeight, Math.round(nextHeight)))
}

export function isHeightAtMax(currentHeight: number, bounds: ResizableInputBounds): boolean {
  const maxHeight = Math.max(bounds.minHeight, Math.floor(bounds.maxHeight))
  return currentHeight >= maxHeight - 1
}

export function isHeightAtMin(currentHeight: number, bounds: ResizableInputBounds): boolean {
  return currentHeight <= bounds.minHeight + 1
}
