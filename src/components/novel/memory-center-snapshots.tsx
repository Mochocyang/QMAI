import { useMemo, useState } from "react"
import { Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MemoryCenterSnapshotCard } from "@/lib/novel/memory-center"
import { outlineSnapshotTitle } from "./memory-center-tabs"

/**
 * 章节 / 大纲快照卡片与它们的集合。
 *
 * 这里**只吃 props、不碰 store** —— 这是原来内层双栏（左章节列表 + 右详情）
 * 留下的最值钱的一条边界：卡片本身与"怎么选、在哪显示"无关，
 * 所以从主从结构改成全宽流式，只需要换掉集合那一层。
 */

type Translate = (key: string, opts?: Record<string, unknown>) => string

export const DEFAULT_SNAPSHOT_PAGE_SIZE = 15

function snapshotCardTitle(card: MemoryCenterSnapshotCard, t: Translate): string {
  // 大纲编号是文件名哈希，对人无意义，标题缺失时用绝对值兜底，不露负号。
  if (card.chapterNumber < 0) return outlineSnapshotTitle(card, t)
  return card.chapterTitle || t("novel.memoryCenter.snapshots.chapter", { chapter: card.chapterNumber })
}

function SnapshotList({
  title,
  items,
  hasMore,
}: {
  title: string
  items: string[]
  hasMore: boolean
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-1 text-xs text-foreground">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
        {hasMore ? <li className="text-muted-foreground">…</li> : null}
      </ul>
    </div>
  )
}

export function SnapshotCard({
  card,
  buttonId,
  onOpen,
  onEdit,
  onDelete,
  t,
}: {
  card: MemoryCenterSnapshotCard
  buttonId: string
  onOpen: (path: string, title: string, focusId: string) => void
  onEdit: (chapterNumber: number) => void
  onDelete: (chapterNumber: number, title: string) => void
  t: Translate
}) {
  const title = snapshotCardTitle(card, t)
  return (
    <div data-ui="memory-snapshot" className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {title}
          </div>
          <div className="mt-1 text-[0.6875rem] text-muted-foreground">
            {card.memorySynced
              ? t("novel.memoryCenter.snapshots.synced")
              : t("novel.memoryCenter.snapshots.unsynced")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            id={buttonId}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpen(card.snapshotPath, title, buttonId)}
          >
            {t("novel.memoryCenter.snapshots.openSnapshot")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onEdit(card.chapterNumber)}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {t("novel.memoryCenter.edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-destructive/50 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(card.chapterNumber, title)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {t("novel.memoryCenter.delete")}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-foreground">
        {card.summary || t("novel.memoryCenter.snapshots.summaryFallback")}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SnapshotList
          title={t("novel.snapshot.characterStateChanges")}
          items={card.characterStateChanges}
          hasMore={card.hasMoreCharacterStateChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.knowledgeChanges")}
          items={card.knowledgeChanges}
          hasMore={card.hasMoreKnowledgeChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.foreshadowingChanges")}
          items={card.foreshadowingChanges}
          hasMore={card.hasMoreForeshadowingChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.timelineEvents")}
          items={card.timelineEvents}
          hasMore={card.hasMoreTimelineEvents}
        />
      </div>

      {card.endingHook ? (
        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("novel.snapshot.endingHook")}：</span>
          {card.endingHook}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 一类快照的全宽流式集合。
 *
 * 取代原来的「左侧章节列表 + 右侧详情」：章节列表不再是一根竖栏，
 * 区间筛选变成顶部一条工具行，卡片全宽纵向堆叠。
 *
 * 区间筛选只对章节有意义（大纲的编号是哈希，按它筛没有语义），
 * 所以 `variant === "outline"` 时不渲染工具行。
 */
export function SnapshotCollection({
  cards,
  variant,
  onOpen,
  onEdit,
  onDelete,
  t,
}: {
  cards: MemoryCenterSnapshotCard[]
  variant: "chapter" | "outline"
  onOpen: (path: string, title: string, focusId: string) => void
  onEdit: (chapterNumber: number) => void
  onDelete: (chapterNumber: number, title: string) => void
  t: Translate
}) {
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd] = useState("")
  const [visibleCount, setVisibleCount] = useState(DEFAULT_SNAPSHOT_PAGE_SIZE)

  const maxChapter = useMemo(
    () => cards.reduce((max, card) => Math.max(max, card.chapterNumber), 0),
    [cards],
  )

  const filtered = useMemo(() => {
    if (variant === "outline") return cards
    const start = rangeStart.trim() ? Number(rangeStart.trim()) : 0
    const end = rangeEnd.trim() ? Number(rangeEnd.trim()) : 0
    if (start > 0 && end > 0 && start <= end) {
      return cards.filter((card) => card.chapterNumber >= start && card.chapterNumber <= end)
    }
    if (start > 0) return cards.filter((card) => card.chapterNumber >= start)
    if (end > 0) return cards.filter((card) => card.chapterNumber <= end)
    return cards
  }, [cards, rangeEnd, rangeStart, variant])

  const isFiltering = variant === "chapter" && Boolean(rangeStart || rangeEnd)
  // 用户已经主动缩小范围时不分页 —— 再截断会让人以为结果不全。
  const shown = isFiltering ? filtered : filtered.slice(0, visibleCount)
  const remaining = filtered.length - shown.length

  return (
    <div data-ui="memory-snapshot-collection" data-variant={variant} className="space-y-3">
      {variant === "chapter" ? (
        <div className="flex flex-nowrap items-center gap-2">
          <label className="flex shrink-0 items-center gap-1.5">
            <span className="sr-only">{t("novel.memoryCenter.snapshots.rangeStart")}</span>
            <input
              type="number"
              min={1}
              max={maxChapter || undefined}
              placeholder={t("novel.memoryCenter.snapshots.rangeStart")}
              value={rangeStart}
              onChange={(event) => { setRangeStart(event.target.value); setVisibleCount(DEFAULT_SNAPSHOT_PAGE_SIZE) }}
              className="h-7 w-20 rounded border bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <span className="shrink-0 text-xs text-muted-foreground">-</span>
          <label className="flex shrink-0 items-center gap-1.5">
            <span className="sr-only">{t("novel.memoryCenter.snapshots.rangeEnd")}</span>
            <input
              type="number"
              min={1}
              max={maxChapter || undefined}
              placeholder={t("novel.memoryCenter.snapshots.rangeEnd")}
              value={rangeEnd}
              onChange={(event) => { setRangeEnd(event.target.value); setVisibleCount(DEFAULT_SNAPSHOT_PAGE_SIZE) }}
              className="h-7 w-20 rounded border bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          {isFiltering ? (
            <button
              type="button"
              aria-label={t("novel.memoryCenter.snapshots.clearRange")}
              onClick={() => { setRangeStart(""); setRangeEnd(""); setVisibleCount(DEFAULT_SNAPSHOT_PAGE_SIZE) }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {isFiltering
              ? t("novel.memoryCenter.snapshots.rangeSummary", {
                start: rangeStart || 1,
                end: rangeEnd || maxChapter,
                count: filtered.length,
              })
              : t("novel.memoryCenter.snapshots.recentSummary", {
                shown: shown.length,
                total: cards.length,
              })}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("novel.memoryCenter.snapshots.outlineSummary", { count: cards.length })}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {variant === "chapter"
            ? t("novel.memoryCenter.noChapterSnapshots")
            : t("novel.memoryCenter.noOutlineSnapshots")}
        </p>
      ) : (
        shown.map((card) => (
          <SnapshotCard
            key={card.chapterNumber}
            card={card}
            buttonId={`memory-center-snapshot-${card.chapterNumber}`}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
            t={t}
          />
        ))
      )}

      {remaining > 0 ? (
        <div className="pt-1 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-ui="memory-show-more"
            onClick={() => setVisibleCount((count) => count + DEFAULT_SNAPSHOT_PAGE_SIZE)}
          >
            {t("novel.memoryCenter.showMore")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
