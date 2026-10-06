import { useId, useMemo, useRef, useState } from "react"
import { ListFilter, Search } from "lucide-react"
import type { ChapterSelectionState } from "@/lib/novel/book-analysis/types"

export function WorkbenchChapterSelector({ chapters, selectedIds, onChange }: {
  chapters: ChapterSelectionState[]; selectedIds: string[]; onChange: (ids: string[]) => void
}) {
  const selectedOrders = chapters.filter((c) => selectedIds.includes(c.chapterId)).map((c) => c.order)
  const [start, setStart] = useState(String(selectedOrders.length ? Math.min(...selectedOrders) : 1))
  const [end, setEnd] = useState(String(selectedOrders.length ? Math.max(...selectedOrders) : Math.min(20, chapters.length)))
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const anchor = useRef<number | null>(null)
  const selected = new Set(selectedIds)
  const filtered = useMemo(() => chapters.filter((c) => `${c.order} ${c.title}`.includes(search.trim())), [chapters, search])
  const selectRange = (from: number, to: number) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > chapters.length) {
      setError(`请选择1至${chapters.length}章内的有效范围`); return
    }
    setError(""); setStart(String(from)); setEnd(String(to))
    onChange(chapters.filter((c) => c.order >= from && c.order <= to).map((c) => c.chapterId))
  }
  const toggle = (chapter: ChapterSelectionState, checked: boolean, shift: boolean) => {
    const next = new Set(selectedIds)
    const affected = shift && anchor.current !== null
      ? chapters.filter((c) => c.order >= Math.min(anchor.current!, chapter.order) && c.order <= Math.max(anchor.current!, chapter.order))
      : [chapter]
    for (const c of affected) { if (checked) next.add(c.chapterId); else next.delete(c.chapterId) }
    anchor.current = chapter.order
    onChange(chapters.filter((c) => next.has(c.chapterId)).map((c) => c.chapterId))
  }
  const lastOrder = Math.max(0, ...chapters.filter((c) => selected.has(c.chapterId)).map((c) => c.order))
  return <section className="wb-range" aria-label="章节选择">
    <div className="wb-row">
      <span className="wb-muted">分析范围</span>
      <label><span className="sr-only">起始章节</span><input aria-label="起始章节" type="number" min={1} max={chapters.length} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <span className="wb-range-dash">至</span>
      <label><span className="sr-only">结束章节</span><input aria-label="结束章节" type="number" min={1} max={chapters.length} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <button className="wb-quiet" type="button" onClick={() => selectRange(Number(start), Number(end))}>应用范围</button>
      <div className="wb-range-presets">
        <button className="wb-quiet" type="button" onClick={() => selectRange(1, Math.min(20, chapters.length))}>前20章</button>
        <button className="wb-quiet" type="button" disabled={lastOrder >= chapters.length} onClick={() => selectRange(lastOrder + 1, Math.min(lastOrder + 20, chapters.length))}>后续20章</button>
        <button className="wb-quiet" type="button" onClick={() => selectRange(1, chapters.length)}>全书</button>
        <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}><ListFilter />{expanded ? "收起清单" : "挑选章节"}</button>
      </div>
      <span className="wb-muted wb-selection-count">已选 {selectedIds.length} / {chapters.length} 章</span>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="wb-chapters" id={listId} hidden={!expanded}>
      <div className="wb-row">
        <label className="wb-search"><Search /><input aria-label="搜索章节" placeholder="章节号或标题" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <button type="button" onClick={() => onChange([...new Set([...selectedIds, ...filtered.map((c) => c.chapterId)])])}>选中搜索结果</button>
        <button className="wb-quiet" type="button" onClick={() => onChange([])}>清空</button>
      </div>
      <div className="wb-chapter-list">
        {filtered.map((c) => <label key={c.chapterId} className="wb-chapter-row">
          <input aria-label={`选择第${c.order}章`} type="checkbox" checked={selected.has(c.chapterId)}
            onChange={(e) => toggle(c, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)} />
          <span>{c.order}</span><span>{c.title}</span><small>{c.wordCount.toLocaleString()} 字</small>
        </label>)}
        {!filtered.length && <p className="wb-muted">没有匹配的章节</p>}
      </div>
    </div>
  </section>
}
