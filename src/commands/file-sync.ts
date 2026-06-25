import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/platform"
import { httpSync } from "@/lib/http-adapter"
import type { SourceWatchConfig } from "@/stores/wiki-store"
import { normalizeSourceWatchConfig } from "@/lib/source-watch-config"

export type FileChangeKind = "created" | "modified" | "deleted"
export type FileChangeStatus = "pending" | "processing" | "done" | "failed" | "superseded"

export interface FileChangeTask {
  id: string
  projectId: string
  path: string
  kind: FileChangeKind
  status: FileChangeStatus
  hashBefore?: string | null
  hashAfter?: string | null
  size?: number | null
  mtimeMs?: number | null
  createdAt: number
  updatedAt: number
  retryCount: number
  error?: string | null
  needsRerun: boolean
}

export interface FileChangeQueue {
  version: number
  tasks: FileChangeTask[]
}

export interface FileChangeRescanResult {
  queue: FileChangeQueue
  changedTasks: FileChangeTask[]
}

export interface FileSyncPayload {
  projectId: string
  tasks: FileChangeTask[]
}

export function startProjectFileWatcher(
  projectId: string,
  projectPath: string,
  sourceWatchConfig?: SourceWatchConfig,
): Promise<FileChangeQueue> {
  if (!isTauri()) {
    return httpSync.start(projectId, projectPath, normalizeSourceWatchConfig(sourceWatchConfig)) as Promise<FileChangeQueue>
  }
  return invoke<FileChangeQueue>("start_project_file_watcher", {
    projectId,
    projectPath,
    sourceWatchConfig: normalizeSourceWatchConfig(sourceWatchConfig),
  })
}

export function stopProjectFileWatcher(): Promise<void> {
  if (!isTauri()) {
    return httpSync.stop() as Promise<void>
  }
  return invoke<void>("stop_project_file_watcher")
}

export function rescanProjectFiles(
  projectId: string,
  projectPath: string,
  sourceWatchConfig?: SourceWatchConfig,
): Promise<FileChangeRescanResult> {
  if (!isTauri()) {
    return httpSync.rescan(projectId, projectPath, normalizeSourceWatchConfig(sourceWatchConfig)) as Promise<FileChangeRescanResult>
  }
  return invoke<FileChangeRescanResult>("rescan_project_files", {
    projectId,
    projectPath,
    sourceWatchConfig: normalizeSourceWatchConfig(sourceWatchConfig),
  })
}

export function getFileChangeQueue(projectPath: string): Promise<FileChangeQueue> {
  if (!isTauri()) {
    return httpSync.queue(projectPath) as Promise<FileChangeQueue>
  }
  return invoke<FileChangeQueue>("get_file_change_queue", { projectPath })
}

export function retryFileChangeTask(
  projectId: string,
  projectPath: string,
  taskId: string,
): Promise<FileChangeQueue> {
  if (!isTauri()) {
    return httpSync.retry(projectId, projectPath, taskId) as Promise<FileChangeQueue>
  }
  return invoke<FileChangeQueue>("retry_file_change_task", { projectId, projectPath, taskId })
}

export function ignoreFileChangeTask(
  projectId: string,
  projectPath: string,
  taskId: string,
): Promise<FileChangeQueue> {
  if (!isTauri()) {
    return httpSync.ignore(projectId, projectPath, taskId) as Promise<FileChangeQueue>
  }
  return invoke<FileChangeQueue>("ignore_file_change_task", { projectId, projectPath, taskId })
}
