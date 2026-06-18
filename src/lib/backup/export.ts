import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { loadRegistry } from "@/lib/project-identity"
import type {
  ExportParams,
  ExportResult,
  ProjectBackupInfo,
  BackupProgressCallback,
} from "./types"

const LS_PREFIXES = ["qmai", "lk-"]

function collectLocalStorage(): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (LS_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      const value = localStorage.getItem(key)
      if (value !== null) {
        data[key] = value
      }
    }
  }
  return data
}

async function collectProjects(): Promise<ProjectBackupInfo[]> {
  const registry = await loadRegistry()
  return Object.values(registry).map((entry) => ({
    id: entry.id,
    path: entry.path,
    name: entry.name,
  }))
}

export async function exportBackup(
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

  const localStorageData = collectLocalStorage()
  const projects = await collectProjects()

  const params: ExportParams = {
    savePath,
    localStorageData,
    projects,
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
