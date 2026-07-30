/** 流式长文本只保留尾部进 DOM，避免流程窗口滚动时布局成本爆炸。 */
export const STREAMING_DISPLAY_MAX_CHARS = 8_000

export function getStreamingTailDisplay(
  content: string,
  streaming: boolean,
  maxChars = STREAMING_DISPLAY_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (!streaming || content.length <= maxChars) {
    return { text: content, truncated: false }
  }

  const sliceStart = content.length - maxChars
  const newline = content.indexOf("\n", sliceStart)
  const start =
    newline >= 0 && newline < sliceStart + 240 ? newline + 1 : sliceStart
  return { text: content.slice(start), truncated: true }
}
