import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/platform"
import { httpBackup } from "@/lib/http-adapter"
import { serverEvents } from "@/lib/server-events"
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
  if (!isTauri()) {
    // ── HTTP mode: use httpBackup + serverEvents + browser download ──
    serverEvents.connect()

    let unsubProgress: (() => void) | undefined
    try {
      if (onProgress) {
        unsubProgress = serverEvents.on("backup-progress", (event) => {
          onProgress(event.payload as never)
        })
      }

      const localStorageData = collectLocalStorage()
      const projects = await collectProjects()

      const params = {
        localStorageData,
        projects,
      }

      const result = await httpBackup.export(params) as ExportResult

      // Trigger browser download if the server returned a download URL or blob
      if (result.success) {
        try {
          const API_BASE = `http://${window.location.hostname}:5800/api`
          const res = await fetch(`${API_BASE}/backup/download`, { method: "GET" })
          if (res.ok) {
            const blob = await res.blob()
            const now = new Date()
            const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
            const filename = `qmai-backup-${dateStr}.zip`
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }
        } catch {
          // Download trigger failed, but export itself succeeded
        }
      }

      return result
    } finally {
      unsubProgress?.()
    }
  }

  // ── Tauri mode ──
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
