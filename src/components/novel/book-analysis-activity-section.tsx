import { useEffect } from "react"
import { BookOpen, Check, Loader2, Pause, Play, RefreshCw, Square, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useBookAnalysisPipelineStore } from "@/stores/book-analysis-pipeline-store"
import { openBookAnalysisOutcome, useBookAnalysisActivityStore } from "@/stores/book-analysis-activity-store"
import { analysisActivities } from "@/lib/novel/book-analysis/analysis-activity"
import { normalizePath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
const statusLabels = { waiting: "待选择角色", queued: "排队中", running: "分析中", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已取消" }
const report = (error: unknown) => toast.error(error instanceof Error ? error.message : "操作失败，请重试")
export function BookAnalysisActivitySection({ onNavigate }: { onNavigate?: () => void }) {
  const project = useWikiStore((s) => s.project)
  const pipeline = useBookAnalysisPipelineStore()
  const history = useBookAnalysisActivityStore()
  useEffect(() => {
    if (!project) return
    void pipeline.initializeProject(project.path).catch(report)
    void history.initializeProject(project.path).catch(report)
  }, [project?.path])
  const path = normalizePath(project?.path ?? "").replace(/\/+$/, "")
  const tasks = pipeline.tasks.filter((t) => normalizePath(t.projectPath).replace(/\/+$/, "") === path)
  const rows = analysisActivities(tasks, pipeline.progresses).sort((a, b) => b.updatedAt - a.updatedAt)
  const outcomes = history.projectPath === path ? [...history.outcomes].sort((a, b) => b.createdAt - a.createdAt) : []
  const navigate = (target: Parameters<typeof openBookAnalysisOutcome>[0]) => {
    if (openBookAnalysisOutcome(target)) onNavigate?.()
  }
  return <section className="book-analysis-activity space-y-3 border-t p-3" aria-label="拆书分析活动">
    <h3 className="flex items-center gap-2 text-sm font-medium"><BookOpen size={16} />拆书 Skill 分析 <span className="text-xs text-muted-foreground">{rows.filter((r) => r.status === "running").length}项运行中</span></h3>
    {!rows.length && <p className="text-xs text-muted-foreground">暂无拆书分析任务</p>}
    {rows.map((row) => {
      const task = tasks.find((t) => t.id === row.taskId)!
      const Icon = row.status === "running" ? Loader2 : row.status === "completed" ? Check : row.status === "failed" ? X : BookOpen
      return <div className="rounded-md border p-3 text-xs" key={`${row.taskId}:${row.skill}`}>
        <div className="flex flex-wrap items-center gap-2"><Icon size={14} className={row.status === "running" ? "animate-spin" : ""} /><strong className="break-words">{row.title}</strong><span>{statusLabels[row.status]}</span></div>
        <p className="my-2 whitespace-pre-wrap break-words text-muted-foreground">{row.detail}</p>
        <div className="flex flex-wrap items-center gap-2"><span>{row.completed}/{row.total}区块</span>
          <button className="rounded border px-2 py-1" onClick={() => navigate(row)}>查看{row.status === "completed" ? "结果" : "任务"}</button>
          {task.status === "running" && <button title="暂停任务" aria-label={`暂停${row.title}`} onClick={() => void pipeline.pauseTask(task.id).catch(report)}><Pause size={15} /></button>}
          {["paused", "failed"].includes(task.status) && <button title="继续或重试任务" aria-label={`重试${row.title}`} onClick={() => void pipeline.continueTask(task.id).catch(report)}><Play size={15} /></button>}
          {task.status === "awaiting-character-selection" && task.error && row.skill === "characters" && <button title="重新识别角色" onClick={() => void pipeline.recognizeWorkbenchCharacters(task.id).catch(report)}><RefreshCw size={15} /></button>}
          {!["completed", "cancelled"].includes(task.status) && <button title="取消任务" aria-label={`取消${row.title}`} onClick={() => void pipeline.cancelTask(task.id).catch(report)}><Square size={15} /></button>}
        </div>
      </div>
    })}
    <details><summary className="cursor-pointer text-xs">完成与失败通知（{outcomes.length}）</summary>
      {history.error && <p role="alert" className="text-xs text-destructive">{history.error}</p>}
      {outcomes.map((event) => <div className="border-b py-3 text-xs" key={event.id}><strong>{event.title}</strong><p className="my-1 whitespace-pre-wrap break-words">{event.message}</p><div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString("zh-CN")}</span><button onClick={() => navigate(event)}>查看任务</button></div></div>)}
    </details>
  </section>
}
