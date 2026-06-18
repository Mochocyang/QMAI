import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { loadRegistry, upsertProjectInfo } from "@/lib/project-identity"
import type {
  ImportParams,
  ImportResult,
  ImportStrategy,
  ProjectRestoreInfo,
  BackupProgressCallback,
} from "./types"

export async function importBackup(
  strategy: ImportStrategy,
  projects?: ProjectRestoreInfo[],
  onProgress?: BackupProgressCallback,
): Promise<ImportResult> {
  const zipPath = await open({
    filters: [{ name: "ZIP 备份文件", extensions: ["zip"] }],
    multiple: false,
  })

  if (!zipPath || typeof zipPath !== "string") {
    return {
      success: false,
      appState: null,
      localStorageData: null,
      projects: [],
      warnings: [],
      error: "用户取消了导入",
    }
  }

  const params: ImportParams = {
    zipPath,
    strategy,
    projects,
  }

  let unlisten: UnlistenFn | undefined
  try {
    if (onProgress) {
      unlisten = await listen("backup-progress", (event) => {
        onProgress(event.payload as never)
      })
    }

    const result = await invoke<ImportResult>("import_backup", { params })

    if (!result.success) {
      return result
    }

    if (result.localStorageData) {
      const prefixes = ["qmai", "lk-"]
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && prefixes.some((p) => key.startsWith(p))) {
          keysToRemove.push(key)
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key)
      }
      for (const [key, value] of Object.entries(result.localStorageData)) {
        localStorage.setItem(key, value)
      }
    }

    if (result.projects.length > 0) {
      for (const project of result.projects) {
        if (project.success) {
          const registry = await loadRegistry()
          const existing = registry[project.id]
          await upsertProjectInfo(project.id, project.path, existing?.name ?? "已恢复项目")
        }
      }
    }

    return result
  } finally {
    unlisten?.()
  }
}
