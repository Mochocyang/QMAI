import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Sparkles, X } from "lucide-react"
import { listDirectory, readFile } from "@/commands/fs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import {
  CHANNELS,
  getChannelLabel,
  getMainGenreLabel,
  getMainGenresByChannel,
  getSubGenres,
} from "@/lib/novel/outline-genres"
import {
  addOutlineTaskToSourceList,
  buildOutlineGenerationPrompt,
  hasOutlineForRefinement,
  openGeneratedOutline,
  OUTLINE_SECTION_GENERATION_CONFIGS,
  runOutlineGenerationTask,
  runOutlineRefinementTask,
  runOutlineIngestTask,
  type OutlineRefinementWriteMode,
  type OutlineSectionGenerationKey,
} from "@/lib/novel/outline-generation"
import { useOutlineGenerationStore, type OutlineGenerationState, type OutlineGenerationTask } from "@/stores/outline-generation-store"
import { useWikiStore } from "@/stores/wiki-store"

const SCALE_KEYS = ["short", "medium", "long", "epic"] as const

export type OutlineGeneratorMode = "outline" | "refine"

interface OutlineFileEntry {
  path: string
  title: string
}

async function loadOutlineFileList(projectPath: string): Promise<OutlineFileEntry[]> {
  const entries: OutlineFileEntry[] = []
  try {
    const tree = await listDirectory(`${projectPath}/wiki/outlines`)
    const flattenFiles = (nodes: typeof tree): typeof tree => {
      const files: typeof tree = []
      for (const node of nodes) {
        if (node.is_dir && node.children) files.push(...flattenFiles(node.children))
        else if (!node.is_dir && node.name.endsWith(".md")) files.push(node)
      }
      return files
    }
    for (const file of flattenFiles(tree)) {
      const title = file.name.replace(/\.md$/, "").replace(/-/g, " ")
      entries.push({ path: file.path, title })
    }
  } catch { /* outlines dir may not exist */ }
  return entries
}

async function loadChapterList(projectPath: string): Promise<OutlineFileEntry[]> {
  const entries: OutlineFileEntry[] = []
  try {
    const tree = await listDirectory(`${projectPath}/wiki/chapters`)
    const flattenFiles = (nodes: typeof tree): typeof tree => {
      const files: typeof tree = []
      for (const node of nodes) {
        if (node.is_dir && node.children) files.push(...flattenFiles(node.children))
        else if (!node.is_dir && node.name.endsWith(".md")) files.push(node)
      }
      return files
    }
    const allFiles = flattenFiles(tree)
    allFiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    const last10 = allFiles.slice(-10)
    for (const file of last10) {
      const title = file.name.replace(/\.md$/, "").replace(/-/g, " ")
      entries.push({ path: file.path, title })
    }
  } catch { /* chapters dir may not exist */ }
  return entries
}

interface OutlineGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: OutlineGeneratorMode
}

export function OutlineGeneratorDialog({
  open,
  onOpenChange,
  mode,
}: OutlineGeneratorDialogProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const createTask = useOutlineGenerationStore((s: OutlineGenerationState) => s.createTask)
  const updateTask = useOutlineGenerationStore((s: OutlineGenerationState) => s.updateTask)
  const tasks = useOutlineGenerationStore((s: OutlineGenerationState) => s.tasks)

  const [channel, setChannel] = useState<"male" | "female">("male")
  const [mainGenre, setMainGenre] = useState<string>("xuanhuan")
  const [subGenres, setSubGenres] = useState<string[]>([])
  const [customTags, setCustomTags] = useState<string[]>([])
  const [customTagInput, setCustomTagInput] = useState("")
  const [scale, setScale] = useState<string>("medium")
  const [premise, setPremise] = useState("")
  const [modelId, setModelId] = useState<string>("")
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [addingToList, setAddingToList] = useState(false)
  const [ingestResult, setIngestResult] = useState<string | null>(null)
  const [refineRequest, setRefineRequest] = useState("")
  const [refineWriteMode, setRefineWriteMode] = useState<OutlineRefinementWriteMode>("newFileAndAddToList")
  const [selectedSectionKey, setSelectedSectionKey] = useState<OutlineSectionGenerationKey | null>(null)
  const [refineResult, setRefineResult] = useState<string | null>(null)
  const [checkingOutline, setCheckingOutline] = useState(false)
  const [canRefine, setCanRefine] = useState(false)
  const [outlineFiles, setOutlineFiles] = useState<OutlineFileEntry[]>([])
  const [selectedOutlineFiles, setSelectedOutlineFiles] = useState<Set<string>>(new Set())
  const [chapterFiles, setChapterFiles] = useState<OutlineFileEntry[]>([])
  const [selectedChapterFiles, setSelectedChapterFiles] = useState<Set<string>>(new Set())
  const taskKind = mode === "refine" ? "refine" : "outline"
  const selectedSectionConfig = useMemo(
    () => OUTLINE_SECTION_GENERATION_CONFIGS.find((config) => config.key === selectedSectionKey) ?? null,
    [selectedSectionKey],
  )

  const currentGenres = useMemo(() => getMainGenresByChannel(channel), [channel])
  const currentSubGenres = useMemo(
    () => getSubGenres(channel, mainGenre),
    [channel, mainGenre],
  )

  useEffect(() => {
    const genres = getMainGenresByChannel(channel)
    const firstGenre = genres[0]?.key ?? ""
    setMainGenre(firstGenre)
    setSubGenres([])
  }, [channel])

  const latestTask = useMemo(() => {
    if (!project) return null
    return tasks
      .filter((task: OutlineGenerationTask) => task.projectPath === project.path && task.kind === taskKind)
      .sort((a: OutlineGenerationTask, b: OutlineGenerationTask) => b.updatedAt - a.updatedAt)[0] ?? null
  }, [project, taskKind, tasks])

  const taskGenerating = latestTask?.status === "generating"
  const hasGeneratedOutline = Boolean(latestTask?.outlinePath)
  const isRefineMode = mode === "refine"
  const activeSectionTitle = isRefineMode ? latestTask?.displayTitle ?? selectedSectionConfig?.title ?? null : null
  const canAppendToCurrentOutline = Boolean(
    selectedFile &&
    selectedFile.replace(/\\/g, "/").endsWith(".md") &&
    selectedFile.replace(/\\/g, "/").includes("/wiki/outlines/"),
  )

  useEffect(() => {
    if (!latestTask) return
    if (latestTask.status === "error" && latestTask.error) {
      setError(latestTask.error)
    }
    if (latestTask.status === "done" || latestTask.status === "ingesting") {
      setIngestResult(latestTask.message)
    }
    if (mode === "refine" && latestTask.status === "generated") {
      setRefineResult(latestTask.message)
    }
  }, [latestTask, mode])

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelectedSectionKey(null)
    if (mode === "outline") {
      setRefineResult(null)
      return
    }
    setIngestResult(null)
  }, [mode, open])

  useEffect(() => {
    if (!open || mode !== "refine" || !project) {
      setCheckingOutline(false)
      if (!project) {
        setCanRefine(false)
      }
      return
    }

    let cancelled = false
    setCheckingOutline(true)

    void hasOutlineForRefinement(project.path)
      .then((value) => {
        if (cancelled) return
        setCanRefine(value)
      })
      .catch(() => {
        if (cancelled) return
        setCanRefine(false)
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingOutline(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [dataVersion, mode, open, project])

  useEffect(() => {
    if (!open || mode !== "refine" || !project) {
      setOutlineFiles([])
      setSelectedOutlineFiles(new Set())
      setChapterFiles([])
      setSelectedChapterFiles(new Set())
      return
    }

    let cancelled = false
    loadOutlineFileList(project.path)
      .then((entries) => {
        if (cancelled) return
        setOutlineFiles(entries)
      })
      .catch(() => {
        if (!cancelled) setOutlineFiles([])
      })
    loadChapterList(project.path)
      .then((entries) => {
        if (cancelled) return
        setChapterFiles(entries)
      })
      .catch(() => {
        if (!cancelled) setChapterFiles([])
      })

    return () => { cancelled = true }
  }, [open, mode, project])

  function handleAddCustomTag() {
    const tag = customTagInput.trim()
    if (!tag || customTags.includes(tag)) return
    setCustomTags((prev) => [...prev, tag])
    setCustomTagInput("")
  }

  function handleRemoveCustomTag(tag: string) {
    setCustomTags((prev) => prev.filter((t) => t !== tag))
  }

  function handleCustomTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAddCustomTag()
    }
  }

  async function handleGenerate() {
    if (!project || generating || taskGenerating) return

    setGenerating(true)
    setError(null)

    try {
      const channelLabel = getChannelLabel(channel)
      const mainGenreLabel = getMainGenreLabel(channel, mainGenre)
      const selectedSubGenreLabels = subGenres
        .map((key) => currentSubGenres.find((s) => s.key === key)?.label)
        .filter(Boolean)
        .join("、")
      const allTags = [...customTags]
      if (selectedSubGenreLabels) {
        allTags.unshift(selectedSubGenreLabels)
      }
      const tagPart = allTags.length > 0 ? `，风格标签：${allTags.join("、")}` : ""
      const genreLabel = `${channelLabel} / ${mainGenreLabel}${tagPart}`
      const scaleLabel = t(`novel.outlineGenerator.scales.${scale}`)
      const prompt = await buildOutlineGenerationPrompt(project.path, genreLabel, scaleLabel, premise)

      const taskId = createTask({
        projectPath: project.path,
        genre: genreLabel,
        scale,
        premise,
        prompt,
        channel,
        mainGenre,
        subGenres,
        customTags,
        modelId: modelId || undefined,
      })
      updateTask(taskId, {
        status: "generating",
        message: t("novel.outlineGenerator.generationMayTakeLong"),
        error: null,
      })
      setIngestResult(null)
      void runOutlineGenerationTask(taskId, llmConfig)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      if (project) {
        const failedTask = tasks
          .filter((task: OutlineGenerationTask) => task.projectPath === project.path)
          .sort((a: OutlineGenerationTask, b: OutlineGenerationTask) => b.updatedAt - a.updatedAt)[0]
        if (failedTask) {
          updateTask(failedTask.id, { status: "error", error: message, message })
        }
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleOpenOutline() {
    if (!latestTask?.id || !latestTask.outlinePath) return
    await openGeneratedOutline(latestTask.id)
    onOpenChange(false)
  }

  async function handleIngestOutline() {
    if (!project || !latestTask?.id || ingesting) return
    setIngesting(true)
    setIngestResult(null)
    try {
      await runOutlineIngestTask(latestTask.id)
      const refreshed = useOutlineGenerationStore.getState().tasks.find((task) => task.id === latestTask.id)
      setIngestResult(refreshed?.message ?? t("novel.outlineGenerator.ingestFailed"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setIngestResult(message)
      updateTask(latestTask.id, { status: "error", error: message, message })
    } finally {
      setIngesting(false)
    }
  }

  async function handleAddToOutlineList() {
    if (!latestTask?.id || addingToList) return
    setAddingToList(true)
    try {
      const addedPath = await addOutlineTaskToSourceList(latestTask.id)
      if (addedPath) {
        setIngestResult(t("novel.outlineGenerator.addedToOutlineList"))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setAddingToList(false)
    }
  }

  async function handleRefineGenerate() {
    if (!project || taskGenerating || checkingOutline || !canRefine) return
    setError(null)
    setRefineResult(null)

    try {
      let effectiveRequest = refineRequest.trim()
      if (selectedOutlineFiles.size > 0) {
        const selectedFileEntries = outlineFiles.filter((f) => selectedOutlineFiles.has(f.path))
        const fileContents = await Promise.all(
          selectedFileEntries.map(async (f) => {
            try {
              const content = await readFile(f.path)
              return `## ${f.title}\n${content}`
            } catch {
              return `## ${f.title}\n（读取失败）`
            }
          }),
        )
        const selectedContent = fileContents.join("\n\n")
        effectiveRequest = effectiveRequest
          ? `${effectiveRequest}\n\n用户选中的大纲文件内容：\n${selectedContent}`
          : `请基于以下选中大纲文件进行细化生成：\n${selectedContent}`
      }
      if (selectedChapterFiles.size > 0) {
        const selectedEntries = chapterFiles.filter((f) => selectedChapterFiles.has(f.path))
        const chapterContents = await Promise.all(
          selectedEntries.map(async (f) => {
            try {
              const content = await readFile(f.path)
              return `## ${f.title}\n${content}`
            } catch {
              return `## ${f.title}\n（读取失败）`
            }
          }),
        )
        const selectedContent = chapterContents.join("\n\n")
        effectiveRequest = effectiveRequest
          ? `${effectiveRequest}\n\n用户选中的章节内容：\n${selectedContent}`
          : `请基于以下选中章节进行细化生成：\n${selectedContent}`
      }

      const currentSection = selectedSectionKey
        ? OUTLINE_SECTION_GENERATION_CONFIGS.find((config) => config.key === selectedSectionKey) ?? null
        : null
      const taskId = createTask({
        projectPath: project.path,
        kind: "refine",
        userRequest: effectiveRequest,
        selectedSectionKey,
        displayTitle: currentSection?.title ?? t("novel.outlineGenerator.refineTitle"),
        writeMode: refineWriteMode,
        targetPath: refineWriteMode === "appendCurrent" ? selectedFile : null,
      })
      updateTask(taskId, {
        status: "generating",
        message: currentSection
          ? t("novel.outlineGenerator.sectionGenerating", { title: currentSection.title })
          : t("novel.outlineGenerator.refining"),
        error: null,
      })
      void runOutlineRefinementTask(taskId, llmConfig)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const dialogTitle =
    mode === "outline"
      ? t("novel.outlineGenerator.title")
      : t("novel.outlineGenerator.refineTitle")
  const dialogDescription =
    mode === "outline"
      ? t("novel.outlineGenerator.premisePlaceholder")
      : t("novel.outlineGenerator.refineDescription")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {mode === "outline" ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">小说频道</Label>
                <div className="grid grid-cols-2 gap-3">
                  {CHANNELS.map((c) => (
                    <Button
                      key={c.key}
                      type="button"
                      variant={channel === c.key ? "default" : "outline"}
                      onClick={() => setChannel(c.key)}
                      disabled={generating || taskGenerating}
                      className="h-10"
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">小说分类</Label>
                <div className="flex flex-wrap gap-2">
                  {currentGenres.map((g) => (
                    <Button
                      key={g.key}
                      type="button"
                      size="sm"
                      variant={mainGenre === g.key ? "default" : "outline"}
                      onClick={() => setMainGenre(g.key)}
                      disabled={generating || taskGenerating}
                      className="h-8 rounded-full px-3 text-xs"
                    >
                      {g.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">风格标签（可多选）</Label>
                <div className="flex flex-wrap gap-2">
                  {currentSubGenres.map((s) => {
                    const selected = subGenres.includes(s.key)
                    return (
                      <Button
                        key={s.key}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        onClick={() =>
                          setSubGenres((prev) =>
                            selected ? prev.filter((k) => k !== s.key) : [...prev, s.key]
                          )
                        }
                        disabled={generating || taskGenerating}
                        className="h-7 rounded-full px-2.5 text-xs"
                      >
                        {s.label}
                      </Button>
                    )
                  })}
                </div>

                {customTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {customTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomTag(tag)}
                          disabled={generating || taskGenerating}
                          className="rounded-full hover:bg-primary-foreground/20"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={handleCustomTagKeyDown}
                    placeholder="输入自定义标签，按回车添加"
                    disabled={generating || taskGenerating}
                    className="h-9 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleAddCustomTag}
                    disabled={generating || taskGenerating}
                    className="h-9 w-9 shrink-0"
                  >
                    +
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">目标字数</Label>
                <div className="grid grid-cols-4 gap-2">
                  {SCALE_KEYS.map((key) => {
                    const labels: Record<string, { title: string; subtitle: string }> = {
                      short: { title: "短篇", subtitle: "10万字以内" },
                      medium: { title: "中篇", subtitle: "10-50万字" },
                      long: { title: "长篇", subtitle: "50-200万字" },
                      epic: { title: "超长篇", subtitle: "200万字以上" },
                    }
                    const item = labels[key]
                    const selected = scale === key
                    return (
                      <Button
                        key={key}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        onClick={() => setScale(key)}
                        disabled={generating || taskGenerating}
                        className="flex h-auto flex-col gap-0.5 py-2 text-xs"
                      >
                        <span className="font-medium">{item.title}</span>
                        <span className={`text-[10px] ${selected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                          {item.subtitle}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">故事核心设定</Label>
                <textarea
                  value={premise}
                  onChange={(e) => setPremise(e.target.value)}
                  placeholder="用一段话描述你的故事核心设定，比如主角身份、核心冲突、故事走向等..."
                  disabled={generating || taskGenerating}
                  rows={4}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {taskGenerating && (
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <div className="font-medium">{t("novel.outlineGenerator.generatingTitle")}</div>
                  <div className="mt-1">{t("novel.outlineGenerator.generationMayTakeLong")}</div>
                </div>
              )}

              {ingestResult && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                  {ingestResult}
                </div>
              )}

              {hasGeneratedOutline && (
                <div className="relative rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <div className="flex items-start justify-between gap-2">
                    <div>{t("novel.outlineGenerator.ready")}</div>
                    <Button type="button" size="sm" variant="outline" onClick={handleAddToOutlineList} disabled={addingToList} className="shrink-0">
                      {addingToList
                        ? t("novel.outlineGenerator.addingToOutlineList")
                        : t("novel.outlineGenerator.addToOutlineList")}
                    </Button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={handleOpenOutline}>
                      {t("novel.outlineGenerator.openOutline")}
                    </Button>
                    <Button type="button" size="sm" onClick={handleIngestOutline} disabled={ingesting}>
                      {ingesting ? t("novel.outlineGenerator.ingesting") : t("novel.outlineGenerator.ingest")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-4">
              {/* Left column: settings */}
              <div className="w-[42%] shrink-0 flex flex-col gap-2.5">
                {checkingOutline && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    {t("novel.outlineGenerator.refineCheckingOutline")}
                  </div>
                )}

                {taskGenerating && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    <div className="font-medium">
                      {activeSectionTitle && activeSectionTitle !== t("novel.outlineGenerator.refineTitle")
                        ? t("novel.outlineGenerator.sectionGenerating", { title: activeSectionTitle })
                        : t("novel.outlineGenerator.refining")}
                    </div>
                    <div className="mt-1">{t("novel.outlineGenerator.generationMayTakeLong")}</div>
                  </div>
                )}

                {latestTask?.status === "generated" && latestTask.outlinePath ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    <div>{latestTask.message}</div>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={handleOpenOutline}>
                        {t("novel.outlineGenerator.openOutline")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!checkingOutline && !canRefine && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <div className="font-medium">{t("novel.outlineGenerator.refineMissingOutline")}</div>
                    <div className="mt-1">{t("novel.outlineGenerator.refineMissingOutlineHint")}</div>
                  </div>
                )}

                <div className="rounded-md border border-border/70 p-2 text-xs">
                  <div className="mb-2 font-medium text-foreground">{t("novel.outlineGenerator.refineWriteModeLabel")}</div>
                  <label className="flex cursor-pointer items-center gap-2 py-1">
                    <input
                      type="radio"
                      name="refine-write-mode"
                      value="newFileAndAddToList"
                      checked={refineWriteMode === "newFileAndAddToList"}
                      onChange={() => setRefineWriteMode("newFileAndAddToList")}
                      disabled={taskGenerating}
                    />
                    <span>{t("novel.outlineGenerator.refineWriteModeNewFile")}</span>
                  </label>
                  <label className={`flex items-center gap-2 py-1 ${canAppendToCurrentOutline ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
                    <input
                      type="radio"
                      name="refine-write-mode"
                      value="appendCurrent"
                      checked={refineWriteMode === "appendCurrent"}
                      onChange={() => setRefineWriteMode("appendCurrent")}
                      disabled={taskGenerating || !canAppendToCurrentOutline}
                    />
                    <span>{t("novel.outlineGenerator.refineWriteModeAppendCurrent")}</span>
                  </label>
                  {!canAppendToCurrentOutline ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("novel.outlineGenerator.refineWriteModeAppendHint")}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {OUTLINE_SECTION_GENERATION_CONFIGS.map((config) => (
                    <Button
                      key={config.key}
                      type="button"
                      size="sm"
                      variant={selectedSectionKey === config.key ? "default" : "outline"}
                      onClick={() => setSelectedSectionKey((current) => current === config.key ? null : config.key)}
                      disabled={taskGenerating || checkingOutline || !canRefine}
                      className="text-xs h-7"
                    >
                      {config.title}
                    </Button>
                  ))}
                </div>

                {selectedSectionConfig ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px] text-primary">
                    {t("novel.outlineGenerator.sectionGeneratingHint", { title: selectedSectionConfig.title })}
                  </div>
                ) : null}

                {outlineFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px]">选中大纲文件</Label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => setSelectedOutlineFiles(new Set(outlineFiles.map((f) => f.path)))}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground hover:underline"
                          onClick={() => setSelectedOutlineFiles(new Set())}
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    <div className="max-h-24 overflow-y-auto rounded-md border p-1.5 text-[11px] space-y-0.5">
                      {outlineFiles.map((file) => (
                        <label key={file.path} className="flex items-center gap-1.5 cursor-pointer py-0.5 hover:bg-muted/50 rounded px-1">
                          <input
                            type="checkbox"
                            checked={selectedOutlineFiles.has(file.path)}
                            onChange={(e) => {
                              setSelectedOutlineFiles((prev) => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(file.path)
                                else next.delete(file.path)
                                return next
                              })
                            }}
                            disabled={taskGenerating}
                            className="h-3 w-3 rounded border-input"
                          />
                          <span className="truncate">{file.title}</span>
                        </label>
                      ))}
                    </div>
                    {selectedOutlineFiles.size > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        已选中 {selectedOutlineFiles.size} / {outlineFiles.length}
                      </div>
                    )}
                  </div>
                )}

                {chapterFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px]">选中章节（最近10章）</Label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => setSelectedChapterFiles(new Set(chapterFiles.map((f) => f.path)))}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground hover:underline"
                          onClick={() => setSelectedChapterFiles(new Set())}
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    <div className="max-h-24 overflow-y-auto rounded-md border p-1.5 text-[11px] space-y-0.5">
                      {chapterFiles.map((file) => (
                        <label key={file.path} className="flex items-center gap-1.5 cursor-pointer py-0.5 hover:bg-muted/50 rounded px-1">
                          <input
                            type="checkbox"
                            checked={selectedChapterFiles.has(file.path)}
                            onChange={(e) => {
                              setSelectedChapterFiles((prev) => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(file.path)
                                else next.delete(file.path)
                                return next
                              })
                            }}
                            disabled={taskGenerating}
                            className="h-3 w-3 rounded border-input"
                          />
                          <span className="truncate">{file.title}</span>
                        </label>
                      ))}
                    </div>
                    {selectedChapterFiles.size > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        已选中 {selectedChapterFiles.size} / {chapterFiles.length}
                      </div>
                    )}
                  </div>
                )}

                {refineResult && (
                  <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                    {refineResult}
                  </div>
                )}
              </div>

              {/* Right column: input */}
              <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                <Label className="text-sm">{t("novel.outlineGenerator.refineRequestLabel")}</Label>
                <textarea
                  value={refineRequest}
                  onChange={(e) => setRefineRequest(e.target.value)}
                  placeholder={t("novel.outlineGenerator.refineRequestPlaceholder")}
                  disabled={taskGenerating}
                  rows={12}
                  className="w-full flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[200px]"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {mode === "outline"
                ? `${t("novel.outlineGenerator.error")}：${error}`
                : error}
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <ChatModelSelector
              value={modelId}
              onChange={setModelId}
              disabled={generating || taskGenerating}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={ingesting}
            >
              {(mode === "outline" || mode === "refine") && taskGenerating
                ? t("novel.outlineGenerator.hideAndContinue")
                : t("project.cancel")}
            </Button>
            {mode === "outline" ? (
              hasGeneratedOutline ? (
                <Button onClick={handleIngestOutline} disabled={ingesting}>
                  {ingesting ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("novel.outlineGenerator.ingesting")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1 h-4 w-4" />
                      {t("novel.outlineGenerator.ingest")}
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleGenerate} disabled={generating || taskGenerating || !premise.trim()}>
                  {generating ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("novel.outlineGenerator.generating")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1 h-4 w-4" />
                      {t("novel.outlineGenerator.title")}
                    </>
                  )}
                </Button>
              )
            ) : (
              <Button onClick={handleRefineGenerate} disabled={taskGenerating || checkingOutline || !canRefine}>
                {taskGenerating ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    {activeSectionTitle && activeSectionTitle !== t("novel.outlineGenerator.refineTitle")
                      ? t("novel.outlineGenerator.sectionGenerating", { title: activeSectionTitle })
                      : t("novel.outlineGenerator.refining")}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 h-4 w-4" />
                    {selectedSectionKey
                      ? t(`novel.outlineGenerator.sectionButtons.${selectedSectionKey}`)
                      : t("novel.outlineGenerator.refineTitle")}
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
