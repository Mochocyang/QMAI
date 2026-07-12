import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type {
  BatchImportBatch,
  BatchImportTask,
  BatchImportTaskStatus,
} from "@/lib/novel/book-analysis/batch-import-types"

interface BookAnalysisImportTaskPanelProps {
  batches: BatchImportBatch[]
  tasks: BatchImportTask[]
  collapsed: boolean
  onCollapsedChange: (value: boolean) => void
  onContinue: (taskId: string) => void
  onRegenerate: (taskId: string) => void
  onCancel: (taskId: string) => void
  onCancelAllQueued: (batchId: string) => void
  onOpenBook: (bookId: string) => void
}

interface TaskGroup {
  batchId?: string
  tasks: BatchImportTask[]
  missingCount: number
}

const taskListId = "book-analysis-import-task-list"

const statusLabels: Record<BatchImportTaskStatus, string> = {
  queued: "等待中",
  copying: "复制中",
  splitting: "拆分中",
  interrupted: "已中断",
  failed: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
  completed: "已完成",
}

const terminalStatuses = new Set<BatchImportTaskStatus>(["failed", "cancelled", "skipped", "completed"])

function getTaskTitle(task: BatchImportTask) {
  return task.finalTitle || task.requestedTitle
}

function getErrorDescriptionId(taskId: string) {
  return `book-analysis-import-task-error-${taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

function TaskActions({
  task,
  onContinue,
  onRegenerate,
  onCancel,
  onOpenBook,
}: Pick<BookAnalysisImportTaskPanelProps, "onContinue" | "onRegenerate" | "onCancel" | "onOpenBook"> & {
  task: BatchImportTask
}) {
  const title = getTaskTitle(task)

  if (["queued", "copying", "splitting"].includes(task.status)) {
    return (
      <Button size="xs" variant="outline" aria-label={`取消作品《${title}》`} onClick={() => onCancel(task.id)}>
        取消
      </Button>
    )
  }

  if (task.status === "interrupted" || task.status === "failed") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="outline" aria-label={`继续作品《${title}》`} onClick={() => onContinue(task.id)}>
          继续
        </Button>
        <Button
          size="xs"
          variant="outline"
          aria-label={`重新生成作品《${title}》`}
          onClick={() => onRegenerate(task.id)}
        >
          重新生成
        </Button>
      </div>
    )
  }

  if (task.status === "cancelled") {
    return (
      <Button
        size="xs"
        variant="outline"
        aria-label={`重新生成作品《${title}》`}
        onClick={() => onRegenerate(task.id)}
      >
        重新生成
      </Button>
    )
  }

  if (task.status === "completed") {
    return (
      <Button size="xs" variant="outline" aria-label={`打开作品《${title}》`} onClick={() => onOpenBook(task.bookId)}>
        打开作品
      </Button>
    )
  }

  return null
}

function BatchSummary({ tasks, missingCount }: { tasks: BatchImportTask[]; missingCount: number }) {
  if (missingCount > 0 || tasks.length === 0 || tasks.some((task) => !terminalStatuses.has(task.status))) return null

  const count = (status: BatchImportTaskStatus) => tasks.filter((task) => task.status === status).length
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      批次完成 · 成功 {count("completed")} · 跳过 {count("skipped")} · 失败 {count("failed")} · 取消 {count("cancelled")}
    </p>
  )
}

function buildTaskGroups(batches: BatchImportBatch[], tasks: BatchImportTask[]) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]))
  const groupedTaskIds = new Set<string>()
  const groups: TaskGroup[] = []

  for (const batch of batchMap.values()) {
    const taskIds = [...new Set(batch.taskIds)]
    const groupTasks: BatchImportTask[] = []
    let missingCount = 0

    for (const taskId of taskIds) {
      const task = taskMap.get(taskId)
      if (!task || task.batchId !== batch.id) {
        missingCount += 1
        continue
      }
      if (!groupedTaskIds.has(task.id)) {
        groupedTaskIds.add(task.id)
        groupTasks.push(task)
      }
    }

    if (groupTasks.length > 0 || missingCount > 0) {
      groups.push({ batchId: batch.id, tasks: groupTasks, missingCount })
    }
  }

  const ungroupedTasks = [...taskMap.values()].filter((task) => !groupedTaskIds.has(task.id))
  if (ungroupedTasks.length > 0) {
    groups.push({ tasks: ungroupedTasks, missingCount: 0 })
  }

  return { groups, uniqueTasks: [...taskMap.values()] }
}

export function BookAnalysisImportTaskPanel({
  batches,
  tasks,
  collapsed,
  onCollapsedChange,
  onContinue,
  onRegenerate,
  onCancel,
  onCancelAllQueued,
  onOpenBook,
}: BookAnalysisImportTaskPanelProps) {
  if (tasks.length === 0) return null

  const { groups, uniqueTasks } = buildTaskGroups(batches, tasks)
  const count = (statuses: BatchImportTaskStatus[]) => uniqueTasks.filter((task) => statuses.includes(task.status)).length

  return (
    <section
      className="flex min-h-0 max-h-[45%] flex-col overflow-hidden border-b bg-background px-5 py-3"
      aria-label="批量导入任务"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">批量导入任务</h3>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
            <span>进行中 {count(["copying", "splitting"])}</span>
            <span>等待 {count(["queued"])}</span>
            <span>失败 {count(["failed"])}</span>
            <span>中断 {count(["interrupted"])}</span>
            <span>完成 {count(["completed"])}</span>
            <span>跳过 {count(["skipped"])}</span>
            <span>取消 {count(["cancelled"])}</span>
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-controls={taskListId}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? <ChevronRight /> : <ChevronDown />}
          {collapsed ? "展开导入任务" : "收起导入任务"}
        </Button>
      </div>

      {!collapsed && (
        <div id={taskListId} className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {groups.map((group, groupIndex) => {
            const batchId = group.batchId
            const queuedTasks = group.tasks.filter((task) => task.status === "queued")
            const queuedCount = queuedTasks.length
            return (
              <div key={batchId ?? `ungrouped-${groupIndex}`} className="space-y-2">
                {batchId && queuedCount > 0 && (
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`取消全部等待作品：${queuedTasks.map(getTaskTitle).join("、")}`}
                      onClick={() => {
                        if (window.confirm("确定取消当前批次的全部等待任务吗？")) {
                          onCancelAllQueued(batchId)
                        }
                      }}
                    >
                      取消全部等待任务
                    </Button>
                  </div>
                )}
                {group.missingCount > 0 && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    批次记录缺少 {group.missingCount} 个任务
                  </p>
                )}
                {group.tasks.map((task) => {
                  const title = getTaskTitle(task)
                  const errorDescriptionId = task.error ? getErrorDescriptionId(task.id) : undefined
                  return (
                    <article
                      key={task.id}
                      className="flex items-center gap-3 rounded-md border px-3 py-2"
                      aria-describedby={errorDescriptionId}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{statusLabels[task.status]}</span>
                          {(task.status === "copying" || task.status === "splitting") && task.total > 0 && (
                            <span
                              className="shrink-0 text-xs text-muted-foreground"
                              role="progressbar"
                              aria-label={`${title}导入进度`}
                              aria-valuemin={0}
                              aria-valuemax={task.total}
                              aria-valuenow={task.completed}
                            >
                              {task.completed}/{task.total}
                            </span>
                          )}
                        </div>
                        {task.error && (
                          <>
                            <p className="mt-1 truncate text-xs text-destructive" title={task.error} aria-hidden="true">
                              {task.error}
                            </p>
                            <span id={errorDescriptionId} className="sr-only">{task.error}</span>
                          </>
                        )}
                        {!task.error && task.skipReason && (
                          <p className="mt-1 truncate text-xs text-muted-foreground" title={task.skipReason}>{task.skipReason}</p>
                        )}
                      </div>
                      <TaskActions
                        task={task}
                        onContinue={onContinue}
                        onRegenerate={onRegenerate}
                        onCancel={onCancel}
                        onOpenBook={onOpenBook}
                      />
                    </article>
                  )
                })}
                {batchId && <BatchSummary tasks={group.tasks} missingCount={group.missingCount} />}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export type { BookAnalysisImportTaskPanelProps }
