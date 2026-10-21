import { openProject } from "@/commands/fs"
import { loadRegisteredProjects } from "@/lib/project-store"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export interface ShelfQuery {
  id?: string
  name?: string
  path?: string
}

type ShelfOpener = (project: WikiProject) => Promise<void>

let opener: ShelfOpener | null = null

export function registerShelfOpener(next: ShelfOpener | null): void {
  opener = next
}

export function findShelfBook(projects: WikiProject[], query: ShelfQuery): WikiProject {
  const id = query.id?.trim() ?? ""
  const name = query.name?.trim() ?? ""
  const path = query.path?.trim() ?? ""
  if (!id && !name && !path) throw new Error("请提供书名、id 或路径")
  if (path) {
    const key = normalizePath(path)
    const found = projects.find((project) => normalizePath(project.path) === key)
    if (!found) throw new Error("书架上没有这本书")
    return found
  }
  if (id) {
    const found = projects.find((project) => project.id === id)
    if (!found) throw new Error("书架上没有这本书")
    return found
  }
  const matches = projects.filter((project) => project.name === name)
  if (matches.length === 0) throw new Error("书架上没有这本书")
  if (matches.length > 1) throw new Error("有多本同名书，请改用 id 或路径")
  return matches[0]
}

export function formatBookshelf(projects: WikiProject[]): string {
  if (projects.length === 0) return "书架是空的"
  return projects.map((project, index) => (
    `${index + 1}. ${project.name}\nid：${project.id}\n路径：${project.path}`
  )).join("\n\n")
}

export function formatCurrentOpen(project: WikiProject | null, selectedFile: string | null): string {
  if (!project) return "当前没有打开的书"
  const file = selectedFile?.trim() ? selectedFile : "无"
  return `当前打开：${project.name}\nid：${project.id}\n路径：${project.path}\n当前文件：${file}`
}

export async function listBookshelf(load: () => Promise<WikiProject[]> = loadRegisteredProjects): Promise<string> {
  return formatBookshelf(await load())
}

export async function openBookshelf(query: ShelfQuery, deps: {
  load?: () => Promise<WikiProject[]>
  open?: (path: string) => Promise<WikiProject>
  openInApp?: ShelfOpener
} = {}): Promise<string> {
  const projects = await (deps.load ?? loadRegisteredProjects)()
  const book = findShelfBook(projects, query)
  const opened = await (deps.open ?? openProject)(book.path)
  const openInApp = deps.openInApp ?? opener
  if (!openInApp) throw new Error("应用还没准备好打开书架")
  await openInApp(opened)
  return `已打开：${opened.name}\nid：${opened.id}\n路径：${opened.path}`
}

export function getCurrentOpen(): string {
  const state = useWikiStore.getState()
  return formatCurrentOpen(state.project, state.selectedFile)
}
