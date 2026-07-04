import { normalizePath } from "@/lib/path-utils"
import { refreshProjectFileTree } from "@/lib/project-file-tree-refresh"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 重新加载项目文件树并 bump 数据版本，用于 AI 生成/保存文件后
 * 无感刷新左侧知识树等依赖 fileTree/dataVersion 的界面。
 */
export async function refreshProjectState(projectPath: string | undefined | null): Promise<void> {
  if (!projectPath) return
  const pp = normalizePath(projectPath)
  try {
    await refreshProjectFileTree(pp, { bumpDataVersion: true })
  } catch (err) {
    useWikiStore.getState().bumpDataVersion()
    console.error("[refreshProjectState] 刷新文件树失败:", err)
  }
}
