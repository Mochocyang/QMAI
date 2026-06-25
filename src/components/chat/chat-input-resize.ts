export const DEFAULT_RESIZABLE_INPUT_HEIGHT = 44

export interface ResizableInputBounds {
  minHeight: number
  maxHeight: number
}

export function resolveResizableInputMaxHeight({
  panelHeight,
  viewportHeight,
}: {
  panelHeight: number
  viewportHeight: number
}): number {
  const availableHeight = panelHeight > 0 ? panelHeight : viewportHeight
  return Math.max(DEFAULT_RESIZABLE_INPUT_HEIGHT, Math.floor(availableHeight / 2))
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
