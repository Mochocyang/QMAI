import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { loadRegistry, upsertProjectInfo } from "@/lib/project-identity"
import { refreshProjectState } from "@/lib/project-refresh"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { registerUiTestProjects } from "@/lib/ui-test-library"
import { planLocalStorageReplacement } from "./local-storage"
import type {
  ImportParams,
  ImportResult,
  ImportStrategy,
  ProjectRestoreInfo,
  ProjectManifestEntry,
  BackupManifestPreview,
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
 * 把恢复成功的项目登记进书架索引，让它们**立刻出现在书架上**。
 *
 * ── 为什么必须有这一步 ──
 * 恢复出来的项目此前只写了 app-state 的 `projectRegistry`，而书架的列表来源是
 * localStorage 里的 `qm-uitest-library`。两者是两个独立的存储：
 * 用户导入一份「仅项目内容」备份（不含 app-state、不含 localStorage）之后，
 * 文件确实回到了磁盘，但书架索引里没有它们 —— 界面上就是**一本书都没有**，
 * 用户合理地认为"备份恢复失败/我的书丢了"。
 *
 * 名称优先用恢复结果里的（它来自 manifest / project-registry.json，
 * 是备份时那份书名的真实记录），没有才退到 id。
 *
 * 单本书登记失败不能影响其它书：书架索引写坏会抛错，这里逐本兜住并给出警告，
 * 因为项目文件已经成功落盘，此时中断会把"其实恢复好了"变成一次失败。
 */
function registerRestoredProjectsOnShelf(
  restored: Array<{ id: string; path: string; name: string; success: boolean }>,
): void {
  const projects = restored
    .filter((project) => project.success && project.path.trim())
    .map((project) => ({
      id: project.id,
      path: project.path,
      name: project.name.trim() || project.id,
    }))
  if (projects.length === 0) return

  try {
    registerUiTestProjects(projects)
    return
  } catch {
    /*
     * 整批失败时退化成"逐本登记"。
     *
     * 书架索引对每条记录都做校验（要求 id/书名非空、路径为绝对路径），
     * 任何一条不合格都会让整批写入被拒绝。批量失败就放弃，会让
     * 其余**完全正常**的书也一起上不了书架 —— 用户看到的是"恢复成功了但没有书"。
     * 所以这里逐本重试，只把真正写不进去的那本记进控制台。
     */
  }

  let failed = 0
  for (const project of projects) {
    try {
      registerUiTestProjects([project])
    } catch {
      failed += 1
    }
  }
  if (failed > 0) {
    console.warn(
      `[backup] ${projects.length - failed} 个项目已登记进书架，${failed} 个写入失败。` +
        `这些项目已恢复到磁盘，可在书架手动重新打开一次。`,
    )
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
    const preview = await invoke<BackupManifestPreview>("read_backup_manifest", { zipPath })
    manifest = preview.projects
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
export async function readBackupManifest(zipPath: string): Promise<BackupManifestPreview> {
  return await invoke<BackupManifestPreview>("read_backup_manifest", { zipPath })
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
  const pathOverrides = strategy === "global-only" ? {} : await checkAndRemapPaths(zipPath)
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
      if (result.replaceLocalStorage !== false) {
        /*
         * 清除范围由 planLocalStorageReplacement 决定（按命名空间分组，
         * 只清备份里真的带了的那几组）。不要在这里直接按前缀遍历删除：
         * 旧版本备份不含 qm-uitest- 组，那样做会把书架索引与皮肤删掉且填不回来。
         */
        const currentKeys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key) currentKeys.push(key)
        }
        for (const key of planLocalStorageReplacement(currentKeys, result.localStorageData)) {
          localStorage.removeItem(key)
        }
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
      registerRestoredProjectsOnShelf(result.projects)
      // 如果导入的是当前打开的项目，自动刷新
      await refreshCurrentProjectIfNeeded(result.projects)
    }

    return result
  } finally {
    unlisten?.()
  }
}
