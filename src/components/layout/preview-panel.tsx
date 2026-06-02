import { Suspense, lazy, useEffect, useCallback, useRef, useMemo, useState, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { Check, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import type { FinalChapterSavePhase } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { deleteFile, fileExists, readFile, writeFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { getFileCategory, isBinary } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { WikiReader } from "@/components/editor/wiki-reader"
import { FilePreview } from "@/components/editor/file-preview"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildChapterEditorHeader } from "@/lib/chapter-editor-header"
import { isChapterPage, isFinalChapter, parseChapterMeta, updateChapterStatus } from "@/lib/novel/chapter-meta"
import { resolveReviewModel } from "@/lib/novel/review-model"
import { CognitionPanel } from "@/components/novel/cognition-panel"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getNextChatExpanded } from "./chat-layout"
import { DeAiPreviewDialog } from "@/components/novel/de-ai-preview-dialog"
import { TextTransformPreviewDialog } from "@/components/novel/text-transform-preview-dialog"
import { buildDeAiRewriteMessages } from "@/lib/novel/de-ai-adapter"
import { startOutlineIngestTask } from "@/lib/novel/outline-generation"
import { streamChat } from "@/lib/llm-client"
import { makeChapterFileName, makeDefaultChapterTitle } from "@/lib/wiki-filename"
import { useOutlineGenerationStore, type OutlineGenerationTask } from "@/stores/outline-generation-store"
import {
  buildPolishSelectionMessages,
  rebuildChapterBody,
  replaceChapterBodySelection,
  replaceWholeChapterBody,
  splitChapterHeading,
  type ChapterBodySelection,
  type ChapterSelectionAction,
} from "@/lib/chapter-selection"

const SnapshotViewer = lazy(async () => {
  const mod = await import("@/components/novel/snapshot-viewer")
  return { default: mod.SnapshotViewer }
})

function inferEditorMode(path: string): "read" | "edit" {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.includes("/wiki/chapters/") || normalized.includes("/wiki/outlines/")) {
    return "edit"
  }
  return "read"
}

function isChapterPath(path: string): boolean {
  return path.replace(/\\/g, "/").includes("/wiki/chapters/")
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

function extractChapterNumberFromMarkdown(markdown: string): number | null {
  const { frontmatter } = parseFrontmatter(markdown)
  if (!frontmatter || typeof frontmatter !== "object") return null
  return parseChapterMeta(frontmatter as Record<string, unknown>)?.chapterNumber ?? null
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
  return formatWritingBodyWithIndent(syncChapterFrontmatterTitle(markdown))
}

function updateChapterHeading(markdown: string, nextTitle: string): string {
  const { rawBlock, body } = parseFrontmatter(markdown)
  const normalizedTitle = nextTitle.trim()
  const bodyWithoutHeading = body.replace(/^#\s+.+$(\r?\n)?/m, "").replace(/^\n+/, "")
  const nextBody = normalizedTitle
    ? `# ${normalizedTitle}${bodyWithoutHeading ? `\n\n${bodyWithoutHeading}` : "\n"}`
    : bodyWithoutHeading
  return rawBlock + nextBody
}

function syncChapterFrontmatterTitle(markdown: string): string {
  const { rawBlock, body, frontmatter } = parseFrontmatter(markdown)
  if (!rawBlock || !frontmatter) return markdown
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (!heading) return markdown
  const fmTitle = typeof (frontmatter as Record<string, unknown>).title === "string"
    ? String((frontmatter as Record<string, unknown>).title).trim()
    : ""
  if (!fmTitle || fmTitle === heading) return markdown
  const escaped = heading.replace(/"/g, '\\"')
  const nextRaw = rawBlock.replace(/^title:\s*.*$/m, `title: "${escaped}"`)
  return nextRaw + body
}

function getChapterTitleFromPath(path: string): string {
  const fileName = normalizePath(path).split("/").pop() ?? ""
  return fileName.replace(/\.md$/i, "").trim()
}

const CHAPTER_TITLE_MIN_WIDTH_PX = 48
const CHAPTER_TITLE_RESTING_EXTRA_WIDTH_PX = 2
const CHAPTER_TITLE_EDITING_EXTRA_WIDTH_PX = 16

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
  const finalChapterSave = useWikiStore((s) => s.finalChapterSave)
  const setFinalChapterSave = useWikiStore((s) => s.setFinalChapterSave)
  const outlineTasks = useOutlineGenerationStore((s) => s.tasks)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isSavingFinal, setIsSavingFinal] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string>("")
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [showOutlineSnapshot, setShowOutlineSnapshot] = useState(false)
  const [outlineSnapshotNumber, setOutlineSnapshotNumber] = useState<number | null>(null)
  const [outlineIngested, setOutlineIngested] = useState(false)
  const [showCognition, setShowCognition] = useState(false)
  const [deAiProcessing, setDeAiProcessing] = useState(false)
  const [deAiPreviewOpen, setDeAiPreviewOpen] = useState(false)
  const [deAiSourceContent, setDeAiSourceContent] = useState("")
  const [deAiCandidateContent, setDeAiCandidateContent] = useState("")
  const [selectionTransformOpen, setSelectionTransformOpen] = useState(false)
  const [selectionTransformAction, setSelectionTransformAction] = useState<ChapterSelectionAction | null>(null)
  const [selectionTransformSelection, setSelectionTransformSelection] = useState<ChapterBodySelection | null>(null)
  const [selectionTransformSourceContent, setSelectionTransformSourceContent] = useState("")
  const [selectionTransformCandidateContent, setSelectionTransformCandidateContent] = useState("")
  const [chapterTitleDraft, setChapterTitleDraft] = useState("")
  const [chapterTitleEditing, setChapterTitleEditing] = useState(false)
  const [chapterTitleWidthPx, setChapterTitleWidthPx] = useState(CHAPTER_TITLE_MIN_WIDTH_PX)
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")
  const fileContentRef = useRef(fileContent)
  const selectedFileRef = useRef<string | null>(selectedFile)
  const titleMeasureRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    fileContentRef.current = fileContent
  }, [fileContent])

  const syncChapterToCanonicalPath = useCallback(async (path: string, markdown: string) => {
    const normalized = normalizeChapterWriting(markdown)
    const chapterNumber = extractChapterNumberFromMarkdown(normalized)
    const targetPath = await getCanonicalChapterPath(path, normalized, chapterNumber)

    await writeFile(targetPath, normalized)
    if (targetPath !== path) {
      await deleteFile(path)
      if (project) {
        try {
          const tree = await listDirectory(normalizePath(project.path))
          setFileTree(tree)
        } catch {
          // non-critical tree refresh
        }
      }
      if (useWikiStore.getState().selectedFile === path) {
        selectedFileRef.current = targetPath
        useWikiStore.getState().setSelectedFile(targetPath)
      }
    }

    if (useWikiStore.getState().selectedFile === targetPath) {
      setFileContent(normalized)
      fileContentRef.current = normalized
      lastLoadedRef.current = normalized
    }

    bumpDataVersion()
    return { targetPath, markdown: normalized }
  }, [project, setFileContent, setFileTree, bumpDataVersion])

  const flushChapterBeforeLeave = useCallback(async (path: string | null, markdown: string) => {
    if (!path || !isChapterPath(path)) return
    if (finalChapterSave?.saving && finalChapterSave.filePath === path) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (markdown === lastLoadedRef.current) return
    try {
      await syncChapterToCanonicalPath(path, markdown)
    } catch (err) {
      console.error("切换章节前同步文件失败:", err)
    }
  }, [syncChapterToCanonicalPath, finalChapterSave])

  useEffect(() => {
    let cancelled = false
    const previousFile = selectedFileRef.current
    const previousContent = fileContentRef.current
    if (previousFile && previousFile !== selectedFile && isChapterPath(previousFile)) {
      void flushChapterBeforeLeave(previousFile, previousContent)
    }
    selectedFileRef.current = selectedFile
    setSelectionTransformOpen(false)
    setDeAiPreviewOpen(false)
    setLoadedFilePath(null)

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
    lastLoadedRef.current = ""
    setSaveStatus("")

    readFile(selectedFile)
      .then((content) => {
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        lastLoadedRef.current = content
        setFileContent(content)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
      })
      .catch((err) => {
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        lastLoadedRef.current = ""
        setFileContent(`Error loading file: ${err}`)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFile, setFileContent, flushChapterBeforeLeave])

  useEffect(() => {
    return () => {
      const currentFile = selectedFileRef.current
      if (currentFile && isChapterPath(currentFile)) {
        void flushChapterBeforeLeave(currentFile, fileContentRef.current)
      }
    }
  }, [flushChapterBeforeLeave])

  const handleSave = useCallback(
    (markdown: string) => {
      if (!selectedFile) return
      const normalized = isChapterPath(selectedFile)
        ? normalizeChapterWriting(markdown)
        : markdown
      setFileContent(normalized)
      fileContentRef.current = normalized
      // Ignore no-op saves from the editor's initial re-emit. Only write
      // when the user has actually changed the content relative to the
      // last disk read.
      if (normalized === lastLoadedRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        writeFile(selectedFile, normalized)
          .then(() => {
            // Our own write becomes the new "last loaded" — subsequent
            // re-emits from Milkdown that match this content must not
            // trigger another save.
            lastLoadedRef.current = normalized
            bumpDataVersion()
          })
          .catch((err) => console.error("保存失败:", err))
      }, 1000)
    },
    [selectedFile, setFileContent, bumpDataVersion]
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

  // 检测大纲是否已经提取过初始记忆（持久化状态）
  useEffect(() => {
    if (!canIngestOutline || !project || !selectedFile) {
      setOutlineIngested(false)
      setOutlineSnapshotNumber(null)
      return
    }
    const normalizedOutlinePath = normalizePath(selectedFile)
    const fileName = normalizedOutlinePath.split("/").pop() ?? "outline"
    const outlineName = fileName.replace(/\.\w+$/, "")
    let hash = 0
    for (let i = 0; i < outlineName.length; i++) {
      hash = ((hash << 5) - hash + outlineName.charCodeAt(i)) | 0
    }
    const outlineNum = -(Math.abs(hash % 999) + 1)
    setOutlineSnapshotNumber(outlineNum)
    const prefix = `outline-${String(Math.abs(outlineNum)).padStart(3, "0")}`
    const jsonPath = `${normalizePath(project.path)}/.novel/snapshots/${prefix}.snapshot.json`
    fileExists(jsonPath).then((exists) => setOutlineIngested(exists)).catch(() => setOutlineIngested(false))
  }, [canIngestOutline, project, selectedFile])
  useEffect(() => {
    if (!canIngestOutline) return
    if (!currentOutlineTask?.message) return
    setSaveStatus(currentOutlineTask.message)
  }, [canIngestOutline, currentOutlineTask])
  const chapterNumber = useMemo(() => {
    if (!chapterFrontmatter) return null
    const meta = parseChapterMeta(chapterFrontmatter)
    return meta?.chapterNumber ?? null
  }, [chapterFrontmatter])
  const canViewSnapshot = Boolean(novelMode && project && chapterNumber !== null)
  const currentFinalChapterSave = finalChapterSave != null && finalChapterSave.projectPath === project?.path && finalChapterSave.filePath === selectedFile ? finalChapterSave : null
  const isFinalChapterSaving = currentFinalChapterSave?.saving ?? isSavingFinal
  const isOutlineIngesting = currentOutlineTask?.status === "ingesting"

  const phaseLabelMap: Record<FinalChapterSavePhase, string> = {
    saving: t("novel.chapter.savingAsFinal"),
    reviewing: t("novel.chapter.reviewInProgress"),
    saved: t("novel.chapter.savedAsFinal"),
    ingested: t("novel.chapter.ingestSuccess"),
    blocked_by_review: t("novel.chapter.reviewBlockedWithErrors"),
    ingest_failed: t("novel.chapter.ingestFailedRetry"),
    ingest_no_llm: t("novel.chapter.ingestNoLlmKey"),
    ingest_no_chapter_number: "章节已保存为正式章节，但快照生成失败：章节编号无效。请在章节2栏中重命名章节以修正编号。",
    ingest_not_final: "章节已保存为正式章节，但快照生成失败：章节状态异常，请检查章节是否正确标记为终稿。",
    ingest_extract_failed: "章节已保存为正式章节，但快照生成失败：LLM 生成超时或返回格式错误，请重试。",
    review_warnings: t("novel.chapter.reviewWarningsButProceeding"),
    review_failed_proceed: t("novel.chapter.reviewFailedProceeding"),
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
  const chapterDisplayTitle = chapterHeader
    ? chapterHeader.heading || (selectedFile ? getChapterTitleFromPath(selectedFile) : "")
    : ""
  const chapterTitleMeasureText = (() => {
    const text = chapterTitleEditing ? chapterTitleDraft : chapterDisplayTitle
    return text || chapterDisplayTitle || chapterTitleDraft || "\u00A0"
  })()
  const chapterStatusMeta = chapterHeader ? (
    chapterHeader.status === "final" ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium leading-5 text-emerald-700 dark:text-emerald-300">
        <Check className="h-3 w-3" />
        <span>{chapterHeader.statusLabel}</span>
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

  const normalizeChapterTitleInput = useCallback((title: string) => {
    const trimmed = title.trim()
    if (chapterNumber !== null) {
      return makeDefaultChapterTitle(chapterNumber, trimmed)
    }
    return trimmed
  }, [chapterNumber])

  const commitChapterTitleDraft = useCallback(async () => {
    if (!selectedFile || !isChapterPath(selectedFile) || !chapterHeader) return
    const normalizedTitle = normalizeChapterTitleInput(chapterTitleDraft)
    const fallbackTitle = chapterDisplayTitle || (chapterNumber !== null ? makeDefaultChapterTitle(chapterNumber) : "")
    const nextTitle = normalizedTitle || fallbackTitle
    setChapterTitleDraft(nextTitle)
    setChapterTitleEditing(false)
    if (nextTitle === chapterDisplayTitle) return
    try {
      await syncChapterToCanonicalPath(selectedFile, updateChapterHeading(fileContent, nextTitle))
    } catch (error) {
      console.error("章节标题同步失败:", error)
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
  ])

  const cancelChapterTitleEditing = useCallback(() => {
    setChapterTitleDraft(chapterDisplayTitle)
    setChapterTitleEditing(false)
  }, [chapterDisplayTitle])

  const handleSaveAsFinal = useCallback(async () => {
    if (!project || !selectedFile || !chapterFrontmatter) return

    let savePath = selectedFile
    const projectPath = project.path
    const updatePhase = (saving: boolean, phase: FinalChapterSavePhase | null, params?: Record<string, string | number>) => {
      setFinalChapterSave({ projectPath, filePath: savePath, saving, phase: phase ?? null, params })
    }

    setIsSavingFinal(true)
    updatePhase(true, "saving")

    const novelConfig = useWikiStore.getState().novelConfig

    if (novelConfig.reviewBeforeSave) {
      updatePhase(true, "reviewing")
      try {
        const chapterNumber = chapterFrontmatter.chapterNumber as number | undefined
        const { reviewChapter } = await import("@/lib/novel/review-adapter")
        const results = await reviewChapter(project.path, fileContent, chapterNumber)
        if (results.length > 0) {
          const reviewStore = useReviewStore.getState()
          reviewStore.addNovelReviewEntry({
            id: `chapter-${chapterNumber}-${Date.now()}`,
            chapterNumber: chapterNumber ?? 0,
            results,
            createdAt: new Date().toISOString(),
            resolved: false,
          })
        }
        const errors = results.filter(r => r.severity === "error")
        const warnings = results.filter(r => r.severity === "warning")

        if (errors.length > 0) {
          updatePhase(false, "blocked_by_review", { count: errors.length, warnings: warnings.length })
          setIsSavingFinal(false)
          return
        }

        if (warnings.length > 0) {
          updatePhase(true, "review_warnings", { count: warnings.length })
        }
      } catch {
        updatePhase(true, "review_failed_proceed")
      }
    }

    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      const updatedMarkdown = updateChapterStatus(fileContent, "final")
      const syncResult = await syncChapterToCanonicalPath(selectedFile, updatedMarkdown)
      const targetPath = syncResult.targetPath
      savePath = targetPath
      lastLoadedRef.current = syncResult.markdown
      setFileContent(syncResult.markdown)

      if (novelConfig.autoIngestOnSave) {
        const llmConfig = useWikiStore.getState().llmConfig
        if (!hasUsableLlm(llmConfig)) {
          updatePhase(false, "ingest_no_llm")
        } else {
          const verifyContent = await readFile(targetPath)
          const verifyParsed = parseFrontmatter(verifyContent)
          const verifyFm = verifyParsed.frontmatter as Record<string, unknown> | null
          if (!verifyFm || !isFinalChapter(verifyFm)) {
            await writeFile(targetPath, syncResult.markdown)
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
          const result = await ingestChapter(project.path, targetPath, resolveReviewModel())
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
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, fileContent, project, selectedFile, setFileContent, setFinalChapterSave, t, syncChapterToCanonicalPath])

  const handleReingest = useCallback(async () => {
    if (!project || !selectedFile || !chapterFrontmatter) return
    if (!isFinalChapter(chapterFrontmatter)) {
      setSaveStatus(t("novel.chapter.reingestNotFinal"))
      return
    }
    setFinalChapterSave(null)
    setIsSavingFinal(true)
    setSaveStatus("")
    try {
      const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
      const result = await ingestChapter(project.path, selectedFile, resolveReviewModel())
      if (result.snapshot) {
        setSaveStatus(t("novel.chapter.ingestSuccess", { chapter: result.snapshot.chapterNumber }))
      } else if (result.failReason === "invalid_chapter_number") {
        setSaveStatus("快照生成失败：章节编号无效，请检查章节的 chapter_number 设置")
      } else {
        setSaveStatus(t("novel.chapter.ingestFailedRetry"))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveStatus(t("novel.chapter.ingestError", { message }))
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, project, selectedFile, setFinalChapterSave, t])

  const handleFormatWriting = useCallback(async () => {
    if (!selectedFile || !canFormatWriting) return
    const formatted = normalizeChapterWriting(fileContent)
    setFileContent(formatted)
    lastLoadedRef.current = formatted
    try {
      await writeFile(selectedFile, formatted)
      bumpDataVersion()
    } catch (err) {
      console.error("格式化写作内容失败:", err)
    }
  }, [canFormatWriting, fileContent, selectedFile, setFileContent, bumpDataVersion])

  const handleIngestOutline = useCallback(() => {
    if (!project || !selectedFile || !canIngestOutline || isOutlineIngesting) return
    setSaveStatus("")
    startOutlineIngestTask(project.path, selectedFile)
  }, [canIngestOutline, isOutlineIngesting, project, selectedFile])

  const handleDeAiProcess = useCallback(async () => {
    if (!fileContent.trim()) return
    setDeAiProcessing(true)
    const llmConfig = useWikiStore.getState().llmConfig
    if (!hasUsableLlm(llmConfig)) {
      setDeAiProcessing(false)
      return
    }
    const source = fileContent
    let result = ""
    try {
      await streamChat(
        llmConfig,
        buildDeAiRewriteMessages(source),
        {
          onToken: (token) => {
            result += token
          },
          onDone: () => {
            setDeAiSourceContent(source)
            setDeAiCandidateContent(result)
            setDeAiPreviewOpen(true)
            setDeAiProcessing(false)
          },
          onError: (error) => {
            console.error("去AI味处理失败:", error)
            setDeAiProcessing(false)
          },
        },
      )
    } catch (err) {
      console.error("去AI味处理失败:", err)
      setDeAiProcessing(false)
    }
  }, [fileContent])

  const handleDeAiApply = useCallback(() => {
    setDeAiPreviewOpen(false)
    handleSave(replaceWholeChapterBody(fileContent, deAiCandidateContent))
  }, [deAiCandidateContent, fileContent, handleSave])

  const handleDeAiSaveDraft = useCallback(async () => {
    if (!selectedFile || !project) return
    const normalizedPath = selectedFile.replace(/\\/g, "/")
    const dir = normalizedPath.substring(0, normalizedPath.lastIndexOf("/") + 1)
    const fileName = normalizedPath.split("/").pop() || "file"
    const baseName = fileName.replace(/\.md$/, "")
    const draftPath = normalizePath(`${dir}${baseName}-去AI味稿.md`)
    try {
      await writeFile(draftPath, deAiCandidateContent)
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
      bumpDataVersion()
      setDeAiPreviewOpen(false)
    } catch (err) {
      console.error("另存去AI味草稿失败:", err)
    }
  }, [selectedFile, project, deAiCandidateContent, setFileTree, bumpDataVersion])

  const handleDeAiClose = useCallback(() => {
    setDeAiPreviewOpen(false)
  }, [])

  const handleSelectionAction = useCallback(async (action: ChapterSelectionAction, selection: ChapterBodySelection) => {
    if (!selection.text.trim()) return
    const llmConfig = useWikiStore.getState().llmConfig
    if (!hasUsableLlm(llmConfig)) {
      setSaveStatus("未配置可用的 AI 模型，无法处理选中文本")
      return
    }

    const actionFile = selectedFileRef.current
    const actionLabel = action === "polish" ? "AI润色" : "去AI味"
    setSaveStatus(`${actionLabel}处理中...`)

    let result = ""
    try {
      await streamChat(
        llmConfig,
        action === "polish"
          ? buildPolishSelectionMessages(selection.text)
          : buildDeAiRewriteMessages(selection.text),
        {
          onToken: (token) => {
            result += token
          },
          onDone: () => {
            if (selectedFileRef.current !== actionFile) return
            setSelectionTransformAction(action)
            setSelectionTransformSelection(selection)
            setSelectionTransformSourceContent(selection.text)
            setSelectionTransformCandidateContent(result)
            setSelectionTransformOpen(true)
            setSaveStatus("")
          },
          onError: (error) => {
            if (selectedFileRef.current !== actionFile) return
            console.error(`${actionLabel}失败:`, error)
            setSaveStatus(`${actionLabel}失败：${error.message}`)
          },
        },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (selectedFileRef.current !== actionFile) return
      console.error(`${actionLabel}失败:`, err)
      setSaveStatus(`${actionLabel}失败：${message}`)
    }
  }, [])

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

    handleSave(rawBlock + rebuildChapterBody(heading, replaced.body))
    setSelectionTransformOpen(false)
    setSelectionTransformAction(null)
    setSelectionTransformSelection(null)
    setSelectionTransformSourceContent("")
    setSelectionTransformCandidateContent("")
    setSaveStatus("")
  }, [fileContent, handleSave, selectionTransformCandidateContent, selectionTransformSelection])

  const handleCloseSelectionTransform = useCallback(() => {
    setSelectionTransformOpen(false)
    setSelectionTransformAction(null)
    setSelectionTransformSelection(null)
    setSelectionTransformSourceContent("")
    setSelectionTransformCandidateContent("")
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
                  {t("trash.deletedItem", { defaultValue: "已删除项目" })} · {selectedTrashItem.kind === "chapter" ? t("trash.kindChapter", { defaultValue: "章节" }) : selectedTrashItem.kind === "outline" ? t("trash.kindOutline", { defaultValue: "大纲" }) : selectedTrashItem.kind === "history" ? t("trash.kindHistory", { defaultValue: "历史记录" }) : t("trash.kindPage", { defaultValue: "页面" })}
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
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("preview.empty")}
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const activeHighlightRequest = pendingEditorHighlight?.path === selectedFile ? pendingEditorHighlight : null

  if (loadedFilePath !== selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("preview.loading", { defaultValue: "正在加载..." })}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 shrink items-center gap-1 overflow-hidden">
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
                  className="max-w-full shrink border-0 bg-transparent p-0 text-2xl font-bold leading-10 text-foreground outline-none"
                  style={{ width: `${chapterTitleWidthPx}px`, fontFamily: "inherit" }}
                  spellCheck={false}
                />
                {chapterMeta}
              </>
            ) : null}
          </div>
          <div className="ml-auto flex items-center justify-end gap-1">
          {chapterHeader ? (
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
          {chapterHeader ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => void handleDeAiProcess()}
                disabled={deAiProcessing}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deAiProcessing ? "处理中" : "去AI味"}
              </button>
            </div>
          ) : null}
          {canIngestOutline ? (
            <button
              type="button"
              onClick={() => void handleIngestOutline()}
              disabled={isOutlineIngesting}
              className={`shrink-0 rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                outlineIngested
                  ? "border-emerald-500/50 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                  : "border-border text-foreground hover:bg-accent"
              }`}
              title={outlineIngested ? "重新提取初始记忆（将覆盖上次提取的内容）" : t("novel.outlineGenerator.ingest")}
            >
              {isOutlineIngesting ? t("novel.outlineGenerator.ingesting") : outlineIngested ? "✓ 已提取记忆" : t("novel.outlineGenerator.ingest")}
            </button>
          ) : null}
          {canIngestOutline && outlineIngested && outlineSnapshotNumber !== null ? (
            <button
              type="button"
              onClick={() => setShowOutlineSnapshot(true)}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title="查看该大纲提取的快照详情"
            >
              查看快照
            </button>
          ) : null}
          {canSaveAsFinal && !alreadyFinal ? (
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
          {canSaveAsFinal && alreadyFinal ? (
            <button
              type="button"
              onClick={() => void handleReingest()}
              disabled={isSavingFinal}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t("preview.reingestTitle")}
            >
              {isSavingFinal ? t("novel.chapter.savingAsFinal") : t("novel.chapter.reingestButton")}
            </button>
          ) : null}
          {canFormatWriting ? (
            <button
              type="button"
              onClick={() => void handleFormatWriting()}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title={t("preview.formatWritingTitle", { defaultValue: "自动整理正文段落格式，并为段落添加首行缩进" })}
            >
              {t("preview.formatWriting", { defaultValue: "一键排版" })}
            </button>
          ) : null}
          {canViewSnapshot ? (
            <button
              type="button"
              onClick={() => setShowSnapshot(true)}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title={t("preview.snapshotTitle")}
            >
              {t("novel.snapshot.viewButton")}
            </button>
          ) : null}
          {novelMode && project ? (
            <button
              type="button"
              onClick={() => setShowCognition(true)}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
              title={t("preview.cognitionTitle")}
            >
              {t("novel.cognition.title")}
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
            <span className="block truncate text-[11px] text-muted-foreground/80">
              {visibleSaveStatus}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {category === "markdown" ? (
          <WikiEditor
            key={selectedFile}
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
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
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
      <DeAiPreviewDialog
        open={deAiPreviewOpen}
        sourceContent={deAiSourceContent}
        candidateContent={deAiCandidateContent}
        onApply={handleDeAiApply}
        onSaveDraft={() => void handleDeAiSaveDraft()}
        onClose={handleDeAiClose}
      />
      <TextTransformPreviewDialog
        open={selectionTransformOpen}
        title={selectionTransformAction === "polish" ? "AI润色预览" : "去AI味预览"}
        description="确认后会替换当前选中的正文片段。"
        sourceLabel="原文片段"
        candidateLabel={selectionTransformAction === "polish" ? "润色结果" : "去AI味结果"}
        sourceContent={selectionTransformSourceContent}
        candidateContent={selectionTransformCandidateContent}
        applyLabel="替换选中文本"
        onApply={handleApplySelectionTransform}
        onClose={handleCloseSelectionTransform}
      />
    </div>
  )
}
