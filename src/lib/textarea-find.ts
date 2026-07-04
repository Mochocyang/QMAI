export interface TextareaFindOptions {
  caseSensitive?: boolean
}

export function findAllMatches(
  text: string,
  query: string,
  options: TextareaFindOptions = {},
): number[] {
  if (!query) return []
  const caseSensitive = options.caseSensitive ?? true
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: number[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) break
    matches.push(index)
    from = index + Math.max(needle.length, 1)
  }
  return matches
}

export function findNextMatchIndex(
  matches: number[],
  selectionStart: number,
  queryLength: number,
  wrap = true,
): number {
  if (matches.length === 0) return -1
  const afterCurrent = selectionStart + queryLength
  const idx = matches.findIndex((start) => start >= afterCurrent)
  if (idx >= 0) return idx
  return wrap ? 0 : -1
}

export function findPrevMatchIndex(
  matches: number[],
  selectionStart: number,
  wrap = true,
): number {
  if (matches.length === 0) return -1
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i] < selectionStart) return i
  }
  return wrap ? matches.length - 1 : -1
}

export function findInitialMatchIndex(
  matches: number[],
  cursor: number,
): number {
  if (matches.length === 0) return -1
  const idx = matches.findIndex((start) => start >= cursor)
  return idx >= 0 ? idx : 0
}

export type FindHighlightPartKind = "plain" | "match" | "active"

export interface FindHighlightPart {
  text: string
  kind: FindHighlightPartKind
}

export function buildFindHighlightParts(
  text: string,
  matches: number[],
  queryLength: number,
  activeMatchIndex: number,
): FindHighlightPart[] {
  if (matches.length === 0 || queryLength <= 0) {
    return text ? [{ text, kind: "plain" }] : []
  }

  const parts: FindHighlightPart[] = []
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]
    if (start > last) {
      parts.push({ text: text.slice(last, start), kind: "plain" })
    }
    parts.push({
      text: text.slice(start, start + queryLength),
      kind: i === activeMatchIndex ? "active" : "match",
    })
    last = start + queryLength
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), kind: "plain" })
  }
  return parts
}

export function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent: HTMLElement | null = element.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (overflowY === "auto" || overflowY === "scroll") {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

const MIRRORED_TEXTAREA_STYLES = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordSpacing",
  "wordBreak",
] as const

function measureMatchOffsetInTextarea(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): number {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement("div")
  const marker = document.createElement("span")

  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.top = "0"
  mirror.style.left = "-9999px"
  mirror.style.whiteSpace = "pre-wrap"
  mirror.style.wordWrap = "break-word"
  mirror.style.overflowWrap = "break-word"

  for (const key of MIRRORED_TEXTAREA_STYLES) {
    mirror.style[key] = style[key]
  }

  mirror.textContent = textarea.value.slice(0, start)
  marker.textContent = textarea.value.slice(start, end) || "\u200b"
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const offsetTop = markerRect.top - mirrorRect.top

  document.body.removeChild(mirror)
  return offsetTop
}

export function scrollTextareaMatchIntoView(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): void {
  const scrollContainer = findScrollContainer(textarea)
  const matchTopInTextarea = measureMatchOffsetInTextarea(textarea, start, end)

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()
    const textareaOffsetInContainer = textareaRect.top - containerRect.top + scrollContainer.scrollTop
    const targetScrollTop = textareaOffsetInContainer + matchTopInTextarea - scrollContainer.clientHeight / 3
    scrollContainer.scrollTop = Math.max(0, targetScrollTop)
    return
  }

  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "32") || 32
  const lineCount = textarea.value.slice(0, start).split("\n").length
  textarea.scrollTop = Math.max(0, lineCount * lineHeight - textarea.clientHeight / 3)
}
