/** 前端传入 Rust 端的项目信息 */
export interface ProjectBackupInfo {
  id: string
  path: string
  name: string
}

/** 导出参数 */
export interface ExportParams {
  savePath: string
  localStorageData: Record<string, string>
  projects: ProjectBackupInfo[]
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
}

/** 备份清单（zip 内 manifest.json） */
export interface BackupManifest {
  backupVersion: number
  createdAt: string
  appVersion: string
  projects: ProjectBackupInfo[]
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
