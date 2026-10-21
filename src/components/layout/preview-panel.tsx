import { type CSSProperties, Suspense, lazy, useEffect, useCallback, useRef, useMemo, useState, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Eraser, Lightbulb, MoreHorizontal, Type, WandSparkles, X } from "lucide-react"
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
import { normalizeChapterWriting } from "@/lib/chapter-formatting"
import { registerOpenDocument } from "@/lib/mcp/open-document"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildChapterEditorHeader } from "@/lib/chapter-editor-header"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { resolveInspirationHint } from "@/lib/inspiration-hint"
import { chapterHasLaterChapter, chapterOrdersFromTree, resolveDraftMemoryHint, type DraftMemoryHintArrival } from "@/lib/draft-memory-hint"
import { saveNovelConfig, saveUiBodyFontFamily, saveUiBodyFontPx, saveUiBodyLineHeight, saveUiBodyLetterSpacing, saveUiBodyMarginX, saveUiBodySafeBottom } from "@/lib/project-store"
import { registerPreCloseFlush } from "@/lib/pre-close-flush"
import { isChapterPage, isFinalChapter, parseChapterMeta, updateChapterStatus, updateChapterTitle } from "@/lib/novel/chapter-meta"
import { chapterSnapshotNumbersFrom, chapterSnapshotNumbersFromFileNames, resolveChapterMemoryDotState } from "@/lib/novel/chapter-memory-dot"
import { resolveChapterDotNumbers } from "@/lib/novel/chapter-utils"
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
import { isOutputTruncatedError, streamChat } from "@/lib/llm-client"
import { isTruncationFinishReason } from "@/lib/llm-providers"
import { isUserAbortError } from "@/lib/user-abort"
import {
  extractChapterNumberFromMarkdown,
  getDraftChapterPath,
  resolveChapterFlushMarkdown,
  shouldSyncChapterOnLeave,
} from "@/lib/novel/chapter-path-sync"
import { makeChapterFileName, makeDefaultChapterTitle } from "@/lib/wiki-filename"
import { getPreviewContentContainerClass, shouldUseCompactChapterToolbar } from "@/lib/workspace-layout"
import { useOutlineGenerationStore, type OutlineGenerationTask } from "@/stores/outline-generation-store"
import { EventOutlineWizardDialog } from "@/components/sources/event-outline-wizard-dialog"
import { buildEventOutlinePrompt, type EventOutlineRequest } from "@/lib/novel/event-outline"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { flattenMdFiles, pickChapterLibraryFiles, resolveNextChapterNumber } from "@/lib/novel/chapter-utils"
import { useChatStore } from "@/stores/chat-store"
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
import { ContinuationPopover, type ContinuationPhase } from "@/components/editor/continuation-popover"
import {
  CONTINUATION_MAX_TOKENS,
  CONTINUATION_POPOVER_MAX_HEIGHT,
  CONTINUATION_POPOVER_WIDTH,
  CONTINUATION_TEMPERATURE,
  buildContinuationMessages,
  clampContinuationPopoverPosition,
  insertContinuationBody,
  resolveContinuationFinish,
  type ContinuationAnchor,
  type ContinuationFinishKind,
  type PendingEditorCaret,
} from "@/lib/novel/continuation"
import { shouldApplyDiskToEditor } from "@/lib/editor-disk-sync"
import { registerEditorExternalUpdateHandler } from "@/lib/editor-external-update-session"
import { registerChapterSaveFlush, CHAPTER_AUTOSAVE_INTERVAL_MS, OUTLINE_AUTOSAVE_DELAY_MS } from "@/lib/chapter-save-flush"
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
  // ── 续写 ──
  // 锚点把视口坐标一起存下来，浮层定位就不必每帧再量 parent。
  const [continuationOpen, setContinuationOpen] = useState(false)
  const [continuationPhase, setContinuationPhase] = useState<ContinuationPhase>("idle")
  const [continuationAnchor, setContinuationAnchor] = useState<(ContinuationAnchor & { x: number; y: number }) | null>(null)
  const [continuationInstruction, setContinuationInstruction] = useState("")
  const [continuationCandidate, setContinuationCandidate] = useState("")
  const [continuationError, setContinuationError] = useState("")
  const [continuationTruncated, setContinuationTruncated] = useState(false)
  const [continuationCaretRequest, setContinuationCaretRequest] = useState<PendingEditorCaret | null>(null)
  const continuationAbortRef = useRef<AbortController | null>(null)
  /**
   * 这个续写锚点属于哪个文件。
   *
   * 与 AI润色 的 `actionFile` 同理，但**必须比它更早记**：润色是生成完才弹
   * 对比窗，文件不匹配就干脆不弹，所以那个窗口永远不会挂在过期章节上；
   * 续写浮层在生成**之前**就打开（要显示输入框），插入又是之后另一次用户动作，
   * 于是「浮层开着 → 切章 → 点插入」是一条真实可达的路径。
   *
   * 只在生成开始时记是不够的：用户可以打开浮层、不生成、直接切章。
   * 所以在 `handleContinuationRequest`（锚点产生的那一刻）就记下。
   */
  const continuationFileRef = useRef<string | null>(null)
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
  /*
   * ── 丁-2「文风写作」状态已删除（用户要求）──
   *
   * 这里原先有 `chapterWritingStyleId` / `setChapterWritingStyleId`，
   * 由章节工具栏最右那枚 `WritingStylePicker`（`iconOnly`）写入，
   * 再经下面的 `writingStyleIdOverride: chapterWritingStyleId` 传给
   * 本次章节正文生成，语义是"这一次临时用某条文风"。用户在定稿截图里
   * 明确要求「每个章节的上面不需要显示『文风』的图标，将『文风』的图标删除」。
   *
   * ⚠️ 删的是**这一处产出端**，不是整条文风能力：
   *   · `WritingStylePicker` 组件本身仍在（文风库里照常可用）；
   *   · `deep-chapter-generation.ts` 的 `writingStyleIdOverride` 入参仍在；
   *   · 对话 / 写作助手那条路仍在产（`chat-panel.tsx` 的
   *     `getWritingStyleIdOverride` → `run_chapter_workflow`）。
   * 也就是说这个通道现在是"只有对话侧一个产出者"，而不是被拆掉。
   *
   * 因此这里**不再传** `writingStyleIdOverride`。省掉这个键与
   * `writingStyleIdOverride: undefined` **完全等价** ——
   * `deep-chapter-generation.ts` 的判据是 `=== undefined` 表示"不覆盖"，
   * `run-chapter-workflow.spec.ts` 也钉着"没有产出者时必须是 undefined"。
   *
   * ⚠️ 若将来要把它加回来：别只加 `useState` 和 JSX，还要一并恢复
   * `[project?.path]` effect 里的清空（`setChapterWritingStyleId(undefined)`）。
   * 那条不是可有可无的收尾 —— 文风是**项目级**资源，旧项目的 preset id
   * 留在内存里换个项目就会静默把新项目启用的文风压掉，而这个选择器是
   * `iconOnly`、正文里看不出任何变化。删除前的版本里那段推理写在
   * `[project?.path]` 那个 effect 的注释里，git 历史可查。
   */
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

  useEffect(() => {
    if (!selectedFile) {
      registerOpenDocument(null)
      return
    }
    const path = selectedFile
    registerOpenDocument({
      path,
      isDirty: () => {
        const current = wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current
        const persisted = isChapterPath(path) ? normalizeChapterWriting(current) : current
        const last = lastLoadedByPathRef.current.get(normalizePath(path)) ?? ""
        return persisted !== last || saveTimerRef.current != null
      },
      applyMarkdown: (markdown) => {
        setFileContent(markdown)
        fileContentRef.current = markdown
        rememberLoadedChapter(path, markdown)
      },
    })
    return () => registerOpenDocument(null)
  }, [rememberLoadedChapter, selectedFile, setFileContent])

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

  /*
   * 项目级选择的统一重置点：**换项目就清空**。
   *
   * 改造前这里清两项：`chapterDeAiSkillId` 与 `chapterWritingStyleId`（丁-2）。
   * 后者随「文风写作」图标一起删除（用户要求，理由见上面
   * `chapterWritingStyleId` 删除处的注释），现在只剩 DeAi Skill 一项。
   *
   * ⚠️ 这一行留着仍有意义：`chapterDeAiSkillId` 指向的是**项目级**的
   * Skill 选择，旧项目的选择不该作用在新项目上。
   *
   * ⚠️ **可达性交代（别把它当成今天正在发生的 bug）**：实测当前 app shell 里
   * 换项目必然经过 `setProject(null)` —— 那是 `App.tsx` 的 `handleSwitchProject`
   * 干的（旧项目由它置空）；`handleProjectOpened` 只负责**置新**（`setProject(proj)`），
   * 不置空。两者别混为一谈，也别把「置新」读成「置空」。
   * 而 `ui-test-shell.tsx` 的 `showShelf`（`!project && !showGlobalSettings`）
   * 会把整个工作区子树（含本组件）换成书架 ⇒ 本组件**本来就会卸载**，
   * 组件状态随之消失。
   * 所以这一行在今天是**契约 + 防将来**：任何让 PreviewPanel 活过一次项目切换的
   * 改动（换成 key 复用、在工作区里加项目切换器、把工作区提到 shelf 之外……）
   * 都会立刻踩中上面那条静默链。行为用例
   * （`preview-panel.event-outline.spec.tsx` 的「丁-2 章节区文风选择与项目绑定」）
   * 在不卸载组件的前提下改 store 里的 project，直接钉住这个契约。
   */
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

  /**
   * 离开非章节文件（大纲/细纲）时立刻落盘待保存内容。
   *
   * 自动保存间隔是 3 分钟，原来只有章节在切走/卸载时兜底 flush，
   * 大纲没有 —— 粘贴细纲后切到别的大纲、切页面或点提取记忆导致重新挂载，
   * 内容就留在定时器里被丢掉了。磁盘若已被外部改动则不覆盖。
   */
  const flushNonChapterPendingSave = useCallback(async (path: string) => {
    const pending = pendingChapterSaveRef.current
    if (!pending || pending.pathAtSave !== path) return
    pendingChapterSaveRef.current = null
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    try {
      const lastLoaded = lastLoadedByPathRef.current.get(pending.normalizedPath) ?? ""
      const diskContent = await readFile(pending.normalizedPath).catch(() => null)
      const normalize = getDiskSyncNormalize(pending.normalizedPath)
      if (diskContent !== null && normalize(diskContent) !== normalize(lastLoaded)) return
      await writeFileAtomic(pending.pathAtSave, pending.persistedMarkdown)
      lastLoadedByPathRef.current.set(pending.normalizedPath, pending.persistedMarkdown)
      bumpDataVersion()
    } catch (err) {
      console.error("离开大纲前保存失败:", err)
    }
  }, [bumpDataVersion])

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
    } else if (previousFile && previousFile !== selectedFile) {
      // 大纲等非章节文件：切走前把还在定时器里的那份写下去，否则粘贴的内容会丢。
      void flushNonChapterPendingSave(previousFile)
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
  }, [selectedFile, rememberLoadedChapter, setFileContent, flushChapterBeforeLeave, flushNonChapterPendingSave, reportUiTestSave])

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
      } else if (currentFile) {
        void flushNonChapterPendingSave(currentFile)
      }
    }
  }, [flushChapterBeforeLeave, flushNonChapterPendingSave])

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
      }, isChapterPath(pathAtSave) ? CHAPTER_AUTOSAVE_INTERVAL_MS : OUTLINE_AUTOSAVE_DELAY_MS)
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
  /*
   * ── 标题行徽章的判据：这一章的记忆快照是否存在 ──
   *
   * 用户口径：「以记忆为准：正式 = 已提取记忆」。
   *
   * 改造前徽章读的是文件里的 `chapter_status`，那是**另一个**概念：
   * `handleSaveAsFinal` 只把 `chapter_status: final` 写盘，并按用户先前的要求
   * **不**再顺带提取记忆（见那里的注释）。于是任何"标记为正式却从未提取"的章节
   * 都会显示绿色「正式」，而侧栏同一行的绿点（快照存在）却是空的 ——
   * 用户报的就是这个：第 6、15 章没有绿点却显示「正式」，第 19 章显示「草稿」。
   *
   * 现在徽章直接问「有没有快照」，并且与侧栏绿点调用**同一个**
   * `resolveChapterDotNumbers` + `resolveChapterMemoryDotState`。
   * 取号规则原先私有在 `knowledge-tree.tsx` 里，已搬到 `chapter-utils` 共享 ——
   * 两处各算一遍正是这次不一致的来源。
   *
   * ⚠️ 只读盘、不写盘：不改动任何章节文件的 `chapter_status`。
   * 「保存为正式章节」按钮的语义（标记定稿）也没变，变的只是徽章在说什么。
   */
  const [memorySnapshotNumbers, setMemorySnapshotNumbers] = useState<Set<number>>(() => new Set())
  /*
   * 提取完成后重读快照的**显式**信号。
   *
   * 为什么不能只依赖 `currentFinalChapterSave?.phase`：保存为正式章节时
   * `syncChapterToCanonicalPath(..., { renameToCanonical: true })` 会把文件改名，
   * `updatePhase` 记的 `filePath` 是改名后的 `targetPath`，于是
   * `currentFinalChapterSave`（要求 `filePath === selectedFile`）变成 null，
   * 依赖值始终不变 —— 提取成功、快照已落盘，徽章却停在「草稿」。
   * 这条路正是用户报的 `-2` 文件那种重命名场景，所以必须用一个与路径无关的计数。
   */
  const [memorySnapshotVersion, setMemorySnapshotVersion] = useState(0)
  useEffect(() => {
    if (!project) {
      setMemorySnapshotNumbers(new Set())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const snapshotDir = `${normalizePath(project.path)}/.novel/snapshots`
        const tree = await listDirectory(snapshotDir)
        // 先解析出全部快照号（含大纲的负数），再只留章节的正数。
        const numbers = chapterSnapshotNumbersFrom(chapterSnapshotNumbersFromFileNames(tree.map((file) => file.name)))
        if (!cancelled) setMemorySnapshotNumbers(new Set(numbers))
      } catch {
        // 快照目录不存在（还没提取过任何章节）是正常状态，静默当作「一个都没有」。
        if (!cancelled) setMemorySnapshotNumbers(new Set())
      }
    })()
    return () => { cancelled = true }
  }, [project, dataVersion, memorySnapshotVersion])

  const chapterMemoryExtracted = useMemo(() => {
    if (!selectedFile || !isChapterPath(selectedFile) || getFileCategory(selectedFile) !== "markdown") return false
    const { chapterNumber: dotChapterNumber, fileChapterNumber } = resolveChapterDotNumbers({
      content: fileContent,
      filePath: selectedFile,
    })
    return resolveChapterMemoryDotState({
      snapshotChapterNumbers: memorySnapshotNumbers,
      chapterNumber: dotChapterNumber,
      fileChapterNumber,
      // 提取中不单独表达：快照还没落盘，此刻按「未提取」显示才是实话。
      running: false,
    }) === "done"
  }, [fileContent, memorySnapshotNumbers, selectedFile])

  const chapterHeader = useMemo(() => {
    if (!selectedFile || !isChapterPath(selectedFile) || getFileCategory(selectedFile) !== "markdown") return null
    /*
     * 徽章与悬停提示都从这里出，所以只要把「记忆口径」交给它，
     * 标题行的三处文案（status / statusLabel / statusBadge）自动一致 ——
     * 不需要在 JSX 里各改一遍，也就不会出现"徽章说草稿、提示说正式章节"。
     */
    return buildChapterEditorHeader(fileContent, { memoryExtracted: chapterMemoryExtracted })
  }, [chapterMemoryExtracted, fileContent, selectedFile])
  const draftMemoryHintEnabled = useWikiStore((s) => s.novelConfig.draftMemoryHintEnabled)
  const draftMemoryHintSeen = useWikiStore((s) => s.novelConfig.draftMemoryHintSeen)
  const inspirationHintEnabled = useWikiStore((s) => s.novelConfig.inspirationHintEnabled)
  const inspirationHintSeen = useWikiStore((s) => s.novelConfig.inspirationHintSeen)
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
  /**
   * 章节区「生成章节细纲」：向导提交后把请求**发进 AI 对话**，生成结果在 AI 对话框里显示。
   *
   * 为什么不再是本地生成（本次改动的全部理由）：这条链路原先在自己这一层调模型、
   * 把结果渲染成卡片挂在章节正文区顶部，于是用户看到的形态是「细纲出现在正文里」。
   * 用户要求改成「点按钮 → 请求进 AI 对话 → 结果在对话框里显示」，所以这里只做三件事：
   * 校验、展开写作助手、把提示词投给 AI 对话（见 chat-store 的 PendingComposerSend）。
   *
   * ⚠️ 模型可用性**仍在这里先查一遍**：投递是异步的（ChatPanel 可能还没挂载），
   * 若把这句话交给对话面板去报，用户点完按钮会先经历一段「什么都没发生」。
   * 这里的两句 toast 是同步、就地、说得清原因的。
   *
   * 提示词用 `hasFileTools: true`：AI 对话有工具循环，可以让模型先读前文与已有章纲 ——
   * 与章节区原先那条无工具链路相反（见 buildEventOutlinePrompt 的能力声明注释）。
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
     * 先展开写作助手再投递，顺序不能反：反过来的话，投递那一刻 ChatPanel 还没挂载，
     * 用户看到的是「点了按钮什么都没发生」—— 而请求其实已经在队列里，
     * 要等他碰巧去展开助手才会发出去。
     *
     * ⚠️ 还要把视图切回 `wiki`：写作助手（ChatPanel）只在 `mode === "chapter"`
     * 的工作区里渲染，而 mode 是由 `activeView` 决定的（ui-test-shell 的
     * `activeView === "sources" ? "outline" : "chapter"`）。本章工具栏理论上只出现在
     * 章节工作区，但「先打开第 7 章、再切到『大纲』标签」会让 `selectedFile` 仍指向
     * 那一章 —— 那时按钮还在、写作助手却换成了大纲助手，而**大纲助手不消费这条队列**
     * （它有自己的事件细纲产线）。不切视图，请求就会静默躺在队列里等用户自己切回去。
     */
    useWikiStore.getState().setActiveView("wiki")
    setChatExpanded(true)
    useChatStore.getState().requestComposerSend({
      text: buildEventOutlinePrompt(request, { hasFileTools: true }),
      displayText: `请为第 ${request.chapterNumber} 章生成事件细纲（${request.eventCount} 个事件 · 目标 ${request.targetWords} 字）`,
    })
  }, [project?.path, setChatExpanded])

  const handleOpenEventOutlineWizard = useCallback(() => {
    setEventOutlineWizardVisible(true)
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
  /*
   * ── 丙-4a：新章节灵感提示 + 草稿提示的**同一次**判定 ──
   *
   * 判据（决定 A）与草稿提示**同源**：都要回答「这一章有没有正文」，
   * 而且都不新写一份判据 —— 否则会出现「草稿提示认为是空章节、
   * 灵感提示认为不是」的自相矛盾。
   *
   * ⚠️ 但「同源」只到**同一个计算函数**为止，**不是同一个数**：草稿链喂进
   * 纯函数的是 `session.persistedWords`（只在切章或保存成功时刷新的**快照**，
   * 删字不会刷新它），灵感链喂的是 `countChapterBodyWords(fileContent)`（**实时**）。
   * 所以两条气泡的互斥**不能**靠「`wordCount > 0` 与 `wordCount === 0` 互补」
   * 这个前提 —— 它在「磁盘上还有正文、编辑框刚被清空」时不成立：
   * 草稿链看到 >0、灵感链看到 0，两条一起挂出来，而它们共用
   * `.ui-test-editor-hint-anchor` 与同一组 top/left/width，会**精确重叠**
   * 在同一坐标上（修复批 F1 实测；当时纯函数层的 432 组合穷举全绿，
   * 因为它把同一个 `wordCount` 喂给两个函数，**覆盖不到接线**）。
   *
   * 互斥因此写成**显式**的：两条链在**同一个 effect 里按顺序**判定，
   * 灵感链拿到草稿链刚算出来的 `draftNext`（`resolveInspirationHint` 的
   * `draftHintVisible` 入参），草稿气泡挂着时灵感气泡一律不挂 ——
   * 也顺带不写 `inspirationHintSeen`，不烧掉「每本书一次」的预算。
   * 拆成两个 effect（让灵感链读 state 或读对方 effect 的产物）会出现
   * 「一帧两条都挂」的窗口：state 更新要等下一次 render 才可见。
   *
   * ⚠️ 决定 B：气泡与向导是**并行**的两条动作。点按钮只开向导
   * （`handleOpenEventOutlineWizard`），本 effect 不看向导状态，
   * 所以向导打开时气泡仍在，气泡也不拦截那次点击。
   */
  const [inspirationHintVisible, setInspirationHintVisible] = useState(false)
  const inspirationHintSessionRef = useRef<{ path: string | null; dismissed: boolean; visible: boolean }>({
    path: null,
    dismissed: false,
    visible: false,
  })
  const dismissInspirationHint = useCallback(() => {
    inspirationHintSessionRef.current.dismissed = true
    inspirationHintSessionRef.current.visible = false
    setInspirationHintVisible(false)
  }, [])
  const muteInspirationHint = useCallback(() => {
    inspirationHintSessionRef.current.visible = false
    setInspirationHintVisible(false)
    const next = { ...useWikiStore.getState().novelConfig, inspirationHintEnabled: false }
    setNovelConfig({ inspirationHintEnabled: false })
    void saveNovelConfig(next, project?.id, project?.path).catch((error) => {
      console.error("关闭新章节灵感提示失败:", error)
    })
  }, [project?.id, project?.path, setNovelConfig])
  /**
   * 草稿气泡与灵感气泡的**唯一**判定点。
   *
   * 两段必须是**一个** effect：见上面的说明 —— 灵感链的 `draftHintVisible`
   * 只能来自同一次运行里草稿链刚算出来的结果，不能来自 state（差一帧）
   * 也不能来自另一个 effect（跨 effect 的时序保证更弱）。
   */
  useEffect(() => {
    const draftSession = draftHintSessionRef.current
    if (draftSession.path !== selectedFile) {
      draftSession.path = selectedFile
      draftSession.arrival = "select"
      draftSession.persistedWords = null
      draftSession.visible = false
      draftSession.dismissed = false
    }
    const inspirationSession = inspirationHintSessionRef.current
    if (inspirationSession.path !== selectedFile) {
      inspirationSession.path = selectedFile
      inspirationSession.dismissed = false
      inspirationSession.visible = false
    }
    if (!selectedFile || loadedFilePath !== selectedFile) {
      draftSession.visible = false
      setDraftHintVisible(false)
      inspirationSession.visible = false
      setInspirationHintVisible(false)
      return
    }
    // ── 草稿链：`persistedWords` 是**快照**语义（草稿提示说的是磁盘上的草稿）──
    const words = countChapterBodyWords(fileContent)
    const phase = uiTestSaveState?.path === selectedFile ? uiTestSaveState.phase : null
    if (draftSession.persistedWords === null && phase !== "saved") {
      draftSession.persistedWords = words
      draftSession.arrival = "select"
    } else if (phase === "saved") {
      const previous = draftSession.persistedWords ?? 0
      draftSession.arrival = previous === 0 && words > 0 ? "first-save" : "stay"
      draftSession.persistedWords = words
    }
    const draftNext = resolveDraftMemoryHint({
      isChapter: isChapterPath(selectedFile),
      status: chapterHeader?.status ?? null,
      wordCount: draftSession.persistedWords ?? 0,
      arrival: draftSession.arrival,
      dismissed: draftSession.dismissed,
      extracting: isFinalChapterSaving,
      enabled: draftMemoryHintEnabled,
      bookHintSeen: draftMemoryHintSeen,
      hasLaterChapter: chapterHasLaterChapter(chapterNumber, chapterOrdersFromTree(fileTree)),
      currentlyVisible: draftSession.visible,
    })
    draftSession.visible = draftNext
    if (draftNext && !draftMemoryHintSeen) {
      const config = { ...useWikiStore.getState().novelConfig, draftMemoryHintSeen: true }
      setNovelConfig({ draftMemoryHintSeen: true })
      void saveNovelConfig(config, project?.id, project?.path).catch((error) => {
        console.error("记录草稿提取记忆提示失败:", error)
      })
    }
    setDraftHintVisible(draftNext)

    // ── 灵感链：显式拿到草稿链**刚算出来**的结果，而不是自己再推一遍 ──
    const inspirationNext = resolveInspirationHint({
      isChapter: isChapterPath(selectedFile),
      // 实时内容，不是磁盘字数：刚新建一章、正在打字时它已经非空 → 气泡不出现。
      wordCount: words,
      enabled: inspirationHintEnabled,
      dismissed: inspirationSession.dismissed,
      bookHintSeen: inspirationHintSeen,
      currentlyVisible: inspirationSession.visible,
      // 草稿气泡挂着时灵感气泡一律不挂：两者定位属性逐项相同，会精确重叠。
      draftHintVisible: draftNext,
    })
    inspirationSession.visible = inspirationNext
    if (inspirationNext && !inspirationHintSeen) {
      const config = { ...useWikiStore.getState().novelConfig, inspirationHintSeen: true }
      setNovelConfig({ inspirationHintSeen: true })
      void saveNovelConfig(config, project?.id, project?.path).catch((error) => {
        console.error("记录新章节灵感提示失败:", error)
      })
    }
    setInspirationHintVisible(inspirationNext)
  }, [chapterHeader, chapterNumber, draftMemoryHintEnabled, draftMemoryHintSeen, fileContent, fileTree, inspirationHintEnabled, inspirationHintSeen, isFinalChapterSaving, loadedFilePath, project?.id, project?.path, selectedFile, setNovelConfig, uiTestSaveState])
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

  /**
   * 章节记忆提取（落盘 `.novel/snapshots/NNN.snapshot.json`）—— **唯一**实现。
   *
   * 抽出来的理由：它有两个调用方，而两者的前置步骤不同：
   *   · 「重新提取记忆」（章节已是 `chapter_status: final`）：直接提取；
   *   · 「提取记忆」（章节还是草稿）：先把章节落成正式章节，紧接着提取。
   * 原先两边各自抄一遍提取体；两次实现一旦分叉，标题行的「正式/草稿」徽章
   * （判据是快照）就会时而亮、时而灭。
   */
  const runChapterIngest = useCallback(async ({
    projectPath,
    filePath,
    chapterNumberOverride,
    chapterTitle,
    updatePhase,
  }: {
    projectPath: string
    filePath: string
    chapterNumberOverride?: number
    chapterTitle: string
    updatePhase: (saving: boolean, phase: FinalChapterSavePhase | null, params?: Record<string, string | number>) => void
  }) => {
    /*
     * 「没配 LLM」这道预检原本在自动提取那条路上（已按用户要求删除）。
     * 删掉路径不等于可以丢掉诊断：否则用户点了按钮只会看到笼统的
     * 「快照生成失败」，不知道根源是压根没有可用的模型。
     * 放进这个共用实现后，两条入口都能提前、明确地提示去配置 LLM。
     */
    {
      const state = useWikiStore.getState()
      const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
      if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
        updatePhase(false, "ingest_no_llm")
        setIsSavingFinal(false)
        return
      }
    }
    setSaveStatus("")
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
      const result = await ingestChapter(projectPath, filePath, resolveReviewModel(), ingestAbortController.signal, chapterNumberOverride)
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
      /*
       * 无论成败都让徽章重读一次快照：
       * 成功时它要从「草稿」翻成「正式」；失败时重读也无副作用
       * （读的是一次目录列表），比"只在成功分支里加"更不容易漏。
       */
      setMemorySnapshotVersion((version) => version + 1)
    }
  }, [])

  /**
   * @param options.thenExtract 保存成功后**立即**提取记忆（「提取记忆」按钮在草稿章上走这条）。
   *   不传 = 只标记定稿，不触发任何 LLM 调用（「保存为正式章节」菜单项走的仍是这条）。
   */
  const handleSaveAsFinal = useCallback(async (options?: { thenExtract?: boolean }) => {
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
       * 「保存为正式章节」本身**不**提取记忆（用户要求：同一份功能不留两个入口，
       * 保留工具栏那个手动按钮即可）。
       *
       * ⚠️ 但「提取记忆」按钮在**草稿**章节上正是从这里进来的，它必须继续走到提取 ——
       * 否则按钮的名字与行为对不上：点一次只把章节标成 final，标题行徽章
       * （判据是快照）仍是「草稿」，用户会以为按钮坏了。
       * 这正是「正式却无记忆」的历史成因：批量导入把 6–9、15 章写成 final，
       * 而提取只跑到第 5 章就停了，于是它们永远停在"正式但无快照"。
       *
       * 所以按 `thenExtract` 分流：按钮带它、菜单项不带。
       */
      if (options?.thenExtract) {
        const updatedMeta = parseChapterMeta(parseFrontmatter(syncResult.markdown).frontmatter ?? {})
        const updatedHeading = syncResult.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
        await runChapterIngest({
          projectPath,
          filePath: targetPath,
          chapterNumberOverride: updatedMeta?.chapterNumber,
          chapterTitle: updatedHeading || `第${updatedMeta?.chapterNumber ?? "?"}章`,
          updatePhase,
        })
        return
      }
      updatePhase(false, "saved")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updatePhase(false, "ingest_failed", { message: `快照提取异常: ${message.slice(0, 100)}` })
      console.error("[preview-panel] ingest failed:", error)
      if (!uiTestFinalFileSaved) reportUiTestSave(selectedFile, "error", undefined, undefined, "final")
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, project, runChapterIngest, selectedFile, setFileContent, setFinalChapterSave, syncChapterToCanonicalPath, syncDiskBeforeAction, reportUiTestSave])

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
    /*
     * 提取体与「草稿章 → 提取」那条入口共用 `runChapterIngest`，
     * 这里只负责「已经是正式章节」这个前置判断与阶段播报。
     */
    await runChapterIngest({
      projectPath,
      filePath,
      chapterNumberOverride: chapterFrontmatter?.chapterNumber as number | undefined,
      /*
       * `String(...)` 不是多余的：`chapterFrontmatter` 是 `Record<string, unknown>`，
       * `title` 是 `unknown`，直接 `||` 出来的类型会退化成 `{}` 而不是 string
       * （原来是把它交给 `String(...)` 用的，抽成共用实现后才暴露出来）。
       */
      chapterTitle: String(chapterFrontmatter?.title || `第${chapterFrontmatter?.chapterNumber || '?'}章`),
      updatePhase,
    })
  }, [chapterFrontmatter, project, runChapterIngest, selectedFile, setFinalChapterSave, t])

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

  const handleIngestOutline = useCallback(async () => {
    if (!project || !selectedFile || !canIngestOutline || isOutlineIngesting) return
    // 提取记忆读的是磁盘：先把刚粘贴、还没落盘的细纲写下去。
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await runPendingChapterSave()
    setSaveStatus("")
    startOutlineIngestTask(project.path, selectedFile)
  }, [canIngestOutline, isOutlineIngesting, project, selectedFile, runPendingChapterSave])

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

  const handleContinuationRequest = useCallback((anchor: ContinuationAnchor, position: { x: number; y: number }) => {
    const state = useWikiStore.getState()
    const llmConfig = resolveDefaultModel(state.llmConfig)
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      setSaveStatus("未配置可用的 AI 模型，无法续写")
      return
    }
    // 换一个插入点就换一次锚点；上一次的候选作废，不能拿旧候选插到新位置。
    continuationAbortRef.current?.abort()
    continuationAbortRef.current = null
    // 锚点属于此刻这个文件。插入前要拿它比对，见 handleInsertContinuation。
    continuationFileRef.current = selectedFileRef.current
    setContinuationAnchor({ ...anchor, x: position.x, y: position.y })
    setContinuationPhase("idle")
    setContinuationCandidate("")
    setContinuationError("")
    setContinuationTruncated(false)
    setContinuationOpen(true)
    setSaveStatus("")
  }, [])

  const runContinuation = useCallback(async () => {
    const anchor = continuationAnchor
    if (!anchor) return
    const state = useWikiStore.getState()
    const llmConfig = resolveDefaultModel(state.llmConfig)
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      setContinuationPhase("error")
      setContinuationError("未配置可用的 AI 模型，无法续写")
      return
    }
    const fileAtStart = selectedFileRef.current
    if (!fileAtStart) return

    continuationAbortRef.current?.abort()
    const controller = new AbortController()
    continuationAbortRef.current = controller
    continuationFileRef.current = fileAtStart

    setContinuationPhase("streaming")
    setContinuationCandidate("")
    setContinuationError("")
    setContinuationTruncated(false)

    let result = ""
    /*
     * 收尾统一走这里：相位由纯函数判（continuation.ts 的 resolveContinuationFinish），
     * 组件只负责把结果落到状态上。
     *
     * 之所以不在这里各写各的判断：用户「停止」走的是 onDone、输出被截断走的是
     * onError，两条路径反直觉，散着写必然写错其中一条（这两条已经各错过一次）。
     */
    const settle = (kind: ContinuationFinishKind, failureMessage = "") => {
      const finish = resolveContinuationFinish(kind, Boolean(result.trim()), failureMessage)
      if (finish.errorMessage) setContinuationError(finish.errorMessage)
      setContinuationPhase(finish.phase)
    }
    try {
      await streamChat(
        llmConfig,
        buildContinuationMessages(anchor.bodySnapshot, continuationInstruction),
        {
          // 与润色不同，这里每个 token 都要上屏：用户要看着它写出来。
          onToken: (token) => {
            result += token
            setContinuationCandidate(result)
          },
          onFinishReason: (reason) => {
            if (isTruncationFinishReason(reason)) setContinuationTruncated(true)
          },
          onDone: () => {
            if (continuationFileRef.current !== selectedFileRef.current) return
            // 用户中止也走 onDone，所以这里要分清「他主动停下」和「模型真没吐字」。
            settle(controller.signal.aborted ? "aborted" : "done")
          },
          onError: (error) => {
            if (continuationFileRef.current !== selectedFileRef.current) return
            // 兜底：正常情况下中止已被 onDone 接走，这里再防一次。
            if (isUserAbortError(error, controller.signal)) {
              settle("aborted")
              return
            }
            /*
             * 输出撞上 token 上限时走的是 onError，但它不是失败：已经有半截
             * 正文了。按错误处理的话浮层不渲染候选区，用户就拿不到已生成的内容。
             */
            if (isOutputTruncatedError(error) && result.trim()) {
              setContinuationTruncated(true)
              settle("truncated")
              return
            }
            console.error("续写失败:", error)
            settle("failed", `续写失败：${error.message}`)
          },
        },
        controller.signal,
        { max_tokens: CONTINUATION_MAX_TOKENS, temperature: CONTINUATION_TEMPERATURE },
      )
    } catch (err) {
      if (continuationFileRef.current !== selectedFileRef.current) return
      if (isUserAbortError(err, controller.signal)) {
        settle("aborted")
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      console.error("续写失败:", err)
      settle("failed", `续写失败：${message}`)
    }
  }, [continuationAnchor, continuationInstruction])

  const handleInsertContinuation = useCallback(() => {
    const anchor = continuationAnchor
    if (!anchor || !continuationCandidate.trim()) return

    /*
     * 锚点必须属于当前这个文件。
     *
     * 只靠下面 insertContinuationBody 的 bodySnapshot 校验拦不住跨章写入：
     * 两章正文逐字节相同时快照相等 —— 新建书里连着两个空章节就是这种情形，
     * 于是给第 1 章生成的续写会插进第 2 章。已实测复现。
     */
    if (continuationFileRef.current !== selectedFileRef.current) {
      setContinuationPhase("error")
      setContinuationError("已切换到其它章节，续写内容未插入")
      return
    }

    // 与 handleApplySelectionTransform 同一套拆解：先剥 frontmatter，
    // 再剥 `# 标题` 行 —— 因为 textarea 里的偏移与快照都不含这两段。
    const { rawBlock, body } = parseFrontmatter(fileContent)
    const { heading, body: currentBody } = splitChapterHeading(body)
    const inserted = insertContinuationBody(currentBody, anchor, continuationCandidate)
    if (!inserted.ok) {
      setContinuationPhase("error")
      setContinuationError(
        inserted.reason === "empty" ? "续写内容为空，无法插入" : "正文已变化，请重新续写",
      )
      return
    }

    // 插进去的是模型产出，整段记到「今日 AI 生成」；原有正文归属不变。
    handleSave(rawBlock + rebuildChapterBody(heading, inserted.body), { source: "ai", immediate: true })
    setContinuationCaretRequest({ at: inserted.caret, nonce: Date.now() })
    setContinuationOpen(false)
    setContinuationPhase("idle")
    setContinuationCandidate("")
    setContinuationError("")
    setContinuationTruncated(false)
    setSaveStatus("")
  }, [continuationAnchor, continuationCandidate, fileContent, handleSave])

  const handleCloseContinuation = useCallback(() => {
    continuationAbortRef.current?.abort()
    continuationAbortRef.current = null
    setContinuationOpen(false)
    setContinuationPhase("idle")
    setContinuationCandidate("")
    setContinuationError("")
    setContinuationTruncated(false)
    // 指令一起清掉：每次续写都是一次新的意图，留着上一次的方向更容易误发。
    setContinuationInstruction("")
  }, [])

  useEffect(() => {
    return () => { continuationAbortRef.current?.abort() }
  }, [])

  /*
   * 切章即收起浮层。
   *
   * 浮层里的候选属于上一章：留着它既容易让用户误以为那是本章的续写，也给了
   * 「切章后点插入」可乘之机（两章正文相同时快照校验拦不住）。AI润色用「文件
   * 不匹配就不弹窗」达到同样效果，这里换成「切了就收」。
   *
   * 用 previousFileRef 跳过首次挂载：挂载时并没有「上一章」，没必要多跑一次
   * setState（会把刚发起的续写也一起清掉）。
   */
  const previousSelectedFileRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousSelectedFileRef.current
    previousSelectedFileRef.current = selectedFile
    if (previous === null || previous === selectedFile) return
    handleCloseContinuation()
  }, [selectedFile, handleCloseContinuation])

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
      statusBadge={isSelectedChapter && chapterHeader
        ? { text: chapterHeader.statusBadge, isFinal: chapterHeader.status === "final" }
        : null}
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
      inspirationHint={inspirationHintVisible ? { onDismiss: dismissInspirationHint, onMute: muteInspirationHint } : null}
      documentDetails={uiTestParsed?.frontmatter ? <FrontmatterPanel data={uiTestParsed.frontmatter} /> : undefined}
      auxiliaryPanel={!isSelectedChapter ? <UiTestOutlineTools /> : undefined}
      actions={isSelectedChapter ? (
        <>
          <button type="button" className="ui-test-editor-action is-icon-only" aria-label={chapterDeAiButtonLabel} title={`${chapterDeAiButtonLabel} · ${chapterDeAiButtonTitle}`} onClick={(event) => void openDeAiSkillPicker(null, event.currentTarget)} disabled={currentChapterDeAiProcessing || !extractDeAiChapterText(fileContent).trim()}>
            <Eraser aria-hidden="true" />
          </button>
          <button type="button" className="ui-test-editor-action is-icon-only" data-draft-memory-target="" aria-label={isFinalChapterSaving ? "正在提取记忆…" : chapterMemoryExtracted ? "重新提取记忆" : "提取记忆"} title={isFinalChapterSaving ? "正在提取记忆…" : chapterMemoryExtracted ? "重新提取记忆" : "提取记忆"} onClick={() => void (alreadyFinal ? handleReingest() : handleSaveAsFinal({ thenExtract: true }))} disabled={!canSaveAsFinal || isFinalChapterSaving}>
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

            ⚠️ 位置：**整排最右**（用户要求「将章节细纲移动到最右侧」）。
            改造前它排在「字体设置」之后、「一键排版」之前，也就是夹在两组之间；
            用户要求把它拎到最右，因此现在排在「一键排版」之后。

            `data-event-outline-target` 是**丙-4a 的锚点属性**，供
            `withAnchoredHint`（ui-test-editor.tsx）把灵感气泡挂在这枚按钮旁。
            ⚠️ 不能复用 `data-draft-memory-target`：那会让草稿提示的遍历
            同时命中两枚按钮、把两枚都包起来。
          */}
          {canFormatWriting ? <button type="button" className="ui-test-editor-action is-icon-only" aria-label="一键排版" title="一键排版" onClick={() => void handleFormatWriting()}><WandSparkles aria-hidden="true" /></button> : null}
          <button type="button" className="ui-test-editor-action is-icon-only" data-event-outline-target="" aria-label="生成章节细纲" title="生成章节细纲" onClick={handleOpenEventOutlineWizard}>
            <Lightbulb aria-hidden="true" />
          </button>
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
          /*
           * 章节正文编辑器**就是这一个**。
           *
           * `useUiTestEditor` 对 chapter 恒为真，所以下面
           * `uiTestEditorElement ? … : …` 的三元永远走 `uiTestEditorElement`，
           * 那个「普通分支」里的 WikiEditor 对章节
           * 根本不会渲染。续写最初只接在那边，结果右键菜单里能看到「续写」，
           * 点了却没反应（wiki-editor 的 continue 分支拿不到回调就直接 return），
           * 浮层工具栏也长不出「续写」—— 整条链是死代码。
           *
           * ⚠️ 这里**不写行号**：合并会让行号漂移，写死的数字会变成假线索
           * （曾写作「:2036」「:2133」，合并后分别落到 :2752 / :3007）。
           *
           * 这一行同时也是 AI润色 / 去AI味 之所以能用、而续写当初不能的原因：
           * onSelectionAction 一直在这里传着。
           */
          onContinuationRequest={isSelectedChapter ? handleContinuationRequest : undefined}
          caretRequest={isSelectedChapter ? continuationCaretRequest : null}
          onCaretHandled={() => setContinuationCaretRequest(null)}
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
                  onContinuationRequest={isChapterPath(selectedFile) ? handleContinuationRequest : undefined}
                  caretRequest={isChapterPath(selectedFile) ? continuationCaretRequest : null}
                  onCaretHandled={() => setContinuationCaretRequest(null)}
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
              onContinuationRequest={isChapterPath(selectedFile) ? handleContinuationRequest : undefined}
              caretRequest={isChapterPath(selectedFile) ? continuationCaretRequest : null}
              onCaretHandled={() => setContinuationCaretRequest(null)}
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
      {continuationOpen && continuationAnchor ? (
        <ContinuationPopover
          phase={continuationPhase}
          position={clampContinuationPopoverPosition(
            { x: continuationAnchor.x, y: continuationAnchor.y },
            { width: window.innerWidth, height: window.innerHeight },
            { width: CONTINUATION_POPOVER_WIDTH, height: CONTINUATION_POPOVER_MAX_HEIGHT },
          )}
          instruction={continuationInstruction}
          candidate={continuationCandidate}
          errorMessage={continuationError}
          truncated={continuationTruncated}
          onInstructionChange={setContinuationInstruction}
          onStart={() => void runContinuation()}
          onInsert={handleInsertContinuation}
          onRegenerate={() => void runContinuation()}
          onStop={() => continuationAbortRef.current?.abort()}
          onClose={handleCloseContinuation}
        />
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
        向导挂在章节区而不是大纲面板：入口就在这一章的工具栏上。
        ⚠️ 但**生成的落点不在这里** —— 提交后请求进 AI 对话、结果在对话框里显示
        （用户口径：「点击该图标后，内容直接在 AI 对话中发送，随后生成的内容在
        AI 对话框中显示」）。所以本次改动的重点是删掉原先那张就地渲染的细纲卡片，
        而不是继续往章节区里塞内容。
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
