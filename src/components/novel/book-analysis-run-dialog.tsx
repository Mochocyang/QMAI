import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ChapterSelectionState } from "@/lib/novel/book-analysis/types"
import {
  ANALYSIS_SKILL_ORDER,
  DEFAULT_STYLE_ANALYSIS_DEPTH,
  type AnalysisChapterRange,
  type AnalysisSkill,
  type StyleAnalysisDepth,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import {
  MAX_ANALYSIS_CHAPTERS,
  MAX_ANALYSIS_CHUNK_CHARS,
  buildAnalysisChunkPlan,
  computeAnalysisChunkCharLimit,
} from "@/lib/novel/book-analysis/analysis-chunk-planner"
import { resolveTaskLlmConfig } from "@/lib/novel/book-analysis/analysis-model-resolver"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"

interface BookAnalysisRunDialogProps {
  open: boolean
  chapters: ChapterSelectionState[]
  initialSkills?: AnalysisSkill[]
  lockedSkills?: AnalysisSkill[]
  initialRange?: AnalysisChapterRange | null
  initialModelKey?: string
  initialStyleDepth?: StyleAnalysisDepth
  onOpenChange: (open: boolean) => void
  onSubmit: (value: {
    range: AnalysisChapterRange
    selectedSkills: AnalysisSkill[]
    modelKey: string
    styleDepth: StyleAnalysisDepth
  }) => Promise<void> | void
}

const SKILL_LABELS: Record<AnalysisSkill, string> = {
  characters: "角色 Skill",
  story: "故事 Skill",
  style: "文风 Skill",
}

const DEPTH_OPTIONS: Array<{ value: StyleAnalysisDepth; label: string; hint: string }> = [
  {
    value: "full",
    label: "完整",
    hint: "跑齐 L1-L6 六层，每个章节区块 3 次模型调用，结果最细但最慢最贵",
  },
  {
    value: "fast",
    label: "快速",
    hint: "只跑语言与排版层，每个章节区块 1 次调用，代表片段由脚本截取；适合大部头先出结果",
  },
]

export function BookAnalysisRunDialog({
  open,
  chapters,
  initialSkills = [],
  lockedSkills,
  initialRange,
  initialModelKey = "",
  initialStyleDepth = DEFAULT_STYLE_ANALYSIS_DEPTH,
  onOpenChange,
  onSubmit,
}: BookAnalysisRunDialogProps) {
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [skills, setSkills] = useState<AnalysisSkill[]>([])
  const [modelKey, setModelKey] = useState("")
  const [styleDepth, setStyleDepth] = useState<StyleAnalysisDepth>(DEFAULT_STYLE_ANALYSIS_DEPTH)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setStart(initialRange ? String(initialRange.startOrder) : "")
    setEnd(initialRange ? String(initialRange.endOrder) : "")
    setSkills(lockedSkills?.length ? [...lockedSkills] : [...initialSkills])
    setModelKey(initialModelKey)
    setStyleDepth(initialStyleDepth)
  }, [initialModelKey, initialRange, initialSkills, initialStyleDepth, lockedSkills, open])

  const range = useMemo<AnalysisChapterRange | null>(() => {
    const startOrder = Number(start)
    const endOrder = Number(end)
    if (!Number.isInteger(startOrder) || !Number.isInteger(endOrder)) return null
    return { startOrder, endOrder }
  }, [end, start])
  const count = range ? range.endOrder - range.startOrder + 1 : 0
  const available = new Set(chapters.map((chapter) => chapter.order))
  const totalChapters = chapters.length
  const missingChapter = range && count > 0
    ? Array.from({ length: count }, (_, index) => range.startOrder + index).find((order) => !available.has(order))
    : undefined
  const error = !range || !start || !end
    ? ""
    : range.startOrder < 1
      ? "起始章节必须大于 0"
      : range.endOrder < range.startOrder
        ? "结束章节不能小于起始章节"
        : count > MAX_ANALYSIS_CHAPTERS
          ? "单次最多分析 100 章，请分批处理"
          : range.endOrder > totalChapters
            ? `本作品共 ${totalChapters} 章，最多只能选择第 ${totalChapters} 章`
          : missingChapter !== undefined
            ? `第 ${missingChapter} 章不存在，请根据作品实际章节范围选择`
            : ""
  const canSubmit = Boolean(range && !error && skills.length > 0 && !submitting)
  const estimatedChunks = useMemo(() => {
    if (!range || !start || !end || error) return []
    const llmConfig = resolveTaskLlmConfig({ modelKey })
    try {
      return buildAnalysisChunkPlan(
        chapters.map((chapter) => ({ id: chapter.chapterId, order: chapter.order, wordCount: chapter.wordCount })),
        range,
        { maxChunkChars: computeAnalysisChunkCharLimit(llmConfig.maxContextSize) },
      )
    } catch {
      return []
    }
  }, [chapters, end, error, modelKey, range, start])
  const truncatedOrders = useMemo(() => {
    if (!range || !start || !end || error) return []
    return chapters
      .filter((chapter) => (
        chapter.order >= range.startOrder
        && chapter.order <= range.endOrder
        && chapter.wordCount > CHAPTER_BODY_EXCERPT_MAX_CHARS
      ))
      .map((chapter) => chapter.order)
  }, [chapters, end, error, range, start])

  const submit = async () => {
    if (!range || !canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        range,
        selectedSkills: ANALYSIS_SKILL_ORDER.filter((skill) => skills.includes(skill)),
        modelKey: modelKey.trim(),
        styleDepth,
      })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[560px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>设置分析范围</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4 pr-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span>起始章节</span>
              <input aria-label="起始章节" type="number" min={1} max={Math.min(totalChapters, MAX_ANALYSIS_CHAPTERS)} value={start} onChange={(event) => setStart(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span>结束章节</span>
              <input aria-label="结束章节" type="number" min={1} max={Math.min(totalChapters, MAX_ANALYSIS_CHAPTERS)} value={end} onChange={(event) => setEnd(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            当前作品共 {totalChapters} 章；单次最多分析 {MAX_ANALYSIS_CHAPTERS} 章，请选择第 1～{Math.min(totalChapters, MAX_ANALYSIS_CHAPTERS)} 章。
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <fieldset>
            <legend className="text-sm font-medium">提取项目</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ANALYSIS_SKILL_ORDER.map((skill) => (
                <label key={skill} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={skills.includes(skill)}
                    disabled={Boolean(lockedSkills?.length && !lockedSkills.includes(skill))}
                    onChange={(event) => setSkills((current) => event.target.checked
                      ? [...new Set([...current, skill])]
                      : current.filter((item) => item !== skill))}
                  />
                  {SKILL_LABELS[skill]}
                </label>
              ))}
              {!lockedSkills?.length && (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={skills.length === ANALYSIS_SKILL_ORDER.length}
                    onChange={(event) => setSkills(event.target.checked ? [...ANALYSIS_SKILL_ORDER] : [])}
                  />
                  全部提取
                </label>
              )}
            </div>
          </fieldset>
          {skills.includes("style") && (
            <fieldset>
              <legend className="text-sm font-medium">文风蒸馏深度</legend>
              <div className="mt-2 space-y-2">
                {DEPTH_OPTIONS.map((option) => (
                  <label key={option.value} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="style-depth"
                      className="mt-1 shrink-0"
                      value={option.value}
                      checked={styleDepth === option.value}
                      onChange={() => setStyleDepth(option.value)}
                    />
                    <span>
                      <span className="font-medium">{option.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">分析模型</span>
            <ChatModelSelector value={modelKey} onChange={setModelKey} disabled={submitting} />
            <p className="text-xs text-muted-foreground">
              不选则使用项目默认模型。每个章节区块最多喂 {MAX_ANALYSIS_CHUNK_CHARS.toLocaleString()} 字正文。
            </p>
          </div>
          {range && !error && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>预计 {estimatedChunks.length} 个章节区块</p>
              {truncatedOrders.length > 0 && (
                <p role="status">
                  第 {truncatedOrders.join("、")} 章超过 {CHAPTER_BODY_EXCERPT_MAX_CHARS.toLocaleString()} 字，仅前 {CHAPTER_BODY_EXCERPT_MAX_CHARS.toLocaleString()} 字会被分析
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!canSubmit} onClick={submit}>{submitting ? "正在启动…" : "开始分析"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
