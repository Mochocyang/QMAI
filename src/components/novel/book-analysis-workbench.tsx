import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, Check, ChevronDown, Download, Feather, FileText, GitBranch, History, LayoutGrid, List, Pause, PencilLine, Play, Plus, RefreshCw, Search, Square, Trash2, Upload, UserRound, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useBookAnalysisPipelineStore } from "@/stores/book-analysis-pipeline-store"
import { useBookAnalysisActivityStore } from "@/stores/book-analysis-activity-store"
import { useBookAnalysisImportStore } from "@/stores/book-analysis-import-store"
import { loadBookAnalysisLibraryState, type BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { loadChapterList } from "@/lib/novel/book-analysis/analysis-engine"
import { loadWorkbenchRevisions } from "@/lib/novel/book-analysis/workbench-storage"
import { buildWorkbenchPlan, WORKBENCH_DEFAULTS, WORKBENCH_LABELS, WORKBENCH_DIMENSIONS, workbenchRulesMarkdown, type WorkbenchRevision } from "@/lib/novel/book-analysis/workbench-core"
import { inspectWorkbenchPublication, confirmWorkbenchRevision } from "@/lib/novel/book-analysis/workbench-publish"
import { ANALYSIS_SKILL_ORDER, type AnalysisSkill, type BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import type { ChapterSelectionState } from "@/lib/novel/book-analysis/types"
import { resolveTaskLlmConfig } from "@/lib/novel/book-analysis/analysis-model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { toast } from "@/lib/toast"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { WorkbenchChapterSelector } from "./workbench-chapter-selector"
import { WorkbenchStyleDetails } from "./workbench-style-details"
import { styleItemEvidenceIds } from "@/lib/novel/book-analysis/style-fingerprint"
import { BookAnalysisUsageSummary } from "./book-analysis-usage-summary"
import { LegacySkillResults } from "./legacy-skill-results"
import { renderStoryMapHtml } from "@/lib/novel/book-analysis/story-map-renderer"
import { loadWritingStyleStore, setEnabledWritingStyle } from "@/lib/novel/writing-style-store"
import "./book-analysis-workbench.css"

const statusLabels: Record<string, string> = {
  "awaiting-range": "待设置范围", "awaiting-character-selection": "待选择角色", queued: "排队中", running: "分析中",
  paused: "已暂停", failed: "失败", cancelled: "已取消", completed: "已完成", copying: "正在复制", splitting: "正在分章",
  interrupted: "已中断", skipped: "已跳过",
}
const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : "操作失败，请重试")
const skillIcons = { characters: UserRound, story: GitBranch, style: Feather }
interface Draft {
  selectedIds: string[]; skills: AnalysisSkill[]; requirements: Partial<Record<AnalysisSkill, string>>; modelKey: string
}
function draftKey(bookPath: string) { return `qmai-book-workbench:${bookPath}` }
function initialDraft(bookPath: string, chapters: ChapterSelectionState[]): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(bookPath)) ?? "null") as Draft | null
    if (value && Array.isArray(value.selectedIds) && Array.isArray(value.skills) && value.requirements) return {
      ...value, selectedIds: value.selectedIds.filter((id) => chapters.some((c) => c.chapterId === id)),
      skills: value.skills.filter((s) => ANALYSIS_SKILL_ORDER.includes(s)),
    }
  } catch { /* 损坏的本地偏好不影响作品。 */ }
  return { selectedIds: chapters.slice(0, 20).map((c) => c.chapterId), skills: ["characters"], requirements: {}, modelKey: "" }
}

export function BookAnalysisWorkbench() {
  const project = useWikiStore((s) => s.project)
  const selectedBookId = useBookAnalysisStore((s) => s.selectedLibraryBookId)
  // 侧边栏刷新旧版由 LegacyBookAnalysisView 承担，它不再挂载后必须由工作台接管：计数器一变就重读作品库。
  const sidebarRefreshCounter = useBookAnalysisStore((s) => s.sidebarRefreshCounter)
  const [books, setBooks] = useState<BookAnalysisLibraryBook[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [bookSearch, setBookSearch] = useState("")
  const [inputOpen, setInputOpen] = useState(false)
  const [error, setError] = useState("")
  const imports = useBookAnalysisImportStore()
  const pipeline = useBookAnalysisPipelineStore()
  const pickerRef = useRef<HTMLDivElement>(null)
  const openedAt = useRef(Date.now())
  const handledImports = useRef(new Set<string>())
  const [refresh, setRefresh] = useState(0)
  const [deletingRecords, setDeletingRecords] = useState<string[]>([])
  const importSignature = imports.tasks.map((t) => `${t.id}:${t.status}`).join()
  const taskSignature = pipeline.tasks.map((t) => `${t.id}:${t.status}`).join()
  useEffect(() => {
    for (const task of imports.tasks) {
      if (task.status !== "completed" || task.createdAt < openedAt.current || handledImports.current.has(task.id)) continue
      handledImports.current.add(task.id)
      if (imports.batches.find((batch) => batch.id === task.batchId)?.analysisSkills?.length) {
        useBookAnalysisStore.getState().setSelectedLibraryBookId(task.bookId)
        document.getElementById("wb-analysis-settings")?.scrollIntoView({ block: "start" })
      }
    }
  }, [importSignature, imports.batches])
  useEffect(() => {
    if (!project) return
    void Promise.all([
      useBookAnalysisImportStore.getState().initializeProject(project.path),
      useBookAnalysisPipelineStore.getState().initializeProject(project.path),
    ]).catch(reportError)
  }, [project?.path])
  useEffect(() => {
    let current = true
    if (!project) { setBooks([]); return }
    void loadBookAnalysisLibraryState(project.path).then((state) => {
      if (!current) return
      setBooks(state.books); setError("")
    }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [project?.path, imports.revision, importSignature, taskSignature, refresh, sidebarRefreshCounter])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    return () => document.removeEventListener("pointerdown", close, true)
  }, [])
  const book = books.find((b) => b.id === selectedBookId) ?? books[0]
  const projectPath = project?.path ?? ""
  const choose = (id: string) => {
    useBookAnalysisStore.getState().setSelectedLibraryBookId(id)
    setPickerOpen(false)
  }
  /** 传 target 删除指定作品（下拉列表项），不传则删当前选中的作品。 */
  const removeBook = async (target?: BookAnalysisLibraryBook) => {
    const victim = target ?? book
    if (!victim) return
    if (!window.confirm(`确认删除《${victim.metadata.title}》及其拆书资料、分析结果吗？此操作不可撤销。已加入使用库的资源保留。`)) return
    await imports.deletePublishedBook(victim.id)
    // 删掉的若是当前选中项，清空选中态：否则界面会继续指向一本已经不存在的作品。
    const selectedId = useBookAnalysisStore.getState().selectedLibraryBookId
    if (selectedId === victim.id) useBookAnalysisStore.getState().setSelectedLibraryBookId(null)
    setRefresh((v) => v + 1)
  }
  const tasks = pipeline.tasks.filter((task) => task.bookId === book?.id)
  const removeImportRecord = async (taskId: string, title: string) => {
    if (deletingRecords.includes(taskId) || !window.confirm(`确认删除“${title}”的导入记录及其导入缓存？不会删除原始 TXT、已导入作品或已生成的 Skill。`)) return
    setDeletingRecords((ids) => [...ids, taskId])
    try { await imports.deleteRecord(taskId) }
    catch (error) { reportError(error) }
    finally { setDeletingRecords((ids) => ids.filter((id) => id !== taskId)) }
  }
  return <div className="book-workbench" data-testid="book-workbench"><div className="wb-inner">
    <header className="wb-header">
      <div className="wb-row"><h1>拆书库</h1>
        <div className="wb-book-picker" ref={pickerRef}>
          <button type="button" aria-label="选择作品" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>
            <BookOpen /><span>{book?.metadata.title ?? "选择作品"}</span><ChevronDown />
          </button>
          {pickerOpen && <div className="wb-book-menu">
            <input autoFocus aria-label="搜索作品" placeholder="搜索作品" value={bookSearch} onChange={(e) => setBookSearch(e.target.value)} />
            <div>{books.filter((b) => b.metadata.title.includes(bookSearch)).map((b) => <div key={b.id} className="wb-book-option">
              <button onClick={() => choose(b.id)}>
                {b.metadata.title}<small>{b.metadata.totalChapters}章 · {b.characters.length}角色 · {b.skills.length}旧版Skill</small>
              </button>
              <button className="wb-icon" aria-label={`删除作品《${b.metadata.title}》`} title="删除作品"
                onClick={() => void removeBook(b).catch(reportError)}><Trash2 /></button>
            </div>)}</div>
          </div>}
        </div>
        {book && <>
          <span className="wb-muted">{book.metadata.totalChapters}章 · {book.metadata.totalWords.toLocaleString()}字</span>
          <button className="wb-icon" aria-label="删除当前作品" title="删除当前作品"
            onClick={() => void removeBook(book).catch(reportError)}><Trash2 /></button>
        </>}
      </div>
      <div className="wb-actions">
        <button className="wb-icon" aria-label="刷新作品" title="刷新作品" onClick={() => setRefresh((v) => v + 1)}><RefreshCw /></button>
        <button onClick={() => setInputOpen(true)} disabled={!project}><Upload />导入作品</button>
      </div>
    </header>
    {error && <p role="alert">{error}</p>}
    {imports.tasks.length > 0 && <details className="wb-section" open={imports.tasks.some((t) => ["queued", "copying", "splitting"].includes(t.status))}>
      <summary>导入记录 <span className="wb-muted">{imports.tasks.length}项</span></summary>
      {imports.tasks.map((task) => <div key={task.id} className="wb-result">
        <div className="wb-row"><strong>{task.finalTitle ?? task.originalFileName}</strong><span>{statusLabels[task.status] ?? task.status}</span>
          <span className="wb-muted">{task.completed}/{task.total}</span>
          {task.status === "completed" && <button onClick={() => choose(task.bookId)}>设置分析</button>}
          {["failed", "interrupted", "cancelled"].includes(task.status) && <button onClick={() => void imports.continueTask(task.id).catch(reportError)}><RefreshCw />重试导入</button>}
          {["queued", "copying", "splitting"].includes(task.status) && <button onClick={() => void imports.cancelTask(task.id).catch(reportError)}><Square />取消</button>}
          {["completed", "cancelled", "skipped", "failed"].includes(task.status) && <button className="wb-icon" title="删除导入记录，不删除作品"
            aria-label={`删除${task.finalTitle ?? task.originalFileName}导入记录`} disabled={deletingRecords.includes(task.id)}
            onClick={() => void removeImportRecord(task.id, task.finalTitle ?? task.originalFileName)}><Trash2 /></button>}
        </div>{(task.error || task.skipReason) && <p role="alert">{task.error || task.skipReason}</p>}
      </div>)}
    </details>}
    {book ? <BookWorkspace key={`${projectPath}:${book.id}`} book={book} projectPath={projectPath} tasks={tasks} onRefresh={() => setRefresh((v) => v + 1)} />
      : <section className="wb-empty"><BookOpen size={32} className="mx-auto" /><h2>暂无作品</h2><button className="wb-primary" onClick={() => setInputOpen(true)} disabled={!project}><Plus />导入作品</button></section>}
    <BookAnalysisInputDialog open={inputOpen} onOpenChange={setInputOpen} workbenchMode onSubmit={async (files, analysisSkills) => {
      await imports.createBatch(files, analysisSkills)
      setInputOpen(false)
    }} />
  </div></div>
}

function BookWorkspace({ book, projectPath, tasks, onRefresh }: {
  book: BookAnalysisLibraryBook; projectPath: string; tasks: BookAnalysisPipelineTask[]; onRefresh: () => void
}) {
  const [chapters, setChapters] = useState<ChapterSelectionState[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState("")
  const [starting, setStarting] = useState(false)
  const [revisions, setRevisions] = useState<WorkbenchRevision[]>([])
  const [activeSkill, setActiveSkill] = useState<AnalysisSkill>("characters")
  const [activeRequest, setActiveRequest] = useState<AnalysisSkill>("characters")
  const [selectedRevision, setSelectedRevision] = useState("")
  // 故事任务完成后靠它让并入的故事页签重读历史导图。
  const [storyMapRefreshKey, setStoryMapRefreshKey] = useState(0)
  // 每个任务只递增一次：旧版当年用 ref 守住（book-analysis-view.tsx:171 的
  // notifiedPipelineTaskIdsRef，键为 `${task.id}:completed`），否则每次任务列表变化都会再读一遍历史导图。
  const storyRefreshedRef = useRef<Set<string>>(new Set())
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [characterSearch, setCharacterSearch] = useState("")
  const activityNavigation = useBookAnalysisActivityStore((s) => s.navigation)
  const pipeline = useBookAnalysisPipelineStore()
  const signature = tasks.map((task) => `${task.id}:${task.status}`).join()
  const task = [...tasks].sort((a, b) => b.createdAt - a.createdAt)[0]
  const pickerTask = tasks.find((t) => t.workbenchVersion === 2 && t.status === "awaiting-character-selection")
  const recognizedKey = `${pickerTask?.id}:${pickerTask?.recognizedCharacters?.map((c) => c.id).join()}`
  const reloadRevisions = useCallback(async () => { setRevisions(await loadWorkbenchRevisions(book.path)) }, [book.path])
  useEffect(() => {
    // 旧版在故事任务完成时递增刷新键，让历史导图重新读取；迁移到工作台。
    for (const item of tasks) {
      if (item.status !== "completed" || !item.selectedSkills.includes("story")) continue
      const refKey = `${item.id}:completed`
      if (storyRefreshedRef.current.has(refKey)) continue
      storyRefreshedRef.current.add(refKey)
      setStoryMapRefreshKey((key) => key + 1)
    }
    // 依赖用 signature（稳定字符串）而不是 tasks：父级传下来的 tasks 是 pipeline.tasks.filter(…)，
    // 每次父组件渲染都是新数组，用它会让本 effect 在每个 store tick 都重跑一遍。
  }, [signature])
  useEffect(() => {
    let current = true
    void loadChapterList(book.path).then((value) => {
      if (current) {
        const saved = initialDraft(book.path, value)
        setChapters(value); setDraft(saved); setActiveRequest(saved.skills[0] ?? "characters")
      }
    }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [book.path])
  useEffect(() => {
    let current = true
    void loadWorkbenchRevisions(book.path).then((value) => { if (current) setRevisions(value) }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [book.path, signature])
  useEffect(() => {
    if (!draft) return
    try { localStorage.setItem(draftKey(book.path), JSON.stringify(draft)) } catch { setError("分析设置无法保存到本地，切换页面前请留意") }
  }, [book.path, draft])
  useEffect(() => { setCharacterIds(pickerTask?.recognizedCharacters?.filter((c) => c.category === "主角").map((c) => c.id) ?? []) }, [recognizedKey])
  useEffect(() => {
    if (!activityNavigation || activityNavigation.bookId !== book.id || activityNavigation.projectPath !== projectPath) return
    setActiveSkill(activityNavigation.skill)
    setSelectedRevision(revisions.find((r) => r.taskId === activityNavigation.taskId && r.skill === activityNavigation.skill)?.id ?? "")
  }, [activityNavigation, revisions, book.id, projectPath])
  const estimate = useMemo(() => {
    if (!draft || !chapters || !draft.selectedIds.length) return null
    const selected = chapters.filter((c) => draft.selectedIds.includes(c.chapterId))
    try {
      const plan = buildWorkbenchPlan(selected.map((c) => ({ id: c.chapterId, order: c.order, content: "文".repeat(Math.max(1, c.wordCount)) })), draft.selectedIds)
      return { count: selected.length, words: selected.reduce((sum, c) => sum + c.wordCount, 0), chunks: plan.length, batches: Math.ceil(selected.length / 100) }
    } catch { return null }
  }, [chapters, draft?.selectedIds])
  const launch = async (requestDraft: Draft, parentRevisionId?: string) => {
    if (!chapters || !requestDraft.selectedIds.length || !requestDraft.skills.length) return
    if (!hasUsableLlm(resolveTaskLlmConfig({ modelKey: requestDraft.modelKey }), useWikiStore.getState().providerConfigs)) {
      setError("请先选择可用的分析模型"); return
    }
    setStarting(true); setError("")
    try {
      await pipeline.initializeProject(projectPath)
      const created = await pipeline.createAwaitingRangeTask({ bookId: book.id, bookTitle: book.metadata.title, bookPath: book.path, selectedSkills: requestDraft.skills, forceNew: true })
      if (!created) return
      const orders = chapters.filter((c) => requestDraft.selectedIds.includes(c.chapterId)).map((c) => c.order)
      await pipeline.configureTaskRange(created.id, { startOrder: Math.min(...orders), endOrder: Math.max(...orders) }, requestDraft.skills, {
        modelKey: requestDraft.modelKey, workbenchRequest: { selectedChapterIds: requestDraft.selectedIds, requirements: requestDraft.requirements, parentRevisionId },
      })
      if (requestDraft.skills.includes("characters")) void pipeline.recognizeWorkbenchCharacters(created.id).catch(reportError)
      else void pipeline.startTask(created.id).catch(reportError)
      setActiveSkill(requestDraft.skills[0]); setSelectedRevision("")
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setStarting(false) }
  }
  const selectedRevisions = revisions.filter((r) => r.skill === activeSkill)
  const result = selectedRevisions.find((r) => r.id === selectedRevision) ?? selectedRevisions[0]
  // 卡在「待选择角色」不等于还在干活：识别失败时任务会停在这个状态并把原因写进 error，
  // 若照旧算作活动任务，「开始分析」会被永久锁死（用户反馈的正是这一点）。
  // 只有真的在跑/排队，或者确实有待选角色、或正在识别，才算占用。
  const hasActiveTask = tasks.some((t) => ["running", "queued"].includes(t.status)
    || (t.status === "awaiting-character-selection"
      && ((t.recognizedCharacters?.length ?? 0) > 0 || Boolean(pipeline.progresses[`${t.id}:characters:recognition`]))))
  return <>
    <section className="wb-section wb-analysis-settings" id="wb-analysis-settings">
      <div className="wb-section-heading"><h2><span className="wb-step-number">01</span>分析设置</h2><span className="wb-muted">TXT · {book.metadata.totalChapters}章</span></div>
      {chapters && draft ? <>
        <WorkbenchChapterSelector chapters={chapters} selectedIds={draft.selectedIds} onChange={(selectedIds) => setDraft({ ...draft, selectedIds })} />
        <div className="wb-skill-options">{ANALYSIS_SKILL_ORDER.map((skill) => {
          const Icon = skillIcons[skill]
          return <div key={skill} className="wb-skill-option" data-active={activeRequest === skill}>
            <input type="checkbox" aria-label={`分析${WORKBENCH_LABELS[skill]}`} checked={draft.skills.includes(skill)} onChange={(e) => {
              setDraft({ ...draft, skills: e.target.checked ? [...draft.skills, skill] : draft.skills.filter((s) => s !== skill) })
              if (e.target.checked) setActiveRequest(skill)
            }} />
            <button aria-label={`编辑${WORKBENCH_LABELS[skill]}需求`} aria-pressed={activeRequest === skill} onClick={() => setActiveRequest(skill)}><Icon />{WORKBENCH_LABELS[skill]}</button>
          </div>
        })}</div>
        <div className="wb-demand-editor">
          {ANALYSIS_SKILL_ORDER.map((skill) => <label className="wb-request" key={skill} hidden={activeRequest !== skill}>
            <span>{WORKBENCH_LABELS[skill]}需求 <small>{draft.skills.includes(skill) ? "已勾选分析" : "未勾选分析"}</small></span>
            <textarea rows={3} aria-label={`${WORKBENCH_LABELS[skill]}需求`} placeholder={WORKBENCH_DEFAULTS[skill]} value={draft.requirements[skill] ?? ""}
              onChange={(e) => setDraft({ ...draft, requirements: { ...draft.requirements, [skill]: e.target.value } })} maxLength={4000} />
          </label>)}
          <div className="wb-demand-toolbar">
            {/* 不再显示「分析模型」字样，选择框直接贴住「开始分析」。 */}
            <div className="wb-row wb-model"><ChatModelSelector value={draft.modelKey} onChange={(modelKey) => setDraft({ ...draft, modelKey })} disabled={starting} /></div>
            <button className="wb-primary" disabled={starting || !estimate || !draft.skills.length || hasActiveTask} onClick={() => void launch(draft)}><Play />{starting ? "正在准备" : `开始分析${draft.skills.length > 1 ? ` · ${draft.skills.length}项` : ""}`}</button>
          </div>
        </div>
        <p className="wb-muted wb-estimate">{estimate ? `已选 ${estimate.count}章 · ${estimate.words.toLocaleString()}字 · ${estimate.batches}批 · 预计 ${estimate.chunks}个正文区块 / 每类` : "尚未选择章节"}</p>
      </> : <p className="wb-muted">正在读取章节…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {pickerTask && <section className="wb-section">
      <h2>选择目标角色</h2>
      {pickerTask.error && <p role="alert">{pickerTask.error}</p>}
      {pickerTask.recognizedCharacters?.length ? <>
        <div className="wb-row"><input aria-label="搜索角色" placeholder="姓名或别名" value={characterSearch} onChange={(e) => setCharacterSearch(e.target.value)} />
          <button onClick={() => setCharacterIds(pickerTask.recognizedCharacters!.filter((c) => c.category === "主角").map((c) => c.id))}>选择主角</button>
          <button onClick={() => setCharacterIds([])}>清空</button></div>
        <div className="wb-character-pick">{pickerTask.recognizedCharacters.filter((c) => `${c.name} ${c.aliases.join(" ")}`.includes(characterSearch)).map((c) => <label key={c.id}>
          <input type="checkbox" checked={characterIds.includes(c.id)} onChange={(e) => setCharacterIds((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />
          <strong>{c.name}</strong><span className="wb-muted">{c.category} · {c.aliases.join("、")}</span>
        </label>)}</div>
        <button className="wb-primary" disabled={!characterIds.length} onClick={() => void pipeline.confirmCharacterSelection(pickerTask.id, characterIds).then(() => pipeline.startTask(pickerTask.id)).catch(reportError)}><Play />生成选中角色（{characterIds.length}）</button>
      </> : <div className="wb-row"><span className="wb-muted">{pipeline.progresses[`${pickerTask.id}:characters:recognition`]?.stageLabel
        ?? (pickerTask.error ? "识别失败，可重试" : "等待角色识别")}</span>
        <button disabled={Boolean(pipeline.progresses[`${pickerTask.id}:characters:recognition`])} onClick={() => void pipeline.recognizeWorkbenchCharacters(pickerTask.id).catch(reportError)}>{pickerTask.error ? <><RefreshCw />重试</> : "识别角色"}</button></div>}
    </section>}
    {task && <section className="wb-section wb-task-section"><h2 className="sr-only">任务进度</h2><TaskProgress task={task} />
      <details><summary><History size={14} className="inline" /> 历史任务（{tasks.length}）</summary>{tasks.filter((t) => t.id !== task.id).map((t) => <TaskProgress key={t.id} task={t} />)}</details>
    </section>}
    <section className="wb-section wb-results-section">
      <div className="wb-tabs" role="tablist" aria-label="分析结果">{ANALYSIS_SKILL_ORDER.map((skill) => {
        const Icon = skillIcons[skill]
        return <button key={skill} role="tab" aria-selected={activeSkill === skill} onClick={() => { setActiveSkill(skill); setSelectedRevision("") }}><Icon />{WORKBENCH_LABELS[skill]}</button>
      })}</div>
      {selectedRevisions.length > 0 && <div className="wb-row"><label>结果版本 <select aria-label="结果版本" value={result?.id} onChange={(e) => setSelectedRevision(e.target.value)}>{selectedRevisions.map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString("zh-CN")} · {r.confirmedAt ? "已确认" : "待确认"}</option>)}</select></label></div>}
      {result ? <WorkbenchResult key={result.id} revision={result} previous={revisions.find((r) => r.id === result.parentRevisionId)} bookPath={book.path} projectPath={projectPath}
        onConfirmed={() => { void reloadRevisions().catch(reportError); onRefresh() }}
        revising={starting || hasActiveTask}
        onRevise={(requirements) => draft && launch({ ...draft, selectedIds: result.selectedChapterIds, skills: [result.skill], requirements: { [result.skill]: `${result.requirements}\n补充要求：${requirements}` } }, result.id)} />
        : <p className="wb-muted">暂无新版本结果。</p>}
      <LegacySkillResults book={book} skill={activeSkill} storyMapRefreshKey={storyMapRefreshKey} />
    </section>
  </>
}

function TaskProgress({ task }: { task: BookAnalysisPipelineTask }) {
  const pipeline = useBookAnalysisPipelineStore()
  const chunks = pipeline.chunks.filter((c) => c.taskId === task.id)
  const completed = chunks.filter((c) => c.status === "completed").length
  const progress = Object.entries(pipeline.progresses).filter(([key]) => key.startsWith(`${task.id}:`)).map(([, value]) => value)
  return <div className="wb-result">
    <div className="wb-row"><strong>{statusLabels[task.status]}</strong><span className="wb-muted">{task.selectedSkills.map((s) => WORKBENCH_LABELS[s]).join("、")} · {completed}/{chunks.length}区块</span>
      <progress className="wb-progress" max={Math.max(1, chunks.length)} value={completed} />
      {task.status === "running" && <button onClick={() => void pipeline.pauseTask(task.id).catch(reportError)}><Pause />暂停</button>}
      {["paused", "failed", "cancelled"].includes(task.status) && <button onClick={() => void pipeline.continueTask(task.id).catch(reportError)}><Play />{task.status === "failed" ? "重试失败区块" : "继续"}</button>}
      {!["completed", "cancelled"].includes(task.status) && <button onClick={() => void pipeline.cancelTask(task.id).catch(reportError)}><Square />取消</button>}
    </div>
    {progress.length > 0 && <p className="wb-muted">{progress.map((p) => p.stageLabel).join(" · ")}</p>}
    {task.error && <p role="alert">{task.error}</p>}
    <details><summary>区块与用量</summary>
      {chunks.map((c) => <p key={`${c.skill}:${c.id}`} className="wb-muted">{WORKBENCH_LABELS[c.skill]} · 批{c.batch ?? 1} · 第{c.startOrder}～{c.endOrder}章 · {statusLabels[c.status] ?? c.status}{c.error ? `：${c.error}` : ""}</p>)}
      <BookAnalysisUsageSummary task={task} />
    </details>
  </div>
}

function WorkbenchResult({ revision, previous, projectPath, bookPath, onConfirmed, onRevise, revising }: {
  revision: WorkbenchRevision; previous?: WorkbenchRevision; projectPath: string; bookPath: string
  onConfirmed: () => void; onRevise: (requirements: string) => Promise<void> | null; revising: boolean
}) {
  const [requirements, setRequirements] = useState("")
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [pendingOnly, setPendingOnly] = useState(false)
  const [view, setView] = useState<"grid" | "list">("grid")
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null)
  const [expandedOverviews, setExpandedOverviews] = useState<string[]>([])
  const [revisionOpen, setRevisionOpen] = useState(false)
  const revisionInput = useRef<HTMLTextAreaElement>(null)
  const [styleState, setStyleState] = useState<{ current: boolean; enabled: boolean } | null>(null)
  const mapHtml = useMemo(() => revision.storyMap ? renderStoryMapHtml({ ...revision.storyMap, bookTitle: revision.bookTitle }) : "", [revision])
  useEffect(() => {
    let current = true
    if (revision.skill !== "style" || !revision.confirmedAt) return
    void loadWritingStyleStore(projectPath).then((store) => {
      const preset = store.styles.find((s) => revision.publishedIds?.includes(s.id))
      if (current) setStyleState({ current: preset?.profile.generatedAt === revision.createdAt, enabled: Boolean(preset && store.enabledStyleId === preset.id) })
    }).catch(reportError)
    return () => { current = false }
  }, [projectPath, revision.id, revision.confirmedAt])
  const toggleStyle = async () => {
    const store = await loadWritingStyleStore(projectPath)
    const preset = store.styles.find((s) => revision.publishedIds?.includes(s.id))
    if (!preset || preset.profile.generatedAt !== revision.createdAt) throw new Error("该版本已被替换，请选择当前入库版本")
    const enabled = store.enabledStyleId === preset.id
    if (!enabled && store.enabledStyleId && !window.confirm("启用此文风会替换当前启用的文风，是否继续？")) return
    await setEnabledWritingStyle(projectPath, enabled ? null : preset.id)
    setStyleState({ current: true, enabled: !enabled })
  }
  const confirm = async () => {
    setSaving(true)
    try {
      const inspect = await inspectWorkbenchPublication(projectPath, revision)
      const destination = revision.skill === "characters" ? "角色灵魂库" : revision.skill === "story" ? "故事框架库" : "文风库"
      const message = inspect.targets.length
        ? `确认替换${destination}中的 ${inspect.targets.length} 个已有条目？\n影响：${inspect.impacts.join("、") || "无当前启用或绑定"}。\n旧版本会保留。`
        : `确认将本版本全部 ${revision.items.length} 个对象加入${destination}？不会自动绑定人物或启用文风。`
      if (!window.confirm(message + (omittedCount ? `\n有${omittedCount}项候选未采纳，仅加入保留的通过项；未采纳记录留在来源版本中。` : ""))) return
      await confirmWorkbenchRevision(projectPath, bookPath, revision.id, inspect.fingerprint)
      onConfirmed()
      toast.success("已确认并加入使用库")
    } catch (error) { reportError(error) } finally { setSaving(false) }
  }
  const usedEvidence = new Set(revision.items.flatMap(styleItemEvidenceIds))
  const omittedCount = revision.items.reduce((sum, item) => sum + (item.styleFingerprint?.omitted?.length ?? 0), 0)
  const filteredItems = revision.items.filter((item) => (!pendingOnly || !revision.confirmedAt)
    && `${item.subject} ${item.summary} ${item.rules.map((r) => `${r.condition} ${r.action}`).join(" ")}`.includes(query.trim()))
  const expandedItem = filteredItems.find((item) => item.subject === expandedSubject)
  const openRevision = () => {
    setRevisionOpen(true)
    requestAnimationFrame(() => revisionInput.current?.focus())
  }
  const exportResult = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const path = await save({ defaultPath: `${revision.bookTitle}-${WORKBENCH_LABELS[revision.skill]}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] })
    if (!path) return
    const { writeFileAtomic } = await import("@/commands/fs")
    await writeFileAtomic(path, revision.items.map((i) => `# ${i.subject}\n\n${workbenchRulesMarkdown(i)}`).join("\n\n"))
  }
  return <div className="wb-results">
    <div className="wb-results-tools">
      <label className="wb-search"><Search /><input aria-label="搜索成果" placeholder="搜索角色 / 规则" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label className="wb-pending-filter"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />仅待确认</label>
      <div className="wb-view-switch" role="group" aria-label="成果展示方式">
        <button className="wb-icon" title="卡片视图" aria-label="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /></button>
        <button className="wb-icon" title="列表视图" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List /></button>
      </div>
    </div>
    <div className="wb-row wb-summary"><span className="wb-status">{revision.confirmedAt ? "用户已确认" : omittedCount ? `已保留通过项 · ${omittedCount}项未采纳 · 待用户确认` : "自动核验通过 · 待用户确认"}</span><span className="wb-muted">{revision.selectedChapterIds.length}章 · {revision.items.length}个对象</span>
      <button className="wb-primary" title={`确认本版本全部${revision.items.length}个对象`} disabled={saving || Boolean(revision.confirmedAt) || !revision.items.some((i) => i.rules.length)} onClick={() => void confirm()}><Check />{saving ? "正在加入" : revision.confirmedAt ? "已加入使用库" : "确认并加入"}</button>
      <button className="wb-icon" title="导出结果" aria-label="导出结果" onClick={() => void exportResult().catch(reportError)}><Download /></button>
      {styleState?.current && <button onClick={() => void toggleStyle().catch(reportError)}><Play />{styleState.enabled ? "取消启用文风" : "启用此文风"}</button>}
      {styleState && !styleState.current && <span className="wb-muted">此历史版本已被替换</span>}
    </div>
    {revision.requirements && <details><summary>本次需求</summary><p>{revision.requirements}</p></details>}
    {mapHtml && <details className="wb-result"><summary>原作结构观察导图</summary><iframe title="原作结构观察导图" srcDoc={mapHtml} sandbox="allow-same-origin" style={{ width: "100%", height: 480, border: 0 }} /></details>}
    <div className="wb-skill-grid" data-view={view}>
      {filteredItems.map((item, index) => <article className="wb-skill-card" key={item.subject}>
        <div className="wb-card-main">
          <div className="wb-card-heading"><span className="wb-avatar" data-tone={index % 3}>{item.subject.slice(0, 1)}</span><h3>{item.subject}</h3><span className="wb-card-status" data-confirmed={Boolean(revision.confirmedAt)}>{revision.confirmedAt ? "已入库" : "待确认"}</span></div>
          <p className="wb-card-description" data-expanded={item.summary.length <= 100 || expandedOverviews.includes(item.subject)}>{item.summary}</p>
          {item.summary.length > 100 && <button className="wb-overview-toggle" aria-label={`展开${item.subject}概述`} aria-expanded={expandedOverviews.includes(item.subject)}
            onClick={() => setExpandedOverviews((subjects) => subjects.includes(item.subject) ? subjects.filter((s) => s !== item.subject) : [...subjects, item.subject])}>
            {expandedOverviews.includes(item.subject) ? "收起概述" : "展开完整概述"}<ChevronDown />
          </button>}
          <div className="wb-traits">{[...new Set(item.rules.map((rule) => WORKBENCH_DIMENSIONS[rule.dimension] ?? rule.dimension))].map((dimension) => <span key={dimension}>{dimension}</span>)}</div>
          <small>{item.rules.length}条规则 · {new Set(item.rules.flatMap((rule) => rule.evidenceIds)).size}条依据</small>
        </div>
        <footer className="wb-card-footer">
          <button aria-label={`查看${item.subject}规则`} aria-expanded={expandedSubject === item.subject} onClick={() => setExpandedSubject(expandedSubject === item.subject ? null : item.subject)}><FileText />{expandedSubject === item.subject ? "收起规则" : "查看规则"}</button>
          <button className="wb-icon" aria-label={`补充${item.subject}修订要求`} title="补充本版本修订要求" onClick={openRevision}><PencilLine /></button>
        </footer>
      </article>)}
      {!filteredItems.length && <p className="wb-muted wb-no-results">没有符合条件的成果</p>}
    </div>
    {expandedItem && <section className="wb-rule-detail">
      <div className="wb-section-heading"><h2>{expandedItem.subject} · 完整规则</h2><button className="wb-icon" aria-label="收起完整规则" title="收起完整规则" onClick={() => setExpandedSubject(null)}><X /></button></div>
      <p className="wb-muted">{expandedItem.limitations}</p>
      {expandedItem.styleFingerprint && <WorkbenchStyleDetails item={expandedItem} evidence={revision.evidence} metrics={revision.metrics} />}
      {expandedItem.rules.map((rule) => <div className="wb-rule" key={rule.id}><h3>{rule.id} · {WORKBENCH_DIMENSIONS[rule.dimension] ?? rule.dimension}</h3>
        <dl><dt>适用情境</dt><dd>{rule.condition}</dd><dt>复用规则</dt><dd>{rule.action}</dd><dt>例外边界</dt><dd>{rule.boundary}</dd></dl>
        <details><summary>原文观察与依据（{rule.evidenceIds.length}）</summary><p>{rule.observation}</p>
          {rule.evidenceIds.map((id) => revision.evidence.find((e) => e.id === id)).filter((e) => !!e).map((e) => <blockquote className="wb-evidence" key={e.id}><small>第{e.order}章 · 正文位置{e.start}～{e.end}</small><p>{e.text}</p></blockquote>)}
        </details>
      </div>)}
    </section>}
    <details className="wb-result"><summary>证据索引与实际覆盖</summary>
      <p className="wb-muted">已读取{revision.selectedChapterIds.length}章、{revision.coverage.length}个正文分段；规则引用{usedEvidence.size}条原文。自动核验仍需人工复核。</p>
      {revision.metrics && <p className="wb-muted">样本 {revision.metrics.counts.chars.toLocaleString()}字 · 平均句长 {revision.metrics.derived.avgSentenceChars}字 · 平均段长 {revision.metrics.derived.avgParagraphChars}字</p>}
      <div className="wb-chapter-list">{revision.coverage.map((c) => <p className="wb-muted" key={`${c.chapterId}:${c.start}`}>第{c.order}章 · {c.start}～{c.end}</p>)}</div>
    </details>
    {previous && <details className="wb-result"><summary>与上一版本的变化</summary>
      {revision.items.map((item) => <div key={item.subject}><h3>{item.subject}</h3><details><summary>上一版本</summary><pre>{previous.items.filter((i) => i.subject === item.subject).map(workbenchRulesMarkdown).join("\n") || "上一版本没有此对象"}</pre></details><pre>{workbenchRulesMarkdown(item)}</pre></div>)}
    </details>}
    <div className="wb-revision-section">
      <button aria-expanded={revisionOpen} onClick={() => setRevisionOpen(!revisionOpen)}><PencilLine />补充修订</button>
      {revisionOpen && <><label className="wb-request"><span>补充修订要求</span><textarea ref={revisionInput} rows={3} value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={4000} aria-label="补充修订要求" /></label>
        <button disabled={!requirements.trim() || revising} onClick={() => void onRevise(requirements.trim())?.catch(reportError)}><RefreshCw />生成修订版本</button></>}
    </div>
  </div>
}
