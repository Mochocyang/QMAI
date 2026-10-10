import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  BackupExportOptions,
  ExportParams,
  ExportResult,
  BackupProgressCallback,
} from "./types"
import { backupPrefixGroupOf } from "./local-storage"
const SENSITIVE_STORAGE_KEY = /(api[_-]?key|token|secret|password|fingerprint)/i

function collectLocalStorage(includeCredentials: boolean): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (backupPrefixGroupOf(key) !== null) {
      if (!includeCredentials && SENSITIVE_STORAGE_KEY.test(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) {
        data[key] = value
      }
    }
  }
  return data
}

export async function exportBackup(
  options: BackupExportOptions,
  onProgress?: BackupProgressCallback,
): Promise<ExportResult> {
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  const defaultName = `qmai-backup-${dateStr}.zip`

  const savePath = await save({
    defaultPath: defaultName,
    filters: [{ name: "ZIP 备份文件", extensions: ["zip"] }],
  })

  if (!savePath) {
    return {
      success: false,
      warnings: [],
      fileCount: 0,
      totalSize: 0,
      error: "用户取消了导出",
    }
  }

  const localStorageData = options.includeUiPreferences
    ? collectLocalStorage(options.includeCredentials)
    : {}

  const params: ExportParams = {
    savePath,
    includeGlobalConfig: options.includeGlobalConfig,
    includeUiPreferences: options.includeUiPreferences,
    includeCredentials: options.includeCredentials,
    localStorageData,
    projects: options.projects,
  }

  let unlisten: UnlistenFn | undefined
  try {
    if (onProgress) {
      unlisten = await listen("backup-progress", (event) => {
        onProgress(event.payload as never)
      })
    }

    const result = await invoke<ExportResult>("export_backup", { params })
    return result
  } finally {
    unlisten?.()
  }
}
