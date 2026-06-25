import { useState, useCallback, useMemo, useEffect, memo } from "react"
import { Search, FileText, ImageIcon, X, ArrowUpRight } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import type { SearchResult, ImageRef } from "@/lib/search"
import { useTranslation } from "react-i18next"
import { normalizePath } from "@/lib/path-utils"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { findRawSourceForImage, imageUrlToAbsolute } from "@/lib/raw-source-resolver"
import { isImeComposing } from "@/lib/keyboard-utils"

const MAX_HISTORY = 20
const SEARCH_PAGE_TOP_K = 20
const STOP_WORDS = new Set([
  "的", "是", "了", "在", "有", "和", "中", "对", "们",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

interface NovelSearchUiOptions {
  includeKeyword: boolean
  includeVector: boolean
  includeGraph: boolean
  includeRecentChapters: boolean
  includeCanon: boolean
}

function tokenizeSearchQuery(query: string): string[] {
  const rawTokens = query
    .toLowerCase()
    .split(/[\s,锛屻€傦紒锛熴€侊紱:"''锛堬級()\-_/\\路~锝炩€?]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))

  const tokens: string[] = []
  for (const token of rawTokens) {
    const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)
    if (hasCjk && token.length > 2) {
      const chars = [...token]
      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.push(chars[index] + chars[index + 1])
      }
      for (const char of chars) {
        if (!STOP_WORDS.has(char)) tokens.push(char)
      }
    }
    tokens.push(token)
  }

  return [...new Set(tokens)]
}

function shouldUseAdvancedNovelSearch(options: NovelSearchUiOptions): boolean {
  return (
    options.includeVector ||
    options.includeGraph ||
    options.includeRecentChapters ||
    options.includeCanon ||
    !options.includeKeyword
  )
}

async function runWikiPanelSearch(
  projectPath: string,
  query: string,
  options?: { rerank?: boolean; includeVector?: boolean },
): Promise<SearchResult[]> {
  const { searchWiki } = await import("@/lib/search")
  return searchWiki(projectPath, query, {
    topK: SEARCH_PAGE_TOP_K,
    rerank: options?.rerank,
    includeVector: options?.includeVector,
    rerankPurpose: "用于搜索面板展示最相关的知识页面。",
  })
}

async function runNovelPanelSearch(
  projectPath: string,
  query: string,
  options: NovelSearchUiOptions,
): Promise<SearchResult[]> {
  if (
    !options.includeKeyword &&
    !options.includeVector &&
    !options.includeGraph &&
    !options.includeRecentChapters &&
    !options.includeCanon
  ) {
    return []
  }

  if (!shouldUseAdvancedNovelSearch(options)) {
    console.log("[Search] using minimal novel keyword search")
    return runWikiPanelSearch(projectPath, query, { rerank: false, includeVector: false })
  }

  console.log("[Search] using advanced novel mixed search")
  const { searchPlot } = await import("@/lib/novel/search-adapter")
  const novelResults = await searchPlot(projectPath, query, options)
  return novelResults.map((result) => ({
    path: result.path,
    title: result.title,
    snippet: result.snippet,
    titleMatch: true,
    score: result.relevance,
    images: [],
  }))
}

function getHistoryKey(projectId: string): string {
  return `qmai_search_history_${projectId}`
}

function loadSearchHistory(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(getHistoryKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
    return []
  } catch {
    return []
  }
}

function saveSearchHistory(projectId: string, history: string[]): void {
  try {
    localStorage.setItem(getHistoryKey(projectId), JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}

/**
 * One image hit displayed in the Images section.
 *
 * `sourcePath` is the wiki page that contains this image reference
 * 鈥?clicking the card opens that page (and the page's markdown
 * preview will scroll the user down to the image naturally).
 *
 * `altMatchesQuery` is whether the caption / alt text matches the
 * query. Used only for ordering: caption matches sort first.
 */
interface ImageHit extends ImageRef {
  sourcePath: string
  sourceTitle: string
  altMatchesQuery: boolean
}

interface SearchViewProps {
  onClose?: () => void
  onOpenFile?: (payload: { path: string; scrollImageSrc?: string | null }) => Promise<void> | void
}

export function SearchView({ onClose, onOpenFile }: SearchViewProps) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const setSearchHistory = useWikiStore((s) => s.setSearchHistory)
  const searchTrigger = useWikiStore((s) => s.searchTrigger)
  const setSearchTriggerInStore = useWikiStore((s) => s.setSearchTrigger)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [lightbox, setLightbox] = useState<ImageHit | null>(null)

  const [searchOpts, setSearchOpts] = useState<NovelSearchUiOptions>({
    includeKeyword: true,
    includeVector: false,
    includeGraph: false,
    includeRecentChapters: false,
    includeCanon: false,
  })

  const toggleSearchOpt = useCallback((key: keyof NovelSearchUiOptions) => {
    setSearchOpts((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  useEffect(() => {
    if (!project?.id) return
    const loaded = loadSearchHistory(project.id)
    if (loaded.length > 0) setSearchHistory(loaded)
  }, [project?.id, setSearchHistory])

  const doSearch = useCallback(
    async (q: string) => {
      console.log("[Search] START", q, "novelMode=", novelMode)
      if (!project || !q.trim()) {
        console.log("[Search] SKIP - no project or empty query")
        setResults([])
        return
      }
      setSearching(true)
      setHasSearched(true)
      const trimmedQuery = q.trim()
      const current = useWikiStore.getState().searchHistory
      const filtered = current.filter((h) => h !== trimmedQuery)
      const next = [trimmedQuery, ...filtered].slice(0, MAX_HISTORY)
      saveSearchHistory(project.id, next)
      setSearchHistory(next)
      try {
        const projectPath = normalizePath(project.path)
        if (novelMode) {
          const t0 = performance.now()
          const novelResults = await runNovelPanelSearch(projectPath, q, searchOpts)
          console.log("[Search] novel panel search done in", Math.round(performance.now() - t0), "ms, got", novelResults.length, "results")
          setResults(novelResults)
        } else {
          const t0 = performance.now()
          const found = await runWikiPanelSearch(projectPath, q, { rerank: true, includeVector: true })
          console.log("[Search] searchWiki done in", Math.round(performance.now() - t0), "ms, got", found.length, "results")
          setResults(found)
        }
      } catch (err) {
        console.error("[Search] FAILED:", err)
        setResults([])
      } finally {
        console.log("[Search] FINISHED, searching=", false)
        setSearching(false)
      }
    },
    [project, novelMode, searchOpts, setSearchHistory],
  )

  useEffect(() => {
    if (searchTrigger) {
      setQuery(searchTrigger.query)
      doSearch(searchTrigger.query)
      setSearchTriggerInStore(null)
    }
  }, [searchTrigger, doSearch, setSearchTriggerInStore])

  // Flatten + dedupe images across results. Two results referencing
  // the same image (e.g. the source-summary AND a concept page that
  // cited the figure) collapse to one card; we keep the FIRST
  // result we saw it in as the click target since results are
  // already sorted by RRF descending.
  //
  // Caption matching uses the SAME tokenizer the main search uses
  // (`tokenizeQuery`), not raw substring containment. Without this
  // a query like "鎬昏祫浜с€? wouldn't match the caption "鍥撅細2023
  // 骞存€昏祫浜у悎璁? 鈥?the trailing 銆?has no business in a substring
  // test against alt text that doesn't end at that exact spot.
  // Falls back to the raw lowercased query when tokenization
  // returns nothing (e.g. user typed only punctuation), so the
  // filter never silently goes empty when the user expected hits.
  const imageHits = useMemo(() => {
    if (!query.trim()) return [] as ImageHit[]
    const fallback = query.trim().toLowerCase()
    const seen = new Set<string>()
    const tokens = tokenizeSearchQuery(query)
    const out: ImageHit[] = []
    for (const r of results) {
      for (const img of r.images) {
        if (seen.has(img.url)) continue
        seen.add(img.url)
        const altLower = img.alt.toLowerCase()
        const altMatchesQuery =
          tokens.length > 0
            ? tokens.some((t) => altLower.includes(t))
            : altLower.includes(fallback)
        out.push({
          ...img,
          sourcePath: r.path,
          sourceTitle: r.title,
          altMatchesQuery,
        })
      }
    }
    // Caption-matches first, then preserve RRF order.
    return out.sort((a, b) => Number(b.altMatchesQuery) - Number(a.altMatchesQuery))
  }, [results, query])

  // Image hits whose CAPTION matches the query are the ones we
  // confidently surface. Hits from matched pages whose alt text
  // doesn't match the query are "supporting" (visible after a
  // toggle) 鈥?showing them ALL by default would dilute the image
  // grid with logos / page-corner decorations.
  const [showSupportingImages, setShowSupportingImages] = useState(false)
  const matchingImages = imageHits.filter((h) => h.altMatchesQuery)
  const supportingImages = imageHits.filter((h) => !h.altMatchesQuery)
  const visibleImages = showSupportingImages ? imageHits : matchingImages

  const handleOpen = useCallback(
    async (path: string) => {
      try {
        if (onOpenFile) {
          await onOpenFile({ path })
          return
        }
        const content = await readFile(path)
        setActiveView("wiki")
        setSearchPanelOpen(false)
        setSelectedFile(path)
        setFileContent(content)
        onClose?.()
      } catch (err) {
        console.error("Failed to open search result:", err)
      }
    },
    [onClose, onOpenFile, setActiveView, setFileContent, setSearchPanelOpen, setSelectedFile],
  )

  /**
   * Lightbox jump-to-source: open the ORIGINAL raw source file
   * (the PDF / DOCX / PPTX in `raw/sources/`), not the LLM-
   * summarized `wiki/sources/<slug>.md`. The wiki summary is
   * abbreviated by design 鈥?the user's mental model when they
   * click a search-result image is "show me where this came
   * from in the actual document," and that's the raw file.
   *
   * Path derivation: image URLs always live under
   * `<project>/wiki/media/<slug>/img-N.<ext>`. The slug matches
   * the basename of the original raw source (we wrote it that
   * way at extraction time in extract_pdf_markdown / fs.rs's
   * raw-sources-layout heuristic). We list `raw/sources/` once
   * and pick the file whose stem equals the slug.
   *
   * The raw file's preview goes through `read_file` 鈫?the
   * combined-extraction path (text + per-page image refs with
   * absolute URLs), which means the `<img data-mdsrc=...>` we
   * scroll-target lives in the same DOM. To match what the
   * preview emits, we normalize `hit.url` to its absolute form
   * before staging the pending scroll 鈥?wiki-relative URLs
   * (from the safety-net section) wouldn't otherwise match the
   * absolute URLs the raw extractor uses.
   *
   * Fallback: if we can't find a raw source file (e.g. the user
   * deleted it after ingest, leaving only the wiki summary), we
   * open the wiki page so SOMETHING happens.
   */
  async function handleJumpFromLightbox(hit: ImageHit) {
    const projectPath = project?.path
    let openPath = hit.sourcePath
    let scrollTarget = hit.url

    if (projectPath) {
      const pp = normalizePath(projectPath)
      const rawPath = await findRawSourceForImage(hit.url, pp)
      if (rawPath) {
        console.log(`[search:jump] ${hit.url} 鈫?raw source ${rawPath}`)
        openPath = rawPath
        scrollTarget = imageUrlToAbsolute(scrollTarget, pp)
      } else {
        console.warn(
          `[search:jump] no raw source found for image ${hit.url} 鈥?falling back to wiki page`,
        )
      }
    }

    try {
      if (onOpenFile) {
        await onOpenFile({ path: openPath, scrollImageSrc: scrollTarget })
        return
      }
      const content = await readFile(openPath)
      setActiveView("wiki")
      setSearchPanelOpen(false)
      setPendingScrollImageSrc(scrollTarget)
      setSelectedFile(openPath)
      setFileContent(content)
      setLightbox(null)
      onClose?.()
    } catch (err) {
      console.error("Failed to jump to source:", err)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return
                if (e.key === "Enter") doSearch(query)
              }}
              placeholder={t(novelMode ? "novel.search.placeholder" : "search.placeholder")}
              autoFocus
              className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              关闭
            </button>
          ) : null}
        </div>
        {novelMode && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([
              ["keyword", "includeKeyword"],
              ["vector", "includeVector"],
              ["graph", "includeGraph"],
              ["recentChapters", "includeRecentChapters"],
              ["canon", "includeCanon"],
            ] as const).map(([labelKey, optKey]) => {
              const active = searchOpts[optKey] as boolean
              return (
                <button
                  key={optKey}
                  type="button"
                  onClick={() => toggleSearchOpt(optKey)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {t(`novel.search.${labelKey}`)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/*
       * Body. Two independently scrollable regions: images (capped
       * height = 2 rows of thumbnails) and pages (fills the rest).
       * Stacked, no outer scroll 鈥?the user asked for "image grid
       * doesn't push the text list off-screen, both areas scroll
       * inside themselves."
       */}
      {searching ? (
        <div className="flex-1 p-4 text-center text-sm text-muted-foreground">
          {t("search.searching")}
        </div>
      ) : !hasSearched ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <Search className="h-8 w-8 text-muted-foreground/30" />
          <p>{t("search.pressEnter")}</p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex-1 p-4 text-center text-sm text-muted-foreground">
          {t(novelMode ? "novel.search.noResults" : "search.noResults")} <span className="font-medium">"{query}"</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 pt-3 pb-1 text-xs text-muted-foreground">
            {t("search.pageCount", { count: results.length })}
            {imageHits.length > 0 && (
              <>
                {" 路 "}
                {t("search.imageMatchCount", { count: matchingImages.length })}
                {supportingImages.length > 0 && ` 路 ${t("search.supportingImagesHint", { count: supportingImages.length })}`}
              </>
            )}
          </div>

          {/* 鈹€鈹€ Images: fixed-height thumbnails, 2 rows visible, scrolls inside 鈹€鈹€ */}
          {visibleImages.length > 0 && (
            <>
              <div className="shrink-0 px-3 pt-1">
                <SectionHeader
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label={t("search.imagesSection")}
                  count={visibleImages.length}
                  trailing={
                    supportingImages.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowSupportingImages((s) => !s)}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        {showSupportingImages
                          ? t("search.hideSupporting")
                          : t("search.showAllPlus", { count: supportingImages.length })}
                      </button>
                    ) : null
                  }
                />
              </div>
              {/*
               * Cap height at 2-rows-worth of cards. Each `ImageHitCard`
               * is fixed at ~176px tall (120px thumbnail + 2-line
               * caption + source title + padding); with `gap-2` (8px)
               * between rows that's ~360px for two rows. We pad to
               * 23rem (368px) so the bottom edge of the second row
               * isn't visually flush with the scrollbar / next
               * section. Anything beyond 2 rows stays accessible via
               * vertical scroll inside this container ONLY 鈥?the
               * Pages list below keeps its own scroll independent.
               */}
              <div className="max-h-[23rem] shrink-0 overflow-y-auto px-3 pt-2 pb-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleImages.map((img) => (
                    <ImageHitCard
                      key={img.url}
                      hit={img}
                      query={query}
                      onClick={() => setLightbox(img)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 鈹€鈹€ Pages: takes remaining vertical space, scrolls inside 鈹€鈹€ */}
          <div className="shrink-0 px-3 pt-1">
            <SectionHeader
              icon={<FileText className="h-3.5 w-3.5" />}
              label={t("search.pagesSection")}
              count={results.length}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
            <div className="flex flex-col gap-1">
              {results.map((result) => (
                <SearchResultCard
                  key={result.path}
                  result={result}
                  query={query}
                  path={result.path}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox modal 鈥?only mounted when an image is selected.
       *  Sits at the SearchView root so it overlays everything inside
       *  this view but doesn't escape into other views' DOM. */}
      {lightbox && (
        <Lightbox
          hit={lightbox}
          projectPath={project?.path ?? null}
          onClose={() => setLightbox(null)}
          onJumpToSource={() => handleJumpFromLightbox(lightbox)}
        />
      )}
    </div>
  )
}

function Lightbox({
  hit,
  projectPath,
  onClose,
  onJumpToSource,
}: {
  hit: ImageHit
  projectPath: string | null
  onClose: () => void
  onJumpToSource: () => void
}) {
  const { t } = useTranslation()
  // Escape-to-close. Body-scroll-lock while open: a long search-
  // results list scrolling underneath the modal is disorienting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const src = resolveMarkdownImageSrc(hit.url, projectPath)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      // Backdrop is the click target; the inner card stops
      // propagation so clicks inside don't accidentally close.
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[90vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header strip 鈥?caption + close button. */}
        <div className="flex items-start justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {hit.alt ? (
              <div className="line-clamp-3 text-sm leading-snug">{hit.alt}</div>
            ) : (
              <div className="text-sm italic text-muted-foreground">{t("search.noCaption")}</div>
            )}
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              {t("search.fromSource")}{hit.sourceTitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Image area 鈥?flex-1 fills, object-contain preserves aspect. */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-4">
          <img
            src={src}
            alt={hit.alt || ""}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {/* Action strip 鈥?single button to jump to source.
         *  Right-aligned so the eye lands on it after reading the
         *  caption (left-to-right). */}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <button
            type="button"
            onClick={onJumpToSource}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {t("search.jumpToSource")}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  icon,
  label,
  count,
  trailing,
}: {
  icon: React.ReactNode
  label: string
  count: number
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b pb-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
        <span className="text-muted-foreground/60">({count})</span>
      </div>
      {trailing}
    </div>
  )
}

const ImageHitCard = memo(
  function ImageHitCard({
    hit,
    query,
    onClick,
  }: {
    hit: ImageHit
    query: string
    onClick: () => void
  }) {
    const { t } = useTranslation()
    const project = useWikiStore((s) => s.project)
    const projectPath = project?.path ?? null
    const src = resolveMarkdownImageSrc(hit.url, projectPath)

    return (
      <button
        type="button"
        onClick={onClick}
        title={hit.alt || hit.sourceTitle}
        className="group flex h-44 flex-col overflow-hidden rounded-lg border bg-background text-left transition-colors hover:bg-accent"
      >
        <div className="h-30 w-full shrink-0 overflow-hidden bg-muted" style={{ height: "7.5rem" }}>
          <img
            src={src}
            alt={hit.alt || ""}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.opacity = "0"
            }}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
          {hit.alt ? (
            <div className="line-clamp-2 text-[11px] leading-snug">
              <HighlightedText text={hit.alt} query={query} />
            </div>
          ) : (
            <div className="text-[11px] italic text-muted-foreground">{t("search.noCaption")}</div>
          )}
          <div className="mt-auto truncate text-[10px] text-muted-foreground">
            {hit.sourceTitle}
          </div>
        </div>
      </button>
    )
  },
  (prev, next) => prev.hit.url === next.hit.url && prev.query === next.query,
)

const SearchResultCard = memo(function SearchResultCard({
  result,
  query,
  path,
  onOpen,
}: {
  result: SearchResult
  query: string
  path: string
  onOpen: (path: string) => void
}) {
  const shortPath = result.path.split("/wiki/").pop() ?? result.path

  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="w-full rounded-lg border p-3 text-left text-sm hover:bg-accent transition-colors"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            <HighlightedText text={result.title} query={query} />
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{shortPath}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">
        <HighlightedText text={result.snippet} query={query} />
      </p>
    </button>
  )
})

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>

  const tokens = tokenizeSearchQuery(query)
  const patterns = tokens.length > 0 ? tokens : [query.trim()]
  const escapedTokens = patterns.map(escapeRegex).join("|")
  const regex = new RegExp(`(${escapedTokens})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        i % 2 !== 0 ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
