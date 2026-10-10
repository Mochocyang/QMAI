import { type CSSProperties, Suspense, lazy, useEffect, useCallback, useRef, useMemo, useState, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Eraser, Lightbulb, MoreHorizontal, Type, WandSparkles, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel, resolveNovelModel, formatResolvedModelLabel } from "@/lib/novel/model-resolver"
import type { FinalChapterSavePhase } from "@/stores/wiki-store"
import { createDirectory, deleteFile, fileExists, readFile, writeFile, writeFileAtomic, writeFileIfAbsent, listDirectory } from "@/commands/fs"
import { isChapterPath, normalizePath } from "@/lib/path-utils"
import { getFileCategory, isBinary } from "@/lib/file-types"
import { WikiEditor, type WikiEditorHandle } from "@/components/editor/wiki-editor"
import { WikiReader } from "@/components/editor/wiki-reader"
import { FilePreview } from "@/components/editor/file-preview"
import { OutlineDualPreview } from "@/components/editor/outline-dual-preview"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildChapterEditorHeader } from "@/lib/chapter-editor-header"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { chapterHasLaterChapter, chapterOrdersFromTree, resolveDraftMemoryHint, type DraftMemoryHintArrival } from "@/lib/draft-memory-hint"
import { saveNovelConfig, saveUiBodyFontFamily, saveUiBodyFontPx, saveUiBodyLineHeight, saveUiBodyLetterSpacing, saveUiBodyMarginX, saveUiBodySafeBottom } from "@/lib/project-store"
import { registerPreCloseFlush } from "@/lib/pre-close-flush"
import { isChapterPage, isFinalChapter, parseChapterMeta, syncChapterFrontmatterFromBody, updateChapterStatus, updateChapterTitle } from "@/lib/novel/chapter-meta"
import { resolveReviewModel } from "@/lib/novel/review-model"
import { CognitionPanel } from "@/components/novel/cognition-panel"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getNextChatExpanded } from "./chat-layout"
import { TextTransformPreviewDialog } from "@/components/novel/text-transform-preview-dialog"
import { DeAiSkillOptionsPanel } from "@/components/skill-library/de-ai-skill-picker"
import { useDeAiSkillOptions } from "@/components/skill-library/use-de-ai-skill-options"
import { buildDeAiRewriteMessages } from "@/lib/novel/de-ai-adapter"
import { filterDeAiOutput } from "@/lib/novel/de-ai-output"
import {
  loadDeAiSkillConfig,
  resolveEffectiveDeAiSkill,
  saveDeAiSkillConfig,
  setLastChapterDeAiSkill,
} from "@/lib/novel/de-ai-skill-library"
import { startOutlineIngestTask } from "@/lib/novel/outline-generation"
import { renderOutlineHtmlForPath } from "@/lib/novel/outline-save-request"
import { getOutlineIngestIdentity, getOutlineFileName, outlineSnapshotExists } from "@/lib/novel/outline-ingest-utils"
import { streamChat } from "@/lib/llm-client"
import {
  extractChapterNumberFromMarkdown,
  getDraftChapterPath,
  resolveChapterFlushMarkdown,
  shouldSyncChapterOnLeave,
} from "@/lib/novel/chapter-path-sync"
import { makeChapterFileName, makeDefaultChapterTitle } from "@/lib/wiki-filename"
import { getPreviewContentContainerClass, shouldUseCompactChapterToolbar } from "@/lib/workspace-layout"
import { useOutlineGenerationStore, type OutlineGenerationTask } from "@/stores/outline-generation-store"
import {
  projectPathKey,
  selectProjectEventOutlineTasks,
  useEventOutlineTaskStore,
} from "@/stores/event-outline-task-store"
import { EventOutlineCard } from "@/components/sources/event-outline-card"
import { EventOutlineWizardDialog } from "@/components/sources/event-outline-wizard-dialog"
import { generateEventOutline } from "@/lib/novel/event-outline-generation"
import { cleanGeneratedChapterContentWithTitle } from "@/lib/novel/chapter-content-cleanup"
import { buildDraftChapterMarkdown } from "@/lib/novel/chapter-draft-markdown"
import { runDeepChapterGeneration } from "@/lib/novel/deep-chapter-generation"
import { type EventOutlineRequest } from "@/lib/novel/event-outline"
import { isUserAbortError, USER_ABORT_MESSAGE } from "@/lib/user-abort"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { flattenMdFiles, findChapterFileByNumber, pickChapterLibraryFiles, resolveNextChapterNumber } from "@/lib/novel/chapter-utils"
import { useImportProgressStore } from "@/stores/import-progress-store"
import {
  buildPolishSelectionMessages,
  extractDeAiChapterText,
  rebuildChapterBody,
  replaceChapterBodySelection,
  splitChapterHeading,
  type ChapterBodySelection,
  type ChapterSelectionAction,
} from "@/lib/chapter-selection"
import { shouldApplyDiskToEditor } from "@/lib/editor-disk-sync"
import { registerEditorExternalUpdateHandler } from "@/lib/editor-external-update-session"
import { registerChapterSaveFlush, CHAPTER_AUTOSAVE_INTERVAL_MS } from "@/lib/chapter-save-flush"
import { createChapterExternalUpdateCoordinator } from "@/lib/chapter-external-update-coordinator"
import { applyOpenChapterBodyUpdate, createDeAiBatchChapterApplier } from "@/lib/novel/de-ai-batch/chapter-apply"
import { acquireDeAiChapterSlot } from "@/lib/novel/de-ai-batch/chapter-concurrency"
import { toast } from "@/lib/toast"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import type { WritingSource } from "@/lib/writing-stats"
import { selectProjectDeAiReview, selectProjectDeAiTasks, useDeAiTaskStore } from "@/stores/de-ai-task-store"
import { DeAiBatchReviewDialog } from "@/components/novel/de-ai-batch-review-dialog"
import type { DeAiBatchChapter, DeAiBatchTaskRecord } from "@/lib/novel/de-ai-batch/types"
import { saveDeAiDraftWithoutOverwrite } from "@/lib/novel/de-ai-draft"
import type { FileNode } from "@/types/wiki"
import { UiTestEditor, type UiTestEditorSaveState } from "@/components/uitest/ui-test-editor"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { UiTestOutlineTools } from "@/components/uitest/ui-test-outline-tools"
import { createDebouncedPersist } from "@/lib/debounced-persist"
import { BodyTypographyFields, type BodyTypographyValue } from "@/components/settings/sections/body-typography-fields"
/*
 * ⚠ 这个 CSS 必须**静态** import 在渲染浮层的这个模块里，不能挪走。
 *
 * 「字体设置」浮层原先借用设置页的 ui-test-tools.css（靠控件根节点的
 * data-ui="interface-fields"），而那份 CSS 只被路由级**懒 chunk** 加载。
 * 结果是：没进过设置页就直接开章节浮层时，浮层先以无样式状态显示
 * （标签挤在控件上方、错位），过一会儿样式才到、内容突然跳成两列 ——
 * 用户报的"刚开始没有美感，等一会儿才有边框"。
 *
 * 静态 import 让这份样式与浮层同生共死：浮层能渲染，样式就一定已生效。
 * 实测根因与证据见 body-font-popover.css 顶部注释与
 * .codex-temp/probe-popover-fouc.mjs。
 *
 * 防回归守卫在
 * src/components/settings/sections/body-typography-fields.spec.tsx
 * 的「浮层样式与渲染它的模块同生共死——不再依赖懒加载 chunk（首帧即有样式）」。
 * （**没有** body-font-popover.spec.ts 这个文件 —— 我先前在这里写过它，
 *  那是一条指向空文件的指路，会让下一个人以为这块没人守。）
 */
import "./body-font-popover.css"
import {
  DEFAULT_BODY_FONT_FAMILY,
  DEFAULT_BODY_FONT_PX,
  DEFAULT_BODY_LETTER_SPACING,
  DEFAULT_BODY_LINE_HEIGHT,
  DEFAULT_BODY_MARGIN_X,
  DEFAULT_BODY_SAFE_BOTTOM,
  type BodyFontFamily,
} from "@/lib/font-settings"

const SnapshotViewer = lazy(async () => {
  const mod = await import("@/components/novel/snapshot-viewer")
  return { default: mod.SnapshotViewer }
})

function extractDeAiResult(content: string): string {
  return extractDeAiChapterText(filterDeAiOutput(content))
}

function finishDeAiTaskResult(taskId: string, content: string): void {
  const candidate = extractDeAiResult(content)
  if (candidate.trim()) {
    useDeAiTaskStore.getState().finishTask(taskId, candidate)
    return
  }
  useDeAiTaskStore.getState().failTask(taskId, "去AI味未返回正文")
}

function inferEditorMode(path: string): "read" | "edit" {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.includes("/wiki/chapters/") || normalized.includes("/wiki/outlines/")) {
    return "edit"
  }
  return "read"
}

function isOutlinePath(path: string): boolean {
  return path.replace(/\\/g, "/").includes("/wiki/outlines/")
}

function getDirName(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

async function getUniqueSiblingPath(dir: string, fileName: string, currentPath: string): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (firstPath === currentPath || !(await fileExists(firstPath))) return firstPath
  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let i = 2; i <= 99; i++) {
    const candidate = `${dir}/${stem}-${i}${extension}`
    if (candidate === currentPath || !(await fileExists(candidate))) return candidate
  }
  return `${dir}/${stem}-${Date.now()}${extension}`
}

async function getCanonicalChapterPath(currentPath: string, markdown: string, chapterNumber: number | null): Promise<string> {
  const { frontmatter, body } = parseFrontmatter(markdown)
  const title = typeof (frontmatter as Record<string, unknown> | null)?.title === "string"
    ? String((frontmatter as Record<string, unknown>).title).trim()
    : body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ""
  if (!title) return currentPath
  return getUniqueSiblingPath(getDirName(currentPath), makeChapterFileName(title, chapterNumber), currentPath)
}

function formatWritingBodyWithIndent(markdown: string): string {
  return formatChapterWriting(markdown)
  /*
  const lines = body.split("\n")
  let inFence = false
  const formatted = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    if (!trimmed) return line
    if (/^(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|\|)/.test(trimmed)) return line
    if (/^\s*[-]{3,}\s*$/.test(trimmed)) return line
    if (/^\s*[　 ]{2}/.test(line)) return line
    return `　　${line}`
  })
  return rawBlock + formatted.join("\n")
  */
}

function normalizeChapterWriting(markdown: string): string {
  return formatWritingBodyWithIndent(syncChapterFrontmatterFromBody(markdown))
}

/**
 * 每个事件细纲任务一个 AbortController，**按 taskId 存**，不是单个 ref。
 *
 * 为什么不能只留一个 ref：store 里允许多个任务并存（不同章号各一份细纲），
 * 而单 ref 只记得「最后一次提交」。于是用户在 A 行点「取消」时会 abort 掉
 * 当前 ref 指向的 B —— 恰好 abort 了他想保留的那一个，同时把 A 摘掉，
 * B 随后也变成无人收尾的僵尸任务。按 id 存才能「哪一行取消哪一个」。
 *
 * 为什么必须在**模块作用域**而不是组件里的 `useRef(new Map())`：
 * 任务 store 是全局的，而本组件会被真实重挂（ui-test-shell 在 wiki/sources
 * 视图之间切换 ContentArea 与 UiTestWorkspace；sources-view 与 outline-workbench
 * 也各自二选一渲染）。重挂后新实例的 Map 是空的，仍在 generating 的任务却会
 * 从全局 store 里**照常渲染**出来 —— 用户点「取消」会走 `if (!controller)` 分支，
 * 只把那一行摘掉、**不 abort**，请求继续计费、结果被丢。按 taskId 做键时
 * 多个实例共用一份 Map 也没有语义问题（同一个 id 只该有一个 controller）。
 */
const eventOutlineAbortControllers = new Map<string, AbortController>()

/**
 * 每个事件细纲任务的**正文生成** AbortController，同样按 taskId 键控、同样在模块作用域。
 *
 * 组件重挂的论证与上面那张 Map 完全一致（store 是全局的，实例级 Map 会在重挂后变空），
 * 所以这里只说**为什么是两张 Map 而不是一张**。
 *
 * ⚠️ 先说清楚一个**不成立**的理由（N7）：不能说「复用一张 Map 只会得到一个永远不存在的
 * controller」。两条链路虽然按 taskId 键控、键会撞上，但它们**在时间上不相交**：
 * 正文的 controller 只在细纲那条链路 settle()（把细纲的条目摘掉）之后才被 set，
 * 而且每次确认都会 set 一个**新的** controller。所以复用一张 Map 也不会读到
 * 「不存在的条目」——它只会读到一个**属于另一个阶段**的条目。
 *
 * 真正的原因是两条链路的取消语义不同，而语义差异必须由**存的位置**表达：
 * - 细纲生成被取消：那一行整条摘掉是对的（细纲还没被用户确认，取消就是放弃这次生成，
 *   见 handleCancelEventOutlineTask 的 removeTask）。
 * - 正文生成被取消：只把状态退回 `awaiting-confirm`（见 cancelWriting）。细纲是用户
 *   **已经确认过**的资产，取消正文不该连它一起丢。
 *
 * 共用一张 Map 会怎样：`handleCancelChapterProse` 与 `handleCancelEventOutlineTask`
 * 都以 taskId 取 controller，而两个回调对同一份状态的收尾动作正好相反 —— 一张表
 * 里两个阶段的条目长得一模一样，谁取到谁的只取决于时序，这正是「取消哪一步只收哪一步」
 * 无法被表达的地方。两张 Map 是**故意**的（代价只是一个 4 行的字段注释），不是历史遗留。
 */
const chapterProseAbortControllers = new Map<string, AbortController>()

function getDiskSyncNormalize(path: string): (content: string) => string {
  return isChapterPath(path) ? normalizeChapterWriting : (content) => content
}

/**
 * 正文生成途中项目被换走（N2）。
 *
 * 为什么要有**独立的错误类型**而不是复用 USER_ABORT_MESSAGE：两者的收尾不同。
 * 取消要把任务退回 `awaiting-confirm`（细纲是用户确认过的资产，取消不该连它一起丢），
 * 而项目已经换掉的这条任务留着没有任何用处 —— 它在当前项目的卡片区里本来就看不见，
 * 留着只会在用户切回旧项目时诈尸。所以它要**收掉**任务、并且让用户看到一句
 * 说清原因的话。这个区别只能由类型来承载（`isUserAbortError` 是按消息/名字/%aborted%
 * 匹配的，用消息区分会被它吞掉）。
 */
class ProjectChangedDuringWriteError extends Error {
  constructor() {
    super("项目已切换")
    this.name = "ProjectChangedDuringWriteError"
  }
}

function getChapterTitleFromPath(path: string): string {
  const fileName = normalizePath(path).split("/").pop() ?? ""
  return fileName.replace(/\.md$/i, "").trim()
}

const CHAPTER_TITLE_MIN_WIDTH_PX = 48
const CHAPTER_TITLE_RESTING_EXTRA_WIDTH_PX = 2
const CHAPTER_TITLE_EDITING_EXTRA_WIDTH_PX = 16
const DE_AI_SKILL_PICKER_WIDTH_PX = 288
const BODY_TYPOGRAPHY_PANEL_WIDTH_PX = 360

/**
 * 把一个浮层贴到锚点按钮下方，并保证不越出视口右缘。
 * 抽成通用函数是因为字体设置面板（360px）比去AI味选择器（288px）
 * 宽，两者都需要同一套夹取逻辑；复制一份必然漂移。
 */
function getFloatingPanelPosition(anchor: HTMLElement | null | undefined, widthPx: number): CSSProperties {
  if (!anchor) return { right: 24, top: 80 }
  const rect = anchor.getBoundingClientRect()
  const gap = 8
  const viewportWidth = window.innerWidth || widthPx
  const left = Math.min(
    Math.max(rect.left, gap),
    Math.max(gap, viewportWidth - widthPx - gap),
  )
  return { left, top: rect.bottom + gap }
}

function getDeAiSkillPickerPosition(anchor?: HTMLElement | null): CSSProperties {
  return getFloatingPanelPosition(anchor, DE_AI_SKILL_PICKER_WIDTH_PX)
}

export function PreviewPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const selectedTrashItem = useWikiStore((s) => s.selectedTrashItem)
  const setSelectedTrashItem = useWikiStore((s) => s.setSelectedTrashItem)
  const fileContent = useWikiStore((s) => s.fileContent)
  const novelMode = useWikiStore((s) => s.novelMode)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const pendingEditorHighlight = useWikiStore((s) => s.pendingEditorHighlight)
  const setPendingEditorHighlight = useWikiStore((s) => s.setPendingEditorHighlight)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const finalChapterSave = useWikiStore((s) => s.finalChapterSave)
  const setFinalChapterSave = useWikiStore((s) => s.setFinalChapterSave)
  const outlineTasks = useOutlineGenerationStore((s) => s.tasks)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGenerationRef = useRef(0)
  const chapterExternalUpdateCoordinator = useMemo(() => createChapterExternalUpdateCoordinator(), [])
  const applyDeAiBatchChapter = useMemo(() => createDeAiBatchChapterApplier(), [])
  const wikiEditorRef = useRef<WikiEditorHandle>(null)
  const [isSavingFinal, setIsSavingFinal] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string>("")
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [showOutlineSnapshot, setShowOutlineSnapshot] = useState(false)
  const [outlineSnapshotNumber, setOutlineSnapshotNumber] = useState<number | null>(null)
  const [outlineIngested, setOutlineIngested] = useState(false)
  const [showCognition, setShowCognition] = useState(false)
  const currentChapterDeAiProcessing = useDeAiTaskStore((s) =>
    selectedFile ? s.isChapterProcessing(selectedFile) : false
  )
  const deAiReviewOpen = useDeAiTaskStore((s) => selectProjectDeAiReview(s, project?.path).open)
  const deAiReviewChapterId = useDeAiTaskStore((s) => selectProjectDeAiReview(s, project?.path).chapterId)
  const deAiTasks = useDeAiTaskStore((s) => s.tasks)
  const [selectionTransformOpen, setSelectionTransformOpen] = useState(false)
  const [deAiDraftSaving, setDeAiDraftSaving] = useState(false)
  const deAiDraftSavingRef = useRef(false)
  const [selectionTransformAction, setSelectionTransformAction] = useState<ChapterSelectionAction | null>(null)
  const [selectionTransformSelection, setSelectionTransformSelection] = useState<ChapterBodySelection | null>(null)
  const [selectionTransformSourceContent, setSelectionTransformSourceContent] = useState("")
  const [selectionTransformCandidateContent, setSelectionTransformCandidateContent] = useState("")
  const [selectionTransformSkillName, setSelectionTransformSkillName] = useState("")
  const [selectionTransformModelName, setSelectionTransformModelName] = useState("")
  const [deAiSkillPickerOpen, setDeAiSkillPickerOpen] = useState(false)
  const [deAiSkillPickerPosition, setDeAiSkillPickerPosition] = useState<CSSProperties>(() => getDeAiSkillPickerPosition())
  // ── 写作现场「字体设置」浮层 ──
  const [bodyFontOpen, setBodyFontOpen] = useState(false)
  const [bodyFontPosition, setBodyFontPosition] = useState<CSSProperties>(() => getFloatingPanelPosition(null, BODY_TYPOGRAPHY_PANEL_WIDTH_PX))
  const bodyFontRef = useRef<HTMLDivElement | null>(null)
  /*
   * 落盘去抖。写作现场改参数是"边拖边看"，store 与 CSS 变量必须立即生效
   * （zustand 同步更新，App 的 effect 会把变量写到 documentElement），
   * 但落盘要合并 —— 一次拖动会触发几十次 onChange。
   */
  const bodyTypographyPersist = useRef(createDebouncedPersist(400))
  const [chapterDeAiSkillId, setChapterDeAiSkillId] = useState<string | null | undefined>(undefined)
  const [pendingSelectionForDeAi, setPendingSelectionForDeAi] = useState<ChapterBodySelection | null>(null)
  const [chapterTitleDraft, setChapterTitleDraft] = useState("")
  const [chapterTitleEditing, setChapterTitleEditing] = useState(false)
  const [chapterTitleWidthPx, setChapterTitleWidthPx] = useState(CHAPTER_TITLE_MIN_WIDTH_PX)
  const [chapterToolbarCompact, setChapterToolbarCompact] = useState(true)
  const [chapterToolbarMoreOpen, setChapterToolbarMoreOpen] = useState(false)
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)
  const [uiTestSaveState, setUiTestSaveState] = useState<UiTestEditorSaveState | null>(null)
  const [draftHintVisible, setDraftHintVisible] = useState(false)
  const draftHintSessionRef = useRef({
    path: null as string | null,
    arrival: "stay" as DraftMemoryHintArrival,
    persistedWords: null as number | null,
    visible: false,
    dismissed: false,
  })
  const uiTestScrollRef = useRef<HTMLDivElement>(null)
  const [diskSyncEpoch, setDiskSyncEpoch] = useState(0)
  /** 卷纲伴生 .html 内容（存在同名 .html 时启用双格式查看器） */
  const [companionHtml, setCompanionHtml] = useState<string | null>(null)
  const pendingScrollRestoreRef = useRef<number | null>(null)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")
  const lastLoadedByPathRef = useRef<Map<string, string>>(new Map())
  const fileContentRef = useRef(fileContent)
  const selectedFileRef = useRef<string | null>(selectedFile)
  const deAiSkillPickerRef = useRef<HTMLDivElement | null>(null)

  const uiBodyFontFamily = useWikiStore((s) => s.uiBodyFontFamily)
  const setUiBodyFontFamily = useWikiStore((s) => s.setUiBodyFontFamily)
  const uiBodyFontPx = useWikiStore((s) => s.uiBodyFontPx)
  const setUiBodyFontPx = useWikiStore((s) => s.setUiBodyFontPx)
  const uiBodyLineHeight = useWikiStore((s) => s.uiBodyLineHeight)
  const setUiBodyLineHeight = useWikiStore((s) => s.setUiBodyLineHeight)
  const uiBodyLetterSpacing = useWikiStore((s) => s.uiBodyLetterSpacing)
  const setUiBodyLetterSpacing = useWikiStore((s) => s.setUiBodyLetterSpacing)
  const uiBodyMarginX = useWikiStore((s) => s.uiBodyMarginX)
  const setUiBodyMarginX = useWikiStore((s) => s.setUiBodyMarginX)
  const uiBodySafeBottom = useWikiStore((s) => s.uiBodySafeBottom)
  const setUiBodySafeBottom = useWikiStore((s) => s.setUiBodySafeBottom)

  const openBodyFontPopover = useCallback((anchor?: HTMLElement | null) => {
    setBodyFontPosition(getFloatingPanelPosition(anchor, BODY_TYPOGRAPHY_PANEL_WIDTH_PX))
    setBodyFontOpen(true)
  }, [])

  /*
   * 关闭时必须 flush：用户最常见的操作顺序是「拖完最后一下就关掉」。
   * 只靠定时器的话最后一次改动会被丢掉，表现为
   * 「明明调过了，重开软件又变回去」。
   */
  const closeBodyFontPopover = useCallback(() => {
    bodyTypographyPersist.current.flush()
    setBodyFontOpen(false)
  }, [])

  /*
   * 卸载时**必须落盘，不能 dispose**；而"关窗口"还要靠注册表。
   *
   * ⚠ 这个 effect 原来写的是 dispose()，那是一个真实的丢数据缺陷
   * （代码质量审查 I1 发现）。两者语义天差地别（见 debounced-persist.ts）：
   *   · flush()   立刻执行待落盘动作并取消定时器 —— **保住**最后一次改动
   *   · dispose() 直接丢弃待落盘动作（pending = null）—— **丢掉**最后一次改动
   *
   * 关浮层那条路径本来就是安全的（document 的 mousedown 会先触发
   * closeBodyFontPopover，它里面就是 flush）。真正会丢的是**不经过 mousedown
   * 的卸载**，只有这一种：
   *   键盘导航切走视图 → 写作现场整个卸载
   * （拖完滑块 400ms 内直接关窗口 / Alt+F4 也属于这一类，但它**不走这里**，
   *  见下一段 —— 旧注释把这条路径错列在本 effect 的覆盖范围里，
   *  那是一句说谎的注释，已纠正。）
   * 而启动读回是 **app-state 优先**的，丢一次 app-state 写入就等于
   * 「下次开软件，我刚调的设置又变回去了」—— 正是这套去抖本来要防的那件事。
   *
   * 卸载后组件不再存在，所以"立刻写一次"没有重复渲染的代价；
   * 而"少写一次"的代价是一个用户可见的设置丢失。两者不对称，选落盘。
   *
   * ⚠ **关窗口那条路径这个 effect 救不了**（最终整体代码审查查出）：
   * App 的关闭流程是 `onCloseRequested` → `flushAppState()` → `window.destroy()`，
   * 而 `destroy()` 是销毁 webview，**React 不走 unmount 生命周期** ——
   * 所以「拖完滑块 400ms 内关窗口」在这里根本不会被触发，
   * 而且 `flushAppState()` 只 flush app-state 那一层，去抖没到点时它没有东西可写。
   * 因此这里额外把自己注册进「关窗前落盘」注册表，由 App 在 destroy 之前逐个 await
   * （完整链路说明见 src/lib/pre-close-flush.ts）。
   * 用 `flushAsync()` 而不是 `flush()`：后者内部是 `void task()`，只启动不等待，
   * 紧随其后的 destroy 会把没写完的写盘切断，等于白做。
   */
  useEffect(() => {
    const persist = bodyTypographyPersist.current
    const unregister = registerPreCloseFlush(() => persist.flushAsync())
    return () => {
      unregister()
      void persist.flushAsync()
    }
  }, [])

  /*
   * 把「当前 store 里的全套 6 个参数」落盘。
   *
   * ⚠ 为什么不是每个字段各排一个落盘任务 —— 这是一个真实的丢数据缺陷：
   * createDebouncedPersist 的去抖语义是**替换待执行任务**（不是排队）。
   * 若按字段各排一个，用户在 400ms 内先拖「行间距」再拖「底部安全距离」，
   * 第一个任务会被第二个直接顶掉 —— 行间距只写进了 localStorage，
   * 没写进 app-state.json。而启动读回是 app-state 优先的，于是
   * 下次开软件行间距又变回旧值，用户看到"我明明调过"。
   *
   * 一次落全套就没有这个问题：最后一个任务写的是当时 store 里的全部值，
   * 它必然包含之前每一次改动。多写几个字段的代价远小于丢一个设置。
   */
  const persistAllBodyTypography = useCallback(async () => {
    const s = useWikiStore.getState()
    /*
     * ⚠ 这里必须是 async + await，不能写成同步函数 + `void Promise.all(...)`，
     * 更不能直接 `return Promise.all(...)`。
     *
     * createDebouncedPersist().schedule 的签名是
     *   schedule(run: () => Promise<void>): void
     * 而 Promise.all([...]) 的类型是 Promise<[void, void, …]>：
     *   · 同步函数 + void 掉结果 → 类型是 () => void，报 TS2345
     *       Argument of type '() => void' is not assignable to
     *       parameter of type '() => Promise<void>'
     *   · 直接 return → Promise<[void,…]> 不是 Promise<void>，同样 TS2345
     * 只有 async + await 的返回类型恰好是 () => Promise<void>。
     * 两种报错都指向 schedule 那一行，看着与"保存这几个参数"毫无关系，
     * 很容易被误判成 debounced-persist 的签名写错了。
     */
    await Promise.all([
      saveUiBodyFontFamily(s.uiBodyFontFamily),
      saveUiBodyFontPx(s.uiBodyFontPx),
      saveUiBodyLineHeight(s.uiBodyLineHeight),
      saveUiBodyLetterSpacing(s.uiBodyLetterSpacing),
      saveUiBodyMarginX(s.uiBodyMarginX),
      saveUiBodySafeBottom(s.uiBodySafeBottom),
    ])
  }, [])

  /*
   * 现场改排版参数：store 立即生效 + 落盘去抖。
   * 与设置页的差别只有"没有保存按钮"，取值来源同一个 store，
   * 所以两处不可能读出两套值。
   *
   * 注意 setter 是**同步**写 zustand 的，所以 persistAllBodyTypography
   * 稍后读到的一定是最新值（包括这一次的改动）。
   */
  const applyBodyTypographyChange = useCallback(<K extends keyof BodyTypographyValue>(
    key: K,
    next: BodyTypographyValue[K],
  ) => {
    switch (key) {
      case "fontFamily":
        setUiBodyFontFamily(next as BodyFontFamily)
        break
      case "fontPx":
        setUiBodyFontPx(next as number)
        break
      case "lineHeight":
        setUiBodyLineHeight(next as number)
        break
      case "letterSpacing":
        setUiBodyLetterSpacing(next as number)
        break
      case "marginX":
        setUiBodyMarginX(next as number | null)
        break
      case "safeBottom":
        setUiBodySafeBottom(next as number)
        break
      default: {
        /*
         * ⚠ 必须写成穷尽收尾，不能写成 `default: break`。
         *
         * 这是一个**键 → store 字段**的手写映射。写成 `default: break` 的话，
         * "共享控件新增第 7 个参数"会在这里**静默丢写** ——
         * 表现是"那一项怎么拖都不生效"，而 `tsc` 报 0 个错。
         *
         * 这条守卫原先在设置页的 `setBodyTypography` 上（那里也有同样的收尾）。
         * 用户要求把这 6 项移出设置页之后，那个函数删掉了、映射只此一处，
         * 于是守在这里就是守卫的全部 —— 由
         * `.codex-temp/check-exhaustive-typography-switch.mjs` 钉住
         * （它同时自证"有 never 才抓得住、没 never 抓不住"）。
         *
         * 收窄的是 key，不是 next：写成 `never = next` 会直接 TS2322（实测）。
         */
        const _never: never = key
        void _never
      }
    }
    bodyTypographyPersist.current.schedule(persistAllBodyTypography)
  }, [persistAllBodyTypography, setUiBodyFontFamily, setUiBodyFontPx, setUiBodyLineHeight, setUiBodyLetterSpacing, setUiBodyMarginX, setUiBodySafeBottom])

  /*
   * 标题栏的「默认设置」：把 6 个参数一次性恢复成 font-settings 里的默认值。
   *
   * ── 为什么逐个调用 applyBodyTypographyChange 而不是直接 setState ──
   * 那个函数同时负责"写 store"和"排一次落盘"。逐个调用意味着
   * 落盘只排一次（createDebouncedPersist 的 schedule 语义是**替换**，
   * 后一次顶掉前一次），而且最后那次读到的 store 已经是 6 个默认值齐全的状态
   * —— 见 persistAllBodyTypography 顶部关于"为什么一次落全套"的说明。
   *
   * ── 默认值必须来自 font-settings，不能在这里写字面量 ──
   * 写 18 / 1.95 / 51 这种数字，日后改默认档就只改了控件初值、
   * 改不到这个按钮，出现"点默认设置得到的不是默认值"。
   *
   * ── 它同时是「回到跟随窗口」的唯一入口 ──
   * 原先左右边距下面有一个「改回跟随窗口」按钮，可单独把 marginX 设回 null。
   * 用户要求删除它，于是现在只有这个按钮能回到跟随窗口
   * （DEFAULT_BODY_MARGIN_X 就是 null）。这是一处真实的能力收缩，
   * 不是被忽略的副作用。
   */
  const resetBodyTypographyToDefaults = useCallback(() => {
    applyBodyTypographyChange("fontFamily", DEFAULT_BODY_FONT_FAMILY)
    applyBodyTypographyChange("fontPx", DEFAULT_BODY_FONT_PX)
    applyBodyTypographyChange("lineHeight", DEFAULT_BODY_LINE_HEIGHT)
    applyBodyTypographyChange("letterSpacing", DEFAULT_BODY_LETTER_SPACING)
    applyBodyTypographyChange("marginX", DEFAULT_BODY_MARGIN_X)
    applyBodyTypographyChange("safeBottom", DEFAULT_BODY_SAFE_BOTTOM)
  }, [applyBodyTypographyChange])

  // 点击浮层外或按 Esc 关闭（与去AI味选择器同一套交互）
  useEffect(() => {
    if (!bodyFontOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (bodyFontRef.current?.contains(event.target as Node)) return
      closeBodyFontPopover()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeBodyFontPopover()
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [bodyFontOpen, closeBodyFontPopover])

  const chapterToolbarRef = useRef<HTMLDivElement | null>(null)
  const titleMeasureRef = useRef<HTMLSpanElement | null>(null)
  // 只观察原保存结果，不改变写入时机、内容或冲突策略。
  const reportUiTestSave = useCallback((path: string, phase: UiTestEditorSaveState["phase"], expectedMarkdown?: string, generation?: number, retryAction?: UiTestEditorSaveState["retryAction"]) => {
    if (selectedFileRef.current !== path) return
    if (generation !== undefined && generation !== saveGenerationRef.current) return
    if (expectedMarkdown !== undefined && getDiskSyncNormalize(path)(fileContentRef.current) !== expectedMarkdown) return
    setUiTestSaveState({ path, phase, retryAction })
  }, [])
  const chapterDeAiOptions = useDeAiSkillOptions({
    projectPath: project?.path,
    selectedSkillId: chapterDeAiSkillId,
    useLastChapterSkill: true,
  })

  useEffect(() => {
    fileContentRef.current = fileContent
  }, [fileContent])

  const rememberLoadedChapter = useCallback((path: string, markdown: string) => {
    const key = normalizePath(path)
    lastLoadedRef.current = markdown
    lastLoadedByPathRef.current.set(key, markdown)
    chapterExternalUpdateCoordinator.markEditorSession(key)
  }, [chapterExternalUpdateCoordinator])

  const applyDiskSyncIfSafe = useCallback(async (path: string): Promise<boolean> => {
    const normalizedPath = normalizePath(path)
    if (getFileCategory(normalizedPath) !== "markdown") return false

    let diskContent: string
    try {
      diskContent = await readFile(normalizedPath)
    } catch {
      return false
    }

    const editorContent = wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current
    const lastLoaded = lastLoadedByPathRef.current.get(normalizedPath) ?? lastLoadedRef.current
    const hasPendingSave = saveTimerRef.current != null
    const normalize = getDiskSyncNormalize(normalizedPath)

    if (!shouldApplyDiskToEditor({
      lastLoaded,
      editorContent,
      diskContent,
      hasPendingSave,
      normalize,
    })) {
      return false
    }

    rememberLoadedChapter(normalizedPath, diskContent)
    // 磁盘上的正文被带外改动并同步进来了（另一个编辑器、外部同步、去重改写
    // 交叉引用…）。把它按 `unknown` 记一笔：差额既不算用户手写也不算 AI，
    // 但账本文本会跟上磁盘，于是**此后**用户敲的字仍然归属正确。
    // 不做这一步的话，这次带外改动会累积在账本里，等用户下次敲一个字时
    // 被整笔算成「他的手写」。
    if (isChapterPath(normalizedPath)) {
      useWritingStatsStore.getState().recordChapter(normalizedPath, diskContent, "unknown")
    }
    fileContentRef.current = diskContent
    if (selectedFileRef.current && normalizePath(selectedFileRef.current) === normalizedPath) {
      const scrollTop = uiTestScrollRef.current?.scrollTop
      if (scrollTop != null) {
        pendingScrollRestoreRef.current = scrollTop
      }
      setFileContent(diskContent)
      setDiskSyncEpoch((epoch) => epoch + 1)
    }
    return true
  }, [rememberLoadedChapter, setFileContent])

  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current
    if (pending == null) return
    pendingScrollRestoreRef.current = null
    const restore = () => {
      if (uiTestScrollRef.current) uiTestScrollRef.current.scrollTop = pending
    }
    restore()
    // WritingTextarea autofocus/caret-to-end can scrollIntoView after mount;
    // re-apply on the next frames so the restored position sticks.
    requestAnimationFrame(() => {
      restore()
      requestAnimationFrame(restore)
    })
  }, [diskSyncEpoch, selectedFile])

  // 卷纲双格式：打开 .md 大纲时并行读取同名 .html 伴生文件（供 HTML/MD 切换）
  useEffect(() => {
    const target = selectedFile
    setCompanionHtml(null)
    if (!target || !target.toLowerCase().endsWith(".md") || !isOutlinePath(target)) return
    const htmlPath = target.replace(/\.md$/i, ".html")
    void (async () => {
      try {
        if (!(await fileExists(htmlPath))) return
        if (selectedFile !== target) return
        const html = await readFile(htmlPath)
        if (selectedFile === target && html.trim()) setCompanionHtml(html)
      } catch {
        // 伴生 html 读取失败时按普通 MD 查看器处理，不影响主文件
      }
    })()
  }, [selectedFile, diskSyncEpoch])

  /**
   * 实际用于渲染的 HTML：
   * 1) 磁盘上有同名 `.html` 伴生文件 → 用它（新保存的文件都是这种情况）；
   * 2) 磁盘上没有（旧版本生成 / 外部写入 / 示例或导入的文件）→ 用内置模板按正文即时渲染，
   *    这样历史大纲也能看到 HTML 视图，而不是只有 MD。
   */
  const effectiveCompanionHtml = useMemo(() => {
    if (companionHtml) return companionHtml
    if (!selectedFile || !fileContent.trim()) return null
    if (!selectedFile.toLowerCase().endsWith(".md") || !isOutlinePath(selectedFile)) return null
    return renderOutlineHtmlForPath(selectedFile, fileContent)
  }, [companionHtml, selectedFile, fileContent])

  const syncDiskBeforeAction = useCallback(async () => {
    const path = selectedFileRef.current
    if (!path) return
    await applyDiskSyncIfSafe(path)
  }, [applyDiskSyncIfSafe])

  const applyExternalChapterBody = useCallback(async (path: string, candidateContent: string): Promise<boolean> => {
    const normalizedPath = normalizePath(path)
    return applyOpenChapterBodyUpdate({
      path: normalizedPath,
      candidateContent,
      currentOpenPath: () => selectedFileRef.current,
      currentMarkdown: () => wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current,
      invalidatePendingSave: () => {
        saveGenerationRef.current += 1
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      },
      runExternalUpdate: chapterExternalUpdateCoordinator.runExternalUpdate,
      markEditorSession: chapterExternalUpdateCoordinator.markEditorSession,
      writeFileAtomic,
      commitEditor: (markdown) => {
        rememberLoadedChapter(normalizedPath, markdown)
        fileContentRef.current = markdown
        setFileContent(markdown)
        setDiskSyncEpoch((epoch) => epoch + 1)
      },
      bumpDataVersion,
    })
  }, [bumpDataVersion, chapterExternalUpdateCoordinator, rememberLoadedChapter, setFileContent])

  useEffect(() => registerEditorExternalUpdateHandler(applyExternalChapterBody), [applyExternalChapterBody])

  useEffect(() => {
    setChapterDeAiSkillId(undefined)
  }, [project?.path])

  useEffect(() => {
    if (!deAiSkillPickerOpen) return
    const handleDeAiSkillPickerMouseDown = (event: MouseEvent) => {
      if (deAiSkillPickerRef.current?.contains(event.target as Node)) return
      setDeAiSkillPickerOpen(false)
      setPendingSelectionForDeAi(null)
    }
    document.addEventListener("mousedown", handleDeAiSkillPickerMouseDown)
    return () => {
      document.removeEventListener("mousedown", handleDeAiSkillPickerMouseDown)
    }
  }, [deAiSkillPickerOpen])

  const syncChapterToCanonicalPath = useCallback(async (
    path: string,
    markdown: string,
    options?: { renameToCanonical?: boolean; source?: WritingSource },
  ) => {
    const normalized = normalizeChapterWriting(markdown)
    const chapterNumber = extractChapterNumberFromMarkdown(normalized)
    const renameToCanonical = options?.renameToCanonical ?? false
    const targetPath = renameToCanonical
      ? await getCanonicalChapterPath(path, normalized, chapterNumber)
      : path

    await writeFileAtomic(targetPath, normalized)
    if (isChapterPath(targetPath)) {
      const stats = useWritingStatsStore.getState()
      // 改名时先把归属账本搬到新路径，再把这份正文记一次账。
      // 重复记账是安全的：`recordChapter` 是差分口径，正文没变就是空增量。
      if (targetPath !== path) stats.transferChapter(path, targetPath)
      stats.recordChapter(targetPath, normalized, options?.source ?? "human")
    }
    if (renameToCanonical && targetPath !== path) {
      if (useWikiStore.getState().selectedFile === path) {
        selectedFileRef.current = targetPath
        useWikiStore.getState().setSelectedFile(targetPath)
      }
      await deleteFile(path)
      if (chapterNumber !== null) {
        const draftPath = getDraftChapterPath(getDirName(targetPath), chapterNumber)
        if (draftPath !== targetPath && draftPath !== path && await fileExists(draftPath)) {
          await deleteFile(draftPath)
        }
      }
      if (project) {
        try {
          const tree = await listDirectory(normalizePath(project.path))
          setFileTree(tree)
        } catch {
          // non-critical tree refresh
        }
      }
    }

    rememberLoadedChapter(targetPath, normalized)
    if (useWikiStore.getState().selectedFile === targetPath) {
      setFileContent(normalized)
      fileContentRef.current = normalized
    }

    bumpDataVersion()
    return { targetPath, markdown: normalized }
  }, [project, rememberLoadedChapter, setFileContent, setFileTree, bumpDataVersion])

  const flushChapterBeforeLeave = useCallback(async (path: string | null, markdown: string) => {
    if (!path || !isChapterPath(path)) return
    if (finalChapterSave?.saving && finalChapterSave.filePath === path) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const normalizedPath = normalizePath(path)
    const lastLoadedForPath = lastLoadedByPathRef.current.get(normalizedPath) ?? ""
    const resolvedMarkdown = resolveChapterFlushMarkdown(path, markdown, lastLoadedByPathRef.current)
    if (!shouldSyncChapterOnLeave(path, markdown, lastLoadedForPath)) return
    try {
      await chapterExternalUpdateCoordinator.flushBeforeLeave(path, async () => {
        await syncChapterToCanonicalPath(path, resolvedMarkdown, { renameToCanonical: false })
      })
    } catch (err) {
      console.error("切换章节前同步文件失败:", err)
    }
  }, [chapterExternalUpdateCoordinator, syncChapterToCanonicalPath, finalChapterSave])

  useEffect(() => {
    let cancelled = false
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveGenerationRef.current += 1
    const previousFile = selectedFileRef.current
    const previousContent = fileContentRef.current
    console.log("[PreviewPanel][debug] useEffect triggered", { selectedFile, previousFile, previousContentLength: previousContent?.length })
    if (previousFile && previousFile !== selectedFile && isChapterPath(previousFile)) {
      void flushChapterBeforeLeave(previousFile, previousContent)
    }
    selectedFileRef.current = selectedFile
    setSelectionTransformOpen(false)
    setSelectionTransformSkillName("")
    setSelectionTransformModelName("")
    setLoadedFilePath(null)
    setUiTestSaveState(null)

    if (!selectedFile) {
      setFileContent("")
      fileContentRef.current = ""
      lastLoadedRef.current = ""
      setSaveStatus("")
      return () => {
        cancelled = true
      }
    }

    const category = getFileCategory(selectedFile)

    if (isBinary(category)) {
      setFileContent("")
      fileContentRef.current = ""
      lastLoadedRef.current = ""
      setSaveStatus("")
      setLoadedFilePath(selectedFile)
      return () => {
        cancelled = true
      }
    }

    setFileContent("")
    fileContentRef.current = ""
    setSaveStatus("")

    readFile(selectedFile)
      .then((content) => {
        console.log("[PreviewPanel][debug] readFile success", { selectedFile, contentLength: content?.length, cancelled, storeSelectedFile: useWikiStore.getState().selectedFile })
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        rememberLoadedChapter(normalizePath(selectedFile), content)
        // 打开章节时先打归属基线：此后敲下的字才算「今天新写的」，
        // 否则用户敲的第一个字会把整章已有正文都算进今日手写。
        if (isChapterPath(selectedFile)) {
          useWritingStatsStore.getState().primeChapter(selectedFile, content)
        }
        setFileContent(content)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
        reportUiTestSave(selectedFile, "loaded")
      })
      .catch((err) => {
        console.log("[PreviewPanel][debug] readFile error", { selectedFile, err, cancelled, storeSelectedFile: useWikiStore.getState().selectedFile })
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        lastLoadedRef.current = ""
        lastLoadedByPathRef.current.delete(normalizePath(selectedFile))
        setFileContent(`Error loading file: ${err}`)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
        reportUiTestSave(selectedFile, "load-error")
      })
    return () => {
      console.log("[PreviewPanel][debug] useEffect cleanup", { selectedFile })
      cancelled = true
    }
  }, [selectedFile, rememberLoadedChapter, setFileContent, flushChapterBeforeLeave, reportUiTestSave])

  useEffect(() => {
    if (!selectedFile) return
    const category = getFileCategory(selectedFile)
    if (category !== "markdown" || isBinary(category)) return

    const normalizedPath = normalizePath(selectedFile)
    const syncNow = () => {
      if (normalizePath(selectedFileRef.current ?? "") !== normalizedPath) return
      void applyDiskSyncIfSafe(normalizedPath)
    }

    const intervalId = setInterval(syncNow, 2000)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncNow()
    }
    window.addEventListener("focus", syncNow)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener("focus", syncNow)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [selectedFile, applyDiskSyncIfSafe])

  useEffect(() => {
    return () => {
      const currentFile = selectedFileRef.current
      if (currentFile && isChapterPath(currentFile)) {
        void flushChapterBeforeLeave(currentFile, fileContentRef.current)
      }
    }
  }, [flushChapterBeforeLeave])

  /**
   * 待落盘的章节正文。
   *
   * 只留**一份**（编辑器每次只会打开一个章节），后一次输入覆盖前一次 ——
   * 落盘的是最新正文，不是排队写历史版本。
   */
  const pendingChapterSaveRef = useRef<{
    pathAtSave: string
    normalizedPath: string
    persistedMarkdown: string
    generation: number
  } | null>(null)

  /**
   * 立刻把待落盘的正文写下去（不等自动保存间隔）。
   *
   * 三条路径要靠它兜底，否则「间隔没到就离开」会丢字：
   * 关窗（`App.tsx` 的 `onCloseRequested` → `flushPendingChapterSave`）、
   * 切章节（`flushChapterBeforeLeave`）、组件卸载。
   */
  const runPendingChapterSave = useCallback(async (): Promise<void> => {
    const pending = pendingChapterSaveRef.current
    if (!pending) return
    pendingChapterSaveRef.current = null
    const { pathAtSave, normalizedPath, persistedMarkdown, generation } = pending
    try {
      if (generation !== saveGenerationRef.current) return
      if (pathAtSave !== selectedFileRef.current) return

      let diskContent: string
      try {
        diskContent = await readFile(normalizedPath)
      } catch (err) {
        console.error("保存前读取磁盘失败:", err)
        reportUiTestSave(pathAtSave, "error", persistedMarkdown, generation)
        return
      }

      const currentLastLoaded = lastLoadedByPathRef.current.get(normalizedPath) ?? lastLoadedRef.current
      const normalize = getDiskSyncNormalize(normalizedPath)
      if (normalize(diskContent) !== normalize(currentLastLoaded)) {
        await applyDiskSyncIfSafe(normalizedPath)
        reportUiTestSave(pathAtSave, "conflict", persistedMarkdown, generation)
        return
      }

      // 刻意**不**报 "saving"：这是用户每打几个字就会走一次的例行落盘，
      // 弹「正在保存」只会干扰写作（用户明确反馈过）。出错与冲突仍然会报，
      // 那两种状态需要用户处理，不能沉默。
      await writeFileAtomic(pathAtSave, persistedMarkdown)
      reportUiTestSave(pathAtSave, "saved", persistedMarkdown, generation)
      rememberLoadedChapter(normalizedPath, persistedMarkdown)
      bumpDataVersion()
    } catch (err) {
      console.error("保存失败:", err)
      reportUiTestSave(pathAtSave, "error", persistedMarkdown, generation)
    }
  }, [applyDiskSyncIfSafe, bumpDataVersion, rememberLoadedChapter, reportUiTestSave])

  // 关窗时 App.tsx 拿不到上面的定时器，靠这个登记处触发一次落盘。
  useEffect(() => registerChapterSaveFlush(runPendingChapterSave), [runPendingChapterSave])

  const handleSave = useCallback(
    /**
     * 编辑器写盘的总入口（沉浸式 textarea 与 Milkdown 都走这里）。
     *
     * `opts.source` 标明这一份正文是**谁**产生的，供写作统计归因：
     * 省略即视为用户手动输入（打字、粘贴、剪切、撤销），AI 改写路径必须显式标 `"ai"`。
     * 默认值刻意选「人写」而不是「不可知」——这是绝大多数调用者的事实，
     * 而漏标一处 AI 只会让 AI 那一栏偏少，标反了才会污染手写那一栏。
     *
     * 已知边界：用户**手工粘贴**外部（含 AI）文本时，这里记的是 `human`。
     * 应用无从判断剪贴板里的字是谁写的——那是用户的动作，不是本软件的产出。
     * 要区分它只能靠猜测，而猜错会把真正手写的字算进 AI，比少算更糟。
     */
    (markdown: string, opts?: { source?: WritingSource; immediate?: boolean }) => {
      const pathAtSave = selectedFileRef.current
      if (!pathAtSave) return
      const persistedMarkdown = isChapterPath(pathAtSave)
        ? normalizeChapterWriting(markdown)
        : markdown
      setFileContent(markdown)
      fileContentRef.current = markdown
      const normalizedPath = normalizePath(pathAtSave)
      // 记账必须发生在下面的「与磁盘一致就返回」之前。
      // 否则「打字 → 落盘 → 退格回到原样」这一段里，退格那一下会被提前 return
      // 吞掉，界面上的手写字数就永远只增不减。
      if (isChapterPath(pathAtSave)) {
        useWritingStatsStore
          .getState()
          .recordChapter(pathAtSave, persistedMarkdown, opts?.source ?? "human")
      }
      const lastLoadedForPath = lastLoadedByPathRef.current.get(normalizedPath) ?? lastLoadedRef.current
      if (persistedMarkdown === lastLoadedForPath) {
        // 内容回到与磁盘一致：撤掉待落盘的那一份，别再白写一次。
        pendingChapterSaveRef.current = null
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        return
      }
      pendingChapterSaveRef.current = {
        pathAtSave,
        normalizedPath,
        persistedMarkdown,
        generation: saveGenerationRef.current,
      }
      // 离散动作（改标题、应用 AI 改写、重试保存）要立刻落盘：它们是「用户
      // 明确做完了一件事」，等 3 分钟才写进去会让人以为没生效。
      // 连续输入才走下面的周期落盘。
      if (opts?.immediate) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        void runPendingChapterSave()
        return
      }
      // 刻意**不**在每次输入时重置定时器：那会退化成「停止输入才保存」，
      // 一直连着写的人反而永远等不到落盘。这里要的是「每 N 分钟一次」。
      if (saveTimerRef.current) return
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void runPendingChapterSave()
      }, CHAPTER_AUTOSAVE_INTERVAL_MS)
    },
    [rememberLoadedChapter, setFileContent, bumpDataVersion, applyDiskSyncIfSafe, reportUiTestSave, runPendingChapterSave]
  )

  const chapterFrontmatter = useMemo(() => {
    if (!selectedFile || getFileCategory(selectedFile) !== "markdown") return null
    const parsed = parseFrontmatter(fileContent)
    const fm = parsed.frontmatter as Record<string, unknown> | null
    if (!fm || !isChapterPage(fm)) return null
    return fm
  }, [fileContent, selectedFile])

  const canSaveAsFinal = Boolean(novelMode && project && selectedFile && chapterFrontmatter)
  const alreadyFinal = chapterFrontmatter ? isFinalChapter(chapterFrontmatter) : false
  const canFormatWriting = Boolean(selectedFile && getFileCategory(selectedFile) === "markdown" && isChapterPath(selectedFile))
  const canIngestOutline = Boolean(novelMode && project && selectedFile && getFileCategory(selectedFile) === "markdown" && isOutlinePath(selectedFile))
  const currentOutlineTask = useMemo(() => {
    if (!project || !selectedFile || !canIngestOutline) return null
    const normalizedSelectedFile = normalizePath(selectedFile)
    return outlineTasks
      .filter((task: OutlineGenerationTask) => (
        task.projectPath === project.path &&
        normalizePath(task.outlinePath ?? "") === normalizedSelectedFile &&
        (task.status === "ingesting" || task.status === "done" || task.status === "error")
      ))
      .sort((a: OutlineGenerationTask, b: OutlineGenerationTask) => b.updatedAt - a.updatedAt)[0] ?? null
  }, [canIngestOutline, outlineTasks, project, selectedFile])

  const outlineIngestProgressRunning = useImportProgressStore((s) => {
    if (!project || !canIngestOutline || !selectedFile) return null
    const pp = normalizePath(project.path)
    return s.tasks.find((task) => (
      task.projectPath === pp &&
      task.kind === "outline" &&
      task.status === "running"
    )) ?? null
  })
  const isOutlineIngesting = useMemo(() => {
    if (!project || !selectedFile || !canIngestOutline) return false
    const fileName = getOutlineFileName(selectedFile)
    if (outlineIngestProgressRunning) {
      if (outlineIngestProgressRunning.total === 1) return true
      if (outlineIngestProgressRunning.currentTitle === fileName) return true
      if (outlineIngestProgressRunning.activeTitles?.includes(fileName)) return true
    }
    return currentOutlineTask?.status === "ingesting"
  }, [canIngestOutline, currentOutlineTask, outlineIngestProgressRunning, project, selectedFile])

  // 检测大纲是否已经提取过初始记忆（持久化状态）
  useEffect(() => {
    if (!canIngestOutline || !project || !selectedFile) {
      setOutlineIngested(false)
      setOutlineSnapshotNumber(null)
      return
    }
    const { chapterNumber } = getOutlineIngestIdentity(project.path, selectedFile)
    setOutlineSnapshotNumber(chapterNumber)
    let cancelled = false
    void outlineSnapshotExists(project.path, selectedFile)
      .then((exists) => {
        if (!cancelled) setOutlineIngested(exists)
      })
      .catch(() => {
        if (!cancelled) setOutlineIngested(false)
      })
    return () => {
      cancelled = true
    }
  }, [canIngestOutline, project, selectedFile, dataVersion, currentOutlineTask?.status, currentOutlineTask?.updatedAt])
  useEffect(() => {
    if (!canIngestOutline) return
    if (!currentOutlineTask?.message) return
    if (currentOutlineTask.status === "ingesting" && !outlineIngestProgressRunning) {
      setSaveStatus("")
      return
    }
    setSaveStatus(currentOutlineTask.message)
  }, [canIngestOutline, currentOutlineTask, outlineIngestProgressRunning])
  const chapterNumber = useMemo(() => {
    if (!chapterFrontmatter) return null
    const meta = parseChapterMeta(chapterFrontmatter)
    return meta?.chapterNumber ?? null
  }, [chapterFrontmatter])
  const canViewSnapshot = Boolean(novelMode && project && chapterNumber !== null)
  const currentFinalChapterSave = finalChapterSave != null && finalChapterSave.projectPath === project?.path && finalChapterSave.filePath === selectedFile ? finalChapterSave : null
  const isFinalChapterSaving = currentFinalChapterSave?.saving ?? isSavingFinal

  const phaseLabelMap: Record<FinalChapterSavePhase, string> = {
    saving: t("novel.chapter.savingAsFinal"),
    saved: t("novel.chapter.savedAsFinal"),
    reingesting: t("novel.chapter.savingAsFinal"),
    ingested: t("novel.chapter.ingestSuccess"),
    ingest_failed: t("novel.chapter.ingestFailedRetry"),
    ingest_no_llm: t("novel.chapter.ingestNoLlmKey"),
    ingest_no_chapter_number: "章节已保存为正式章节，但快照生成失败：章节编号无效。请在章节2栏中重命名章节以修正编号。",
  }

  const visibleSaveStatus = (() => {
    if (!currentFinalChapterSave?.phase) return saveStatus
    const label = phaseLabelMap[currentFinalChapterSave.phase]
    const params = currentFinalChapterSave.params
    if (params) {
      const result = t(label, params as never)
      return typeof result === "string" ? result : saveStatus
    }
    return label
  })()
  const chapterHeader = useMemo(() => {
    if (!selectedFile || !isChapterPath(selectedFile) || getFileCategory(selectedFile) !== "markdown") return null
    return buildChapterEditorHeader(fileContent)
  }, [fileContent, selectedFile])
  const draftMemoryHintEnabled = useWikiStore((s) => s.novelConfig.draftMemoryHintEnabled)
  const draftMemoryHintSeen = useWikiStore((s) => s.novelConfig.draftMemoryHintSeen)
  const fileTree = useWikiStore((s) => s.fileTree)
  const setNovelConfig = useWikiStore((s) => s.setNovelConfig)

  /**
   * 章节区「生成章节细纲」：向导的默认值是「章节库里最大章号 + 1」与项目单章目标字数。
   *
   * 章号探测复用大纲面板的同一对函数，保证两处对「下一章是第几章」的判断一致 ——
   * 各自写一份正则迟早会出现「大纲面板说第 7 章、章节区说第 8 章」。
   */
  const [eventOutlineWizardVisible, setEventOutlineWizardVisible] = useState(false)
  const nextEventOutlineChapterNumber = useMemo(
    () => resolveNextChapterNumber(pickChapterLibraryFiles(flattenMdFiles(fileTree))),
    [fileTree],
  )
  const eventOutlineDefaultTargetWords = resolveChapterLengthSpec(
    useWikiStore((s) => s.novelConfig.chapterTargetChars),
  ).targetChars
  const eventOutlineTasks = useEventOutlineTaskStore((s) => s.tasks)
  const projectEventOutlineTasks = useMemo(
    () => selectProjectEventOutlineTasks(eventOutlineTasks, project?.path),
    [eventOutlineTasks, project?.path],
  )
  /*
   * controller 的 Map 在**模块作用域**（eventOutlineAbortControllers，见文件上部）：
   * 它按 taskId 键控，而任务 store 是全局的 —— 组件级 Map 会在重挂后变空，
   * 让「取消」退化成「只丢行、不 abort」。
   */

  /**
   * 生成一份事件细纲，结果落在 store 里由卡片区渲染。
   *
   * 与大纲对话那条链路的关键差别：这里没有工具循环，模型读不到文件，
   * 所以 generateEventOutline 会把前文资料一次性装配进提示词（见该模块的注释）。
   * 生成过程不进对话、不切视图 —— 用户点了按钮就该留在章节区看到结果。
   */
  const handleSubmitEventOutline = useCallback((request: EventOutlineRequest) => {
    if (!project?.path) {
      toast.error("请先打开一个项目")
      return
    }
    const state = useWikiStore.getState()
    const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "writing")
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      toast.error("未配置可用的 AI 模型，无法生成章节细纲")
      return
    }

    /*
     * 同项目 + 同章号重提：被取代的那次生成必须**中止**。
     *
     * startTask 会把同项目同章号的旧任务从 store 里移除（同一章同时挂两份细纲没有语义），
     * 但请求本身还在跑、还在计费，而它的行已经没了 —— finishTask(oldId) 按 id 匹配
     * 会静默无用，用户既看不到那一行也没有「取消」可点。触发只要一步：
     * 向导提交后关掉，工具栏那枚按钮仍可点。
     *
     * 顺序是安全的：旧任务的 catch 会对一个已被移除的 id 调 removeTask，是 no-op。
     */
    const superseded = selectProjectEventOutlineTasks(
      useEventOutlineTaskStore.getState().tasks,
      project.path,
    ).filter((task) => task.chapterNumber === request.chapterNumber)
    for (const task of superseded) {
      eventOutlineAbortControllers.get(task.id)?.abort()
      /*
       * 正在写正文的那条也要中止：startTask 会把这条任务整行换掉（同项目同章号替换），
       * 于是 in-flight 的正文请求既看不到自己的行、也没有「取消」可点，
       * 却还在计费 —— 正是 F1 那个回归的形状。
       *
       * 结果的作废**不靠状态**、只靠这次 abort：`.then` 里的 abort 复核读的就是
       * 这个 signal（N4 —— 原先这里还有一道 `stillWriting` 状态判定，实测它与
       * abort 复核完全重复，删掉后本文件 26 条用例全绿）。
       */
      chapterProseAbortControllers.get(task.id)?.abort()
      chapterProseAbortControllers.delete(task.id)
    }

    const taskId = useEventOutlineTaskStore.getState().startTask({
      projectPath: project.path,
      request,
    })
    const controller = new AbortController()
    eventOutlineAbortControllers.set(taskId, controller)
    const settle = () => { eventOutlineAbortControllers.delete(taskId) }

    let lastReportedChars = 0
    let lastReportedAt = 0
    void generateEventOutline(
      project.path,
      request,
      llmConfig,
      {
        onToken: (_token, receivedChars) => {
          // 进度节流：每 2000 字或每 1 秒才写一次 store。逐 token 写会让
          // 整棵章节区跟着重渲染，而这些渲染对用户没有任何新信息。
          const now = Date.now()
          if (receivedChars - lastReportedChars < 2000 && now - lastReportedAt < 1000) return
          lastReportedChars = receivedChars
          lastReportedAt = now
          useEventOutlineTaskStore.getState().appendProgress(taskId, receivedChars)
        },
      },
      controller.signal,
    ).then((result) => {
      settle()
      /*
       * 这里**不再**检查 controller.signal.aborted：取消由
       * generateEventOutline 内部统一抛 USER_ABORT_MESSAGE（streamChat 在取消时
       * 是正常 onDone() 返回、不 reject，所以模块自己查一次信号），
       * 于是取消永远走下面的 catch 分支。在这里再查一次的后果是
       * 「return 而不收尾」—— 任务会永远停在 generating 上，
       * 既没有任何东西会再推动它，用户也看不出它在等什么。
       */
      if (result.outline) {
        useEventOutlineTaskStore.getState().finishTask(taskId, result.outline)
        return
      }
      useEventOutlineTaskStore.getState().failTask(taskId, result.error ?? "事件细纲生成失败")
    }).catch((error) => {
      settle()
      /*
       * 主动取消不是失败：用户自己按的取消，卡片不该留一条红色错误。
       *
       * 窄竞态（**已知、不改**）：本判定会因第二参数 `signal.aborted` 为真而短路，
       * 所以「用户点取消」与「人格守卫 fail-closed 同时抛错」撞在一起时，
       * 「去修绑定」那条提示会被当成取消静默吞掉。两者的时间窗只有一帧，
       * 而拆开判定就得在这里重构取消的收尾归属（取消的唯一归属点是
       * generateEventOutline），风险大于收益 —— 故只记录。
       */
      if (isUserAbortError(error, controller.signal)) {
        useEventOutlineTaskStore.getState().removeTask(taskId)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      useEventOutlineTaskStore.getState().failTask(taskId, message)
    })
  }, [project?.path])

  /**
   * 取消某一行的生成。
   *
   * 只 abort **这个任务自己的** controller：用户在多行之间点哪个就停哪个。
   *
   * 为什么这里也**乐观地** removeTask（F8）：取消不再只是「丢掉结果」，
   * 它还得等 generateEventOutline 收尾；而装配阶段（buildContextPack）不吃 signal，
   * 那段时间那行会一直写着「正在生成」却没有任何反馈；若某条传输链压根不响应
   * abort，那行就会**永远**停在 generating —— 正是本批要消除的症状。
   * 乐观摘行的代价是零：removeTask 幂等，随后 catch 里的 removeTask
   * 或 finishTask/failTask 对一个已移除的 id 都是无害的 no-op。
   */
  const handleCancelEventOutlineTask = useCallback((taskId: string) => {
    const controller = eventOutlineAbortControllers.get(taskId)
    if (!controller) {
      /*
       * **防御性分支**（正常情况下走不到）。
       *
       * 取消按钮只在 status === "generating" 时渲染，而 settle() 总是在
       * finishTask/failTask/removeTask 之前（同一段 .then/.catch 里）把条目摘掉、
       * 紧随其后就是一次 store 更新 —— 所以「行还渲染着取消按钮、Map 里却没有条目」
       * 这一组合在正常时序下不成立。留着它只为兜住任何未来新增的收尾路径：
       * 真发生时也只需把这一行收掉，绝不能什么都不做。
       */
      useEventOutlineTaskStore.getState().removeTask(taskId)
      return
    }
    controller.abort()
    /*
     * 顺手把条目从模块级 Map 里摘掉：settle() 只在 promise 收尾时执行，而 F8
     * 命名的那种传输（忽略 abort）永远不会收尾 —— 不删的话这个 AbortController
     * 会一直挂在这个 webview 的模块级 Map 上（提升到模块作用域之前，
     * 重挂一次就随实例一起释放了，现在没有别的清理点）。
     *
     * 安全性：对同一个 id 再 abort() 是 no-op；而此处 removeTask 之后该任务
     * 已经不在 store 里，同章重提的 supersede 循环是按 store 里的行找 controller 的，
     * 不会再用到这个条目。
     */
    eventOutlineAbortControllers.delete(taskId)
    useEventOutlineTaskStore.getState().removeTask(taskId)
  }, [])

  const handleOpenEventOutlineWizard = useCallback(() => {
    setEventOutlineWizardVisible(true)
  }, [])

  /**
   * 用户确认细纲 → 在章节区直接生成这一章的正文（丙-2b 的最后一句话）。
   *
   * 收到的是 **EventOutlineCard 已经拼好的计划文本**（`eventOutlineToProsePrompt`），
   * 原样交给 `input.planBlueprint`：框架会把它拼成「用户已确认的章节计划：…」注入
   * brief 阶段（deep-chapter-generation.ts:534-539），并且 `planBlueprint` 的 `||`
   * 优先级保证它**覆盖** checkpoint 里那份旧的 —— 正是「刚确认的细纲说话」的语义。
   *
   * 刻意**不**把事件细纲注册成新的上下文来源：它属于「本轮任务指令」，不是
   * 「可检索的资料」（event-outline.ts:1-10 与设计 §3）。
   */
  const handleConfirmEventOutline = useCallback((taskId: string, planBlueprint: string) => {
    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === taskId)
    /*
     * 只接受 awaiting-confirm：双击那枚按钮时第二次点击可能落在 React 重渲染之前，
     * 没有这道闸门就会起两次生成、后一次的 controller 覆盖前一个（前一个再也没人 abort）。
     */
    if (task?.status !== "awaiting-confirm" || !task.outline) return
    const projectPath = project?.path
    if (!projectPath) {
      toast.error("请先打开一个项目")
      return
    }
    const state = useWikiStore.getState()
    const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "writing")
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      toast.error("未配置可用的 AI 模型，无法生成本章正文")
      return
    }

    // 章号以**任务**为准（那是用户在向导里指定、startTask 记下来的那一章），
    // 不用细纲 JSON 里模型自报的 chapterNumber —— 两者不一致时以用户的要求为准。
    // 这一条在 store 层已经强制过一次（finishTask 会把模型自报值覆盖成任务章号，F8），
    // 这里保留同一个取值口径只是为了本函数内不必依赖那个远端事实。
    const chapterNumber = task.chapterNumber
    const controller = new AbortController()
    chapterProseAbortControllers.set(taskId, controller)
    useEventOutlineTaskStore.getState().startWriting(taskId)
    /*
     * 条目只在**整条写入链**收尾后摘掉（`.finally`），绝不能放在 `.then` 的开头。
     *
     * 写入是一次真实的落盘流程（createDirectory → flush → readFile → writeFile →
     * recordChapter → setSelectedFile → listDirectory），期间那一行仍然渲染着
     * `status === "writing"` 与一枚**可见的「取消」按钮**。如果条目在这之前就被摘掉，
     * `handleCancelChapterProse` 会走 `if (controller)` 的 false 分支 —— 只把状态
     * 退回 awaiting-confirm（取消看上去生效了），**一个 abort 都没发**；而写入链里
     * 的 abort 复核读到的是 `aborted === false`，于是这一章照样写进盘、照样被选中、
     * 任务照样被摘掉。也就是说「取消」在整段写入期间是一个完整的 no-op（N1）。
     */
    const settle = () => {
      /*
       * 身份判定**不能省**：正文任务复用同一个 `taskId`（取消/失败后重试走的还是那一行，
       * 见下面的 `startWriting(taskId)`）。所以「取消 A → 立刻重试 B → A 的收尾晚到」时，
       * 身份无关的 `delete(taskId)` 摘掉的是 **B** 的条目，而对 A 的取消在点击时就已经
       * 把条目删掉了。条目一没，B 的「取消」就只改状态、**一个 abort 都不发**，
       * B 的 abort 复核读到 `aborted === false` → 照写盘、照选中 —— N1 的症状在重入时复活。
       *
       * ⚠️ A 的收尾走的是 `.then` 里 `if (controller.signal.aborted) return` 那一支，
       * **不碰 store**，所以那一行仍停在 writing、取消按钮仍可见 —— 这条路径是可达的，
       * 不是理论担忧。
       *
       * 对比：细纲那条链路的 `settle()` 不需要这个判定 —— 它的 taskId 永不复用
       * （同章重提走 `startTask` 造一个新 id，旧行直接消失）。
       */
      if (chapterProseAbortControllers.get(taskId) === controller) {
        chapterProseAbortControllers.delete(taskId)
      }
    }

    /** 这次生成捕获的项目还是当前项目吗。比较口径复用事件细纲 store 的 projectPathKey。 */
    const projectChanged = () => (
      projectPathKey(useWikiStore.getState().project?.path ?? "") !== projectPathKey(projectPath)
    )

    /**
     * 落盘前的最后一道闸。
     *
     * 两道判定都必须在这里（而不是只在 `.then` 的开头）：写入链里有多个真实的
     * IPC 往返，用户完全有机会在这中间切项目或点取消。
     *
     * ⚠️ 项目那一道是**纵深防御**，不是唯一防线（变异测试的结论）：把它单独删掉，
     * 本文件 38 条用例**全绿** —— 因为「切项目」那个 effect 几乎总是先跑、先 abort
     * 掉这个 controller，随后 `aborted` 那道判定就把它拦住了；`.catch` 里
     * `|| projectChanged()` 也兜住了收尾方式。它防的是两者之间的次序窗口：
     * React 的被动 effect 是宏任务、promise 续体是微任务，真实 IPC 恰好先回来时
     * 写入链会赶在 abort 之前走到这里，那时只剩它能回答「这一章属于哪个项目」。
     * 这个次序在 jsdom + act 里造不出来（act 会在微任务排空前冲刷 effect）。
     */
    const assertStillWritable = () => {
      if (projectChanged()) throw new ProjectChangedDuringWriteError()
      if (controller.signal.aborted) throw new Error(USER_ABORT_MESSAGE)
    }

    /** 正文写进章节文件。抛错即视为「这次生成失败」，由下面的 catch 退回待确认。 */
    const writePort: GeneratedChapterWritePort = {
      projectChanged,
      assertStillWritable,
      readOpenChapterPath: () => selectedFileRef.current,
      readEditorMarkdown: () => fileContentRef.current,
      /*
       * 只丢掉与刚冲刷那个文件对应的那一份：别的路径的待落盘内容不归这次写入管。
       * 留着它，关窗时 registerChapterSaveFlush 会把它盖回刚写好的 AI 正文上。
       */
      discardPendingSaveFor: (path) => {
        const pending = pendingChapterSaveRef.current
        if (pending && normalizePath(pending.pathAtSave) === normalizePath(path)) {
          pendingChapterSaveRef.current = null
        }
      },
      flushChapterBeforeLeave,
      rememberLoadedChapter,
      writeEditorMarkdown: (markdown) => { fileContentRef.current = markdown },
      markSelectedFile: (path) => {
        // 先指 ref 再调 store：重载 effect 因此认为「没换章」而整段跳过（理由见下方注释）。
        selectedFileRef.current = path
        useWikiStore.getState().setSelectedFile(path)
      },
      setFileContent,
      setFileTree,
      bumpDataVersion,
    }

    void runDeepChapterGeneration(
      {
        projectPath,
        // 完整写作要求已经在 planBlueprint 里，这里只放一句**短**指令，不重复一遍。
        userRequest: `请按下面已确认的事件细纲写出第 ${chapterNumber} 章正文。`,
        chapterNumber,
        llmConfig,
        aiWorkflowMode: state.aiWorkflowMode,
        planBlueprint,
      },
      {
        // 结构化阶段进度（onFinalContent 只在阶段边界给完整文本，不是逐字流）。
        onWorkflowEvent: (event) => {
          if (event.type !== "started") return
          useEventOutlineTaskStore.getState().setWritingStage(taskId, event.title)
        },
      },
      undefined,
      controller.signal,
    ).then((result) => {
      /*
       * 收尾前必须再确认「这次生成还算数」。
       *
       * 项目复核排在 abort 复核**之前**不是随手一排：项目被换走时，上面的
       * 「项目切换」effect 同时会 abort 掉这个 controller，先判 aborted 的话
       * 这次收尾就会被当成「用户取消」——任务退回 awaiting-confirm 静静留在
       * 上一个项目里，用户既看不到也不知道那一章没写。先判项目才能给出
       * 「项目已切换，这一章没写」这句能懂的话，并把这条已经不适用的任务收掉。
       *
       * abort 这一支仍然是 return 而不是 throw：取消已经在点击时同步把状态
       * 退回 awaiting-confirm（乐观收尾），这里只需要丢掉结果、不留僵尸行。
       */
      if (projectChanged()) throw new ProjectChangedDuringWriteError()
      if (controller.signal.aborted) return
      return persistGeneratedChapter(projectPath, chapterNumber, result.finalContent, writePort).then(() => {
        // 细纲已经被扩写成磁盘上的章节文件，任务本身没有留在卡片区的理由。
        useEventOutlineTaskStore.getState().removeTask(taskId)
      })
    }).catch((error) => {
      /*
       * 项目在生成途中被换走：这次生成的正文属于上一个项目，绝不能往里写。
       * 这不是失败、也不是「用户取消」—— 明说原因，并把这条已经不适用的任务清掉
       * （它在当前项目的卡片区里本来就看不见，留着只会在切回旧项目时诈尸）。
       *
       * 第二个条件兜的是「忽略 abort 的传输」：它可能抛自己的错误（Tauri 的
       * invalid-resource-id 甚至会被 isUserAbortError 认成取消），此时错误类型
       * 认不出来，但「这个任务的项目已经不是当前项目」这件事仍然成立。
       */
      if (error instanceof ProjectChangedDuringWriteError || projectChanged()) {
        toast.error(`项目已切换，第 ${chapterNumber} 章正文未写入`)
        useEventOutlineTaskStore.getState().removeTask(taskId)
        return
      }
      // 主动取消不是失败：退回待确认、不留红色错误（与细纲那条链路同一原则）。
      if (isUserAbortError(error, controller.signal)) {
        useEventOutlineTaskStore.getState().cancelWriting(taskId)
        return
      }
      console.error("[preview-panel] 生成章节正文失败:", error)
      const message = error instanceof Error ? error.message : String(error)
      useEventOutlineTaskStore.getState().failWriting(taskId, message)
    }).finally(() => {
      /*
       * 条目在**整条链**收尾后才摘（N1）：写入期间那条「取消」必须还能找到
       * 自己的 controller。放在 `.finally` 而不是 `.then` 的开头，早退路径
       * （abort 复核、项目复核）也照样会走到这里，不会漏摘。
       */
      settle()
    })
  }, [bumpDataVersion, flushChapterBeforeLeave, project?.path, rememberLoadedChapter, setFileContent, setFileTree])

  /** 取消正文生成：abort + 乐观退回待确认（传输忽略 abort 时那行也不会永远停在 writing）。 */
  const handleCancelChapterProse = useCallback((taskId: string) => {
    const controller = chapterProseAbortControllers.get(taskId)
    if (controller) {
      controller.abort()
      // 与细纲那张 Map 同样的清理理由：settle() 只在 promise 收尾时跑，
      // 而「忽略 abort、永不 settle」的传输不会有收尾，条目必须在这里摘掉。
      chapterProseAbortControllers.delete(taskId)
    }
    useEventOutlineTaskStore.getState().cancelWriting(taskId)
  }, [])

  /**
   * 项目切换：上一个项目里还在写正文的生成必须停下来（N2）。
   *
   * 正文任务的行是按项目过滤渲染的（`projectEventOutlineTasks`，`:1214-1216`），
   * 所以切项目后那一行**当场消失** —— 用户既看不到进度、也没有「取消」可点，
   * 而请求还在跑、还在计费。停下来能省下这笔调用；写不写盘另有一道复核
   * （`writeGeneratedChapter` 里的 `assertStillWritable`），两件事都要做：
   * 复核保**正确性**，abort 省**调用**。
   *
   * 只在**真的换了项目**时动手：这里刻意不用 `useEffect(..., [project?.path])`
   * 的清理函数，那样组件卸载（视图切换导致的重挂）也会 abort 掉正在写的正文
   * —— 一次已经付过费的生成不该因为用户切了个视图就作废。
   */
  const proseProjectKeyRef = useRef(projectPathKey(project?.path ?? ""))
  useEffect(() => {
    const key = projectPathKey(project?.path ?? "")
    if (proseProjectKeyRef.current === key) return
    proseProjectKeyRef.current = key
    const tasks = useEventOutlineTaskStore.getState().tasks
    for (const [taskId, controller] of chapterProseAbortControllers) {
      const task = tasks.find((item) => item.id === taskId)
      // 属于**新**项目的正在写的那条不动：它可能是用户切回来之前就发起、现在又回来了的。
      if (task && projectPathKey(task.projectPath) === key) continue
      controller.abort()
      /*
       * 条目必须在这里摘掉：settle() 只在 promise 收尾时跑，而忽略 abort 的传输
       * 永远不收尾 —— 不摘的话这个 controller 会一直挂在这个 webview 的模块级 Map 上。
       *
       * 顺带把它退回 `awaiting-confirm`：那条任务已经不属于当前项目（卡片区里看不见），
       * 但用户切回去时应该看到那张还能重试的细纲卡片，而不是一行永远停在「正在写」、
       * 又没有任何取消入口的僵尸行（它的 controller 已经不在 Map 里了）。
       */
      chapterProseAbortControllers.delete(taskId)
      useEventOutlineTaskStore.getState().cancelWriting(taskId)
    }
  }, [project?.path])

  const handleDismissEventOutlineTask = useCallback((taskId: string) => {
    useEventOutlineTaskStore.getState().removeTask(taskId)
  }, [])
  const dismissDraftMemoryHint = useCallback(() => {
    draftHintSessionRef.current.dismissed = true
    draftHintSessionRef.current.visible = false
    setDraftHintVisible(false)
  }, [])
  const muteDraftMemoryHint = useCallback(() => {
    draftHintSessionRef.current.visible = false
    setDraftHintVisible(false)
    const next = { ...useWikiStore.getState().novelConfig, draftMemoryHintEnabled: false }
    setNovelConfig({ draftMemoryHintEnabled: false })
    void saveNovelConfig(next, project?.id, project?.path).catch((error) => {
      console.error("关闭草稿提取记忆提示失败:", error)
    })
  }, [project?.id, project?.path, setNovelConfig])
  useEffect(() => {
    const session = draftHintSessionRef.current
    if (session.path !== selectedFile) {
      session.path = selectedFile
      session.arrival = "select"
      session.persistedWords = null
      session.visible = false
      session.dismissed = false
    }
    if (!selectedFile || loadedFilePath !== selectedFile) {
      session.visible = false
      setDraftHintVisible(false)
      return
    }
    const words = countChapterBodyWords(fileContent)
    const phase = uiTestSaveState?.path === selectedFile ? uiTestSaveState.phase : null
    if (session.persistedWords === null && phase !== "saved") {
      session.persistedWords = words
      session.arrival = "select"
    } else if (phase === "saved") {
      const previous = session.persistedWords ?? 0
      session.arrival = previous === 0 && words > 0 ? "first-save" : "stay"
      session.persistedWords = words
    }
    const next = resolveDraftMemoryHint({
      isChapter: isChapterPath(selectedFile),
      status: chapterHeader?.status ?? null,
      wordCount: session.persistedWords ?? 0,
      arrival: session.arrival,
      dismissed: session.dismissed,
      extracting: isFinalChapterSaving,
      enabled: draftMemoryHintEnabled,
      bookHintSeen: draftMemoryHintSeen,
      hasLaterChapter: chapterHasLaterChapter(chapterNumber, chapterOrdersFromTree(fileTree)),
      currentlyVisible: session.visible,
    })
    session.visible = next
    if (next && !draftMemoryHintSeen) {
      const config = { ...useWikiStore.getState().novelConfig, draftMemoryHintSeen: true }
      setNovelConfig({ draftMemoryHintSeen: true })
      void saveNovelConfig(config, project?.id, project?.path).catch((error) => {
        console.error("记录草稿提取记忆提示失败:", error)
      })
    }
    setDraftHintVisible(next)
  }, [chapterHeader, chapterNumber, draftMemoryHintEnabled, draftMemoryHintSeen, fileContent, fileTree, isFinalChapterSaving, loadedFilePath, project?.id, project?.path, selectedFile, setNovelConfig, uiTestSaveState])
  const chapterDisplayTitle = chapterHeader
    ? chapterHeader.heading || (selectedFile ? getChapterTitleFromPath(selectedFile) : "")
    : ""
  const chapterTitleMeasureText = (() => {
    const text = chapterTitleEditing ? chapterTitleDraft : chapterDisplayTitle
    return text || chapterDisplayTitle || chapterTitleDraft || "\u00A0"
  })()
  const chapterStatusMeta = chapterHeader ? (
    chapterHeader.status === "final" ? (
      <span className="shrink-0 text-sm font-medium leading-5 text-emerald-600">
        {chapterHeader.statusLabel}
      </span>
    ) : chapterHeader.status === "draft" ? (
      <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-xs font-medium leading-5 text-muted-foreground">
        {chapterHeader.statusLabel}
      </span>
    ) : (
      <span className="shrink-0 text-sm leading-5 text-muted-foreground">
        {chapterHeader.statusLabel}
      </span>
    )
  ) : null
  const chapterWordCountMeta = chapterHeader ? (
    <span className="shrink-0 text-sm leading-5 text-muted-foreground">
      {chapterHeader.wordCountLabel}
    </span>
  ) : null
  const chapterMeta = chapterHeader ? (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {chapterStatusMeta}
      {chapterWordCountMeta}
    </div>
  ) : null
  const chapterDeAiSkillName = chapterHeader ? chapterDeAiOptions.effectiveName : "未启用"
  const chapterDeAiButtonLabel = currentChapterDeAiProcessing ? "处理中" : "去AI味"
  const chapterDeAiButtonTitle = `当前去AI味 Skill：${chapterDeAiSkillName}`

  useEffect(() => {
    if (!chapterHeader) {
      setChapterTitleDraft("")
      setChapterTitleEditing(false)
      setChapterTitleWidthPx(CHAPTER_TITLE_MIN_WIDTH_PX)
      return
    }
    if (!chapterTitleEditing) {
      setChapterTitleDraft(chapterDisplayTitle)
    }
  }, [chapterDisplayTitle, chapterHeader, chapterTitleEditing])

  useLayoutEffect(() => {
    if (!chapterHeader) return
    const measure = titleMeasureRef.current
    if (!measure) return
    const measuredWidth = Math.ceil(measure.getBoundingClientRect().width)
    const extraWidth = chapterTitleEditing ? CHAPTER_TITLE_EDITING_EXTRA_WIDTH_PX : CHAPTER_TITLE_RESTING_EXTRA_WIDTH_PX
    const nextWidth = Math.max(measuredWidth + extraWidth, CHAPTER_TITLE_MIN_WIDTH_PX)
    setChapterTitleWidthPx((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth)
  }, [chapterHeader, chapterTitleEditing, chapterTitleMeasureText])

  useLayoutEffect(() => {
    const element = chapterToolbarRef.current
    if (!element) return

    const update = () => {
      setChapterToolbarCompact(shouldUseCompactChapterToolbar(element.getBoundingClientRect().width))
    }

    update()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update)
      return () => window.removeEventListener("resize", update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [chapterHeader, loadedFilePath, selectedFile])

  useEffect(() => {
    if (!chapterToolbarCompact) {
      setChapterToolbarMoreOpen(false)
    }
  }, [chapterToolbarCompact])

  const normalizeChapterTitleInput = useCallback((title: string) => {
    const trimmed = title.trim()
    if (chapterNumber !== null) {
      return makeDefaultChapterTitle(chapterNumber, trimmed)
    }
    return trimmed
  }, [chapterNumber])

  const commitChapterTitleDraft = useCallback(async (titleDraft = chapterTitleDraft) => {
    if (!selectedFile || !isChapterPath(selectedFile) || !chapterHeader) return
    const normalizedTitle = normalizeChapterTitleInput(titleDraft)
    const fallbackTitle = chapterDisplayTitle || (chapterNumber !== null ? makeDefaultChapterTitle(chapterNumber) : "")
    const nextTitle = normalizedTitle || fallbackTitle
    setChapterTitleDraft(nextTitle)
    setChapterTitleEditing(false)
    if (nextTitle === chapterDisplayTitle) return
    reportUiTestSave(selectedFile, "saving")
    try {
      await syncChapterToCanonicalPath(selectedFile, updateChapterTitle(fileContent, nextTitle), { renameToCanonical: true })
      reportUiTestSave(selectedFile, "saved")
    } catch (error) {
      console.error("章节标题同步失败:", error)
      reportUiTestSave(selectedFile, "error", undefined, undefined, "title")
    }
  }, [
    chapterHeader,
    chapterNumber,
    chapterDisplayTitle,
    chapterTitleDraft,
    fileContent,
    normalizeChapterTitleInput,
    selectedFile,
    syncChapterToCanonicalPath,
    reportUiTestSave,
  ])

  const cancelChapterTitleEditing = useCallback(() => {
    setChapterTitleDraft(chapterDisplayTitle)
    setChapterTitleEditing(false)
  }, [chapterDisplayTitle])

  const handleSaveAsFinal = useCallback(async () => {
    if (!project || !selectedFile || !chapterFrontmatter) return

    await syncDiskBeforeAction()
    const currentContent = wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current

    let savePath = selectedFile
    const projectPath = project.path
    const updatePhase = (saving: boolean, phase: FinalChapterSavePhase | null, params?: Record<string, string | number>) => {
      setFinalChapterSave({ projectPath, filePath: savePath, saving, phase: phase ?? null, params })
    }

    setIsSavingFinal(true)
    updatePhase(true, "saving")

    let uiTestFinalFileSaved = false
    reportUiTestSave(selectedFile, "saving")

    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      const markdownToSave = currentContent.trim()
        ? currentContent
        : (lastLoadedByPathRef.current.get(normalizePath(selectedFile)) ?? lastLoadedRef.current)
      if (!markdownToSave.trim()) {
        updatePhase(false, null)
        setSaveStatus("章节内容为空，无法保存为正式章节")
        setIsSavingFinal(false)
        return
      }

      const updatedMarkdown = updateChapterStatus(markdownToSave, "final")
      const syncResult = await syncChapterToCanonicalPath(selectedFile, updatedMarkdown, { renameToCanonical: true })
      const targetPath = syncResult.targetPath
      savePath = targetPath
      uiTestFinalFileSaved = true
      reportUiTestSave(targetPath, "saved")
      rememberLoadedChapter(targetPath, syncResult.markdown)
      fileContentRef.current = syncResult.markdown
      setFileContent(syncResult.markdown)

      /*
       * 保存为正式章节**不再**顺带提取记忆（用户要求）。
       *
       * 原先此处按 `autoIngestOnSave` 开关自动跑一遍 ingestChapter，
       * 而章节/大纲工具栏的「提取记忆」按钮（handleReingest）做的是同一件事 ——
       * 同一份功能有两个入口，用户判定为重复，要求取消设置里那个开关，
       * 并去掉这条自动行为（只保留手动按钮）。
       * 因此这里只报告「已保存为正式章节」，是否提取由用户点按钮决定。
       */
      updatePhase(false, "saved")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updatePhase(false, "ingest_failed", { message: `快照提取异常: ${message.slice(0, 100)}` })
      console.error("[preview-panel] ingest failed:", error)
      if (!uiTestFinalFileSaved) reportUiTestSave(selectedFile, "error", undefined, undefined, "final")
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, project, selectedFile, setFileContent, setFinalChapterSave, syncChapterToCanonicalPath, syncDiskBeforeAction, reportUiTestSave])

  const handleReingest = useCallback(async () => {
    if (!project || !selectedFile || !chapterFrontmatter) return
    if (!isFinalChapter(chapterFrontmatter)) {
      setSaveStatus(t("novel.chapter.reingestNotFinal"))
      return
    }
    /*
     * 「没配 LLM」这道预检原本在自动提取那条路上（已按用户要求删除）。
     * 删掉路径不等于可以丢掉诊断：否则用户点了按钮只会看到笼统的
     * 「快照生成失败」，不知道根源是压根没有可用的模型。所以把它
     * 移到手动按钮这里 —— 提前、明确地告诉他去配置 LLM。
     */
    {
      const state = useWikiStore.getState()
      const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
      if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
        setFinalChapterSave({ projectPath: project.path, filePath: selectedFile, saving: false, phase: "ingest_no_llm" })
        return
      }
    }
    const projectPath = project.path
    const filePath = selectedFile
    const updatePhase = (saving: boolean, phase: FinalChapterSavePhase | null, params?: Record<string, string | number>) => {
      setFinalChapterSave({ projectPath, filePath, saving, phase: phase ?? null, params })
    }

    setIsSavingFinal(true)
    updatePhase(true, "reingesting")
    setSaveStatus("")
    const chapterTitle = chapterFrontmatter?.title || `第${chapterFrontmatter?.chapterNumber || '?'}章`
    const ingestAbortController = new AbortController()
    const ingestTaskId = useImportProgressStore.getState().startTask({
      projectPath: projectPath,
      kind: "chapter",
      total: 1,
      currentTitle: String(chapterTitle),
      message: "正在重新提取章节记忆",
      abortController: ingestAbortController,
    })
    try {
      const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
      const result = await ingestChapter(projectPath, filePath, resolveReviewModel(), ingestAbortController.signal, chapterFrontmatter?.chapterNumber as number | undefined)
      useImportProgressStore.getState().finishTask(ingestTaskId, result.snapshot ? "done" : "error", {
        completed: result.snapshot ? 1 : 0,
        total: 1,
        currentTitle: "",
        message: result.snapshot
          ? `${chapterTitle} 提取完成`
          : `${chapterTitle} 提取失败：${result.error ?? result.failReason ?? "未知错误"}`,
        error: result.error,
      })
      if (result.snapshot) {
        updatePhase(false, "ingested", { chapter: result.snapshot.chapterNumber })
      } else if (result.failReason === "invalid_chapter_number") {
        updatePhase(false, "ingest_no_chapter_number")
      } else {
        updatePhase(false, "ingest_failed")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useImportProgressStore.getState().finishTask(ingestTaskId, "error", {
        completed: 0,
        total: 1,
        currentTitle: "",
        message: `${chapterTitle} 提取失败：${message}`,
        error: message,
      })
      updatePhase(false, "ingest_failed", { message: message.slice(0, 100) })
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, project, selectedFile, setFinalChapterSave, t])

  const handleFormatWriting = useCallback(async () => {
    if (!selectedFile || !canFormatWriting) return
    const formatted = normalizeChapterWriting(fileContent)
    setFileContent(formatted)
    rememberLoadedChapter(selectedFile, formatted)
    reportUiTestSave(selectedFile, "saving")
    try {
      await writeFileAtomic(selectedFile, formatted)
      reportUiTestSave(selectedFile, "saved", formatted)
      bumpDataVersion()
    } catch (err) {
      console.error("格式化写作内容失败:", err)
      reportUiTestSave(selectedFile, "error", formatted, undefined, "format")
    }
  }, [canFormatWriting, fileContent, rememberLoadedChapter, selectedFile, setFileContent, bumpDataVersion, reportUiTestSave])

  const handleIngestOutline = useCallback(() => {
    if (!project || !selectedFile || !canIngestOutline || isOutlineIngesting) return
    setSaveStatus("")
    startOutlineIngestTask(project.path, selectedFile)
  }, [canIngestOutline, isOutlineIngesting, project, selectedFile])

  const runWholeChapterDeAi = useCallback(async (skillContent: string, skillName: string) => {
    await syncDiskBeforeAction()
    const markdown = wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current
    const source = extractDeAiChapterText(markdown)
    if (!source.trim() || !selectedFile || !project) return
    const state = useWikiStore.getState()
    const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "deAi")
    const modelLabel = formatResolvedModelLabel(llmConfig, state.providerConfigs)
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      toast.error("未配置可用的 AI 模型，无法去AI味")
      return
    }
    const chapterTitle = typeof chapterHeader === "string" ? chapterHeader : (chapterHeader?.heading ?? selectedFile)
    const taskId = useDeAiTaskStore.getState().startTask({
      projectPath: project.path,
      chapterPath: selectedFile,
      chapterTitle,
      skillId: chapterDeAiOptions.currentSkillId ?? null,
      skillName,
      skillContent,
      modelName: modelLabel,
      sourceContent: source,
    })
    const release = await acquireDeAiChapterSlot()
    let result = ""
    let doneCalled = false
    try {
      const current = useDeAiTaskStore.getState().tasks.find((task) => task.id === taskId)
      if (!current || current.status === "cancelled") return
      await streamChat(
        llmConfig,
        buildDeAiRewriteMessages(source, skillContent),
        {
          onToken: (token) => {
            result += token
          },
          onDone: () => {
            doneCalled = true
            finishDeAiTaskResult(taskId, result)
          },
          onError: (error) => {
            doneCalled = true
            console.error("去AI味处理失败:", error)
            useDeAiTaskStore.getState().failTask(taskId, error.message ?? String(error))
          },
        },
      )
      // 兜底：streamChat 正常返回但未调用 onDone/onError 时，用 result 完成
      if (!doneCalled) {
        finishDeAiTaskResult(taskId, result)
      }
    } catch (err) {
      console.error("去AI味处理失败:", err)
      if (!doneCalled) {
        useDeAiTaskStore.getState().failTask(taskId, String(err))
      }
    } finally {
      release()
    }
  }, [syncDiskBeforeAction, selectedFile, project, chapterHeader, chapterDeAiOptions.currentSkillId])

  const runSelectionTransform = useCallback(async (
    action: ChapterSelectionAction,
    selection: ChapterBodySelection,
    skillContent?: string,
    skillName?: string,
  ) => {
    if (!selection.text.trim()) return
    if (action === "de-ai") {
      await syncDiskBeforeAction()
    }
    const state = useWikiStore.getState()
    const llmConfig = action === "de-ai"
      ? resolveNovelModel(state.llmConfig, state.novelConfig, "deAi")
      : resolveDefaultModel(state.llmConfig)
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      setSaveStatus("未配置可用的 AI 模型，无法处理选中文本")
      return
    }

    const actionFile = selectedFileRef.current
    const actionLabel = action === "polish" ? "AI润色" : "去AI味"
    const modelLabel = formatResolvedModelLabel(llmConfig, state.providerConfigs)
    setSelectionTransformSkillName(action === "de-ai" ? skillName ?? "" : "")
    setSelectionTransformModelName(action === "de-ai" ? modelLabel : "")

    let result = ""
    try {
      await streamChat(
        llmConfig,
        action === "polish"
          ? buildPolishSelectionMessages(selection.text)
          : buildDeAiRewriteMessages(selection.text, skillContent),
        {
          onToken: (token) => {
            result += token
          },
          onDone: () => {
            if (selectedFileRef.current !== actionFile) return
            const candidate = action === "de-ai" ? filterDeAiOutput(result) : result
            if (!candidate.trim()) {
              toast.error(`${actionLabel}失败：模型未返回正文`)
              return
            }
            setSelectionTransformAction(action)
            setSelectionTransformSelection(selection)
            setSelectionTransformSourceContent(selection.text)
            setSelectionTransformCandidateContent(candidate)
            setSelectionTransformSkillName(action === "de-ai" ? skillName ?? "" : "")
            setSelectionTransformOpen(true)
          },
          onError: (error) => {
            if (selectedFileRef.current !== actionFile) return
            console.error(`${actionLabel}失败:`, error)
            toast.error(`${actionLabel}失败：${error.message}`)
          },
        },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (selectedFileRef.current !== actionFile) return
      console.error(`${actionLabel}失败:`, err)
      toast.error(`${actionLabel}失败：${message}`)
    }
  }, [syncDiskBeforeAction])

  const openDeAiSkillPicker = useCallback((selection: ChapterBodySelection | null, anchor?: HTMLElement | null) => {
    if (currentChapterDeAiProcessing && !selection) return
    setPendingSelectionForDeAi(selection)
    setDeAiSkillPickerPosition(getDeAiSkillPickerPosition(anchor))
    setDeAiSkillPickerOpen(true)
    if (chapterDeAiOptions.loadError) {
      setSaveStatus(chapterDeAiOptions.loadError)
      return
    }
    if (!chapterDeAiOptions.loading && chapterDeAiOptions.skills.length === 0) {
      setSaveStatus("暂无可用去AI味技能")
      return
    }
    setSaveStatus("")
  }, [chapterDeAiOptions.loadError, chapterDeAiOptions.loading, chapterDeAiOptions.skills.length, currentChapterDeAiProcessing])

  const handlePickedDeAiSkill = useCallback(async (skillId: string) => {
    const selection = pendingSelectionForDeAi
    setDeAiSkillPickerOpen(false)
    setPendingSelectionForDeAi(null)

    let skill = chapterDeAiOptions.skills.find((item) => item.id === skillId) ?? null
    if (!skill) {
      const config = await loadDeAiSkillConfig(project?.path ?? null)
      skill = resolveEffectiveDeAiSkill(config, skillId)
    }
    if (!skill) {
      setSaveStatus("暂无可用去AI味技能")
      return
    }
    setChapterDeAiSkillId(skill.id)
    if (project) {
      try {
        const config = await loadDeAiSkillConfig(project.path)
        await saveDeAiSkillConfig(project.path, setLastChapterDeAiSkill(config, skill.id))
        bumpDataVersion()
      } catch (err) {
        console.error("保存章节去AI味 Skill 选择失败:", err)
        toast.error("未能记住本次去AI味 Skill 选择，本次处理仍会继续")
      }
    }

    if (selection) {
      await runSelectionTransform("de-ai", selection, skill.content, skill.name)
      return
    }
    await runWholeChapterDeAi(skill.content, skill.name)
  }, [bumpDataVersion, chapterDeAiOptions.skills, pendingSelectionForDeAi, project, runSelectionTransform, runWholeChapterDeAi])

  const handleDeAiSaveDraft = useCallback(async (chapterPath: string, candidateContent: string) => {
    if (!project || !candidateContent || deAiDraftSavingRef.current) return
    const draftProjectId = project.id
    const draftProjectPath = normalizePath(project.path)
    deAiDraftSavingRef.current = true
    setDeAiDraftSaving(true)
    try {
      const draftPath = await saveDeAiDraftWithoutOverwrite(
        chapterPath,
        candidateContent,
        writeFileIfAbsent,
      )

      if (useWikiStore.getState().project?.id === draftProjectId) {
        try {
          const tree = await listDirectory(draftProjectPath)
          if (useWikiStore.getState().project?.id === draftProjectId) {
            setFileTree(tree)
          }
        } catch (err) {
          console.error("另存去AI味草稿后刷新文件树失败:", err)
        }
        bumpDataVersion()
      }

      toast.success(`已另存草稿：${draftPath.split("/").pop() ?? draftPath}`)
    } catch (err) {
      console.error("另存去AI味草稿失败:", err)
      toast.error(`另存草稿失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      deAiDraftSavingRef.current = false
      setDeAiDraftSaving(false)
    }
  }, [bumpDataVersion, project, setFileTree])

  const handleSelectionAction = useCallback((action: ChapterSelectionAction, selection: ChapterBodySelection) => {
    if (action === "de-ai") {
      void openDeAiSkillPicker(selection)
      return
    }
    void runSelectionTransform(action, selection)
  }, [openDeAiSkillPicker, runSelectionTransform])

  const handleApplySelectionTransform = useCallback(() => {
    if (!selectionTransformSelection || !selectionTransformCandidateContent) return

    const { rawBlock, body } = parseFrontmatter(fileContent)
    const { heading, body: currentBody } = splitChapterHeading(body)
    const replaced = replaceChapterBodySelection(
      currentBody,
      selectionTransformSelection,
      selectionTransformCandidateContent,
    )

    if (!replaced.ok) {
      setSelectionTransformOpen(false)
      setSaveStatus("正文内容已变化，请重新选中文本后再试")
      return
    }

    const replacedMarkdown = rawBlock + rebuildChapterBody(heading, replaced.body)
    // 替换进去的是模型产出，整段记到「今日 AI 生成」；未选中的部分归属不变。
    handleSave(
      selectionTransformAction === "de-ai"
        ? normalizeChapterWriting(replacedMarkdown)
        : replacedMarkdown,
      { source: "ai", immediate: true },
    )
    setSelectionTransformOpen(false)
    setSelectionTransformAction(null)
    setSelectionTransformSelection(null)
    setSelectionTransformSourceContent("")
    setSelectionTransformCandidateContent("")
    setSelectionTransformSkillName("")
    setSaveStatus("")
  }, [fileContent, handleSave, selectionTransformAction, selectionTransformCandidateContent, selectionTransformSelection])

  const handleCloseSelectionTransform = useCallback(() => {
    setSelectionTransformOpen(false)
    setSelectionTransformAction(null)
    setSelectionTransformSelection(null)
    setSelectionTransformSourceContent("")
    setSelectionTransformCandidateContent("")
    setSelectionTransformSkillName("")
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      // 卸载时**必须落盘**，不能只清定时器：自动保存间隔是 3 分钟，
      // 直接丢掉待保存的正文等于把用户最后几分钟写的内容扔了。
      void runPendingChapterSave()
    }
  }, [runPendingChapterSave])

  // Check if we're showing a trash item
  if (selectedTrashItem) {
    const category = getFileCategory(selectedTrashItem.originalPath)
    const trashPreviewBody = category === "markdown"
      ? parseFrontmatter(fileContent).body
      : fileContent
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-3 py-2 bg-yellow-50 dark:bg-yellow-950/30">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1">
              <div className="flex flex-col">
                <div className="text-sm font-medium truncate">{selectedTrashItem.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t("trash.deletedItem", { defaultValue: "已删除项目" })} · {selectedTrashItem.kind === "chapter" ? t("trash.kindChapter", { defaultValue: "章节" }) : selectedTrashItem.kind === "outline" ? t("trash.kindOutline", { defaultValue: "大纲" }) : selectedTrashItem.kind === "history" ? t("trash.kindHistory", { defaultValue: "历史记录" }) : selectedTrashItem.kind === "skill" ? t("trash.kindSkill", { defaultValue: "技能/画像" }) : selectedTrashItem.kind === "storymap" ? t("trash.kindStoryMap", { defaultValue: "故事导图" }) : t("trash.kindPage", { defaultValue: "页面" })}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {t("trash.originalPath", { defaultValue: "原路径" })}: {selectedTrashItem.originalPath}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedTrashItem(null)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
              title={t("preview.close", { defaultValue: "关闭预览" })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-0 overflow-auto">
          {category === "markdown" ? (
            <WikiReader body={trashPreviewBody} />
          ) : (
            <FilePreview filePath={selectedTrashItem.originalPath} textContent={fileContent} />
          )}
        </div>
      </div>
    )
  }

  if (!selectedFile) {
    return (
      <div className="ui-test-editor-empty">
        <h2>选择一份文档，开始写作</h2>
        <p>从目录打开章节或大纲，也可以使用目录中的新建、导入入口。</p>
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const isSelectedChapter = isChapterPath(selectedFile)
  const outlineFolderLabel = (() => {
    const match = (selectedFile ?? "").replace(/\\/g, "/").match(/\/wiki\/outlines\/([^/]+)/)
    return match ? match[1] : ""
  })()
  const activeHighlightRequest = pendingEditorHighlight?.path === selectedFile ? pendingEditorHighlight : null
  const hasChapterToolbarActions = Boolean(
    chapterHeader ||
    canIngestOutline ||
    canSaveAsFinal ||
    canFormatWriting ||
    canViewSnapshot
  )

  if (loadedFilePath !== selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("preview.loading", { defaultValue: "正在加载..." })}
      </div>
    )
  }

  const useUiTestEditor = category === "markdown" && (isSelectedChapter || isOutlinePath(selectedFile))
  const uiTestParsed = useUiTestEditor ? parseFrontmatter(fileContent) : null
  const uiTestHeading = uiTestParsed ? splitChapterHeading(uiTestParsed.body) : null

  const uiTestEditorElement = useUiTestEditor ? (
    <UiTestEditor
      key={selectedFile}
      kind={isSelectedChapter ? "chapter" : "outline"}
      path={selectedFile}
      title={isSelectedChapter ? chapterDisplayTitle : uiTestHeading?.heading || getOutlineFileName(selectedFile)}
      onTitleCommit={isSelectedChapter ? commitChapterTitleDraft : (title) => {
        // 改大纲标题是离散动作，立刻落盘，别等自动保存周期。
        if (uiTestParsed && uiTestHeading) handleSave(uiTestParsed.rawBlock + rebuildChapterBody(title, uiTestHeading.body), { immediate: true })
      }}
      statusLabel={isSelectedChapter ? chapterHeader?.statusLabel ?? "草稿" : isOutlineIngesting ? "正在提取记忆" : outlineIngested ? "已提取记忆" : "待提取记忆"}
      wordCount={countChapterBodyWords(fileContent)}
      saveState={uiTestSaveState}
      taskStatus={currentFinalChapterSave?.phase === "ingest_failed" && !alreadyFinal ? "正式章节保存未完成，请核对文件后重试。" : visibleSaveStatus}
      onRetrySave={() => {
        if (uiTestSaveState?.retryAction === "format") void handleFormatWriting()
        else if (uiTestSaveState?.retryAction === "title") void commitChapterTitleDraft()
        else if (uiTestSaveState?.retryAction === "final") void handleSaveAsFinal()
        else handleSave(wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current, { immediate: true })
      }}
      onClose={() => setSelectedFile(null)}
      scrollRef={uiTestScrollRef}
      draftMemoryHint={draftHintVisible ? { onDismiss: dismissDraftMemoryHint, onMute: muteDraftMemoryHint } : null}
      documentDetails={uiTestParsed?.frontmatter ? <FrontmatterPanel data={uiTestParsed.frontmatter} /> : undefined}
      auxiliaryPanel={!isSelectedChapter ? <UiTestOutlineTools /> : undefined}
      actions={isSelectedChapter ? (
        <>
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label={chapterDeAiButtonLabel} title={`${chapterDeAiButtonLabel} · ${chapterDeAiButtonTitle}`} onClick={(event) => void openDeAiSkillPicker(null, event.currentTarget)} disabled={currentChapterDeAiProcessing || !extractDeAiChapterText(fileContent).trim()}>
            <Eraser aria-hidden="true" />
          </button>
          <button type="button" className="ui-test-editor-action is-icon-only" data-draft-memory-target="" aria-label={isFinalChapterSaving ? "正在提取记忆…" : alreadyFinal ? "重新提取记忆" : "提取记忆"} title={isFinalChapterSaving ? "正在提取记忆…" : alreadyFinal ? "重新提取记忆" : "提取记忆"} onClick={() => void (alreadyFinal ? handleReingest() : handleSaveAsFinal())} disabled={!canSaveAsFinal || isFinalChapterSaving}>
            <Brain aria-hidden="true" />
          </button>
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label="查看记忆" title="查看记忆" onClick={() => canViewSnapshot ? setShowSnapshot(true) : setSaveStatus("尚无可查看的章节记忆，请先确认章节编号并提取记忆。")}>
            <BookOpen aria-hidden="true" />
          </button>
          {/*
            字体设置（原「正文排版」）。图标是 Type（T），一键排版是 WandSparkles ——
            用户明确要求两者不能是同一个图标：改造前两者都是 Type，
            用户在工具栏上无法区分"调字体"与"自动整理段落"。
          */}
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label="字体设置" title="字体设置" onClick={(event) => openBodyFontPopover(event.currentTarget)}>
            <Type aria-hidden="true" />
          </button>
          {/*
            生成章节细纲：入口从大纲面板的空白态搬到章节区工具栏（用户要求
            「点击这个功能后，在章节区生成内容」）。图标用 Lightbulb ——
            Type 是字体设置、WandSparkles 是一键排版，三个动作必须在工具栏上
            一眼可分，不能复用。
          */}
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label="生成章节细纲" title="生成章节细纲" onClick={handleOpenEventOutlineWizard}>
            <Lightbulb aria-hidden="true" />
          </button>
          {canFormatWriting ? <button type="button" className="ui-test-editor-action is-icon-only" aria-label="一键排版" title="一键排版" onClick={() => void handleFormatWriting()}><WandSparkles aria-hidden="true" /></button> : null}
        </>
      ) : (
        <>
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label={isOutlineIngesting ? "正在提取记忆…" : outlineIngested ? "重新提取记忆" : "提取记忆"} title={isOutlineIngesting ? "正在提取记忆…" : outlineIngested ? "重新提取记忆" : "提取记忆"} onClick={() => void handleIngestOutline()} disabled={!canIngestOutline || isOutlineIngesting}>
            <Brain aria-hidden="true" />
          </button>
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label="查看记忆" title="查看记忆" onClick={() => {
            if (outlineIngested && outlineSnapshotNumber !== null) setShowOutlineSnapshot(true)
            else setSaveStatus("尚未提取记忆。请先使用“提取记忆”，完成后可在此查看。")
          }}><BookOpen aria-hidden="true" /></button>
          {/*
            大纲里也要能调字体。用户原话：「关于字体、间距等这些的设置，
            大纲当中也要有这个设置功能」。
            与章节共用同一个浮层与同一份值 —— 章节与大纲共用一套排版参数
            是已确认的决定，不各自维护一份。
          */}
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label="字体设置" title="字体设置" onClick={(event) => openBodyFontPopover(event.currentTarget)}>
            <Type aria-hidden="true" />
          </button>
        </>
      )}
      moreActions={[]}
    >
      {(mode) => isSelectedChapter && mode === "read" ? (
        <div className="ui-test-editor-reader">
          <WikiReader body={(uiTestHeading?.body ?? "").replace(/^　　/gm, "")} highlightHandcraftZones />
        </div>
      ) : (
        <WikiEditor
          ref={wikiEditorRef}
          key={`${selectedFile}:${diskSyncEpoch}`}
          content={fileContent}
          onSave={handleSave}
          defaultMode={mode}
          immersiveWriting={isSelectedChapter}
          formatToolbar={!isSelectedChapter}
          onSelectionAction={isSelectedChapter ? handleSelectionAction : undefined}
          highlightRequest={isSelectedChapter ? activeHighlightRequest : null}
          onHighlightHandled={() => {
            if (activeHighlightRequest) setPendingEditorHighlight(null)
          }}
        />
      )}
    </UiTestEditor>
  ) : null

  return (
    <div className="flex h-full flex-col">
      {/*
        待确认的事件细纲。放在整个预览面板的最上方，而不是塞进编辑器内部：
        它属于「章节区」这个概念，不属于某一份正在打开的文档 —— 用户完全可能
        在第 5 章上点了生成、拿到第 6 章的细纲，这时按 selectedFile 决定显不显示
        就会把卡片藏起来。放这里还能扛住用户在章节与大纲之间来回切换。
      */}
      {projectEventOutlineTasks.length > 0 ? (
        <section className="shrink-0 space-y-2 border-b bg-muted/30 px-3 py-2" aria-label="待确认的事件细纲">
          {projectEventOutlineTasks.map((task) => (
            <div key={task.id} data-event-outline-task={task.id}>
              {task.status === "generating" ? (
                <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
                  <span>正在生成第 {task.chapterNumber} 章事件细纲…</span>
                  {task.receivedChars > 0 ? (
                    <span className="text-xs text-muted-foreground">已收到 {task.receivedChars} 字</span>
                  ) : null}
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground underline"
                    onClick={() => handleCancelEventOutlineTask(task.id)}
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {task.status === "error" ? (
                <div className="text-sm text-destructive" role="alert">
                  <div className="font-medium">第 {task.chapterNumber} 章事件细纲生成失败</div>
                  <p className="mt-1 text-xs">{task.error}</p>
                  <button type="button" className="mt-1 text-xs underline" onClick={() => handleDismissEventOutlineTask(task.id)}>
                    知道了
                  </button>
                </div>
              ) : null}

              {/*
                正文生成中。进度只能是**阶段名**（onWorkflowEvent）：那条链路的
                onFinalContent 在阶段边界给完整文本，不是逐字流，报「已收到 N 字」会是假的。
              */}
              {task.status === "writing" ? (
                <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
                  <span>正在写第 {task.chapterNumber} 章正文…</span>
                  {task.writingStage ? (
                    <span className="text-xs text-muted-foreground">{task.writingStage}</span>
                  ) : null}
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground underline"
                    onClick={() => handleCancelChapterProse(task.id)}
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {task.status === "awaiting-confirm" && task.outline ? (
                <>
                  {/*
                   * 确认件就是卡片自带的那枚「用这份细纲写这一章」（它由 validation.ok 门控），
                   * 我们把 EventOutlineCard 已经拼好的计划文本转交 handleConfirmEventOutline。
                   */}
                  <EventOutlineCard
                    data={task.outline}
                    onWriteChapter={(prompt) => handleConfirmEventOutline(task.id, prompt)}
                  />
                  {/*
                   * 正文生成失败：细纲还在（failWriting 不碰 outline），所以卡片原样留着，
                   * 上面那枚按钮同时就是「重试」。这里只把原因说清楚。
                   */}
                  {task.writingError ? (
                    <p className="mt-2 text-xs text-destructive" role="alert">
                      第 {task.chapterNumber} 章正文生成失败：{task.writingError}
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => handleDismissEventOutlineTask(task.id)}
                    >
                      丢弃这份细纲
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {uiTestEditorElement ? (
        effectiveCompanionHtml ? (
          <OutlineDualPreview htmlContent={effectiveCompanionHtml} mdEditor={uiTestEditorElement} label={outlineFolderLabel ? `${outlineFolderLabel}双格式` : undefined} />
        ) : uiTestEditorElement
      ) : (
      <>
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <div ref={chapterToolbarRef} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative flex min-w-0 min-h-0 flex-1 items-center gap-1 overflow-hidden">
            {chapterHeader ? (
              <>
                <span
                  ref={titleMeasureRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 whitespace-pre border-0 p-0 text-2xl font-bold leading-10 opacity-0"
                  style={{ fontFamily: "inherit" }}
                >
                  {chapterTitleMeasureText}
                </span>
                <input
                  type="text"
                  value={chapterTitleDraft}
                  onFocus={() => {
                    setChapterTitleEditing(true)
                    setChapterTitleDraft(chapterDisplayTitle)
                  }}
                  onChange={(e) => setChapterTitleDraft(e.target.value)}
                  onBlur={() => {
                    void commitChapterTitleDraft()
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === "Enter") {
                      e.preventDefault()
                      e.currentTarget.blur()
                      return
                    }
                    if (e.key === "Escape") {
                      e.preventDefault()
                      cancelChapterTitleEditing()
                      e.currentTarget.blur()
                    }
                  }}
                  className="min-w-[4rem] shrink truncate border-0 bg-transparent p-0 text-2xl font-bold leading-10 text-foreground outline-none"
                  style={{
                    width: `${chapterTitleWidthPx}px`,
                    maxWidth: chapterToolbarCompact ? "12rem" : "min(28rem, 100%)",
                    fontFamily: "inherit",
                  }}
                  title={chapterDisplayTitle}
                  spellCheck={false}
                />
                {chapterMeta}
              </>
            ) : null}
          </div>
          <div className="relative ml-auto flex shrink-0 items-center justify-end gap-1">
          {chapterToolbarCompact && hasChapterToolbarActions ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setChapterToolbarMoreOpen((open) => !open)}
                className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
                title="更多功能"
                aria-label="更多功能"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {chapterToolbarMoreOpen ? (
                <div className="absolute right-0 top-8 z-30 w-40 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-lg">
                  {chapterHeader ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        setChatExpanded(getNextChatExpanded(chatExpanded))
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                    >
                      {chatExpanded ? t("preview.closeChatSession", { defaultValue: "关闭会话栏" }) : t("preview.openChatSession", { defaultValue: "打开会话栏" })}
                    </button>
                  ) : null}
                  {chapterHeader ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        setChapterToolbarMoreOpen(false)
                        void openDeAiSkillPicker(null, e.currentTarget)
                      }}
                      disabled={currentChapterDeAiProcessing}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={chapterDeAiButtonTitle}
                    >
                      <span className="block truncate">{chapterDeAiButtonLabel}</span>
                    </button>
                  ) : null}
                  {canIngestOutline ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        void handleIngestOutline()
                      }}
                      disabled={isOutlineIngesting}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isOutlineIngesting
                        ? t("novel.outlineGenerator.ingesting")
                        : outlineIngested
                          ? t("novel.outlineGenerator.reingestButton")
                          : t("novel.outlineGenerator.ingest")}
                    </button>
                  ) : null}
                  {canIngestOutline && outlineIngested && outlineSnapshotNumber !== null ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        setShowOutlineSnapshot(true)
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                    >
                      {t("novel.snapshot.viewButton")}
                    </button>
                  ) : null}
                  {canSaveAsFinal && !alreadyFinal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        void handleSaveAsFinal()
                      }}
                      disabled={isFinalChapterSaving}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isFinalChapterSaving ? t("novel.chapter.savingAsFinal") : t("novel.chapter.saveAsCanon")}
                    </button>
                  ) : null}
                  {canSaveAsFinal && alreadyFinal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        void handleReingest()
                      }}
                      disabled={isFinalChapterSaving}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isFinalChapterSaving ? t("novel.chapter.savingAsFinal") : t("novel.chapter.reingestButton")}
                    </button>
                  ) : null}
                  {canFormatWriting ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        void handleFormatWriting()
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                    >
                      {t("preview.formatWriting", { defaultValue: "一键排版" })}
                    </button>
                  ) : null}
                  {canViewSnapshot ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        setShowSnapshot(true)
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                    >
                      {t("novel.snapshot.viewButton")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!chapterToolbarCompact && chapterHeader ? (
            <button
              type="button"
              onClick={() => setChatExpanded(getNextChatExpanded(chatExpanded))}
              className={`shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-accent ${
                chatExpanded ? "bg-accent text-foreground" : "text-foreground"
              }`}
              title={chatExpanded ? t("preview.closeChatSession", { defaultValue: "关闭会话栏" }) : t("preview.openChatSession", { defaultValue: "打开会话栏" })}
            >
              {t("preview.chatSession", { defaultValue: "AI会话" })}
            </button>
          ) : null}
          {!chapterToolbarCompact && chapterHeader ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => void openDeAiSkillPicker(null, e.currentTarget)}
                disabled={currentChapterDeAiProcessing}
                className="max-w-[11rem] shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                title={chapterDeAiButtonTitle}
              >
                <span className="block truncate">{chapterDeAiButtonLabel}</span>
              </button>
            </div>
          ) : null}
          {!chapterToolbarCompact && canIngestOutline ? (
            <button
              type="button"
              onClick={() => void handleIngestOutline()}
              disabled={isOutlineIngesting}
              className={`shrink-0 rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                outlineIngested
                  ? "border-emerald-500/50 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                  : "border-border text-foreground hover:bg-accent"
              }`}
              title={outlineIngested ? t("novel.outlineGenerator.reingestTitle") : t("novel.outlineGenerator.ingest")}
            >
              {isOutlineIngesting
                ? t("novel.outlineGenerator.ingesting")
                : outlineIngested
                  ? t("novel.outlineGenerator.reingestButton")
                  : t("novel.outlineGenerator.ingest")}
            </button>
          ) : null}
          {!chapterToolbarCompact && canIngestOutline && outlineIngested && outlineSnapshotNumber !== null ? (
            <button
              type="button"
              onClick={() => setShowOutlineSnapshot(true)}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title="查看该大纲提取的快照详情"
            >
              {t("novel.snapshot.viewButton")}
            </button>
          ) : null}
          {!chapterToolbarCompact && canSaveAsFinal && !alreadyFinal ? (
            <button
              type="button"
              onClick={() => void handleSaveAsFinal()}
              disabled={isFinalChapterSaving}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t("novel.chapter.saveAsCanon")}
            >
              {isFinalChapterSaving ? t("novel.chapter.savingAsFinal") : t("novel.chapter.saveAsCanon")}
            </button>
          ) : null}
          {!chapterToolbarCompact && canSaveAsFinal && alreadyFinal ? (
            <button
              type="button"
              onClick={() => void handleReingest()}
              disabled={isFinalChapterSaving}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t("preview.reingestTitle")}
            >
              {isFinalChapterSaving ? t("novel.chapter.savingAsFinal") : t("novel.chapter.reingestButton")}
            </button>
          ) : null}
          {!chapterToolbarCompact && canFormatWriting ? (
            <button
              type="button"
              onClick={() => void handleFormatWriting()}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title={t("preview.formatWritingTitle", { defaultValue: "自动整理正文段落格式，并为段落添加首行缩进" })}
            >
              {t("preview.formatWriting", { defaultValue: "一键排版" })}
            </button>
          ) : null}
          {!chapterToolbarCompact && canViewSnapshot ? (
            <button
              type="button"
              onClick={() => setShowSnapshot(true)}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title={t("preview.snapshotTitle")}
            >
              {t("novel.snapshot.viewButton")}
            </button>
          ) : null}
          <button
            onClick={() => setSelectedFile(null)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
        {visibleSaveStatus ? (
          <div className="mt-1 text-right">
            <span className="block truncate text-[0.6875rem] text-muted-foreground/80">
              {visibleSaveStatus}
            </span>
          </div>
        ) : null}
      </div>
      <div className={getPreviewContentContainerClass(isSelectedChapter)}>
        {category === "markdown" ? (
          effectiveCompanionHtml ? (
            <OutlineDualPreview
              htmlContent={effectiveCompanionHtml}
              label={outlineFolderLabel ? `${outlineFolderLabel}双格式` : undefined}
              mdEditor={
                <WikiEditor
                  ref={wikiEditorRef}
                  key={`${selectedFile}:${diskSyncEpoch}`}
                  content={fileContent}
                  onSave={handleSave}
                  defaultMode={inferEditorMode(selectedFile)}
                  immersiveWriting={isChapterPath(selectedFile)}
                  onSelectionAction={isChapterPath(selectedFile) ? handleSelectionAction : undefined}
                  highlightRequest={isChapterPath(selectedFile) ? activeHighlightRequest : null}
                  onHighlightHandled={() => {
                    if (activeHighlightRequest) setPendingEditorHighlight(null)
                  }}
                />
              }
            />
          ) : (
            <WikiEditor
              ref={wikiEditorRef}
              key={`${selectedFile}:${diskSyncEpoch}`}
              content={fileContent}
              onSave={handleSave}
              defaultMode={inferEditorMode(selectedFile)}
              immersiveWriting={isChapterPath(selectedFile)}
              onSelectionAction={isChapterPath(selectedFile) ? handleSelectionAction : undefined}
              highlightRequest={isChapterPath(selectedFile) ? activeHighlightRequest : null}
              onHighlightHandled={() => {
                if (activeHighlightRequest) setPendingEditorHighlight(null)
              }}
            />
          )
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
            onSave={async (content) => {
              await writeFileAtomic(selectedFile, content)
              setFileContent(content)
            }}
          />
        )}
      </div>
      </>
      )}
      {showSnapshot && project && chapterNumber !== null ? (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
          <SnapshotViewer
            projectPath={project.path}
            chapterNumber={chapterNumber}
            onClose={() => setShowSnapshot(false)}
          />
        </Suspense>
      ) : null}
      {showOutlineSnapshot && project && outlineSnapshotNumber !== null ? (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
          <SnapshotViewer
            projectPath={project.path}
            chapterNumber={outlineSnapshotNumber}
            onClose={() => setShowOutlineSnapshot(false)}
          />
        </Suspense>
      ) : null}
      {showCognition && project ? (
        <div className="absolute inset-0 z-20 bg-background">
          <CognitionPanel
            projectPath={project.path}
            onClose={() => setShowCognition(false)}
          />
        </div>
      ) : null}
      {bodyFontOpen ? (
        <div
          ref={bodyFontRef}
          /*
           * 样式全部来自 body-font-popover.css（与本模块同时加载）。
           * 这里只留定位与宽度：位置由 getFloatingPanelPosition 算好后放进行内 style。
           * 不再用 data-ui="interface-fields" 去借设置页的懒加载样式 —— 那正是
           * "首帧无样式"的成因，见文件顶部那段 import 注释。
           */
          className="body-font-popover"
          style={{ ...bodyFontPosition, width: BODY_TYPOGRAPHY_PANEL_WIDTH_PX }}
          role="dialog"
          aria-label="字体设置"
        >
          <div className="body-font-popover__head">
            <div className="body-font-popover__title">字体设置</div>
            <div className="body-font-popover__actions">
              {/*
                「默认设置」——用户要求放在关闭按钮旁边。
                逐项恢复默认值的理由与"它同时是回到跟随窗口的唯一入口"
                见 resetBodyTypographyToDefaults 上方注释。
              */}
              <button
                type="button"
                className="body-font-popover__action"
                onClick={resetBodyTypographyToDefaults}
                aria-label="默认设置"
                title="恢复为默认的正文排版"
              >
                默认设置
              </button>
              <button
                type="button"
                className="body-font-popover__action is-icon-only"
                onClick={closeBodyFontPopover}
                aria-label="关闭字体设置"
                title="关闭字体设置"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <BodyTypographyFields
            idPrefix="chapter-body-typography"
            value={{
              fontFamily: uiBodyFontFamily,
              fontPx: uiBodyFontPx,
              lineHeight: uiBodyLineHeight,
              letterSpacing: uiBodyLetterSpacing,
              marginX: uiBodyMarginX,
              safeBottom: uiBodySafeBottom,
            }}
            onChange={applyBodyTypographyChange}
          />
        </div>
      ) : null}
      {deAiSkillPickerOpen ? (
        <div
          ref={deAiSkillPickerRef}
          className="fixed z-50 w-72 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-lg"
          style={deAiSkillPickerPosition}
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <div className="truncate text-sm font-medium">
              {pendingSelectionForDeAi ? "选择选中文本去AI味技能" : "选择去AI味技能"}
            </div>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setDeAiSkillPickerOpen(false)
                setPendingSelectionForDeAi(null)
              }}
              aria-label="关闭技能选择"
              title="关闭技能选择"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <DeAiSkillOptionsPanel
            loading={chapterDeAiOptions.loading}
            errorMessage={chapterDeAiOptions.loadError}
            emptyMessage="暂无可用去AI味技能"
            skills={chapterDeAiOptions.skills}
            currentSkillId={chapterDeAiOptions.currentSkillId}
            defaultSkillId={chapterDeAiOptions.defaultSkillId}
            onClose={() => {
              setDeAiSkillPickerOpen(false)
              setPendingSelectionForDeAi(null)
            }}
            onPick={(skillId) => void handlePickedDeAiSkill(skillId)}
          />
        </div>
      ) : null}
      {(() => {
        const projectDeAiTasks = selectProjectDeAiTasks(deAiTasks, project?.path)
        const readyTasks = projectDeAiTasks.filter(
          (t) => t.status === "ready" || t.status === "confirmed" || t.status === "cancelled"
        )
        if (!project || readyTasks.length === 0) return null
        const currentReviewChapterId = readyTasks.some((task) => task.id === deAiReviewChapterId)
          ? deAiReviewChapterId
          : readyTasks[0]?.id ?? null
        const now = Date.now()
        const reviewChapters = readyTasks.map((t, index) => ({
          version: 1 as const,
          id: t.id,
          taskId: "de-ai-chapter-review",
          title: t.chapterTitle,
          order: index,
          sourcePath: t.chapterPath,
          sourceContent: t.sourceContent,
          candidateContent: t.candidateContent,
          status: (t.status === "confirmed" ? "confirmed" : t.status === "cancelled" ? "cancelled" : "ready") as DeAiBatchChapter["status"],
          runId: null,
          generation: 1,
          error: null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }))
        const reviewRecord: DeAiBatchTaskRecord = {
          task: {
            version: 1 as const,
            id: "de-ai-chapter-review",
            projectPath: project?.path ?? "",
            workId: "chapter-de-ai",
            workTitle: "去AI味审查",
            modelKey: "",
            skillId: readyTasks[0]?.skillId ?? null,
            skillName: readyTasks[0]?.skillName ?? "",
            skillContent: "",
            status: "completed",
            chapterIds: readyTasks.map((t) => t.id),
            error: null,
            createdAt: now,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
          chapters: reviewChapters as unknown as DeAiBatchChapter[],
        }
        return (
           <DeAiBatchReviewDialog
             open={deAiReviewOpen && readyTasks.length > 0}
             record={reviewRecord}
             currentChapterId={currentReviewChapterId}
             pending={deAiDraftSaving}
            onSelectChapter={(id) => useDeAiTaskStore.getState().setReviewChapter(project.path, id)}
             onConfirm={async (_taskId, chapterId, candidateContent) => {
              const task = readyTasks.find((t) => t.id === chapterId)
              if (!task) return
              const body = extractDeAiChapterText(candidateContent)
              try {
                await applyDeAiBatchChapter(task.chapterPath, body)
                useDeAiTaskStore.getState().updateTask(chapterId, { candidateContent: body })
                useDeAiTaskStore.getState().confirmTaskAndAdvanceReview(chapterId)
                toast.success(`${task.chapterTitle} 去AI味结果已保存`)
              } catch (err) {
                console.error("保存去AI味结果失败:", err)
                toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
               }
             }}
             onSaveDraft={async (_taskId, chapterId, candidateContent) => {
               const task = readyTasks.find((item) => item.id === chapterId)
               if (!task) return
               await handleDeAiSaveDraft(task.chapterPath, extractDeAiChapterText(candidateContent))
             }}
             onRegenerate={async (_taskId, chapterId) => {
              const task = readyTasks.find((t) => t.id === chapterId)
              if (!task) return
              useDeAiTaskStore.getState().updateTask(chapterId, {
                status: "processing",
                candidateContent: "",
                error: null,
              })
              const state = useWikiStore.getState()
              const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "deAi")
              if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
                useDeAiTaskStore.getState().failTask(chapterId, "未配置可用的 AI 模型")
                return
              }
              const release = await acquireDeAiChapterSlot()
              let result = ""
              try {
                const current = useDeAiTaskStore.getState().tasks.find((item) => item.id === chapterId)
                if (!current || current.status === "cancelled") return
                const source = extractDeAiChapterText(task.sourceContent)
                await streamChat(
                  llmConfig,
                  buildDeAiRewriteMessages(source, task.skillContent),
                  {
                    onToken: (token) => { result += token },
                    onDone: () => {
                      finishDeAiTaskResult(chapterId, result)
                    },
                    onError: (error) => {
                      useDeAiTaskStore.getState().failTask(chapterId, error.message ?? String(error))
                    },
                  },
                )
              } catch (err) {
                useDeAiTaskStore.getState().failTask(chapterId, String(err))
              } finally {
                release()
              }
            }}
            onCancelChapter={(_taskId, chapterId) => {
              useDeAiTaskStore.getState().cancelTask(chapterId)
            }}
            onClose={() => useDeAiTaskStore.getState().closeReview(project.path)}
          />
        )
      })()}
      <TextTransformPreviewDialog
        open={selectionTransformOpen}
        title={selectionTransformAction === "polish" ? "AI润色预览" : "去AI味预览"}
        description={selectionTransformAction === "de-ai" && selectionTransformSkillName
          ? `本次使用 Skill：${selectionTransformSkillName}${selectionTransformModelName ? `，模型：${selectionTransformModelName}` : ""}。确认后会替换当前选中的正文片段。`
          : "确认后会替换当前选中的正文片段。"}
        sourceLabel="原文片段"
        candidateLabel={selectionTransformAction === "polish" ? "润色结果" : "去AI味结果"}
        sourceContent={selectionTransformSourceContent}
        candidateContent={selectionTransformCandidateContent}
        comparisonMode={selectionTransformAction === "de-ai"}
        onCandidateContentChange={selectionTransformAction === "de-ai" ? setSelectionTransformCandidateContent : undefined}
        applyLabel="替换选中文本"
        onApply={handleApplySelectionTransform}
        onClose={handleCloseSelectionTransform}
      />
      {/*
        向导挂在章节区而不是大纲面板：点按钮、填参数、生成、确认、写成正文，
        整条链路不离开章节区（用户口径：「点击这个功能后，在章节区生成内容」）。
      */}
      <EventOutlineWizardDialog
        open={eventOutlineWizardVisible}
        onOpenChange={setEventOutlineWizardVisible}
        onSubmit={handleSubmitEventOutline}
        defaultChapterNumber={nextEventOutlineChapterNumber}
        defaultTargetWords={eventOutlineDefaultTargetWords}
      />
    </div>
  )
}

/**
 * 落盘这一段需要的**组件侧端口**（N6）。
 *
 * 这些不是可以随便改成从闭包直接读的东西：写入链里有多次真实 IPC 往返，
 * 读到的必须是「此刻」的值，而不是发起生成那一刻捕获的值。分成显式端口之后，
 * 「哪些组件状态会被写入链读到」在类型上就是可数的。
 */
type GeneratedChapterWritePort = {
  /** 这次生成捕获的项目还是当前项目吗（目录刷新前要再问一次）。 */
  projectChanged: () => boolean
  /** 落盘前的最后一道闸：项目复核 + abort 复核，不过就抛。 */
  assertStillWritable: () => void
  /** 编辑器里此刻打开的那一章（没有就是 null）。 */
  readOpenChapterPath: () => string | null
  /** 编辑器里此刻的正文（可能含还没落盘的改动）。 */
  readEditorMarkdown: () => string
  /** 丢掉与这个路径对应的待落盘快照（别的路径不归这次写入管）。 */
  discardPendingSaveFor: (path: string) => void
  flushChapterBeforeLeave: (path: string | null, markdown: string) => Promise<void>
  rememberLoadedChapter: (path: string, markdown: string) => void
  writeEditorMarkdown: (markdown: string) => void
  /** 把章节区切到这一章（ref 与 store 一起改，理由见函数内注释）。 */
  markSelectedFile: (path: string) => void
  setFileContent: (markdown: string) => void
  setFileTree: (tree: FileNode[]) => void
  bumpDataVersion: () => void
}

/**
 * 把一次「确认细纲 → 生成正文」的结果落进章节文件（N6：从 handleConfirmEventOutline 里抽出来）。
 *
 * 抽出来的理由不是行数：它原本是那个回调里一个 68 行的嵌套闭包，读代码时
 * 「两道闸分别在什么时候跑」被埋在 `.then` 的深处；有了名字之后，调用点读起来
 * 就是「生成 → 复核 → 落盘 → 收尾」四步，而这里只回答「落到哪个文件、按什么顺序」。
 *
 * 三件事必须保持现在的次序，它们是这份文件的既有约定：
 * 1. **先冲刷当前打开的那一章**，再写盘（否则两条 promise 链抢同一个文件）；
 * 2. **先记账、再选中**（选中会触发重载 effect 打归属基线，漏记是永久偏差）；
 * 3. 写完自己 `setFileContent`（同章时重载 effect 不会重跑，编辑器只能靠这一句对齐）。
 *
 * 抛错即视为「这次生成失败」，由调用方的 catch 退回待确认 —— 这里不吞异常。
 */
async function persistGeneratedChapter(
  projectPath: string,
  chapterNumber: number,
  finalContent: string,
  port: GeneratedChapterWritePort,
): Promise<void> {
  const { content: body, title: extractedTitle } = cleanGeneratedChapterContentWithTitle(finalContent)
  if (!body.trim()) throw new Error("模型没有返回可用的章节正文")
  const chapterDir = `${normalizePath(projectPath)}/wiki/chapters`
  const chapterTitle = extractedTitle || makeDefaultChapterTitle(chapterNumber)
  /*
   * 归一化后再落盘（normalizeChapterWriting = 同步 frontmatter + 全角缩进 + 段间整理）。
   * 理由：章节区**自己**的保存路径（handleSave，`:1035-1037` 的 isChapterPath 分支）
   * 对每一份章节正文都会做这一步，所以「磁盘内容 == 编辑器随后会写出的内容」——
   * 用户之后改一个字保存是真正的空差分，不会出现「整份文件被静默重排」这一幕。
   * 代价是 AI 正文在写入时就带上了全角缩进，与 chat-panel.tsx 那条不做归一化的
   * AI 写入路径行为不一致（那是既有分歧，本批不动它）。
   */
  const chapterMarkdown = normalizeChapterWriting(buildDraftChapterMarkdown(chapterNumber, chapterTitle, body))

  /*
   * ── 先把**当前打开的那一章**冲刷到磁盘（不管是哪一章）──
   *
   * 这一步与目标章号是不是同一章无关，必须无条件先做，原因有两个：
   *
   * 1. 紧接着就要写盘，而 `:856-858` 的「切章前自动冲刷」要等 React 提交后才跑
   *    —— 两条链会抢同一个文件（不 await 就是「旧快照把刚生成的整章盖回去」）。
   * 2. 下面会把 `selectedFileRef.current` 提前指到新章节（见写完那一段的注释），
   *    于是那个 effect 会认为「没换章」而整段跳过。它本来要做的冲刷就只能由
   *    这里代替 —— 否则用户在上一个章节里没保存的字既不在盘上，也不在编辑器里，
   *    直接消失（N3 的第二个缺陷）。
   */
  const openPath = port.readOpenChapterPath()
  if (openPath && isChapterPath(openPath)) {
    await port.flushChapterBeforeLeave(openPath, port.readEditorMarkdown())
    port.discardPendingSaveFor(openPath)
  }

  port.assertStillWritable()

  await createDirectory(chapterDir)

  /*
   * ── 目标路径：先认**已存在**的那一章，再谈新建 ──
   *
   * `findChapterFileByNumber` 按文件名章号**或** `chapter_number` frontmatter
   * 匹配，所以「编辑器里开着的就是这一章」时它返回的正是那个文件 —— 不会为
   * 同一章再建一份 `chapter-016.md`，也就不会出现「同一章两个文件」，
   * 更不会把 AI 正文写进用户另开的那一份里。
   *
   * 只有真的没有这一章时才新建，且名字用章节区自己的规范名
   * `makeChapterFileName(title, number)` → `第N章-标题.md`（`getCanonicalChapterPath`
   * `:173-180`、`sidebar-panel.tsx:821`、`knowledge-tree.tsx:1258` 都是这个口径）。
   *
   * ⚠️ 这里**刻意不用** `getDraftChapterPath`（`chapter-NNN.md`）：那是 AI 对话
   * 落盘的**临时草稿**名（`chapter-path-sync.ts:5-9` 的 `isDraftChapterPath` 把它
   * 定义为 "AI / chat draft files"），章节区随后会把它改名成规范名。目标路径用
   * 草稿名就等于**绕开**了章节区自己的命名，从而制造出上面那两个文件。
   */
  const existingChapterPath = await findChapterFileByNumber(normalizePath(projectPath), chapterNumber)
  const chapterPath = existingChapterPath ?? `${chapterDir}/${makeChapterFileName(chapterTitle, chapterNumber)}`

  const previousMarkdown = await readFile(chapterPath).catch(() => undefined)

  // 第二道闸：上面的 createDirectory / listDirectory / readFile 都是真实 IPC 往返，
  // 用户在这中间切项目或点「取消」都不该让这一章落盘。
  port.assertStillWritable()

  await writeFile(chapterPath, chapterMarkdown)
  /*
   * 顺序是**约定**：先记账，再选中这一章。
   *
   * ⚠️ 如实说明（F4）：这两句之间没有 await，而 React 的 effect 不会插进两个
   * 同步语句之间 —— 所以在**当前实现**下把两句对调**不会**改变「今日 AI 生成」
   * 的数值（实测：对调后本文件所有用例仍全绿，唯一变红的是专门断言次序的那条）。
   * 它守的是「一旦有人在两者之间插入 await」时才会出现的后果：选中会触发
   * `:846-922` 的重载 effect，它读完盘就 `primeChapter` 打归属基线（`:901`）
   * ——基线一旦先打上，刚写进去的 AI 正文就会被当成「本来就有的正文」，
   * 那一整章都不计入今日 AI。recordChapter 是差分口径（重复记账安全），
   * 而漏记是永久偏差，所以约定仍然是「先记账」。
   */
  useWritingStatsStore.getState().recordChapter(chapterPath, chapterMarkdown, "ai", previousMarkdown)
  port.rememberLoadedChapter(chapterPath, chapterMarkdown)
  port.writeEditorMarkdown(chapterMarkdown)
  /*
   * 提前把 `selectedFileRef.current` 指到新章节，**再**调 setSelectedFile
   * ——这是本文件既有的写法（见 syncChapterToCanonicalPath 改名那一支，`:794-798`）。
   * 于是重载 effect 里 `previousFile !== selectedFile` 为 false，它不会再对
   * 「上一个打开的文件」做一次冲刷（那一次我们已经显式做过了，而且此刻
   * 编辑器里的正文已经是**这一章**的：不拦住的话它是拿新章的正文去冲刷旧章的文件，
   * `chapterContentMatchesPath` 会因为章号不符而整段抑制掉冲刷，表面上无事，
   * 但任何一次判定放宽都会变成写错文件）。
   */
  port.markSelectedFile(chapterPath)
  // 同章时重载 effect 不会重跑，编辑器内容只能靠这一句对齐磁盘。
  port.setFileContent(chapterMarkdown)
  try {
    const tree = await listDirectory(normalizePath(projectPath))
    // 目录是异步读的：读的过程中项目可能被换走，这棵树就属于上一本书了。
    if (!port.projectChanged()) port.setFileTree(tree)
  } catch (err) {
    // 新章节已在盘上、也已选中，刷新目录失败不影响这次写入。
    console.error("生成章节正文后刷新文件树失败:", err)
  }
  port.bumpDataVersion()
}
