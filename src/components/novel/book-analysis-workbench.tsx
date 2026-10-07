import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, ChevronDown, Feather, FileText, GitBranch, History, LayoutGrid, Link2, List, Pause, PencilLine, Play, Plus, RefreshCw, Search, Square, Trash2, Upload, UserRound, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useBookAnalysisPipelineStore } from "@/stores/book-analysis-pipeline-store"
import { useBookAnalysisActivityStore } from "@/stores/book-analysis-activity-store"
import { useBookAnalysisImportStore } from "@/stores/book-analysis-import-store"
import { loadBookAnalysisLibraryState, type BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { loadChapterList } from "@/lib/novel/book-analysis/analysis-engine"
import { loadWorkbenchRevisions } from "@/lib/novel/book-analysis/workbench-storage"
import { buildWorkbenchPlan, WORKBENCH_DEFAULTS, WORKBENCH_LABELS, WORKBENCH_DIMENSIONS, workbenchRulesMarkdown, type WorkbenchItem, type WorkbenchRevision } from "@/lib/novel/book-analysis/workbench-core"
import { inspectWorkbenchPublication, confirmWorkbenchRevision } from "@/lib/novel/book-analysis/workbench-publish"
// 删除是「连使用库一起真删」的数据层动作，组件只负责确认后调用它并刷新列表。
import { removeWorkbenchRevisionItem } from "@/lib/novel/book-analysis/workbench-remove"
// materializeLegacyCharacterRevision 不再被组件调用：legacy 绝不自动发布（见下面的自动入库 effect）。
import { buildLegacyCharacterRevision } from "@/lib/novel/book-analysis/legacy-character-revision"
import { loadCharacterSoulStatus, addCharacterToSoulLibrary, bindCharacterToNovelCharacters, type CharacterSoulStatus } from "@/lib/novel/book-analysis/workbench-soul-actions"
import { listBindableNovelCharacters, refineBindableCharactersWithLlm } from "@/lib/novel/character-aura"
import { addBindableIgnore, filterBindableCharacters, readBindableIgnoreList, removeBindableIgnore } from "@/lib/novel/bindable-characters-filter"
import { refreshProjectState } from "@/lib/project-refresh"
import { ANALYSIS_SKILL_ORDER, type AnalysisSkill, type BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import type { ChapterSelectionState } from "@/lib/novel/book-analysis/types"
import { resolveTaskLlmConfig } from "@/lib/novel/book-analysis/analysis-model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { toast } from "@/lib/toast"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { WorkbenchChapterSelector } from "./workbench-chapter-selector"
import { WorkbenchStyleDetails } from "./workbench-style-details"
import { BookAnalysisUsageSummary } from "./book-analysis-usage-summary"
import { LegacySkillResults } from "./legacy-skill-results"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
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

/** 整个版本有没有可发布内容。旧版迁移版本靠散文字段兜底发布，即使没有结构化规则也算数。 */
function canPublishRevision(revision: WorkbenchRevision): boolean {
  return revision.origin === "legacy" || revision.items.some((item) => item.rules.length)
}

/**
 * 版本标题行 / 对象名后的时间。对象自己没有时间戳，只能取所属版本的 createdAt，
 * 所以同一个对象出现在不同版本里会显示各自的日期——这是正确且有意义的。
 * 时间戳缺失时返回空串（调用方会跳过这一段），绝不渲染出 NaN。
 */
function formatTimestamp(createdAt: number | undefined, withYear = false): string {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return ""
  const date = new Date(createdAt)
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  const day = `${date.getMonth() + 1}/${date.getDate()}`
  return withYear ? `${date.getFullYear()}/${day} ${clock}` : `${day} ${clock}`
}

/** 用户主动删掉的对象不再渲染。库里查不到 ≠ 用户想删，所以以版本上的 removedSubjects 为准。 */
function visibleItems(revision: WorkbenchRevision): WorkbenchItem[] {
  const removed = revision.removedSubjects
  return removed?.length ? revision.items.filter((item) => !removed.includes(item.subject)) : revision.items
}

/**
 * 卡片级状态的复合键：版本 id + 对象名。
 *
 * 用 \u0000 连接而不是 ":" 之类可见字符：对象名完全可能出现冒号或空格
 * （例如「代号：孤星」），那样 ("a:b", "c") 与 ("a", "b:c") 会撞成同一个键，
 * 于是点一张卡的按钮会同时改动另一张卡。
 */
function cardKey(revisionId: string, subject: string): string {
  return `${revisionId}\u0000${subject}`
}

/**
 * 按钮能不能用取决于「有没有可发布的数据」，不是规则条数：
 * 六维路径生成的旧版 Skill 不含便携人格块，规则为空但资料齐全，必须仍能加入灵魂库。
 */
function hasPublishableData(revision: WorkbenchRevision, item: WorkbenchItem, book: BookAnalysisLibraryBook): boolean {
  if (revision.origin !== "legacy") return item.rules.length > 0
  const character = book.characters.find((c) => c.name === item.subject)
  if (!character) return false
  if (book.skills.some((s) => s.characterId === character.id || s.characterName === character.name)) return true
  return Boolean(character.personalityProfile) || Boolean(character.personality) || Boolean(character.description)
}

/** 三态徽标文案；「无可用资料」优先——按钮都点不动了，再写「未加入灵魂库」就是骗人去点。 */
function soulStatusLabel(status: CharacterSoulStatus | undefined, publishable: boolean): string {
  if (!publishable) return "无可用资料"
  if (!status || status === "none") return "未加入灵魂库"
  if (status === "added") return "已在灵魂库"
  return `已绑定「${status.bound.join("、")}」`
}

/** 该角色灵魂已经绑定的小说人物名。过滤名单时当安全阀用：已绑定的角色绝不能从候选里消失。 */
function boundCharacterNames(status: CharacterSoulStatus | undefined): string[] {
  return status && typeof status === "object" ? status.bound : []
}

/** 合并后台精修结果：已显示的名字保持原顺序，只把新发现的名字追加进来。 */
function mergeBindableNames(shown: readonly string[], refined: readonly string[]): string[] {
  const merged = new Set(shown)
  for (const name of refined) {
    if (typeof name !== "string") continue
    const trimmed = name.trim()
    if (trimmed) merged.add(trimmed)
  }
  return [...merged]
}

/**
 * 取后台精修的名单。名单本身是缓存/本地的，精修只是可选增强，
 * 所以这里把「导出不存在」和「精修抛错」一并兜住，保证永不 reject：
 * 打开对话框不该因为一个可选增强而失败。
 */
async function refineBindableNames(projectPath: string): Promise<string[]> {
  try {
    if (typeof refineBindableCharactersWithLlm !== "function") return []
    return await refineBindableCharactersWithLlm(projectPath)
  } catch {
    return []
  }
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
  const [soulStatus, setSoulStatus] = useState<Record<string, CharacterSoulStatus>>({})
  // 绑定的是「哪一版里的哪个对象」：全版本平铺后，同一个 subject 可能同时出现在多个版本里。
  const [bindingTarget, setBindingTarget] = useState<{ subject: string; revision: WorkbenchRevision } | null>(null)
  const [bindableNames, setBindableNames] = useState<string[] | null>(null)
  // 精修结果回来时用来判断对话框是否已经换人／关掉，避免迟到的结果污染下一次打开。
  const bindingSessionRef = useRef(0)
  const [activeSkill, setActiveSkill] = useState<AnalysisSkill>("characters")
  // 结果区的卡片/列表视图：全版本平铺后由结果区统一持有，所有版本块共用一份。
  const [view, setView] = useState<"grid" | "list">("grid")
  /*
   * 下面四组状态全部提到结果区，并且键都带**版本 id**。
   *
   * 合并版本之后同一个角色会出现在多个版本里（例如两个版本都有「许七安」），
   * 只用对象名当键会让「点 A 版查看规则」同时点亮 B 版；删除更危险——可能删错版本。
   * 因此展开规则、展开概述、待删除、正在补充修订都以「版本 id（+ 对象名）」为键。
   */
  const [expandedCard, setExpandedCard] = useState<{ revisionId: string; subject: string } | null>(null)
  const [expandedOverviews, setExpandedOverviews] = useState<string[]>([])
  const [removing, setRemoving] = useState<{ revisionId: string; subject: string } | null>(null)
  // 哪一版的补充修订编辑器是打开的（只可能有一个，因为同一时刻只有一个编辑框可见）。
  const [revisingFor, setRevisingFor] = useState<string | null>(null)
  /*
   * 补充修订草稿按**版本**分别保存，不能用单一字段：合并列表里用户完全可能先在 A 版写一段、
   * 又去点 B 版的笔，旧实现（每版本各持一个 state）不会丢，单一字段会把 A 的草稿清空。
   * 这是合并后真实丢过数据的地方，故以版本 id 为键。
   */
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>({})
  const [activeRequest, setActiveRequest] = useState<AnalysisSkill>("characters")
  // 全版本平铺后不再有「选中版本」：活动跳转改成「切到对应页签 + 等目标版本渲染出来后滚进视野」。
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
  // 自动入库的去重键：每个版本 id 每次挂载只尝试一次（失败也不重试，避免无限刷屏）。
  const autoPublishAttempted = useRef<Set<string>>(new Set())
  // 故事任务完成后靠它让并入的故事页签重读历史导图。
  const [storyMapRefreshKey, setStoryMapRefreshKey] = useState(0)
  // 每个任务只递增一次：旧版当年用 ref 守住（book-analysis-view.tsx:171 的
  // notifiedPipelineTaskIdsRef，键为 `${task.id}:completed`），否则每次任务列表变化都会再读一遍历史导图。
  const storyRefreshedRef = useRef<Set<string>>(new Set())
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [characterSearch, setCharacterSearch] = useState("")
  const activityNavigation = useBookAnalysisActivityStore((s) => s.navigation)
  const consumeNavigation = useBookAnalysisActivityStore((s) => s.consumeNavigation)
  const pipeline = useBookAnalysisPipelineStore()
  const signature = tasks.map((task) => `${task.id}:${task.status}`).join()
  // 侧边栏/toast 的「现在处理」写的是这个字段。旧版是订阅它才重开面板的（book-analysis-view.tsx:141）：
  // 只靠 getState() 读、不订阅，store 变化时本组件不会重渲染，下面的 effect 就永远等不到请求。
  const pendingRecognitionTaskId = useBookAnalysisStore((s) => s.pendingRecognitionTaskId)
  // 「识别刚结束」那一次不会改变任务状态，只有 progresses 会变，所以还需要它参与依赖。
  const progressSignature = Object.keys(pipeline.progresses).join()
  useEffect(() => {
    const requested = useBookAnalysisStore.getState().pendingRecognitionTaskId
    if (!requested) return
    // 旧版卸载后没人处理这个请求：新版自己把选角色区滚进视野。
    if (!tasks.some((t) => t.id === requested)) return
    useBookAnalysisStore.getState().consumeReopenRequest()
    document.getElementById("wb-character-picker")?.scrollIntoView({ block: "start" })
  }, [signature, progressSignature, pendingRecognitionTaskId])
  const task = [...tasks].sort((a, b) => b.createdAt - a.createdAt)[0]
  const pickerTask = tasks.find((t) => t.workbenchVersion === 2 && t.status === "awaiting-character-selection")
  const recognizedKey = `${pickerTask?.id}:${pickerTask?.recognizedCharacters?.map((c) => c.id).join()}`
  /**
   * 磁盘上的版本 + 内存里的旧版迁移条目。
   * 迁移条目不落盘（懒落盘）——它只存在于这份列表里，除此之外没人写它，
   * 因此这里按 id 去重，避免以后落盘了出现两份。
   *
   * 追加在**末尾**，不要放开头：列表顺序是 loadWorkbenchRevisions 的降序 + 这个末尾追加，
   * 一旦把迁移条目前置，任何「按列表取第一条」的下游都会拿到旧版条目。
   * 渲染顺序由 orderedRevisions 单独按 createdAt 排，不依赖这份数组的顺序。
   */
  const reloadRevisions = useCallback(async () => {
    const stored = await loadWorkbenchRevisions(book.path)
    const legacyRevision = buildLegacyCharacterRevision(book)
    setRevisions(legacyRevision && !stored.some((r) => r.id === legacyRevision.id)
      ? [...stored, legacyRevision]
      : stored)
  }, [book.path, book])
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
    void reloadRevisions().catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [reloadRevisions, signature])
  /**
   * 自动入库：分析结果不再需要用户点「确认并加入」——读出来就发布。
   * 两条硬规则：
   *  1) origin === "legacy" 绝不在这里发布，理由是「懒落盘 + 打开页面即批量导入」：
   *     legacy 走 importBookAnalysisSkillsAsAuras，会把作品库里**全部**旧版角色
   *     批量导入灵魂库，而它原本只在用户点确认时才落盘。自动发布会变成
   *     「仅仅打开结果页就往磁盘写文件、并批量建灵魂」。
   *     （原先这里写的「两套 id 体系会造出重复角色灵魂」经复验**不成立**：
   *      aura-adapter.ts 有同源去重 existingAuraKeys，且两条路径最终都调用同一个
   *      createCustomCharacterAuraFromGeneratedSkill。别再按那个错理由去改去重逻辑。）
   *  2) 每个版本 id 每次挂载只尝试一次：失败只报一次错、不重试，
   *     否则 revisions/signature 每次变化都会再发一次，用户看到的是刷屏。
   */
  useEffect(() => {
    const pending = revisions.filter((revision) => !revision.confirmedAt && revision.origin !== "legacy"
      && canPublishRevision(revision) && !autoPublishAttempted.current.has(revision.id))
    if (!pending.length) return
    let current = true
    void (async () => {
      let published = false
      for (const revision of pending) {
        autoPublishAttempted.current.add(revision.id)
        try {
          const inspect = await inspectWorkbenchPublication(projectPath, revision)
          await confirmWorkbenchRevision(projectPath, book.path, revision.id, inspect.fingerprint, book)
          published = true
        } catch (error) {
          // 不写 confirmedAt、不重试；也不能让一个版本失败拖住其它版本。
          if (current) reportError(error)
        }
      }
      /*
       * 发布成功后重读：把盘上的 confirmedAt 与 publishedIds 拿回来。
       * 卡片上的状态徽标已按需求删除，所以这次重读的可见后果是**文风启用按钮**
       * 从「未入库（点了会先入库）」变成「当前版本（点了直接启停）」。
       */
      if (published && current) await reloadRevisions().catch((error) => { if (current) reportError(error) })
    })()
    return () => { current = false }
  }, [revisions, projectPath, book, book.path, reloadRevisions])
  /**
   * 「按需入库」：文风版本的启用按钮在未入库时点下去，先走这一步。
   *
   * 与上面的自动入库用同一条路径（inspect → confirm），区别只在触发时机：
   * 自动入库失败或没轮到这一版时，用户仍然要能自己把这一版发出去，
   * 否则启用按钮点了也没东西可启用。
   */
  const ensureRevisionPublished = useCallback(async (target: WorkbenchRevision): Promise<WorkbenchRevision> => {
    const inspect = await inspectWorkbenchPublication(projectPath, target)
    const published = await confirmWorkbenchRevision(projectPath, book.path, target.id, inspect.fingerprint, book)
    // 重读列表，让卡片/日期标签上的其它状态跟着更新；失败不影响本次启用。
    await reloadRevisions().catch(reportError)
    return published
  }, [projectPath, book, book.path, reloadRevisions])
  useEffect(() => {
    if (!draft) return
    try { localStorage.setItem(draftKey(book.path), JSON.stringify(draft)) } catch { setError("分析设置无法保存到本地，切换页面前请留意") }
  }, [book.path, draft])
  useEffect(() => { setCharacterIds(pickerTask?.recognizedCharacters?.filter((c) => c.category === "主角").map((c) => c.id) ?? []) }, [recognizedKey])
  useEffect(() => {
    if (!activityNavigation || activityNavigation.bookId !== book.id || activityNavigation.projectPath !== projectPath) return
    setActiveSkill(activityNavigation.skill)
    const target = revisions.find((r) => r.taskId === activityNavigation.taskId && r.skill === activityNavigation.skill)
    /*
     * 只在**真的找到目标版本**时才消费掉跳转请求。
     * 结果页是异步读出 revisions 的，第一轮往往是空数组；那时就消费会把跳转弄丢。
     * 反过来，一旦找到就必须消费 —— 否则本 effect 依赖 revisions，之后每次
     * 版本列表重载（自动入库后 reload、用户删掉一个对象…）都会把视口再拉回这个旧版本。
     */
    if (!target) return
    setScrollTargetId(target.id)
    consumeNavigation()
  }, [activityNavigation, revisions, book.id, projectPath, consumeNavigation])
  // 目标版本可能刚才还在别的页签下（还没渲染），所以滚动必须等它真的出现在 DOM 里再做。
  useEffect(() => {
    if (!scrollTargetId) return
    const target = document.querySelector(`[data-revision-id="${scrollTargetId}"]`)
    if (!target) return
    setScrollTargetId(null)
    target.scrollIntoView({ block: "start" })
  }, [scrollTargetId, activeSkill, revisions])
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
      setActiveSkill(requestDraft.skills[0])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setStarting(false) }
  }
  // 徽标要反映「在不在自定义灵魂库／绑给了谁」，从盘上读。
  useEffect(() => {
    if (activeSkill !== "characters") return
    let current = true
    const subjects = [...new Set(revisions.flatMap((r) => r.items.map((i) => i.subject)))]
    void Promise.all(subjects.map(async (subject) =>
      [subject, await loadCharacterSoulStatus(projectPath, book.metadata.title, subject)] as const,
    )).then((entries) => {
      if (current) setSoulStatus(Object.fromEntries(entries))
    }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [activeSkill, revisions, projectPath, book.metadata.title, signature])

  /** 只重读一个角色：不要靠整表重算，否则每次点按钮都触发一次全量 IO。 */
  const refreshSoulStatus = async (subject: string) => {
    const status = await loadCharacterSoulStatus(projectPath, book.metadata.title, subject)
    setSoulStatus((prev) => ({ ...prev, [subject]: status }))
  }

  const handleAddToSoul = async (revision: WorkbenchRevision, subject: string) => {
    try {
      const r = await addCharacterToSoulLibrary(projectPath, book, revision, subject)
      await refreshProjectState(projectPath)
      toast.success(`已将「${r.auraName}」加入自定义灵魂库。`)
      await refreshSoulStatus(subject)
    } catch (error) { reportError(error) }
  }

  /**
   * 删除确认框要针对的那一版。合并列表之后「哪一版」不再由外层块决定，
   * 所以由 removing 里的 revisionId 现查；查不到（版本刚被重读掉）就当作没打开。
   */
  const removingRevision = removing ? revisions.find((r) => r.id === removing.revisionId) : undefined
  /**
   * 删除一个对象：连使用库一起真删，成功后才重读版本列表。
   * 取消（onOpenChange(false)）什么都不做——绝不能「先删了才问」。
   *
   * 传下去的是 removingRevision（**被点那一版**），不是「当前版本」之类的近似值：
   * 两个版本都有同名角色时，删错版本就是不可撤销的数据丢失。
   */
  const confirmRemove = async () => {
    const { subject, revisionId } = removing ?? {}
    const target = revisionId ? revisions.find((r) => r.id === revisionId) : undefined
    // 先关弹窗（无论能不能删成），避免留下一个「点了删除但什么都没发生」的悬空状态。
    setRemoving(null)
    if (!subject) return
    // 版本查不到（弹窗打开期间版本被重读掉/作品库变化换了 legacy 的推导 id）时必须说出来：
    // 静默 return 正是本函数上一版写注释说要避免的那种「点了删除却没反应」。
    if (!target) { reportError(new Error("这个版本已不在当前列表里，请重新打开结果页后再删除。")); return }
    try {
      await removeWorkbenchRevisionItem({ projectPath, bookPath: book.path, revision: target, subject })
      void reloadRevisions().catch(reportError); onRefresh()
    } catch (error) { reportError(error) }
  }

  const openBindingDialog = async (revision: WorkbenchRevision, subject: string) => {
    setBindingTarget({ revision, subject })
    setBindableNames(null)
    // 每次打开/关闭都自增：后台精修是异步回来的，用它判断「还是同一个对话框」。
    const session = ++bindingSessionRef.current
    try {
      const names = await listBindableNovelCharacters(projectPath)
      if (bindingSessionRef.current !== session) return
      setBindableNames(names)
    } catch (error) {
      if (bindingSessionRef.current !== session) return
      reportError(error); setBindableNames([])
    }
    // 精修只负责补新名字，绝不 await：名单已经是缓存/本地的，模型慢也不能卡住对话框。
    void refineBindableNames(projectPath).then((refined) => {
      if (bindingSessionRef.current !== session || refined.length === 0) return
      setBindableNames((shown) => mergeBindableNames(shown ?? [], refined))
    })
  }

  /** 关对话框时同时作废还在飞的精修结果：它不能再往列表里塞东西。 */
  const closeBindingDialog = () => {
    bindingSessionRef.current += 1
    setBindingTarget(null)
    setBindableNames(null)
  }

  const confirmBinding = async (names: string[]) => {
    const target = bindingTarget
    if (!target) return
    try {
      const r = await bindCharacterToNovelCharacters(projectPath, book, target.revision, target.subject, names)
      await refreshProjectState(projectPath)
      // 部分失败时如实报数；幂等命中的计为已有
      if (r.failed.length === 0 && r.alreadyBound.length === 0) {
        toast.success(`已将「${target.subject}」绑定到 ${r.succeeded} 个小说人物`)
      } else {
        toast.info(`绑定完成：成功 ${r.succeeded}，已是现绑定 ${r.alreadyBound.length}，失败 ${r.failed.length}`)
      }
      await refreshSoulStatus(target.subject)
      closeBindingDialog()
    } catch (error) { reportError(error) }
  }
  /**
   * 当前页签的全部版本，按 createdAt 升序渲染（旧版本在前、新版本在后）。
   * 只改「渲染顺序」：revisions 数组本身仍是 loadWorkbenchRevisions 的降序 + 迁移条目追加在末尾
   * （见 reloadRevisions 的注释，那条不变量不能动）。filter 已经返回新数组，sort 不会污染 state。
   */
  const orderedRevisions = useMemo(
    () => revisions.filter((r) => r.skill === activeSkill).sort((a, b) => a.createdAt - b.createdAt),
    [revisions, activeSkill],
  )
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
    {pickerTask && <section className="wb-section" id="wb-character-picker">
      <h2>选择目标角色</h2>
      {pickerTask.error && <p role="alert">{pickerTask.error}</p>}
      {pickerTask.recognizedCharacters?.length ? <>
        <div className="wb-row"><input aria-label="搜索角色" placeholder="姓名或别名" value={characterSearch} onChange={(e) => setCharacterSearch(e.target.value)} />
          <button onClick={() => setCharacterIds(pickerTask.recognizedCharacters!.filter((c) => c.category === "主角").map((c) => c.id))}>选择主角</button>
          <button onClick={() => setCharacterIds([])}>清空</button></div>
        <div className="wb-character-pick">{pickerTask.recognizedCharacters.filter((c) => `${c.name} ${c.aliases.join(" ")}`.includes(characterSearch)).map((c) => <label key={c.id}>
          <input type="checkbox" checked={characterIds.includes(c.id)} onChange={(e) => setCharacterIds((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />
          {/* 别名可能为空，直接 `{category} · {aliases.join()}` 会渲染出悬空的「配角 · 」。 */}
          <strong>{c.name}</strong><span className="wb-muted">{c.category}{c.aliases.length > 0 ? ` · ${c.aliases.join("、")}` : ""}</span>
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
      {/* 视图切换只此一份，统管结果区里所有版本块（全版本平铺后每块各一个会互相打架）。 */}
      <div className="wb-results-bar">
        <div className="wb-tabs" role="tablist" aria-label="分析结果">{ANALYSIS_SKILL_ORDER.map((skill) => {
          const Icon = skillIcons[skill]
          return <button key={skill} role="tab" aria-selected={activeSkill === skill} onClick={() => setActiveSkill(skill)}><Icon />{WORKBENCH_LABELS[skill]}</button>
        })}</div>
        <div className="wb-view-switch" role="group" aria-label="成果展示方式">
          <button className="wb-icon" title="卡片视图" aria-label="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /></button>
          <button className="wb-icon" title="列表视图" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List /></button>
        </div>
      </div>
      <div className="wb-card-list">
        {orderedRevisions.length > 0 ? orderedRevisions.map((revision) => {
          const items = visibleItems(revision)
          const itemDate = formatTimestamp(revision.createdAt)
          return <section className="wb-revision-block" data-revision-id={revision.id} key={revision.id}>
            <div className="wb-skill-grid" data-view={view}>
              {items.map((item, index) => <SkillCard key={item.subject} revision={revision} item={item} index={index} itemDate={itemDate}
                expanded={expandedCard?.revisionId === revision.id && expandedCard.subject === item.subject}
                overviewOpen={expandedOverviews.includes(cardKey(revision.id, item.subject))}
                book={book} soulStatus={soulStatus} busy={starting || hasActiveTask}
                onAddToSoul={() => void handleAddToSoul(revision, item.subject)}
                onBind={() => void openBindingDialog(revision, item.subject)}
                onToggleRules={() => setExpandedCard((current) =>
                  current?.revisionId === revision.id && current.subject === item.subject ? null : { revisionId: revision.id, subject: item.subject })}
                onToggleOverview={() => setExpandedOverviews((keys) => {
                  const key = cardKey(revision.id, item.subject)
                  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
                })}
                onOpenRevise={() => setRevisingFor(revision.id)}
                onRequestRemove={() => setRemoving({ revisionId: revision.id, subject: item.subject })} />)}
              {!items.length && <p className="wb-muted wb-no-results">没有符合条件的成果</p>}
            </div>
          </section>
        }) : <p className="wb-muted">暂无新版本结果。</p>}
      </div>
      {/* 版本级内容统一排在合并列表之后，按版本顺序（导图/证据索引/与上一版本的变化/补充修订）。 */}
      {orderedRevisions.map((revision) => <RevisionExtras key={revision.id} revision={revision}
        previous={revisions.find((r) => r.id === revision.parentRevisionId)}
        projectPath={projectPath}
        expandedSubject={expandedCard?.revisionId === revision.id ? expandedCard.subject : null}
        openRevise={revisingFor === revision.id}
        requirements={revisionDrafts[revision.id] ?? ""}
        revising={starting || hasActiveTask}
        onRequirements={(value) => setRevisionDrafts((drafts) => ({ ...drafts, [revision.id]: value }))}
        onToggleRevise={(open) => setRevisingFor((current) => open ? revision.id : (current === revision.id ? null : current))}
        onCloseRules={() => setExpandedCard(null)}
        onEnsurePublished={() => ensureRevisionPublished(revision)}
        onRevise={(requirements) => draft && launch({ ...draft, selectedIds: revision.selectedChapterIds, skills: [revision.skill], requirements: { [revision.skill]: `${revision.requirements}\n补充要求：${requirements}` } }, revision.id)} />)}
      {/* 删除确认框只留一份：一次只可能删一个对象，它需要知道「哪一版的哪个对象」。 */}
      <RemoveItemDialog revision={removingRevision} subject={removing?.subject ?? null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        onConfirm={() => void confirmRemove()} />
      <LegacySkillResults book={book} skill={activeSkill} storyMapRefreshKey={storyMapRefreshKey} />
      <BindingTargetDialog subject={bindingTarget?.subject ?? null} names={bindableNames} projectPath={projectPath}
        alwaysKeep={boundCharacterNames(bindingTarget ? soulStatus[bindingTarget.subject] : undefined)}
        onOpenChange={(open) => { if (!open) closeBindingDialog() }}
        onConfirm={(names) => void confirmBinding(names)} />
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

/**
 * 一张对象卡。**不持有任何 state**：展开规则、展开概述、待删除这三件事都由结果区按
 * 「版本 id + 对象名」复合键统一持有。
 *
 * 为什么必须是复合键：合并列表之后，同一个角色（例如「许七安」）会出现在多个版本里，
 * 只用对象名当键的话，点一个版本的「查看规则」会同时点亮另一个版本的同名卡片。
 */
function SkillCard({ revision, item, index, itemDate, expanded, overviewOpen, book, soulStatus, busy, onAddToSoul, onBind, onToggleRules, onToggleOverview, onOpenRevise, onRequestRemove }: {
  revision: WorkbenchRevision; item: WorkbenchItem; index: number; itemDate: string
  expanded: boolean; overviewOpen: boolean
  book: BookAnalysisLibraryBook
  soulStatus: Record<string, CharacterSoulStatus>; busy: boolean
  onAddToSoul: () => void; onBind: () => void
  onToggleRules: () => void; onToggleOverview: () => void; onOpenRevise: () => void; onRequestRemove: () => void
}) {
  /*
   * 这份成果引用的原文。与上面那行「M 条依据」用**同一个集合**，
   * 所以「几条依据」和「这里列了几条」不可能互相矛盾。
   */
  const itemEvidence = [...new Set(item.rules.flatMap((rule) => rule.evidenceIds))]
    .map((id) => revision.evidence.find((evidence) => evidence.id === id))
    .filter((evidence) => !!evidence)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  return <article className="wb-skill-card">
    <div className="wb-card-main">
      <div className="wb-card-heading"><span className="wb-avatar" data-tone={index % 3}>{item.subject.slice(0, 1)}</span>
        {/* 对象自己没有时间戳，取所属版本的 createdAt：同一对象在不同版本里日期不同是对的。 */}
        <h3>{item.subject}{itemDate && <small className="wb-card-date">{` · ${itemDate}`}</small>}</h3>
      </div>
      <p className="wb-card-description" data-expanded={item.summary.length <= 100 || overviewOpen}>{item.summary}</p>
      {item.summary.length > 100 && <button className="wb-overview-toggle" aria-label={`展开${item.subject}概述`} aria-expanded={overviewOpen}
        onClick={onToggleOverview}>
        {overviewOpen ? "收起概述" : "展开完整概述"}<ChevronDown />
      </button>}
      <div className="wb-traits">{[...new Set(item.rules.map((rule) => WORKBENCH_DIMENSIONS[rule.dimension] ?? rule.dimension))].map((dimension) => <span key={dimension}>{dimension}</span>)}</div>
      <div className="wb-card-meta">
        <small>{item.rules.length}条规则 · {new Set(item.rules.flatMap((rule) => rule.evidenceIds)).size}条依据</small>
        {/*
          * 证据索引原来是一个 <details>，另起一行、点开就地把原文展开（上下排列）。
          * 现在与左边那行统计**并排同一行**，点击改为弹窗 —— 原文有长有短，
          * 内联展开会把卡片撑得忽高忽低，弹窗里给足空间反而更好读。
          * 只列**这份成果自己**引用的原文；整版覆盖统计已按需求移除。
          */}
        <button
          type="button"
          className="wb-card-evidence"
          data-ui-card-evidence="true"
          aria-label={`查看${item.subject}的证据索引`}
          onClick={() => setEvidenceOpen(true)}
        >
          <Search />证据索引
        </button>
      </div>
    </div>
    {/*
      * 弹窗挂在卡片内部、内容经 portal 渲染到 body。
      * 它只属于这一张卡（itemEvidence 是按本卡规则算出来的），
      * 所以状态放在 SkillCard 本地即可 —— 外层用 key={item.subject} 渲染，
      * 同一版本里 subject 唯一，状态不会串到别的卡片上。
      */}
    <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-[680px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{item.subject}的证据索引</DialogTitle>
          <DialogDescription>
            这份成果引用了 {itemEvidence.length} 条原文，来自它自己的 {item.rules.length} 条规则。
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          {itemEvidence.length
            ? itemEvidence.map((evidence) => <blockquote className="wb-evidence" key={evidence.id}>
              <small>第{evidence.order}章 · 正文位置{evidence.start}～{evidence.end}</small><p>{evidence.text}</p>
            </blockquote>)
            : <p className="wb-muted">这份成果没有引用原文。</p>}
        </div>
      </DialogContent>
    </Dialog>
    <footer className="wb-card-footer">
      <button aria-label={`查看${item.subject}规则`} aria-expanded={expanded} onClick={onToggleRules}><FileText />{expanded ? "收起规则" : "查看规则"}</button>
      {/* 修订与删除是一个动作组：包在同一个容器里让它们紧挨，靠右与「查看规则」分开。 */}
      <span className="wb-card-actions">
        <button className="wb-icon" aria-label={`补充${item.subject}修订要求`} title="补充本版本修订要求" onClick={onOpenRevise}><PencilLine /></button>
        {/* 删除是「连使用库一起真删」：先弹窗确认，取消则什么都不发生。 */}
        <button className="wb-icon wb-card-remove" aria-label={`删除${item.subject}`} title="删除该对象（连使用库一起删）" onClick={onRequestRemove}><Trash2 /></button>
      </span>
    </footer>
    {revision.skill === "characters" && <div className="wb-soul-actions" data-testid={`wb-soul-actions-${item.subject}`}>
      {/* publishable 只算一次：徽标与两个按钮必须用同一个判定，否则文案会和可点性互相矛盾。 */}
      {(() => {
        const publishable = hasPublishableData(revision, item, book)
        const status = soulStatus[item.subject] ?? "none"
        return <>
          <span className="wb-soul-status">{soulStatusLabel(soulStatus[item.subject], publishable)}</span>
          <button type="button" disabled={!publishable || status !== "none" || busy}
            title={!publishable ? "这个角色没有可加入灵魂库的资料" : status !== "none" ? "已在自定义灵魂库中" : "只加入自定义灵魂库，不绑定小说人物"}
            onClick={onAddToSoul}><Plus />加入自定义灵魂库</button>
          <button type="button" disabled={!publishable || busy}
            title={publishable ? "绑定到小说人物（会自动加入自定义灵魂库）" : "这个角色没有可加入灵魂库的资料"}
            onClick={onBind}><Link2 />绑定…</button>
        </>
      })()}
    </div>}
  </article>
}

/**
 * 一个版本的**版本级内容**：导图、展开的规则详情、证据索引、与上一版本的变化、补充修订。
 *
 * 合并列表只合并对象卡；这些内容按版本各留一份、统一排在合并列表之后。
 * 因为多版本时会有 N 组长得一样的块，第一行放一个带年份的日期标签标明归属
 * （卡片上的是不带年份的短格式）。
 *
 * styleState 必须留在这里：它是「这个版本对应的文风预设是否当前启用」的异步读取，
 * 每版本一份，天然属于版本级内容。
 */
/**
 * 文风版本的启用状态。**必须是三态**：
 *
 * - `unpublished`：这个版本还没入库，所以磁盘上根本没有它的文风预设。
 * - `replaced`：预设存在，但内容已被更新的一版顶掉（generatedAt 不匹配）。
 * - `current`：预设就是这个版本的内容，可以启停。
 *
 * 把「没入库」和「已被替换」合成一态是不行的：前者可以补入库、后者补入库等于
 * **用旧内容覆盖新预设**，是破坏性的。同一个文案会把用户引向危险操作。
 */
type StyleEnableState = { kind: "unpublished" } | { kind: "replaced" } | { kind: "current"; enabled: boolean }

function RevisionExtras({ revision, previous, projectPath, expandedSubject, openRevise, requirements, revising, onRequirements, onToggleRevise, onCloseRules, onRevise, onEnsurePublished }: {
  revision: WorkbenchRevision; previous?: WorkbenchRevision; projectPath: string
  expandedSubject: string | null
  openRevise: boolean; requirements: string; revising: boolean
  onRequirements: (value: string) => void; onToggleRevise: (open: boolean) => void
  onCloseRules: () => void
  onRevise: (requirements: string) => Promise<void> | null
  /** 未入库的文风版本要能「点一下启用就顺带入库」，入库动作在父组件里（它才持有 book）。 */
  onEnsurePublished: () => Promise<WorkbenchRevision>
}) {
  const revisionInput = useRef<HTMLTextAreaElement>(null)
  const [styleState, setStyleState] = useState<StyleEnableState | null>(null)
  const mapHtml = useMemo(() => revision.storyMap ? renderStoryMapHtml({ ...revision.storyMap, bookTitle: revision.bookTitle }) : "", [revision])
  useEffect(() => {
    let current = true
    /*
     * 这里**刻意不再**因 `!revision.confirmedAt` 提前返回。
     * 原来这么做，导致停在「待确认」的版本连工具栏都不渲染，用户看到的是
     * 「文风生成完却没有启用按钮」——而按钮缺失和未入库其实是同一件事。
     */
    if (revision.skill !== "style") return
    void loadWritingStyleStore(projectPath).then((store) => {
      if (!current) return
      const preset = store.styles.find((s) => revision.publishedIds?.includes(s.id))
      if (!preset) { setStyleState({ kind: "unpublished" }); return }
      if (preset.profile.generatedAt !== revision.createdAt) { setStyleState({ kind: "replaced" }); return }
      setStyleState({ kind: "current", enabled: store.enabledStyleId === preset.id })
    }).catch(reportError)
    return () => { current = false }
  }, [projectPath, revision.id, revision.confirmedAt, revision.publishedIds])
  const toggleStyle = async () => {
    /*
     * 未入库时先入库：启用需要「文风预设」存在，而预设是入库时才建的
     * （confirmWorkbenchRevision → upsertWritingStylePreset → publishedIds）。
     * 入库函数把带新 publishedIds 的版本对象还回来，所以紧接着就能找到预设并启用，
     * 不必等父组件重载列表再让用户点第二次。
     */
    const ensured = styleState?.kind === "unpublished" ? await onEnsurePublished() : revision
    const store = await loadWritingStyleStore(projectPath)
    const preset = store.styles.find((s) => ensured.publishedIds?.includes(s.id))
    if (!preset) throw new Error("入库后仍未找到这篇文风预设，请重新生成文风")
    if (preset.profile.generatedAt !== ensured.createdAt) throw new Error("该版本已被替换，请选择当前入库版本")
    const enabled = store.enabledStyleId === preset.id
    if (!enabled && store.enabledStyleId && !window.confirm("启用此文风会替换当前启用的文风，是否继续？")) return
    await setEnabledWritingStyle(projectPath, enabled ? null : preset.id)
    setStyleState({ kind: "current", enabled: !enabled })
  }
  const items = visibleItems(revision)
  const expandedItem = items.find((item) => item.subject === expandedSubject)
  const revisionDate = formatTimestamp(revision.createdAt, true)
  /*
   * 聚焦与滚动只由「编辑器是否打开」这一个信号驱动，不跟着某个按钮走：
   * 卡片上的笔（结果区）与版本级按钮（这里）都能打开它，而编辑框本身位于**所有**卡片之后，
   * 若只有本地按钮聚焦，点卡片上的笔就没有任何可见反馈，用户会以为按钮坏了。
   */
  useEffect(() => {
    if (openRevise) requestAnimationFrame(() => revisionInput.current?.focus())
  }, [openRevise])
  return <section className="wb-revision-extras" data-revision-extras={revision.id}>
    {/* 工具栏只留本版本自己的动作（启用文风）；视图切换已提到结果区顶部统一一份。 */}
    {styleState && <div className="wb-results-tools">
      {/*
        * 加载完成前（styleState 为 null）不渲染工具栏，避免按钮出现又消失；
        * 但**只要加载完了就必须给出按钮**（未入库也是一种加载完的状态）——
        * 这正是「文风生成完却没有启用按钮」的修复点。
        */}
      {styleState.kind === "replaced"
        ? <span className="wb-muted">此历史版本已被替换</span>
        : <button onClick={() => void toggleStyle().catch(reportError)}><Play />
          {styleState.kind === "current" && styleState.enabled ? "取消启用文风" : "启用此文风"}</button>}
    </div>}
    {mapHtml && <details className="wb-result"><summary>原作结构观察导图</summary><iframe title="原作结构观察导图" srcDoc={mapHtml} sandbox="allow-same-origin" style={{ width: "100%", height: 480, border: 0 }} /></details>}
    {expandedItem && <section className="wb-rule-detail">
      <div className="wb-section-heading"><h2>{expandedItem.subject} · 完整规则</h2><button className="wb-icon" aria-label="收起完整规则" title="收起完整规则" onClick={onCloseRules}><X /></button></div>
      <p className="wb-muted">{expandedItem.limitations}</p>
      {expandedItem.styleFingerprint && <WorkbenchStyleDetails item={expandedItem} evidence={revision.evidence} metrics={revision.metrics} />}
      {expandedItem.rules.map((rule) => <div className="wb-rule" key={rule.id}><h3>{rule.id} · {WORKBENCH_DIMENSIONS[rule.dimension] ?? rule.dimension}</h3>
        <dl><dt>适用情境</dt><dd>{rule.condition}</dd><dt>复用规则</dt><dd>{rule.action}</dd><dt>例外边界</dt><dd>{rule.boundary}</dd></dl>
        <details><summary>原文观察与依据（{rule.evidenceIds.length}）</summary><p>{rule.observation}</p>
          {rule.evidenceIds.map((id) => revision.evidence.find((e) => e.id === id)).filter((e) => !!e).map((e) => <blockquote className="wb-evidence" key={e.id}><small>第{e.order}章 · 正文位置{e.start}～{e.end}</small><p>{e.text}</p></blockquote>)}
        </details>
      </div>)}
    </section>}
    {previous && <details className="wb-result"><summary>与上一版本的变化</summary>
      {revision.items.map((item) => <div key={item.subject}><h3>{item.subject}</h3><details><summary>上一版本</summary><pre>{previous.items.filter((i) => i.subject === item.subject).map(workbenchRulesMarkdown).join("\n") || "上一版本没有此对象"}</pre></details><pre>{workbenchRulesMarkdown(item)}</pre></div>)}
    </details>}
    <div className="wb-revision-section">
      {/* 只有「日期标签 + 补充修订」这一行是 flex；整段不能变 flex，否则 .wb-request
          （display:block，靠它铺满整行）会变成按内容收缩的 flex 项，补充修订的输入框会被挤窄。 */}
      <div className="wb-revision-head">
        {/* 版本标题行删掉之后，这里就是唯一能标明「这一组版本级内容属于哪一版」的地方。 */}
        {revisionDate && <span className="wb-revision-date">{revisionDate}</span>}
        <button aria-expanded={openRevise} onClick={() => onToggleRevise(!openRevise)}><PencilLine />补充修订</button>
      </div>
      {openRevise && <><label className="wb-request"><span>补充修订要求</span><textarea ref={revisionInput} rows={3} value={requirements} onChange={(e) => onRequirements(e.target.value)} maxLength={4000} aria-label="补充修订要求" /></label>
        <button disabled={!requirements.trim() || revising} onClick={() => void onRevise(requirements.trim())?.catch(reportError)}><RefreshCw />生成修订版本</button></>}
    </div>
  </section>
}

/**
 * 删除确认弹窗。用仓库现成的 base-ui Dialog（与绑定对话框同一套），不自己搭遮罩。
 *
 * 文风/故事页整版只有**一个**库条目，所以文案必须写明删掉的是「《书名》· 文风 / 故事机制」整版，
 * 而不是某一个对象——否则用户以为只删一张卡，实际删掉的是整个预设/框架。
 */
function RemoveItemDialog({ revision, subject, onOpenChange, onConfirm }: {
  revision?: WorkbenchRevision; subject: string | null
  onOpenChange: (open: boolean) => void; onConfirm: () => void
}) {
  // 版本查不到时（重读期间）不给文案：绝不能拿别的版本的书名去拼一句「要删的是它」。
  const single = revision?.skill === "characters"
  const target = single ? `「${subject}」` : `「${revision?.bookTitle} · ${revision?.skill === "style" ? "文风" : "故事机制"}」`
  const title = revision?.skill === "style" ? `删除文风预设${target}？` : revision?.skill === "story" ? `删除故事框架${target}？` : `从角色灵魂库删除${target}？`
  const description = single
    ? "将删除该角色的灵魂及其规则，并解除它已绑定的小说人物。此操作不可撤销。"
    : revision?.skill === "style" ? "将删除该文风预设。此操作不可撤销。" : "将删除该故事框架。此操作不可撤销。"
  return (
    <Dialog open={Boolean(revision) && Boolean(subject)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={onConfirm}>删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 绑定对话框。用仓库的 base-ui Dialog，不自己搭遮罩：
 * DialogContent 已经带了 role="dialog"、焦点圈、Esc 关闭与宽度约束。
 *
 * 名单由调用方读（缓存感知、绝不等 LLM）；本组件只负责筛选、勾选与忽略表。
 * 导出是为了让「搜索/栅格/忽略」这些自身契约能脱离整页工作台直接测。
 */
export function BindingTargetDialog({ subject, names, projectPath, alwaysKeep = [], onOpenChange, onConfirm }: {
  subject: string | null
  names: string[] | null
  projectPath: string
  alwaysKeep?: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: (names: string[]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [ignored, setIgnored] = useState<string[]>([])
  const [ignoredOpen, setIgnoredOpen] = useState(false)
  // 换目标就重置：勾选、搜索词、忽略展开都只属于当前这个角色。
  useEffect(() => {
    if (!subject) return
    setPicked([]); setQuery(""); setIgnored([]); setIgnoredOpen(false)
    let current = true
    // 打开时读忽略表；读不到就当没有忽略项，绝不能因此挡住名单。
    void readBindableIgnoreList(projectPath).then((list) => { if (current) setIgnored(list) }).catch(() => {})
    return () => { current = false }
  }, [subject, projectPath])
  const ignoreName = async (name: string) => {
    try {
      setIgnored(await addBindableIgnore(projectPath, name))
    } catch (error) { reportError(error) }
  }
  const restoreName = async (name: string) => {
    try {
      setIgnored(await removeBindableIgnore(projectPath, name))
    } catch (error) { reportError(error) }
  }
  // 内置规则与忽略表一起过滤；alwaysKeep 是安全阀，已绑定的人物永不出局。
  const candidates = filterBindableCharacters(names ?? [], ignored, alwaysKeep)
  const keyword = query.trim().toLowerCase()
  const visible = keyword ? candidates.filter((name) => name.toLowerCase().includes(keyword)) : candidates
  const loading = names === null
  const empty = names !== null && names.length === 0
  return (
    <Dialog open={Boolean(subject)} onOpenChange={onOpenChange}>
      {/*
        纵向分配：标题/说明/搜索框/计数/页脚全都 shrink-0（按内容占位、绝不被压扁），
        只有中间的名单区吸收剩余高度并自己滚动。之前这几行没有 shrink-0，
        窗口一矮就被挤到只剩几像素、文字被裁一半，名单区还会被压成 0。
        整个对话框再兜一层 overflow-y-auto：窗口真的极矮时宁可对话框自己滚，
        也不能让「绑定所选」按钮跑到看不见的地方。
      */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto sm:max-w-[760px]">
        <DialogHeader className="shrink-0"><DialogTitle>绑定「{subject}」</DialogTitle></DialogHeader>
        <p className="shrink-0 text-sm text-muted-foreground">绑定后会自动把该角色灵魂加入自定义灵魂库。</p>
        <label className="flex shrink-0 items-center gap-2 rounded-md border px-2">
          <Search className="size-4 shrink-0 opacity-60" />
          {/* Dialog 的初始焦点落在第一个可聚焦控件上，也就是这里，所以打开即输入。 */}
          <input aria-label="搜索小说人物" placeholder="搜索小说人物" value={query}
            className="h-9 w-full bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 搜索框有内容时，用户想退出的是「筛选」而不是对话框：Esc 先清空搜索。
              if (event.key !== "Escape" || !query.trim()) return
              event.preventDefault(); event.stopPropagation(); setQuery("")
            }} />
        </label>
        {!loading && <p className="shrink-0 text-xs text-muted-foreground">已选 {picked.length} 个 · 匹配 {visible.length} / 共 {candidates.length}</p>}
        {/* 文案与 character-aura.ts 的常量一致 */}
        {empty && <p role="alert" className="shrink-0 text-sm">请先在大纲中添加人物小传或人物设定，再绑定角色灵魂</p>}
        {/* min-h-0 让名单区成为唯一吸收纵向压力的地方：窗口再矮也是它变短，
            标题/搜索框/计数/按钮始终按内容完整显示，绝不被裁。 */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="bindable-name-list">
          {/* 加载提示只占列表区：标题、搜索框和底部按钮立刻可用。 */}
          {loading && <p className="text-sm text-muted-foreground">正在读取小说人物…</p>}
          {!loading && !empty && (visible.length > 0
            ? <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 md:grid-cols-5" data-testid="bindable-name-grid">
                {visible.map((name) => (
                  <div key={name} className="flex min-w-0 items-center gap-1">
                    <label className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-sm">
                      <input type="checkbox" checked={picked.includes(name)}
                        onChange={(event) => setPicked((ids) => event.target.checked ? [...ids, name] : ids.filter((id) => id !== name))} />
                      {/* 名字可能很长：截断显示，全名留在 title 里。 */}
                      <span className="truncate" title={name}>{name}</span>
                    </label>
                    {/* 「忽略」按最小宽度排版：5 列时每格只有约 145px，
                        按钮多占 1px，名字就少显示一个字。 */}
                    <button type="button" title={`忽略「${name}」`} aria-label={`忽略${name}`}
                      className="shrink-0 rounded px-0.5 text-[11px] leading-4 text-muted-foreground hover:text-foreground"
                      onClick={() => void ignoreName(name)}>忽略</button>
                  </div>
                ))}
              </div>
            : <p className="text-sm text-muted-foreground">{keyword ? `没有匹配「${query.trim()}」` : "没有可绑定的小说人物"}</p>)}
        </div>
        <DialogFooter className="shrink-0 items-center">
          {ignored.length > 0 && <div className="mr-auto text-xs text-muted-foreground">
            <button type="button" aria-expanded={ignoredOpen} className="underline" onClick={() => setIgnoredOpen(!ignoredOpen)}>已忽略 {ignored.length} 项</button>
            {ignoredOpen && <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{ignored.map((name) => <li key={name} className="flex items-center gap-1">
              <span className="truncate" title={name}>{name}</span>
              <button type="button" aria-label={`恢复${name}`} className="underline" onClick={() => void restoreName(name)}>恢复</button>
            </li>)}</ul>}
          </div>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={picked.length === 0} onClick={() => onConfirm(picked)}>绑定所选 {picked.length} 个人物</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
