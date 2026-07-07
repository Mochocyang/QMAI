import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import {
  Bot, User, FileText, ChevronDown, ChevronRight, RefreshCw, Copy, Check,
  Users, Lightbulb, BookOpen, HelpCircle, GitMerge, BarChart3, Layout, Globe,
  Image as ImageIcon,
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import { getLastQueryPages } from "@/components/chat/chat-shared"
import { FileEditPreview } from "@/components/chat/file-edit-preview"
import type { DisplayMessage } from "@/stores/chat-store"

import { convertLatexToUnicode } from "@/lib/latex-to-unicode"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { findRawSourceForImage, imageUrlToAbsolute } from "@/lib/raw-source-resolver"
import { detectLanguage } from "@/lib/detect-language"
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata"
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram"
import { canContinueUnfinishedDeepChapter } from "./chat-resume"
import { getCopyableAssistantContent } from "@/lib/chat-copy-content"
import { parseAgentResponse } from "@/lib/novel/agent-parser"

interface ChatMessageProps {
  message: DisplayMessage
  isLastAssistant?: boolean
  onRegenerate?: () => void
  novelMode?: boolean
  projectPath?: string | null
  onSaveAsChapter?: (content: string) => void
  onContinueNextChapter?: () => void
  onContinueUnfinished?: () => void
  onSaveAsDraft?: (content: string) => void
  onDiscardDraft?: () => void
  saveStatus?: string
  isSaving?: boolean
}

export function ChatMessage({ message, isLastAssistant, onRegenerate, novelMode, projectPath, onSaveAsChapter, onContinueNextChapter, onContinueUnfinished, saveStatus, isSaving }: ChatMessageProps) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"
  const isAssistant = message.role === "assistant"
  const [hovered, setHovered] = useState(false)
  const canResumeUnfinished = Boolean(
    novelMode && isLastAssistant && onContinueUnfinished && canContinueUnfinishedDeepChapter(message.content),
  )

  return (
    <div
      className={`flex w-full gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isSystem
            ? "bg-accent text-accent-foreground"
            : isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 max-w-[80%] flex-1 flex flex-col gap-1.5">
        <div
          className={`w-full min-w-0 rounded-lg px-3 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : message.discarded
                ? "bg-muted/50 text-muted-foreground/50"
                : "bg-muted text-foreground"
          }`}
        >
          {message.discarded ? (
            <span className="italic text-xs opacity-60">已废弃</span>
          ) : isUser ? (
            <p dir="auto" className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <AgentAwareContent content={message.content} projectPath={projectPath} />
          )}
        </div>
        {isAssistant && !message.discarded && <CitedReferencesPanel content={message.content} savedReferences={message.references} />}
        {isAssistant && !message.discarded && (
          <div className="flex items-center gap-1 flex-wrap">
            {canResumeUnfinished && (
              <div className="basis-full rounded-md border border-amber-500/30 bg-amber-50/60 px-2 py-1.5 text-[11px] leading-5 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                这次深度生成已经完成了部分思考过程。点击“继续未完成”会基于上方已有阶段继续往后生成，通常比“重新生成”更节省 token；如果前面的思考方向本身不对，再使用“重新生成”。
              </div>
            )}
            {novelMode && isLastAssistant && onSaveAsChapter && (
              <button
                type="button"
                onClick={() => onSaveAsChapter(message.content)}
                disabled={isSaving}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
              >
                {isSaving ? "保存中..." : "保存到章节库"}
              </button>
            )}
            {novelMode && isLastAssistant && onContinueNextChapter && (
              <button
                type="button"
                onClick={onContinueNextChapter}
                disabled={isSaving}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
              >
                继续生成下一章
              </button>
            )}
            {canResumeUnfinished && (
              <button
                type="button"
                onClick={onContinueUnfinished}
                disabled={isSaving}
                className="rounded border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/35"
                title="基于已有思考过程继续生成，减少重复消耗"
              >
                继续未完成
              </button>
            )}
            {(hovered || (novelMode && isLastAssistant)) && (
              <CopyButton content={message.content} />
            )}
            {isLastAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="重新生成这条回复"
              >
                <RefreshCw className="h-3 w-3" /> 重新生成
              </button>
            )}
          </div>
        )}
        {saveStatus && (
          <p className="mt-1 text-xs text-muted-foreground">{saveStatus}</p>
        )}
      </div>
    </div>
  )
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const clean = getCopyableAssistantContent(content)
    await navigator.clipboard.writeText(clean)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
      title="复制到剪贴板"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "已复制" : "复制"}
    </button>
  )
}

interface CitedPage {
  title: string
  path: string
}

const REF_TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string }> = {
  entity: { icon: Users, color: "text-blue-500" },
  concept: { icon: Lightbulb, color: "text-purple-500" },
  source: { icon: BookOpen, color: "text-orange-500" },
  query: { icon: HelpCircle, color: "text-green-500" },
  synthesis: { icon: GitMerge, color: "text-red-500" },
  comparison: { icon: BarChart3, color: "text-teal-500" },
  overview: { icon: Layout, color: "text-yellow-500" },
  clip: { icon: Globe, color: "text-blue-400" },
}

function getRefType(path: string): string {
  if (path.includes("/entities/")) return "entity"
  if (path.includes("/concepts/")) return "concept"
  if (path.includes("/sources/")) return "source"
  if (path.includes("/queries/")) return "query"
  if (path.includes("/synthesis/")) return "synthesis"
  if (path.includes("/comparisons/")) return "comparison"
  if (path.includes("overview")) return "overview"
  if (path.includes("raw/sources/")) return "clip"
  return "source"
}

/**
 * Markdown image-reference regex used to count `![](url)` occurrences
 * in cited pages AND extract the first URL (so the image-badge
 * jump button knows where to send the user). Same shape as the
 * search/pipeline regex elsewhere (kept duplicated to avoid
 * coupling — this module never wants to pull caption-pipeline
 * imports for a 3-character count).
 *
 * Group 1 captures the URL (everything inside `(...)` of the
 * markdown image syntax, no whitespace).
 */
const CITED_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g

interface CitedImageInfo {
  count: number
  /** First image URL on the page — used as the scroll target when
   *  the badge button opens the raw source. Null when count===0. */
  firstUrl: string | null
}

function CitedReferencesPanel({ content, savedReferences }: { content: string; savedReferences?: CitedPage[] }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)
  const [expanded, setExpanded] = useState(false)
  /**
   * Per-cited-page image info: count + first image URL. We can't
   * hang this off `CitedPage` directly because `extractCitedPages`
   * is sync and works on the AI's text response, never seeing the
   * underlying page. So we fetch the page contents lazily here.
   * Same path → same info, so a tiny in-component map keyed by
   * path is plenty.
   */
  const [imageInfos, setImageInfos] = useState<Record<string, CitedImageInfo>>({})

  // Use saved references first (persisted with message), fall back to dynamic extraction
  const citedPages = useMemo(() => {
    if (savedReferences && savedReferences.length > 0) return savedReferences
    return extractCitedPages(content)
  }, [content, savedReferences])

  // Async-fetch each cited page's content once and extract image
  // info: count + first URL. Done in parallel; failures are
  // silently treated as { count: 0, firstUrl: null } (page may
  // not exist on disk yet, e.g. a citation the LLM hallucinated).
  useEffect(() => {
    if (!project || citedPages.length === 0) return
    const pp = normalizePath(project.path)
    let cancelled = false
    Promise.all(
      citedPages.map(async (page) => {
        // Try the path verbatim first, then the same fallback set
        // the click-handler uses below — keeps "is the file on
        // disk" check consistent across the panel.
        const id = getFileName(page.path.replace(/^wiki\//, "").replace(/\.md$/, ""))
        const candidates = [
          `${pp}/${page.path}`,
          `${pp}/wiki/entities/${id}.md`,
          `${pp}/wiki/concepts/${id}.md`,
          `${pp}/wiki/sources/${id}.md`,
          `${pp}/wiki/queries/${id}.md`,
          `${pp}/wiki/synthesis/${id}.md`,
          `${pp}/wiki/comparisons/${id}.md`,
          `${pp}/wiki/${id}.md`,
        ]
        for (const candidate of candidates) {
          try {
            const text = await readFile(candidate)
            // Reset stateful regex.lastIndex by `new RegExp(...)` —
            // module-level `g` regexes carry state across calls
            // and would skip matches on the second invocation.
            const re = new RegExp(CITED_IMAGE_RE.source, CITED_IMAGE_RE.flags)
            const matches = [...text.matchAll(re)]
            const info: CitedImageInfo = {
              count: matches.length,
              firstUrl: matches.length > 0 ? matches[0][1] : null,
            }
            return [page.path, info] as const
          } catch {
            // try next candidate
          }
        }
        return [page.path, { count: 0, firstUrl: null }] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      const next: Record<string, CitedImageInfo> = {}
      for (const [path, info] of entries) next[path] = info
      setImageInfos(next)
    })
    return () => {
      cancelled = true
    }
  }, [project, citedPages])

  /**
   * Open the raw source file for a page's first image and stage a
   * scroll target so the markdown preview lands on that image.
   * Mirrors the lightbox "Jump to source document" path in
   * search-view — same `findRawSourceForImage` resolver, same
   * `pendingScrollImageSrc` store handoff, same fallback to
   * opening the wiki page when no raw source is found.
   */
  const handleJumpToImageSource = useCallback(
    async (firstUrl: string, fallbackPath: string) => {
      if (!project) return
      const pp = normalizePath(project.path)
      const rawPath = await findRawSourceForImage(firstUrl, pp)
      if (rawPath) {
        try {
          const content = await readFile(rawPath)
          setPendingScrollImageSrc(imageUrlToAbsolute(firstUrl, pp))
          setSelectedFile(rawPath)
          setFileContent(content)
          console.log(`[refs:image-jump] ${firstUrl} → raw source ${rawPath}`)
          return
        } catch (err) {
          console.warn(`[refs:image-jump] failed to read ${rawPath}:`, err)
        }
      }
      // Fallback: open the wiki summary itself with same scroll
      // target — at least the safety-net section will scroll into
      // view there.
      try {
        const content = await readFile(`${pp}/${fallbackPath}`)
        setPendingScrollImageSrc(firstUrl)
        setSelectedFile(`${pp}/${fallbackPath}`)
        setFileContent(content)
      } catch (err) {
        console.warn(`[refs:image-jump] fallback also failed:`, err)
      }
    },
    [project, setPendingScrollImageSrc, setSelectedFile, setFileContent],
  )

  if (citedPages.length === 0) return null

  const MAX_COLLAPSED = 3
  const visiblePages = expanded ? citedPages : citedPages.slice(0, MAX_COLLAPSED)
  const hasMore = citedPages.length > MAX_COLLAPSED

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs mb-1">
      <button
        type="button"
        onClick={() => hasMore && setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-medium">引用资料（{citedPages.length}）</span>
        {hasMore && (
          expanded
            ? <ChevronDown className="h-3 w-3 ml-auto" />
            : <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      <div className="px-2 pb-1.5">
        {visiblePages.map((page, i) => {
          const refType = getRefType(page.path)
          const config = REF_TYPE_CONFIG[refType] ?? REF_TYPE_CONFIG.source
          const Icon = config.icon
          const info = imageInfos[page.path]
          const hasImages = (info?.count ?? 0) > 0
          const openCitedPage = async () => {
            if (!project) return
            const pp = normalizePath(project.path)
            const id = getFileName(page.path.replace(/^wiki\//, "").replace(/\.md$/, ""))
            const candidates = [
              `${pp}/${page.path}`,
              `${pp}/wiki/entities/${id}.md`,
              `${pp}/wiki/concepts/${id}.md`,
              `${pp}/wiki/sources/${id}.md`,
              `${pp}/wiki/queries/${id}.md`,
              `${pp}/wiki/synthesis/${id}.md`,
              `${pp}/wiki/comparisons/${id}.md`,
              `${pp}/wiki/${id}.md`,
            ]
            for (const candidate of candidates) {
              try {
                await readFile(candidate)
                setSelectedFile(candidate)
                return
              } catch {
                // try next
              }
            }
            setSelectedFile(`${pp}/${page.path}`)
          }
          return (
            // Outer is a div, NOT a button — we have two click
            // targets inside (image badge + main row) and nesting
            // a button inside a button is invalid HTML and breaks
            // event delegation. Hover effect shifts to the inner
            // buttons individually so each gives feedback.
            <div
              key={page.path}
              className="flex w-full items-center gap-1.5 rounded text-left"
              title={page.path}
            >
              <span className="text-[10px] text-muted-foreground/60 w-4 shrink-0 text-right">[{i + 1}]</span>
              {/*
               * Image badge — clickable, separately from the page
               * row. Click → resolve the FIRST image's raw source
               * (`raw/sources/<slug>.<ext>`) and open the FULL
               * combined-extraction preview, scrolled to that
               * image. This mirrors the search-view lightbox
               * "Jump to source document" behavior so the two
               * surfaces feel consistent.
               *
               * Icon: lucide `Image` (picture-frame outline with
               * mountain + sun) — direct visual cue for "image",
               * NOT `Camera` which reads as "take a photo".
               */}
              {hasImages && info?.firstUrl && (
                <button
                  type="button"
                  onClick={() => handleJumpToImageSource(info.firstUrl!, page.path)}
                  className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100/40 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                  title={`打开第一张图片所在原始文档（本页共 ${info.count} 张图片）`}
                >
                  <ImageIcon className="h-3 w-3" />
                  {info.count}
                </button>
              )}
              <button
                type="button"
                onClick={openCitedPage}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/50 transition-colors"
              >
                <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
                <span className="truncate text-foreground/80">{page.title}</span>
              </button>
            </div>
          )
        })}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-center text-[10px] text-muted-foreground hover:text-primary pt-0.5"
          >
            +{citedPages.length - MAX_COLLAPSED} 条更多引用...
          </button>
        )}
      </div>
    </div>
  )
}


/**
 * Extract cited wiki pages from the hidden <!-- cited: 1, 3, 5 --> comment.
 * Maps page numbers back to the pages that were sent to the LLM.
 */
function extractCitedPages(text: string): CitedPage[] {
  const lastQueryPages = getLastQueryPages()
  const citedMatch = text.match(/<!--\s*cited:\s*(.+?)\s*-->/)
  if (citedMatch && lastQueryPages.length > 0) {
    const numbers = citedMatch[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= lastQueryPages.length)

    const pages = numbers.map((n) => lastQueryPages[n - 1])
    if (pages.length > 0) return pages
  }

  // Fallback: if LLM used [1], [2] notation in text, try to match those
  if (lastQueryPages.length > 0) {
    const numberRefs = text.match(/\[(\d+)\]/g)
    if (numberRefs) {
      const numbers = [...new Set(numberRefs.map((r) => parseInt(r.slice(1, -1), 10)))]
        .filter((n) => n >= 1 && n <= lastQueryPages.length)
      if (numbers.length > 0) {
        return numbers.map((n) => lastQueryPages[n - 1])
      }
    }
  }

  // Fallback for persisted messages: extract [[wikilinks]] from the text
  // Try to resolve each wikilink to a real file path by checking common wiki subdirectories
  const wikilinks = text.match(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)
  if (wikilinks) {
    const seen = new Set<string>()
    const pages: CitedPage[] = []
    const WIKI_DIRS = ["entities", "concepts", "sources", "queries", "synthesis", "comparisons"]

    for (const link of wikilinks) {
      const nameMatch = link.match(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/)
      if (nameMatch) {
        const id = nameMatch[1].trim()
        const display = nameMatch[2]?.trim() || id

        // Skip if id contains path separators (already a path like queries/xxx)
        if (seen.has(id)) continue
        seen.add(id)

        // Try to find the file in known wiki subdirectories
        let resolvedPath = ""
        if (id.includes("/")) {
          // Already has directory like "queries/my-query"
          resolvedPath = `wiki/${id}.md`
        } else {
          // Search in common directories
          for (const dir of WIKI_DIRS) {
            resolvedPath = `wiki/${dir}/${id}.md`
            // We can't do async file checking here, so try all known patterns
            // The click handler will try multiple paths
            break // Use first candidate, click handler resolves the rest
          }
          if (!resolvedPath) resolvedPath = `wiki/${id}.md`
        }

        pages.push({ title: display, path: resolvedPath })
      }
    }
    if (pages.length > 0) return pages
  }

  // No citations found
  return []
}

interface StreamingMessageProps {
  content: string
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  const { thinking, answer } = useMemo(() => separateThinking(content), [content])
  const isThinking = thinking !== null && answer.length === 0

  return (
    <div className="flex w-full gap-2 flex-row">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 w-full max-w-[80%] flex-1 rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
        {isThinking ? (
          <StreamingWorkflowBlock content={thinking} />
        ) : (
          <>
            {thinking && <WorkflowBlock content={thinking} />}
            <MarkdownContent content={answer} />
            <span className="animate-pulse">▊</span>
          </>
        )}
      </div>
    </div>
  )
}

function AgentAwareContent({ content, projectPath }: { content: string; projectPath?: string | null }) {
  const [applied, setApplied] = useState(false)
  const [results, setResults] = useState<import("@/lib/novel/agent-tools").FileEditResult[]>([])
  const [dismissed, setDismissed] = useState(false)

  const parsed = useMemo(() => {
    return parseAgentResponse(content)
  }, [content])

  const handleApply = useCallback(async (edits: import("@/lib/novel/agent-parser").FileEditAction[]) => {
    if (!projectPath) return []
    const { applyFileEdits } = await import("@/lib/novel/agent-tools")
    const editResults = await applyFileEdits(projectPath, edits)
    setResults(editResults)
    setApplied(true)
    // Refresh file tree
    await refreshProjectState(projectPath)
    return editResults
  }, [projectPath])

  return (
    <>
      <MarkdownContent content={parsed.textContent || content} />
      {parsed.hasEdits && !dismissed && projectPath ? (
        <FileEditPreview
          edits={parsed.edits}
          onApply={handleApply}
          onDismiss={() => setDismissed(true)}
          applied={applied}
          results={results}
        />
      ) : null}
    </>
  )
}

function MarkdownContent({ content }: { content: string }) {
  // Strip hidden comments
  const cleaned = content.replace(/<!--.*?-->/gs, "").trimEnd()

  // Project path for resolving wiki-relative image src in chat
  // replies (LLM may surface images that came in via retrieved
  // chunks, e.g. when the chat answer cites a diagram from a wiki
  // page). Same convention the file-preview uses.
  const projectPath = useWikiStore((s) => s.project?.path ?? null)

  // Separate thinking blocks from main content, filter LLM English thinking but keep workflow stages
  const { thinking, answer } = useMemo(() => separateThinking(cleaned), [cleaned])
  const processed = useMemo(() => processContent(answer), [answer])
  const renderLanguage = useMemo(() => detectLanguage(answer), [answer])
  const direction = getTextDirection(renderLanguage)
  const htmlLang = getHtmlLang(renderLanguage)

  return (
    <div className="w-full min-w-0">
      {thinking && <WorkflowBlock content={thinking} />}
      <div
        className="chat-markdown prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none"
        dir={direction}
        lang={htmlLang}
        style={{ textAlign: "start" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("wikilink:")) {
                const pageName = href.slice("wikilink:".length)
                return <WikiLink pageName={pageName}>{children}</WikiLink>
              }
              return (
                <span className="text-primary underline cursor-default" title={href}>
                  {children}
                </span>
              )
            },
            img: ({ src, alt, ...props }) => (
              <img
                src={typeof src === "string" ? resolveMarkdownImageSrc(src, projectPath) : undefined}
                alt={alt ?? ""}
                className="my-2 max-w-full rounded border border-border/40"
                loading="lazy"
                {...props}
              />
            ),
            table: ({ children, ...props }) => (
              <div className="my-2 overflow-x-auto rounded border border-border">
                <table className="w-full border-collapse text-xs" {...props}>{children}</table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead className="bg-muted" {...props}>{children}</thead>
            ),
            th: ({ children, ...props }) => (
              <th className="border border-border/80 px-3 py-1.5 text-start font-semibold bg-muted" {...props}>{children}</th>
            ),
            td: ({ children, ...props }) => (
              <td className="border border-border/60 px-3 py-1.5" {...props}>{children}</td>
            ),
            pre: ({ children, ...props }) => {
              const mermaid = unwrapMermaidPre(children)
              if (mermaid) return <>{mermaid}</>
              return (
                <pre
                  dir="ltr"
                  className="rounded bg-background/50 p-2 text-xs overflow-x-auto"
                  style={{ textAlign: "left" }}
                  {...props}
                >
                  {children}
                </pre>
              )
            },
            code: ({ className, children, ...props }) => {
              const lang = className?.replace("language-", "")
              const codeText = String(children).replace(/\n$/, "")
              if (lang === "mermaid") {
                return <MermaidDiagram code={codeText} />
              }
              return <code dir="ltr" className={className} {...props}>{children}</code>
            },
          }}
        >
          {processed}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * 检测文本是否主要是LLM英文思考内容（应隐藏）
 * 特征：主要是英文，包含典型推理词汇，中文字符极少
 */
function isLlmEnglishThinking(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // 统计中文字符数
  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length
  const totalChars = trimmed.length
  const chineseRatio = chineseChars / Math.max(totalChars, 1)

  // 如果中文字符占比超过15%，认为是中文内容（工作流信息），保留
  if (chineseRatio > 0.15) return false

  // 检测典型的LLM英文思考关键词
  const thinkingKeywords = [
    "thinking process",
    "let's think",
    "let me think",
    "analyze",
    "let's write",
    "wait,",
    "word count",
    "constraints",
    "note:",
    "check:",
    "strategy",
    "i need to",
    "i should",
    "first,",
    "okay,",
    "so,",
    "now,",
    "the user",
    "based on",
    "according to",
  ]
  const lower = trimmed.toLowerCase()
  const keywordCount = thinkingKeywords.filter((kw) => lower.includes(kw)).length

  // 如果包含2个以上思考关键词且中文很少，判定为LLM英文思考
  return keywordCount >= 2
}

/**
 * 检测一行是否是工作流阶段标题
 */
function isWorkflowStageHeader(line: string): boolean {
  const trimmed = line.trim()
  // 匹配 ## 阶段X... 格式
  if (/^##\s*阶段/.test(trimmed)) return true
  // 匹配 "阶段X：" 或 "阶段X:" 开头的行（即使没有##）
  if (/^阶段\s*[\d.]+\s*[：:]/.test(trimmed)) return true
  return false
}

/**
 * 过滤思考块内容，保留中文工作流阶段信息，隐藏LLM英文思考
 */
function filterThinkingContent(thinking: string): string | null {
  const lines = thinking.split("\n")
  const resultLines: string[] = []
  let currentStageHeader: string | null = null
  let currentStageContent: string[] = []

  const flushStage = () => {
    if (currentStageHeader) {
      resultLines.push(currentStageHeader)
      const contentText = currentStageContent.join("\n").trim()
      if (contentText) {
        // 检查内容是否是LLM英文思考
        if (!isLlmEnglishThinking(contentText)) {
          resultLines.push(...currentStageContent)
        }
      }
      resultLines.push("")
    } else if (currentStageContent.length > 0) {
      // 没有阶段标题的独立内容块
      const blockText = currentStageContent.join("\n").trim()
      if (blockText && !isLlmEnglishThinking(blockText)) {
        resultLines.push(...currentStageContent)
        resultLines.push("")
      }
    }
    currentStageHeader = null
    currentStageContent = []
  }

  for (const line of lines) {
    if (isWorkflowStageHeader(line)) {
      // 新的阶段开始，先flush之前的
      flushStage()
      currentStageHeader = line
    } else if (currentStageHeader) {
      // 当前正在收集阶段内容
      currentStageContent.push(line)
    } else {
      // 不在阶段内的内容，按段落处理
      currentStageContent.push(line)
      // 空行表示段落结束
      if (!line.trim()) {
        flushStage()
      }
    }
  }
  // flush最后一个阶段
  flushStage()

  const result = resultLines.join("\n").trim()
  return result || null
}

/**
 * Separate <think>...</think> blocks from the main answer.
 * Handles multiple think blocks and partial (unclosed) thinking during streaming.
 * 保留工作流阶段提示（中文），过滤LLM英文思考内容。
 */
function separateThinking(text: string): { thinking: string | null; answer: string } {
  // Match complete <think>...</think> and <thinking>...</thinking> blocks
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const thinkParts: string[] = []
  let answer = text

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim())
  }
  answer = answer.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim()

  // Handle unclosed <think> or <thinking> tag (streaming in progress)
  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i)
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim())
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, "").trim()
  }

  // 处理只有结尾 </think> 标签的情况（没有开头标签）
  const firstCloseIndex = answer.search(/<\/think(?:ing)?>/i)
  if (firstCloseIndex >= 0) {
    const beforeClose = answer.slice(0, firstCloseIndex)
    if (!/<think(?:ing)?>/i.test(beforeClose)) {
      const thinkingContent = beforeClose.trim()
      if (thinkingContent) {
        thinkParts.push(thinkingContent)
      }
      answer = answer.replace(/^[\s\S]*?<\/think(?:ing)?>\s*/i, "")
    }
  }

  const rawThinking = thinkParts.length > 0 ? thinkParts.join("\n\n") : null
  const filteredThinking = rawThinking ? filterThinkingContent(rawThinking) : null

  return { thinking: filteredThinking, answer: answer.trim() }
}

function countWorkflowStages(content: string): number {
  return content.split("\n").filter((line) => isWorkflowStageHeader(line)).length
}

function getThinkingBlockMeta(content: string, streaming: boolean): { title: string; stageCount: number | null } {
  const stageCount = countWorkflowStages(content)
  if (stageCount > 0) {
    return {
      title: streaming ? "工作流进行中..." : "工作流阶段",
      stageCount,
    }
  }
  return {
    title: streaming ? "思考中..." : "思考过程",
    stageCount: null,
  }
}

/** 模型 reasoning 流式输出常带大量换行；合并为连续文本，避免被误切成上百个“阶段”。 */
function formatThinkingForDisplay(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ""

  if (countWorkflowStages(trimmed) > 0) {
    return trimmed.replace(/\n{3,}/g, "\n\n")
  }

  return trimmed.replace(/\s*\n+\s*/g, "")
}

/** Streaming workflow: show stages as they come in so user can see progress. */
function StreamingWorkflowBlock({ content }: { content: string }) {
  const displayContent = useMemo(() => formatThinkingForDisplay(content), [content])
  const { title } = useMemo(() => getThinkingBlockMeta(content, true), [content])

  return (
    <div className="w-full min-w-0 rounded-md border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-2 min-h-[3rem]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm animate-pulse">📋</span>
        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">{title}</span>
      </div>
      <div className="w-full min-w-0 max-h-72 overflow-y-auto overflow-x-hidden pr-1 text-xs text-blue-800/70 dark:text-blue-300/60 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {displayContent}
        <span className="animate-pulse text-blue-500">▊</span>
      </div>
    </div>
  )
}

/** Completed workflow stages: keep visible so user can review what happened. */
function WorkflowBlock({ content }: { content: string }) {
  const displayContent = useMemo(() => formatThinkingForDisplay(content), [content])
  const { title, stageCount } = useMemo(() => getThinkingBlockMeta(content, false), [content])

  return (
    <div className="mb-2 w-full min-w-0 rounded-md border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 min-h-[3rem]">
      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-blue-700 dark:text-blue-400">
        <span className="text-sm">📋</span>
        <span className="font-medium">{title}</span>
        {stageCount !== null && (
          <span className="text-[10px] text-blue-600/60 dark:text-blue-500/60">{stageCount} 个阶段</span>
        )}
      </div>
      <div className="w-full min-w-0 max-h-72 overflow-y-auto overflow-x-hidden border-t border-blue-500/20 px-2.5 py-2 pr-1 text-xs text-blue-800/80 dark:text-blue-300/70 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
        {displayContent}
      </div>
    </div>
  )
}

/**
 * Process content to create clickable links:
 * - [[wikilinks]] → markdown links with wikilink: protocol
 */
function processContent(text: string): string {
  let result = text

  // Wrap bare \begin{...}...\end{...} blocks with $$ for remark-math
  result = result.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  )

  // Only apply Unicode conversion to text outside of math delimiters
  // Split on $$...$$ and $...$ blocks, only convert non-math parts
  const parts = result.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g)
  result = parts
    .map((part) => {
      if (part.startsWith("$")) return part // preserve math
      return convertLatexToUnicode(part)
    })
    .join("")

  // Fix malformed wikilinks like [[name] (missing closing bracket)
  result = result.replace(/\[\[([^\]]+)\](?!\])/g, "[[$1]]")

  // Convert [[wikilinks]] to markdown links
  result = result.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, pageName: string, displayText?: string) => {
      const display = displayText?.trim() || pageName.trim()
      return `[${display}](wikilink:${pageName.trim()})`
    }
  )

  return result
}

function WikiLink({ pageName, children }: { pageName: string; children: React.ReactNode }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [exists, setExists] = useState<boolean | null>(null)
  const resolvedPath = useRef<string | null>(null)

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    const candidates = [
      `${pp}/wiki/entities/${pageName}.md`,
      `${pp}/wiki/concepts/${pageName}.md`,
      `${pp}/wiki/sources/${pageName}.md`,
      `${pp}/wiki/queries/${pageName}.md`,
      `${pp}/wiki/comparisons/${pageName}.md`,
      `${pp}/wiki/synthesis/${pageName}.md`,
      `${pp}/wiki/${pageName}.md`,
    ]

    let cancelled = false
    async function check() {
      for (const path of candidates) {
        try {
          await readFile(path)
          if (!cancelled) {
            resolvedPath.current = path
            setExists(true)
          }
          return
        } catch {
          // try next
        }
      }
      if (!cancelled) setExists(false)
    }
    check()
    return () => { cancelled = true }
  }, [project, pageName])

  const handleClick = useCallback(async () => {
    if (!resolvedPath.current) return
    try {
      const content = await readFile(resolvedPath.current)
      setSelectedFile(resolvedPath.current)
      setFileContent(content)
      setActiveView("wiki")
    } catch {
      // ignore
    }
  }, [setSelectedFile, setFileContent, setActiveView])

  if (exists === false) {
    return (
      <span className="inline text-muted-foreground" title={`Page not found: ${pageName}`}>
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-primary underline decoration-primary/30 hover:bg-primary/10 hover:decoration-primary"
      title={`Open wiki page: ${pageName}`}
    >
      <FileText className="inline h-3 w-3" />
      {children}
    </button>
  )
}
