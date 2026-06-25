import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/platform"
import { serverEvents } from "@/lib/server-events"
import { loadRegistry, upsertProjectInfo } from "@/lib/project-identity"
import { refreshProjectState } from "@/lib/project-refresh"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import type {
  ImportParams,
  ImportResult,
  ImportStrategy,
  ProjectRestoreInfo,
  BackupProgressCallback,
} from "./types"

/**
 * 如果导入的项目包含当前打开的项目，则刷新当前项目的文件树和数据版本，
 * 让知识树等组件自动重新加载，无需用户手动重启或重新打开项目。
 */
async function refreshCurrentProjectIfNeeded(restoredProjects: Array<{ path: string; success: boolean }>): Promise<void> {
  const currentProject = useWikiStore.getState().project
  if (!currentProject) return

  const currentPath = normalizePath(currentProject.path)
  const needsRefresh = restoredProjects.some(
    (p) => p.success && normalizePath(p.path) === currentPath,
  )

  if (needsRefresh) {
    await refreshProjectState(currentPath)
  }
}

function pickFileBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".zip"
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      resolve(file)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function importBackup(
  strategy: ImportStrategy,
  projects?: ProjectRestoreInfo[],
  onProgress?: BackupProgressCallback,
): Promise<ImportResult> {
  if (!isTauri()) {
    // ── HTTP mode: use file input + httpBackup + serverEvents ──
    const file = await pickFileBrowser()
    if (!file) {
      return {
        success: false,
        appState: null,
        localStorageData: null,
        projects: [],
        warnings: [],
        error: "用户取消了导入",
      }
    }

    serverEvents.connect()

    let unsubProgress: (() => void) | undefined
    try {
      if (onProgress) {
        unsubProgress = serverEvents.on("backup-progress", (event) => {
          onProgress(event.payload as never)
        })
      }

      // Upload the file to the server via FormData
      const API_BASE = `http://${window.location.hostname}:5800/api`
      const formData = new FormData()
      formData.append("file", file)
      formData.append("strategy", strategy)
      if (projects) {
        formData.append("projects", JSON.stringify(projects))
      }

      const res = await fetch(`${API_BASE}/backup/import-upload`, {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        return {
          success: false,
          appState: null,
          localStorageData: null,
          projects: [],
          warnings: [],
          error: `导入失败: HTTP ${res.status}`,
        }
      }

      const json = await res.json()
      const result: ImportResult = json.data || json

      if (result.success && result.localStorageData) {
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

      if (result.success && result.projects.length > 0) {
        for (const project of result.projects) {
          if (project.success) {
            const registry = await loadRegistry()
            const existing = registry[project.id]
            await upsertProjectInfo(project.id, project.path, existing?.name ?? project.name)
          }
        }
        // 如果导入的是当前打开的项目，自动刷新
        await refreshCurrentProjectIfNeeded(result.projects)
      }

      return result
    } finally {
      unsubProgress?.()
    }
  }

  // ── Tauri mode ──
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
          await upsertProjectInfo(project.id, project.path, existing?.name ?? project.name)
        }
      }
      // 如果导入的是当前打开的项目，自动刷新
      await refreshCurrentProjectIfNeeded(result.projects)
    }

    return result
  } finally {
    unlisten?.()
  }
}
