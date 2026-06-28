import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { loadRegistry, upsertProjectInfo } from "@/lib/project-identity"
import { refreshProjectState } from "@/lib/project-refresh"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import type {
  ImportParams,
  ImportResult,
  ImportStrategy,
  ProjectRestoreInfo,
  ProjectManifestEntry,
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

/**
 * 导入前读取备份 manifest，检查路径可达性。
 * 如果有项目路径的盘符不存在，弹窗让用户选择新目录并构建路径重映射表。
 * @returns 重映射表（projectId -> 新路径），如果无需重映射则返回空对象。
 *          如果用户取消选择，返回 null。
 */
async function checkAndRemapPaths(zipPath: string): Promise<Record<string, string> | null> {
  let manifest: ProjectManifestEntry[]
  try {
    manifest = await invoke<ProjectManifestEntry[]>("read_backup_manifest", { zipPath })
  } catch {
    // manifest 读取失败，回退到原行为（直接导入）
    return {}
  }

  const inaccessibleProjects = manifest.filter((p) => !p.pathAccessible)

  if (inaccessibleProjects.length === 0) {
    // 所有路径可达，无需重映射
    return {}
  }

  // 构建不可达项目列表描述
  const projectList = inaccessibleProjects
    .map((p) => `  · ${p.name}（原路径: ${p.path}）`)
    .join("\n")

  // 弹窗让用户选择新的基础目录
  const newBaseDir = await open({
    title: `以下 ${inaccessibleProjects.length} 个项目路径不可用，请选择新的存放目录：\n${projectList}`,
    directory: true,
    multiple: false,
  })

  if (!newBaseDir || typeof newBaseDir !== "string") {
    // 用户取消
    return null
  }

  // 构建重映射表：{ projectId: "{新目录}/{原项目文件夹名}" }
  const overrides: Record<string, string> = {}
  for (const project of inaccessibleProjects) {
    const folderName = project.path.split(/[\\/]/).filter(Boolean).pop() || project.id
    overrides[project.id] = `${newBaseDir}\\${folderName}`
  }

  return overrides
}

/**
 * 读取备份文件的 manifest，返回项目列表。
 * 供 UI 组件在导入前预览项目列表使用。
 */
export async function readBackupManifest(zipPath: string): Promise<ProjectManifestEntry[]> {
  return await invoke<ProjectManifestEntry[]>("read_backup_manifest", { zipPath })
}

/**
 * 打开文件选择对话框选择备份文件。
 */
export async function selectBackupFile(): Promise<string | null> {
  const zipPath = await open({
    filters: [{ name: "ZIP 备份文件", extensions: ["zip"] }],
    multiple: false,
  })
  return typeof zipPath === "string" ? zipPath : null
}

export async function importBackup(
  strategy: ImportStrategy,
  projects?: ProjectRestoreInfo[],
  onProgress?: BackupProgressCallback,
  zipPath?: string,
): Promise<ImportResult> {
  // 如果没有传入 zipPath，则弹出文件选择对话框
  if (!zipPath) {
    zipPath = await selectBackupFile() ?? undefined
    if (!zipPath) {
      return {
        success: false,
        appState: null,
        localStorageData: null,
        projects: [],
        warnings: [],
        error: "用户取消了导入",
      }
    }
  }

  // 导入前检查路径可达性，必要时弹窗让用户选择新目录
  const pathOverrides = await checkAndRemapPaths(zipPath)
  if (pathOverrides === null) {
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
    projectPathOverrides: Object.keys(pathOverrides).length > 0 ? pathOverrides : undefined,
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
