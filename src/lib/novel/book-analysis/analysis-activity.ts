import type { AnalysisRuntimeProgress, AnalysisSkill, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import { WORKBENCH_LABELS } from "./workbench-core"

export type AnalysisActivityStatus = "waiting" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
export interface AnalysisActivity {
  taskId: string; bookId: string; projectPath: string; skill: AnalysisSkill
  title: string; status: AnalysisActivityStatus; detail: string; completed: number; total: number; updatedAt: number
}
export interface AnalysisOutcome {
  id: string; taskId: string; bookId: string; projectPath: string; skill: AnalysisSkill
  title: string; status: "completed" | "failed"; message: string; createdAt: number
}
function phase(task: BookAnalysisPipelineTask, skill: AnalysisSkill): AnalysisActivityStatus {
  const module = task.modules[skill]
  if (module.status === "completed") return "completed"
  if (task.status === "cancelled") return "cancelled"
  if (module.status === "failed" || (task.status === "failed" && (task.currentSkill ?? task.selectedSkills[0]) === skill)
    || (task.status === "awaiting-character-selection" && skill === "characters" && task.error)) return "failed"
  if (task.status === "paused") return "paused"
  if (task.status === "awaiting-character-selection" && skill === "characters") return "waiting"
  return module.status === "running" ? "running" : "queued"
}
export function analysisActivities(tasks: BookAnalysisPipelineTask[], progresses: Record<string, AnalysisRuntimeProgress> = {}): AnalysisActivity[] {
  return tasks.filter((task) => task.status !== "awaiting-range").flatMap((task) => task.selectedSkills.map((skill) => {
    let status = phase(task, skill)
    const progress = Object.entries(progresses).filter(([key]) => key.startsWith(`${task.id}:${skill}:`)).map(([, value]) => value.stageLabel)
    if (status === "waiting" && progress.length) status = "running"
    const detail = status === "completed"
      ? task.workbenchVersion === 2 ? "分析完成，结果待确认；不会自动绑定人物或启用文风。" : "分析完成，可前往拆书库查看结果。"
      : status === "failed" ? `分析失败：${task.error || "区块或结果校验失败，请重试"}`
        : status === "cancelled" ? "任务已取消，已有结果保留。"
          : status === "paused" ? "任务已暂停，可继续分析。"
            : progress.join(" · ") || (status === "waiting" ? "等待识别或选择目标角色。" : "等待调度分析。")
    return {
      taskId: task.id, bookId: task.bookId, projectPath: task.projectPath, skill,
      title: `《${task.bookTitle || task.bookId}》 · ${WORKBENCH_LABELS[skill]}`, status, detail,
      completed: task.modules[skill].completedChunkIds.length, total: task.modules[skill].chunkIds.length,
      updatedAt: task.modules[skill].updatedAt || task.updatedAt,
    }
  }))
}
export function analysisOutcomeChanges(tasks: BookAnalysisPipelineTask[], previous: BookAnalysisPipelineTask[]): AnalysisOutcome[] {
  const before = new Map(analysisActivities(previous).map((row) => [`${row.projectPath}:${row.taskId}:${row.skill}`, row.status]))
  return analysisActivities(tasks).flatMap((row) => {
    const old = before.get(`${row.projectPath}:${row.taskId}:${row.skill}`)
    if (!old || old === row.status || !["completed", "failed"].includes(row.status)) return []
    return [{
      id: crypto.randomUUID(), taskId: row.taskId, bookId: row.bookId, projectPath: row.projectPath, skill: row.skill,
      title: `${row.title} · ${row.status === "completed" ? "已完成" : "失败"}`,
      status: row.status as "completed" | "failed", message: row.detail, createdAt: Date.now(),
    }]
  })
}
