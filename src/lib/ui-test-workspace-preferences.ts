import { fileExists } from "@/commands/fs"
import { getUiTestDocumentPath } from "@/lib/ui-test-layout"
import { useWikiStore, type WikiState } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import type { WikiProject } from "@/types/wiki"

type View = WikiState["activeView"]
export interface UiTestWorkspacePreference {
  version: 1
  aiWidth?: number
  directory?: Partial<Record<View, boolean>>
  files?: Partial<Record<View, string | null>>
  lastView?: "sources" | "wiki" | "soul"
  assistant?: Partial<Record<"sources" | "wiki", boolean>>
}
export function uiTestWorkspaceKey(projectId?: string) { return `qm-uitest-workspace-v1-${projectId ?? "library"}` }
export function readUiTestWorkspacePreference(projectId?: string): UiTestWorkspacePreference {
  try {
    const data = JSON.parse(localStorage.getItem(uiTestWorkspaceKey(projectId)) ?? "null")
    if (data?.version === 1) return data
  } catch { /* 损坏的界面偏好不阻止打开小说。 */ }
  return { version: 1 }
}
export async function restoreUiTestWorkspace(project: WikiProject, saved = readUiTestWorkspacePreference(project.id)): Promise<void> {
  const current = () => {
    const active = useWikiStore.getState().project
    return active?.id === project.id && normalizePath(active.path) === normalizePath(project.path)
  }
  if (!current()) return
  const view = "wiki"
  const path = getUiTestDocumentPath(project.path, saved.files?.[view], view)
  const exists = path ? await fileExists(path).catch(() => false) : false
  if (!current()) return
  useWikiStore.getState().setActiveView(view)
  if (exists) useWikiStore.getState().setSelectedFile(path)
  const assistant = saved.assistant?.[view]
  if (typeof assistant === "boolean") useWikiStore.getState().setChatExpanded(assistant)
}
