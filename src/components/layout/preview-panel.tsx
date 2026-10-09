import { type CSSProperties, Suspense, lazy, useEffect, useCallback, useRef, useMemo, useState, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Eraser, MoreHorizontal, Type, WandSparkles, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel, resolveNovelModel, formatResolvedModelLabel } from "@/lib/novel/model-resolver"
import type { FinalChapterSavePhase } from "@/stores/wiki-store"
import { deleteFile, fileExists, readFile, writeFileAtomic, writeFileIfAbsent, listDirectory } from "@/commands/fs"
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
import { UiTestEditor, type UiTestEditorSaveState } from "@/components/uitest/ui-test-editor"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { UiTestOutlineTools } from "@/components/uitest/ui-test-outline-tools"
import { createDebouncedPersist } from "@/lib/debounced-persist"
import { BodyTypographyFields, type BodyTypographyValue } from "@/components/settings/sections/body-typography-fields"
import type { BodyFontFamily } from "@/lib/font-settings"

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

function getDiskSyncNormalize(path: string): (content: string) => string {
  return isChapterPath(path) ? normalizeChapterWriting : (content) => content
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
   * 卸载时**必须 flush，不能 dispose**。
   *
   * ⚠ 这里原本写的是 dispose()，那是一个真实的丢数据缺陷（代码质量审查 I1 发现）。
   * 两者的语义天差地别（见 debounced-persist.ts）：
   *   · flush()   立刻执行待落盘动作并取消定时器 —— **保住**最后一次改动
   *   · dispose() 直接丢弃待落盘动作（pending = null）—— **丢掉**最后一次改动
   *
   * 为什么"卸载"这条路径上真的会丢：用户调完设置后最常见的做法是直接关掉
   * 写作视图或关窗口。关浮层那条路径是安全的（document 的 mousedown 会先
   * 触发 closeBodyFontPopover，它里面就是 flush）—— 但**不经过 mousedown 的
   * 卸载**没有这个保护：
   *   ① 拖完滑块 400ms 内直接关窗口 / Alt+F4（走 Tauri 的关闭，没有 mousedown）
   *   ② 键盘导航切走视图，导致写作现场整个卸载
   * 而启动读回是 **app-state 优先**的，丢一次 app-state 写入就等于
   * 「下次开软件，我刚调的设置又变回去了」—— 正是这套去抖逻辑本来要防的那件事。
   *
   * 卸载后组件不再存在，所以"立刻写一次"没有重复渲染的代价；
   * 而"少写一次"的代价是一个用户可见的设置丢失。两者不对称，选 flush。
   */
  useEffect(() => {
    const persist = bodyTypographyPersist.current
    return () => { persist.flush() }
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
        // ⚠ 与 Task 9 的 setBodyTypography 同一个道理，也必须写成穷尽收尾。
        // 任务 11 的键 → store 映射是**第二处**同样的 switch：
        // 写成 default: break 的话，"共享控件新增第 7 个参数"会在这里静默丢写
        // —— 表现是"设置页能改、写作现场浮层改不动"，比单点漏更难排查。
        // 收窄的是 key，不是 next：写成 `never = next` 会直接 TS2322（实测）。
        const _never: never = key
        void _never
      }
    }
    bodyTypographyPersist.current.schedule(persistAllBodyTypography)
  }, [persistAllBodyTypography, setUiBodyFontFamily, setUiBodyFontPx, setUiBodyLineHeight, setUiBodyLetterSpacing, setUiBodyMarginX, setUiBodySafeBottom])

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
    (markdown: string, opts?: { source?: WritingSource }) => {
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
      if (persistedMarkdown === lastLoadedForPath) return
      reportUiTestSave(pathAtSave, "pending")
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const generation = saveGenerationRef.current
      saveTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            if (generation !== saveGenerationRef.current) return
            if (pathAtSave !== selectedFileRef.current) return
            if (normalizePath(pathAtSave) !== normalizedPath) return

            reportUiTestSave(pathAtSave, "saving", persistedMarkdown, generation)
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

            await writeFileAtomic(pathAtSave, persistedMarkdown)
            reportUiTestSave(pathAtSave, "saved", persistedMarkdown, generation)
            rememberLoadedChapter(normalizedPath, persistedMarkdown)
            bumpDataVersion()
          } catch (err) {
            console.error("保存失败:", err)
            reportUiTestSave(pathAtSave, "error", persistedMarkdown, generation)
          } finally {
            saveTimerRef.current = null
          }
        })()
      }, 1000)
    },
    [rememberLoadedChapter, setFileContent, bumpDataVersion, applyDiskSyncIfSafe, reportUiTestSave]
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
    ingest_not_final: "章节已保存为正式章节，但快照生成失败：章节状态异常，请检查章节是否正确标记为终稿。",
    ingest_extract_failed: "章节已保存为正式章节，但快照生成失败：LLM 生成超时或返回格式错误，请重试。",
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

    const novelConfig = useWikiStore.getState().novelConfig
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

      if (novelConfig.autoIngestOnSave) {
        const state = useWikiStore.getState()
        const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
        if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
          updatePhase(false, "ingest_no_llm")
        } else {
          const verifyContent = await readFile(targetPath)
          const verifyParsed = parseFrontmatter(verifyContent)
          const verifyFm = verifyParsed.frontmatter as Record<string, unknown> | null
          if (!verifyFm || !isFinalChapter(verifyFm)) {
            await writeFileAtomic(targetPath, syncResult.markdown)
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const chapterTitle = chapterFrontmatter?.title || `第${chapterFrontmatter?.chapterNumber || '?'}章`
          const ingestAbortController = new AbortController()
          const ingestTaskId = useImportProgressStore.getState().startTask({
            projectPath: project.path,
            kind: "chapter",
            total: 1,
            currentTitle: String(chapterTitle),
            message: "正在提取章节记忆",
            // 章节目录里那一行的「提取中」灰点靠这个字段点亮（按路径，不按标题）。
            activeChapterPaths: [normalizePath(targetPath)],
            abortController: ingestAbortController,
          })
          const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
          const result = await ingestChapter(project.path, targetPath, resolveReviewModel(), ingestAbortController.signal, chapterFrontmatter?.chapterNumber as number | undefined)
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
          } else if (result.failReason === "not_final") {
            updatePhase(false, "ingest_not_final")
          } else if (result.failReason === "extract_failed") {
            updatePhase(false, "ingest_extract_failed")
          } else {
            updatePhase(false, "ingest_failed")
          }
        }
      } else {
        updatePhase(false, "saved")
      }
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
      { source: "ai" },
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

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
        if (uiTestParsed && uiTestHeading) handleSave(uiTestParsed.rawBlock + rebuildChapterBody(title, uiTestHeading.body))
      }}
      statusLabel={isSelectedChapter ? chapterHeader?.statusLabel ?? "草稿" : isOutlineIngesting ? "正在提取记忆" : outlineIngested ? "已提取记忆" : "待提取记忆"}
      wordCount={countChapterBodyWords(fileContent)}
      saveState={uiTestSaveState}
      taskStatus={currentFinalChapterSave?.phase === "ingest_failed" && !alreadyFinal ? "正式章节保存未完成，请核对文件后重试。" : visibleSaveStatus}
      onRetrySave={() => {
        if (uiTestSaveState?.retryAction === "format") void handleFormatWriting()
        else if (uiTestSaveState?.retryAction === "title") void commitChapterTitleDraft()
        else if (uiTestSaveState?.retryAction === "final") void handleSaveAsFinal()
        else handleSave(wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current)
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
          className="fixed z-50 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
          style={{ ...bodyFontPosition, width: BODY_TYPOGRAPHY_PANEL_WIDTH_PX }}
          role="dialog"
          aria-label="字体设置"
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="truncate text-sm font-medium">字体设置</div>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={closeBodyFontPopover}
              aria-label="关闭字体设置"
              title="关闭字体设置"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/*
            与设置页共用同一个组件、同一份 store 取值。
            dense 只影响说明段落，不影响任何数值语义。
          */}
          <BodyTypographyFields
            idPrefix="chapter-body-typography"
            dense
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
    </div>
  )
}
