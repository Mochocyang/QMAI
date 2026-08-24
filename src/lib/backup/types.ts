/** 前端传入 Rust 端的项目信息 */
export interface ProjectBackupInfo {
  id: string
  path: string
  name: string
}

export type ProjectBackupSection =
  | "content"
  | "memory"
  | "analysis"
  | "indexes"
  | "trash"

export interface SelectedProjectBackupInfo extends ProjectBackupInfo {
  sections: ProjectBackupSection[]
}

export interface BackupExportOptions {
  includeGlobalConfig: boolean
  includeUiPreferences: boolean
  includeCredentials: boolean
  projects: SelectedProjectBackupInfo[]
}

/** 导出参数 */
export interface ExportParams {
  savePath: string
  includeGlobalConfig: boolean
  includeUiPreferences: boolean
  includeCredentials: boolean
  localStorageData: Record<string, string>
  projects: SelectedProjectBackupInfo[]
}

/** 导出结果 */
export interface ExportResult {
  success: boolean
  warnings: string[]
  fileCount: number
  totalSize: number
  error: string | null
}

/** 导入策略 */
export type ImportStrategy = "full" | "global-only" | "selective"

/** 选择性导入时的项目恢复信息 */
export interface ProjectRestoreInfo {
  id: string
  targetPath: string
}

/** 导入参数 */
export interface ImportParams {
  zipPath: string
  strategy: ImportStrategy
  projects?: ProjectRestoreInfo[]
  projectPathOverrides?: Record<string, string>
}

/** 项目恢复结果 */
export interface ProjectRestoreResult {
  id: string
  path: string
  name: string
  success: boolean
  error: string | null
}

/** 导入结果 */
export interface ImportResult {
  success: boolean
  appState: Record<string, unknown> | null
  localStorageData: Record<string, string> | null
  projects: ProjectRestoreResult[]
  warnings: string[]
  error: string | null
  replaceLocalStorage?: boolean
}

export interface BackupContents {
  globalConfig: boolean
  uiPreferences: boolean
  credentials: boolean
}

/** manifest 项目条目（含路径可达性） */
export interface ProjectManifestEntry {
  id: string
  path: string
  name: string
  pathAccessible: boolean
  sections: ProjectBackupSection[]
}

export interface BackupManifestPreview {
  backupVersion: number
  contents: BackupContents
  projects: ProjectManifestEntry[]
}

/** 进度事件载荷 */
export interface BackupProgressPayload {
  operation: "export" | "import"
  stage: string
  current: number
  total: number
  message: string
}

/** 进度回调 */
export type BackupProgressCallback = (payload: BackupProgressPayload) => void
