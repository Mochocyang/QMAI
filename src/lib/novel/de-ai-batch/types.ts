type DeAiBatchTaskStatus =
  | "queued"
  | "running"
  | "reviewing"
  | "partial"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "completed"

export type DeAiBatchChapterStatus =
  | "pending"
  | "generating"
  | "ready"
  | "confirmed"
  | "failed"
  | "cancelled"

export interface DeAiBatchTask {
  version: 1
  id: string
  projectPath: string
  workId: string
  workTitle: string
  modelKey: string
  skillId: string | null
  skillName: string
  skillContent: string
  status: DeAiBatchTaskStatus
  chapterIds: string[]
  error: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export interface DeAiBatchChapter {
  version: 1
  id: string
  taskId: string
  title: string
  order: number
  sourcePath: string
  sourceContent: string
  candidateContent: string | null
  status: DeAiBatchChapterStatus
  runId: string | null
  generation: number
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface DeAiBatchTaskRecord {
  task: DeAiBatchTask
  chapters: DeAiBatchChapter[]
}
