import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { math } from "@milkdown/plugin-math"
import { nord } from "@milkdown/theme-nord"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import "@milkdown/theme-nord/style.css"
import "katex/dist/katex.min.css"
import { Pencil, Eye } from "lucide-react"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { parseFrontmatter } from "@/lib/frontmatter"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { WikiReader } from "@/components/editor/wiki-reader"
import {
  rebuildChapterBody,
  splitChapterHeading,
  type ChapterBodySelection,
  type ChapterSelectionAction,
} from "@/lib/chapter-selection"
import type { PendingEditorHighlight } from "@/stores/wiki-store"

interface WikiEditorInnerProps {
  content: string
  onSave: (markdown: string) => void
}

interface WritingTextareaProps {
  content: string
  onSave: (markdown: string) => void
  autoFocus?: boolean
  onSelectionAction?: (action: ChapterSelectionAction, selection: ChapterBodySelection) => void
  highlightRequest?: PendingEditorHighlight | null
  onHighlightHandled?: () => void
}

interface FloatingToolbarPosition {
  top: number
  left: number
}

function WritingTextarea({
  content,
  onSave,
  autoFocus = false,
  onSelectionAction,
  highlightRequest,
  onHighlightHandled,
}: WritingTextareaProps) {
  const initial = useMemo(() => splitChapterHeading(content), [content])
  const [heading, setHeading] = useState(initial.heading)
  const [value, setValue] = useState(initial.body)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previousBodyRef = useRef(initial.body)
  const [selection, setSelection] = useState<ChapterBodySelection | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<FloatingToolbarPosition | null>(null)

  useEffect(() => {
    const { heading: h, body: b } = splitChapterHeading(content)
    if (document.activeElement === textareaRef.current) {
      const normalizedDraft = splitChapterHeading(formatChapterWriting(rebuildChapterBody(heading, value)))
      if (normalizedDraft.heading === h && normalizedDraft.body === b && (heading !== h || value !== b)) {
        previousBodyRef.current = value
        return
      }
    }
    const previousBody = previousBodyRef.current
    previousBodyRef.current = b
    setHeading(h)
    setValue(b)
    setSelection(null)
    setToolbarPosition(null)
    if (!autoFocus) return
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      const shouldMoveCaretToEnd = document.activeElement !== el || (previousBody.length === 0 && b.length > 0)
      el.focus()
      if (shouldMoveCaretToEnd) {
        const caret = el.value.length
        el.setSelectionRange(caret, caret)
      }
    })
  }, [content, autoFocus])

  const rebuild = useCallback((h: string, b: string) => {
    onSave(h ? `# ${h}\n\n${b}` : b)
  }, [onSave])

  const resize = useMemo(
    () => () => {
      const el = textareaRef.current
      if (!el) return
      // 找到外层滚动容器，保存滚动位置防止跳动
      let scrollContainer: HTMLElement | null = null
      let savedScrollTop = 0
      let savedScrollLeft = 0
      let parent: HTMLElement | null = el.parentElement
      while (parent) {
        const overflowY = window.getComputedStyle(parent).overflowY
        if (overflowY === "auto" || overflowY === "scroll") {
          scrollContainer = parent
          savedScrollTop = parent.scrollTop
          savedScrollLeft = parent.scrollLeft
          break
        }
        parent = parent.parentElement
      }
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
      // 恢复外层滚动容器的滚动位置
      if (scrollContainer) {
        scrollContainer.scrollTop = savedScrollTop
        scrollContainer.scrollLeft = savedScrollLeft
      }
    },
    [],
  )

  useEffect(() => {
    resize()
  }, [value, resize])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const resizeTarget = el.parentElement ?? el
    let frame: number | null = null

    const scheduleResize = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        resize()
      })
    }

    scheduleResize()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleResize)
      return () => {
        if (frame !== null) cancelAnimationFrame(frame)
        window.removeEventListener("resize", scheduleResize)
      }
    }

    const observer = new ResizeObserver(scheduleResize)
    observer.observe(resizeTarget)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [resize])

  const refreshSelection = useCallback(() => {
    const el = textareaRef.current
    if (!el || !onSelectionAction) {
      setSelection(null)
      setToolbarPosition(null)
      return
    }

    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === end) {
      setSelection(null)
      setToolbarPosition(null)
      return
    }

    const text = value.slice(start, end)
    if (!text.trim()) {
      setSelection(null)
      setToolbarPosition(null)
      return
    }

    const nextPosition = getTextareaSelectionToolbarPosition(el, start, end)
    setSelection({
      start,
      end,
      text,
      bodySnapshot: value,
    })
    setToolbarPosition(nextPosition)
  }, [onSelectionAction, value])

  useEffect(() => {
    if (!highlightRequest) return
    const target = highlightRequest.text.trim()
    const textarea = textareaRef.current
    if (!textarea || !target) {
      onHighlightHandled?.()
      return
    }
    const start = value.indexOf(target)
    if (start < 0) {
      onHighlightHandled?.()
      return
    }
    const end = start + target.length
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start, end)
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "32") || 32
      const scrollTop = Math.max(0, value.slice(0, start).split("\n").length * lineHeight - textarea.clientHeight / 3)
      textarea.scrollTop = scrollTop
      refreshSelection()
      onHighlightHandled?.()
    })
  }, [highlightRequest, onHighlightHandled, refreshSelection, value])

  useEffect(() => {
    if (!selection || !onSelectionAction) return
    const handleWindowChange = () => refreshSelection()
    document.addEventListener("scroll", handleWindowChange, true)
    window.addEventListener("resize", handleWindowChange)
    return () => {
      document.removeEventListener("scroll", handleWindowChange, true)
      window.removeEventListener("resize", handleWindowChange)
    }
  }, [selection, onSelectionAction, refreshSelection])

  const triggerSelectionAction = useCallback((action: ChapterSelectionAction) => {
    if (!selection || !onSelectionAction) return
    onSelectionAction(action, selection)
    setToolbarPosition(null)
  }, [selection, onSelectionAction])

  return (
    <div className="relative flex w-full flex-col">
      {selection && toolbarPosition && onSelectionAction ? (
        <div
          data-selection-toolbar="true"
          className="fixed z-30 flex items-center gap-1 rounded-full border border-border/80 bg-background/95 px-2 py-1 shadow-lg backdrop-blur"
          style={{ top: toolbarPosition.top, left: toolbarPosition.left, transform: "translate(-50%, -100%)" }}
        >
          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => triggerSelectionAction("polish")}
          >
            AI润色
          </button>
          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => triggerSelectionAction("de-ai")}
          >
            去AI味
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          const next = e.target.value
          setValue(next)
          setSelection(null)
          setToolbarPosition(null)
          rebuild(heading, next)
        }}
        onSelect={refreshSelection}
        onMouseUp={refreshSelection}
        onKeyUp={refreshSelection}
        onBlur={() => {
          window.setTimeout(() => {
            const active = document.activeElement
            if (active instanceof HTMLElement && active.closest("[data-selection-toolbar='true']")) {
              return
            }
            setSelection(null)
            setToolbarPosition(null)
          }, 0)
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          const target = e.currentTarget
          const start = target.selectionStart
          const end = target.selectionEnd
          const next = `${value.slice(0, start)}\n　　${value.slice(end)}`
          setValue(next)
          rebuild(heading, next)
          requestAnimationFrame(() => {
            const caret = start + 3
            target.selectionStart = caret
            target.selectionEnd = caret
            resize()
          })
        }}
        className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-lg leading-8 text-foreground outline-none"
        style={{ 
          fontFamily: "inherit",
          minHeight: "100%",
          height: "auto"
        }}
        spellCheck={false}
      />
    </div>
  )
}

function WikiEditorInner({ content, onSave }: WikiEditorInnerProps) {
  // Milkdown fires `markdownUpdated` once on initial parse before any
  // user interaction. That one emit must not be forwarded as a save,
  // otherwise just opening a file can overwrite its content with
  // Milkdown's normalized-but-equivalent re-emit (or, worse, with a
  // placeholder string that came back from a failed read).
  const initialEmitConsumedRef = useRef(false)

  useEditor(
    (root) =>
      Editor.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          initialEmitConsumedRef.current = false
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            if (!initialEmitConsumedRef.current) {
              initialEmitConsumedRef.current = true
              return
            }
            onSave(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(math)
        .use(history)
        .use(listener),
    [],
  )

  return <Milkdown />
}

interface WikiEditorProps {
  content: string
  onSave: (markdown: string) => void
  defaultMode?: "read" | "edit"
  immersiveWriting?: boolean
  onSelectionAction?: (action: ChapterSelectionAction, selection: ChapterBodySelection) => void
  highlightRequest?: PendingEditorHighlight | null
  onHighlightHandled?: () => void
}

function wrapBareMathBlocks(text: string): string {
  return text.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  )
}

export function WikiEditor({
  content,
  onSave,
  defaultMode = "read",
  immersiveWriting = false,
  onSelectionAction,
  highlightRequest,
  onHighlightHandled,
}: WikiEditorProps) {
  // Default to read mode (ReactMarkdown render). Edit mode swaps
  // in Milkdown WYSIWYG. We default to read because:
  //   1. Milkdown's commonmark/gfm preset has no wikilink schema,
  //      so `[[…]]` shows up as raw text — exactly what users
  //      called out as "looking like raw code".
  //   2. We can pre-process wikilinks for the read view safely
  //      (the rendered output is throwaway). Doing the same in
  //      Milkdown would be a save-corruption hazard because
  //      Milkdown serializes its current state on save — the
  //      transformed `[label](#slug)` would overwrite the
  //      original `[[…]]` source.
  //   3. Users read wiki pages far more often than they edit
  //      them; the toggle makes editing a deliberate action
  //      rather than the default state.
  const [mode, setMode] = useState<"read" | "edit">(defaultMode)

  // Split frontmatter from body. Both modes consume `body`;
  // Milkdown additionally rebuilds the full file via `rawBlock`
  // on save so user-managed YAML survives untouched.
  const { frontmatter, body, rawBlock } = useMemo(
    () => parseFrontmatter(content),
    [content],
  )

  const processedBody = useMemo(() => wrapBareMathBlocks(body), [body])

  const handleSave = useMemo(
    () => (markdown: string) => onSave(rawBlock + markdown),
    [onSave, rawBlock],
  )

  useEffect(() => {
    setMode(defaultMode)
  }, [defaultMode])

  const effectiveMode = immersiveWriting ? "edit" : mode

  return (
    <div className={immersiveWriting ? "relative h-full overflow-hidden" : "relative h-full overflow-auto"}>
      {!immersiveWriting && (
        <button
          type="button"
          onClick={() => setMode((m) => (m === "read" ? "edit" : "read"))}
          title={mode === "read" ? "Edit (raw markdown)" : "Done editing"}
          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
        >
          {mode === "read" ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {mode === "read" ? "Edit" : "Done"}
        </button>
      )}

      {effectiveMode === "read" ? (
        <div className="px-6 py-6">
          {!immersiveWriting && frontmatter && <FrontmatterPanel data={frontmatter} />}
          <WikiReader body={body} />
        </div>
      ) : (
        immersiveWriting ? (
          <div className="immersive-scroll-container flex h-full w-full flex-col overflow-auto" style={{ 
            scrollbarWidth: "thin",
            scrollbarColor: "oklch(0.75 0 0) transparent"
          }}>
            <style>{`
              .immersive-scroll-container::-webkit-scrollbar {
                width: 8px;
              }
              .immersive-scroll-container::-webkit-scrollbar-track {
                background: transparent;
              }
              .immersive-scroll-container::-webkit-scrollbar-thumb {
                background: oklch(0.75 0 0);
                border-radius: 4px;
              }
              .immersive-scroll-container::-webkit-scrollbar-thumb:hover {
                background: oklch(0.65 0 0);
              }
            `}</style>
            <div className="mx-auto w-full max-w-4xl flex-col px-8 py-10">
              <WritingTextarea
                content={body}
                onSave={handleSave}
                autoFocus={immersiveWriting}
                onSelectionAction={onSelectionAction}
                highlightRequest={highlightRequest}
                onHighlightHandled={onHighlightHandled}
              />
            </div>
          </div>
        ) : (
          <MilkdownProvider>
            <div className="prose prose-invert min-w-0 max-w-none overflow-hidden p-6">
              {!immersiveWriting && frontmatter && <FrontmatterPanel data={frontmatter} />}
              <WikiEditorInner content={processedBody} onSave={handleSave} />
            </div>
          </MilkdownProvider>
        )
      )}
    </div>
  )
}

function getTextareaSelectionToolbarPosition(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): FloatingToolbarPosition | null {
  const text = textarea.value.slice(start, end) || "\u200b"
  if (!text) return null

  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement("div")
  const marker = document.createElement("span")
  const textareaRect = textarea.getBoundingClientRect()

  const mirroredStyles = [
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

  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.top = "0"
  mirror.style.left = "-9999px"
  mirror.style.whiteSpace = "pre-wrap"
  mirror.style.wordWrap = "break-word"
  mirror.style.overflowWrap = "break-word"

  for (const key of mirroredStyles) {
    mirror.style[key] = style[key]
  }

  mirror.textContent = textarea.value.slice(0, start)
  marker.textContent = text
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const left = textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft + markerRect.width / 2
  const top = textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop - 8

  document.body.removeChild(mirror)

  return { top, left }
}
