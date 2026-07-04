import { type CSSProperties, Suspense, lazy, useEffect, useCallback, useRef, useMemo, useState, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { Check, MoreHorizontal, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel, resolveNovelModel } from "@/lib/novel/model-resolver"
import type { FinalChapterSavePhase } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { deleteFile, fileExists, readFile, writeFile, writeFileAtomic, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { getFileCategory, isBinary } from "@/lib/file-types"
import { WikiEditor, type WikiEditorHandle } from "@/components/editor/wiki-editor"
import { WikiReader } from "@/components/editor/wiki-reader"
import { FilePreview } from "@/components/editor/file-preview"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildChapterEditorHeader } from "@/lib/chapter-editor-header"
import { isChapterPage, isFinalChapter, parseChapterMeta, syncChapterFrontmatterFromBody, updateChapterStatus, updateChapterTitle } from "@/lib/novel/chapter-meta"
import { resolveReviewModel } from "@/lib/novel/review-model"
import { CognitionPanel } from "@/components/novel/cognition-panel"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getNextChatExpanded } from "./chat-layout"
import { DeAiPreviewDialog } from "@/components/novel/de-ai-preview-dialog"
import { TextTransformPreviewDialog } from "@/components/novel/text-transform-preview-dialog"
import { DeAiSkillOptionsPanel } from "@/components/skill-library/de-ai-skill-picker"
import { useDeAiSkillOptions } from "@/components/skill-library/use-de-ai-skill-options"
import { buildDeAiRewriteMessages } from "@/lib/novel/de-ai-adapter"
import {
  loadDeAiSkillConfig,
  resolveEffectiveDeAiSkill,
  saveDeAiSkillConfig,
  setLastChapterDeAiSkill,
} from "@/lib/novel/de-ai-skill-library"
import { startOutlineIngestTask } from "@/lib/novel/outline-generation"
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
  rebuildChapterBody,
  replaceChapterBodySelection,
  replaceWholeChapterBody,
  splitChapterHeading,
  type ChapterBodySelection,
  type ChapterSelectionAction,
} from "@/lib/chapter-selection"
import { shouldApplyDiskToEditor } from "@/lib/editor-disk-sync"
import { registerEditorDiskSyncHandler } from "@/lib/editor-disk-sync-session"

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

function getDeAiSkillPickerPosition(anchor?: HTMLElement | null): CSSProperties {
  if (!anchor) return { right: 24, top: 80 }
  const rect = anchor.getBoundingClientRect()
  const gap = 8
  const viewportWidth = window.innerWidth || DE_AI_SKILL_PICKER_WIDTH_PX
  const left = Math.min(
    Math.max(rect.left, gap),
    Math.max(gap, viewportWidth - DE_AI_SKILL_PICKER_WIDTH_PX - gap),
  )
  return {
    left,
    top: rect.bottom + gap,
  }
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
  const finalChapterSave = useWikiStore((s) => s.finalChapterSave)
  const setFinalChapterSave = useWikiStore((s) => s.setFinalChapterSave)
  const outlineTasks = useOutlineGenerationStore((s) => s.tasks)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGenerationRef = useRef(0)
  const wikiEditorRef = useRef<WikiEditorHandle>(null)
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
  const [deAiSkillName, setDeAiSkillName] = useState("")
  const [deAiSkillMemoryWarning, setDeAiSkillMemoryWarning] = useState("")
  const [selectionTransformOpen, setSelectionTransformOpen] = useState(false)
  const [selectionTransformAction, setSelectionTransformAction] = useState<ChapterSelectionAction | null>(null)
  const [selectionTransformSelection, setSelectionTransformSelection] = useState<ChapterBodySelection | null>(null)
  const [selectionTransformSourceContent, setSelectionTransformSourceContent] = useState("")
  const [selectionTransformCandidateContent, setSelectionTransformCandidateContent] = useState("")
  const [selectionTransformSkillName, setSelectionTransformSkillName] = useState("")
  const [deAiSkillPickerOpen, setDeAiSkillPickerOpen] = useState(false)
  const [deAiSkillPickerPosition, setDeAiSkillPickerPosition] = useState<CSSProperties>(() => getDeAiSkillPickerPosition())
  const [chapterDeAiSkillId, setChapterDeAiSkillId] = useState<string | null | undefined>(undefined)
  const [pendingSelectionForDeAi, setPendingSelectionForDeAi] = useState<ChapterBodySelection | null>(null)
  const [chapterTitleDraft, setChapterTitleDraft] = useState("")
  const [chapterTitleEditing, setChapterTitleEditing] = useState(false)
  const [chapterTitleWidthPx, setChapterTitleWidthPx] = useState(CHAPTER_TITLE_MIN_WIDTH_PX)
  const [chapterToolbarCompact, setChapterToolbarCompact] = useState(true)
  const [chapterToolbarMoreOpen, setChapterToolbarMoreOpen] = useState(false)
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)
  const [diskSyncEpoch, setDiskSyncEpoch] = useState(0)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")
  const lastLoadedByPathRef = useRef<Map<string, string>>(new Map())
  const fileContentRef = useRef(fileContent)
  const selectedFileRef = useRef<string | null>(selectedFile)
  const deAiSkillMemoryWarningRef = useRef("")
  const deAiSkillPickerRef = useRef<HTMLDivElement | null>(null)
  const chapterToolbarRef = useRef<HTMLDivElement | null>(null)
  const titleMeasureRef = useRef<HTMLSpanElement | null>(null)
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
  }, [])

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
      setFileContent(diskContent)
      setDiskSyncEpoch((epoch) => epoch + 1)
    }
    return true
  }, [rememberLoadedChapter, setFileContent])

  const syncDiskBeforeAction = useCallback(async () => {
    const path = selectedFileRef.current
    if (!path) return
    await applyDiskSyncIfSafe(path)
  }, [applyDiskSyncIfSafe])

  useEffect(() => {
    registerEditorDiskSyncHandler(applyDiskSyncIfSafe)
    return () => registerEditorDiskSyncHandler(null)
  }, [applyDiskSyncIfSafe])

  useEffect(() => {
    setChapterDeAiSkillId(undefined)
    deAiSkillMemoryWarningRef.current = ""
    setDeAiSkillMemoryWarning("")
  }, [project?.path])

  const formatDeAiStatus = useCallback((status: string) => {
    const warning = deAiSkillMemoryWarningRef.current || deAiSkillMemoryWarning
    if (!status) return warning
    return warning ? `${warning}；${status}` : status
  }, [deAiSkillMemoryWarning])

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
    options?: { renameToCanonical?: boolean },
  ) => {
    const normalized = normalizeChapterWriting(markdown)
    const chapterNumber = extractChapterNumberFromMarkdown(normalized)
    const renameToCanonical = options?.renameToCanonical ?? false
    const targetPath = renameToCanonical
      ? await getCanonicalChapterPath(path, normalized, chapterNumber)
      : path

    await writeFileAtomic(targetPath, normalized)
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
      await syncChapterToCanonicalPath(path, resolvedMarkdown, { renameToCanonical: false })
    } catch (err) {
      console.error("切换章节前同步文件失败:", err)
    }
  }, [syncChapterToCanonicalPath, finalChapterSave])

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
    setDeAiPreviewOpen(false)
    setDeAiSkillName("")
    setSelectionTransformSkillName("")
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
    setSaveStatus("")

    readFile(selectedFile)
      .then((content) => {
        console.log("[PreviewPanel][debug] readFile success", { selectedFile, contentLength: content?.length, cancelled, storeSelectedFile: useWikiStore.getState().selectedFile })
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        rememberLoadedChapter(normalizePath(selectedFile), content)
        setFileContent(content)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
      })
      .catch((err) => {
        console.log("[PreviewPanel][debug] readFile error", { selectedFile, err, cancelled, storeSelectedFile: useWikiStore.getState().selectedFile })
        if (cancelled || useWikiStore.getState().selectedFile !== selectedFile) return
        lastLoadedRef.current = ""
        lastLoadedByPathRef.current.delete(normalizePath(selectedFile))
        setFileContent(`Error loading file: ${err}`)
        setSaveStatus("")
        setLoadedFilePath(selectedFile)
      })
    return () => {
      console.log("[PreviewPanel][debug] useEffect cleanup", { selectedFile })
      cancelled = true
    }
  }, [selectedFile, rememberLoadedChapter, setFileContent, flushChapterBeforeLeave])

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
    (markdown: string) => {
      const pathAtSave = selectedFileRef.current
      if (!pathAtSave) return
      const persistedMarkdown = isChapterPath(pathAtSave)
        ? normalizeChapterWriting(markdown)
        : markdown
      setFileContent(markdown)
      fileContentRef.current = markdown
      const normalizedPath = normalizePath(pathAtSave)
      const lastLoadedForPath = lastLoadedByPathRef.current.get(normalizedPath) ?? lastLoadedRef.current
      if (persistedMarkdown === lastLoadedForPath) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const generation = saveGenerationRef.current
      saveTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            if (generation !== saveGenerationRef.current) return
            if (pathAtSave !== selectedFileRef.current) return
            if (normalizePath(pathAtSave) !== normalizedPath) return

            let diskContent: string
            try {
              diskContent = await readFile(normalizedPath)
            } catch (err) {
              console.error("保存前读取磁盘失败:", err)
              return
            }

            const currentLastLoaded = lastLoadedByPathRef.current.get(normalizedPath) ?? lastLoadedRef.current
            const normalize = getDiskSyncNormalize(normalizedPath)
            if (normalize(diskContent) !== normalize(currentLastLoaded)) {
              await applyDiskSyncIfSafe(normalizedPath)
              return
            }

            await writeFileAtomic(pathAtSave, persistedMarkdown)
            rememberLoadedChapter(normalizedPath, persistedMarkdown)
            bumpDataVersion()
          } catch (err) {
            console.error("保存失败:", err)
          } finally {
            saveTimerRef.current = null
          }
        })()
      }, 1000)
    },
    [rememberLoadedChapter, setFileContent, bumpDataVersion, applyDiskSyncIfSafe]
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
    reingesting: t("novel.chapter.savingAsFinal"),
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
  const chapterDeAiSkillName = chapterHeader ? chapterDeAiOptions.effectiveName : "未启用"
  const chapterDeAiButtonLabel = deAiProcessing ? "处理中" : (chapterDeAiSkillName === "未启用" ? "去AI味" : `去AI味：${chapterDeAiSkillName}`)
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

  const commitChapterTitleDraft = useCallback(async () => {
    if (!selectedFile || !isChapterPath(selectedFile) || !chapterHeader) return
    const normalizedTitle = normalizeChapterTitleInput(chapterTitleDraft)
    const fallbackTitle = chapterDisplayTitle || (chapterNumber !== null ? makeDefaultChapterTitle(chapterNumber) : "")
    const nextTitle = normalizedTitle || fallbackTitle
    setChapterTitleDraft(nextTitle)
    setChapterTitleEditing(false)
    if (nextTitle === chapterDisplayTitle) return
    try {
      await syncChapterToCanonicalPath(selectedFile, updateChapterTitle(fileContent, nextTitle), { renameToCanonical: true })
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

    if (novelConfig.reviewBeforeSave) {
      updatePhase(true, "reviewing")
      try {
        const chapterNumber = chapterFrontmatter.chapterNumber as number | undefined
        const { reviewChapter } = await import("@/lib/novel/review-adapter")
        const results = await reviewChapter(project.path, currentContent, chapterNumber)
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
            abortController: ingestAbortController,
          })
          const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
          const result = await ingestChapter(project.path, targetPath, resolveReviewModel(), ingestAbortController.signal, chapterFrontmatter?.chapterNumber as number | undefined)
          useImportProgressStore.getState().finishTask(ingestTaskId, result.snapshot ? "done" : "error", {
            completed: result.snapshot ? 1 : 0,
            total: 1,
            currentTitle: "",
            message: result.snapshot ? `${chapterTitle} 提取完成` : `${chapterTitle} 提取失败`,
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
    } finally {
      setIsSavingFinal(false)
    }
  }, [chapterFrontmatter, project, selectedFile, setFileContent, setFinalChapterSave, syncChapterToCanonicalPath, syncDiskBeforeAction])

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
        message: result.snapshot ? `${chapterTitle} 提取完成` : `${chapterTitle} 提取失败`,
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
        message: `${chapterTitle} 提取失败`,
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
    try {
      await writeFileAtomic(selectedFile, formatted)
      bumpDataVersion()
    } catch (err) {
      console.error("格式化写作内容失败:", err)
    }
  }, [canFormatWriting, fileContent, rememberLoadedChapter, selectedFile, setFileContent, bumpDataVersion])

  const handleIngestOutline = useCallback(() => {
    if (!project || !selectedFile || !canIngestOutline || isOutlineIngesting) return
    setSaveStatus("")
    startOutlineIngestTask(project.path, selectedFile)
  }, [canIngestOutline, isOutlineIngesting, project, selectedFile])

  const runWholeChapterDeAi = useCallback(async (skillContent: string, skillName: string) => {
    await syncDiskBeforeAction()
    const source = wikiEditorRef.current?.getCurrentMarkdown() ?? fileContentRef.current
    if (!source.trim()) return
    setDeAiProcessing(true)
    setDeAiSkillName(skillName)
    const state = useWikiStore.getState()
    const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "deAi")
    if (!hasUsableLlm(llmConfig, state.providerConfigs)) {
      setDeAiProcessing(false)
      setSaveStatus("未配置可用的 AI 模型，无法去AI味")
      return
    }
    setSaveStatus(formatDeAiStatus(`去AI味处理中，使用 Skill：${skillName}...`))
    let result = ""
    try {
      await streamChat(
        llmConfig,
        buildDeAiRewriteMessages(source, skillContent),
        {
          onToken: (token) => {
            result += token
          },
          onDone: () => {
            setDeAiSourceContent(source)
            setDeAiCandidateContent(result)
            setDeAiPreviewOpen(true)
            setDeAiProcessing(false)
            setSaveStatus(formatDeAiStatus(`本次使用 Skill：${skillName}`))
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
  }, [formatDeAiStatus, syncDiskBeforeAction])

  const handleDeAiApply = useCallback(() => {
    setDeAiPreviewOpen(false)
    setDeAiSkillName("")
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
    setDeAiSkillName("")
  }, [])

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
    setSelectionTransformSkillName(action === "de-ai" ? skillName ?? "" : "")
    const transformStatus = action === "de-ai" && skillName
      ? `${actionLabel}处理中，使用 Skill：${skillName}...`
      : `${actionLabel}处理中...`
    setSaveStatus(action === "de-ai" ? formatDeAiStatus(transformStatus) : transformStatus)

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
            setSelectionTransformAction(action)
            setSelectionTransformSelection(selection)
            setSelectionTransformSourceContent(selection.text)
            setSelectionTransformCandidateContent(result)
            setSelectionTransformSkillName(action === "de-ai" ? skillName ?? "" : "")
            setSelectionTransformOpen(true)
            setSaveStatus(formatDeAiStatus(""))
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
  }, [formatDeAiStatus, syncDiskBeforeAction])

  const openDeAiSkillPicker = useCallback((selection: ChapterBodySelection | null, anchor?: HTMLElement | null) => {
    if (deAiProcessing) return
    setPendingSelectionForDeAi(selection)
    setDeAiSkillPickerPosition(getDeAiSkillPickerPosition(anchor))
    setDeAiSkillPickerOpen(true)
    deAiSkillMemoryWarningRef.current = ""
    setDeAiSkillMemoryWarning("")
    if (chapterDeAiOptions.loadError) {
      setSaveStatus(chapterDeAiOptions.loadError)
      return
    }
    if (!chapterDeAiOptions.loading && chapterDeAiOptions.skills.length === 0) {
      setSaveStatus("暂无可用去AI味技能")
      return
    }
    setSaveStatus("")
  }, [chapterDeAiOptions.loadError, chapterDeAiOptions.loading, chapterDeAiOptions.skills.length, deAiProcessing])

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
        deAiSkillMemoryWarningRef.current = ""
        setDeAiSkillMemoryWarning("")
        bumpDataVersion()
      } catch (err) {
        console.error("保存章节去AI味 Skill 选择失败:", err)
        deAiSkillMemoryWarningRef.current = "未能记住本次去AI味 Skill 选择，本次处理仍会继续"
        setDeAiSkillMemoryWarning("未能记住本次去AI味 Skill 选择，本次处理仍会继续")
        setSaveStatus("未能记住本次去AI味 Skill 选择，本次处理仍会继续")
      }
    }

    if (selection) {
      await runSelectionTransform("de-ai", selection, skill.content, skill.name)
      return
    }
    await runWholeChapterDeAi(skill.content, skill.name)
  }, [bumpDataVersion, chapterDeAiOptions.skills, pendingSelectionForDeAi, project, runSelectionTransform, runWholeChapterDeAi])

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

    handleSave(rawBlock + rebuildChapterBody(heading, replaced.body))
    setSelectionTransformOpen(false)
    setSelectionTransformAction(null)
    setSelectionTransformSelection(null)
    setSelectionTransformSourceContent("")
    setSelectionTransformCandidateContent("")
    setSelectionTransformSkillName("")
    setSaveStatus("")
  }, [fileContent, handleSave, selectionTransformCandidateContent, selectionTransformSelection])

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
  const isSelectedChapter = isChapterPath(selectedFile)
  const activeHighlightRequest = pendingEditorHighlight?.path === selectedFile ? pendingEditorHighlight : null
  const hasChapterToolbarActions = Boolean(
    chapterHeader ||
    canIngestOutline ||
    canSaveAsFinal ||
    canFormatWriting ||
    canViewSnapshot ||
    (novelMode && project)
  )

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
        <div ref={chapterToolbarRef} className="flex min-w-0 items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
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
                      disabled={deAiProcessing}
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
                      {isOutlineIngesting ? t("novel.outlineGenerator.ingesting") : outlineIngested ? "已提取记忆" : t("novel.outlineGenerator.ingest")}
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
                  {novelMode && project ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterToolbarMoreOpen(false)
                        setShowCognition(true)
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                    >
                      {t("novel.cognition.title")}
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
                disabled={deAiProcessing}
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
              title={outlineIngested ? "重新提取初始记忆（将覆盖上次提取的内容）" : t("novel.outlineGenerator.ingest")}
            >
              {isOutlineIngesting ? t("novel.outlineGenerator.ingesting") : outlineIngested ? "✓ 已提取记忆" : t("novel.outlineGenerator.ingest")}
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
          {!chapterToolbarCompact && novelMode && project ? (
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
      <div className={getPreviewContentContainerClass(isSelectedChapter)}>
        {category === "markdown" ? (
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
            modifiedSkillIds={chapterDeAiOptions.modifiedSkillIds}
            onClose={() => {
              setDeAiSkillPickerOpen(false)
              setPendingSelectionForDeAi(null)
            }}
            onPick={(skillId) => void handlePickedDeAiSkill(skillId)}
          />
        </div>
      ) : null}
      <DeAiPreviewDialog
        open={deAiPreviewOpen}
        sourceContent={deAiSourceContent}
        candidateContent={deAiCandidateContent}
        skillName={deAiSkillName}
        onApply={handleDeAiApply}
        onSaveDraft={() => void handleDeAiSaveDraft()}
        onClose={handleDeAiClose}
      />
      <TextTransformPreviewDialog
        open={selectionTransformOpen}
        title={selectionTransformAction === "polish" ? "AI润色预览" : "去AI味预览"}
        description={selectionTransformAction === "de-ai" && selectionTransformSkillName
          ? `本次使用 Skill：${selectionTransformSkillName}。确认后会替换当前选中的正文片段。`
          : "确认后会替换当前选中的正文片段。"}
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
