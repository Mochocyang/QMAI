import type { WikiProject } from "@/types/wiki"
import { isAbsolutePath, normalizeComparablePath } from "@/lib/path-utils"
import { IS_UI_TEST_BUILD, UI_TEST_STORAGE_PREFIX } from "@/lib/ui-test"

const LIBRARY_KEY = `${UI_TEST_STORAGE_PREFIX}library`
const READ_ERROR = "书架索引读取失败，原始记录已保留，请勿清除本地数据。"

function isProject(value: unknown): value is WikiProject {
  if (!value || typeof value !== "object") return false
  const project = value as Partial<WikiProject>
  return typeof project.id === "string" && !!project.id.trim()
    && typeof project.name === "string" && !!project.name.trim()
    && typeof project.path === "string" && isAbsolutePath(project.path)
}

function pathKey(path: string): string {
  const normalized = normalizeComparablePath(path)
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}

/** 保留完整目录；稳定 ID 的迁移或同一路径的重新打开更新原位置，不按书名合并。 */
export function mergeUiTestProjects(...lists: WikiProject[][]): WikiProject[] {
  let merged: WikiProject[] = []
  for (const projects of lists) {
    for (const project of projects) {
      if (!isProject(project)) throw new Error(READ_ERROR)
      const matches = (item: WikiProject) => item.id === project.id || pathKey(item.path) === pathKey(project.path)
      const index = merged.findIndex(matches)
      const record = { id: project.id, name: project.name, path: project.path }
      if (index === -1) {
        merged.push(record)
      } else {
        merged = merged.filter((item) => !matches(item))
        merged.splice(index, 0, record)
      }
    }
  }
  return merged
}

export function getUiTestProjects(): WikiProject[] {
  if (!IS_UI_TEST_BUILD || typeof localStorage === "undefined") return []
  let raw: string | null
  try {
    raw = localStorage.getItem(LIBRARY_KEY)
  } catch {
    throw new Error(READ_ERROR)
  }
  if (raw === null) return []

  let index: { schemaVersion?: unknown; projects?: unknown } | null
  try {
    index = JSON.parse(raw)
  } catch {
    throw new Error(READ_ERROR)
  }
  if (!index || typeof index !== "object") throw new Error(READ_ERROR)
  if (index.schemaVersion !== 1) {
    throw new Error("书架索引版本暂不受支持，原始记录已保留，未覆盖或迁移。")
  }
  if (!Array.isArray(index.projects) || !index.projects.every(isProject)) {
    throw new Error(READ_ERROR)
  }
  return mergeUiTestProjects(index.projects)
}

/** 仅写测试版本机侧车；读取损坏或高版本索引时拒绝覆盖，不触碰正式存储与项目文件。 */
export function registerUiTestProjects(projects: WikiProject[]): void {
  if (!IS_UI_TEST_BUILD) return
  const merged = mergeUiTestProjects(getUiTestProjects(), projects)
  if (typeof localStorage === "undefined") {
    throw new Error("当前环境不支持保存本地书架记录。")
  }
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schemaVersion: 1, projects: merged }))
  } catch {
    throw new Error("书架索引保存失败，请检查本地存储空间；小说文件未受影响。")
  }
}

export function replaceUiTestProjectPath(from: string, project: WikiProject): void {
  if (!IS_UI_TEST_BUILD) return
  const projects = getUiTestProjects().map((item) => pathKey(item.path) === pathKey(from) ? project : item)
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schemaVersion: 1, projects: mergeUiTestProjects(projects) }))
}

/** Shell 在成功打开或创建后调用；存储失败抛中文错误，调用方可提示但不应中断开书。 */
export function registerUiTestProject(project: WikiProject): void {
  registerUiTestProjects([project])
}
