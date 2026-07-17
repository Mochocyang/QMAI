import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ChapterSelectionState } from "@/lib/novel/book-analysis/types"
import {
  ANALYSIS_SKILL_ORDER,
  type AnalysisChapterRange,
  type AnalysisSkill,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { MAX_ANALYSIS_CHAPTERS } from "@/lib/novel/book-analysis/analysis-chunk-planner"

interface BookAnalysisRunDialogProps {
  open: boolean
  chapters: ChapterSelectionState[]
  initialSkills?: AnalysisSkill[]
  lockedSkills?: AnalysisSkill[]
  initialRange?: AnalysisChapterRange | null
  onOpenChange: (open: boolean) => void
  onSubmit: (value: { range: AnalysisChapterRange; selectedSkills: AnalysisSkill[] }) => Promise<void> | void
}

const SKILL_LABELS: Record<AnalysisSkill, string> = {
  characters: "角色 Skill",
  story: "故事 Skill",
  style: "文风 Skill",
}

export function BookAnalysisRunDialog({
  open,
  chapters,
  initialSkills = [],
  lockedSkills,
  initialRange,
  onOpenChange,
  onSubmit,
}: BookAnalysisRunDialogProps) {
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [skills, setSkills] = useState<AnalysisSkill[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setStart(initialRange ? String(initialRange.startOrder) : "")
    setEnd(initialRange ? String(initialRange.endOrder) : "")
    setSkills(lockedSkills?.length ? [...lockedSkills] : [...initialSkills])
  }, [initialRange, initialSkills, lockedSkills, open])

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

  const submit = async () => {
    if (!range || !canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ range, selectedSkills: ANALYSIS_SKILL_ORDER.filter((skill) => skills.includes(skill)) })
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
          {range && !error && (
            <p className="text-sm text-muted-foreground">预计 {Math.ceil(count / 10)} 个章节区块</p>
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
