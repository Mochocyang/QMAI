export type BatchImportTaskStatus =
  | "queued"
  | "copying"
  | "splitting"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "skipped"
  | "completed"

export interface BatchImportCandidate {
  sourcePath: string
  fileName: string
  fileSize: number
}

export interface BatchImportCheckpoint {
  version: 1
  sourceSha256: string
  totalChapters: number
  completedChapterIndexes: number[]
  totalWords: number
  updatedAt: number
}

export interface BatchImportTask {
  version: 1
  id: string
  batchId: string
  projectPath: string
  originalPath: string
  originalFileName: string
  cachedSourcePath: string
  sourceSha256: string | null
  requestedTitle: string
  finalTitle: string | null
  bookId: string
  status: BatchImportTaskStatus
  completed: number
  total: number
  error: string | null
  skipReason: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export interface BatchImportBatch {
  version: 1
  id: string
  projectPath: string
  taskIds: string[]
  createdAt: number
  updatedAt: number
}