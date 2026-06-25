import { isTauri } from "@/lib/platform"

export const SEARCH_WINDOW_LABEL = "search"
export const SEARCH_CONTEXT_EVENT = "qmai://search-window-context"
export const SEARCH_OPEN_FILE_EVENT = "qmai://search-open-file"

export interface SearchWindowContext {
  projectId: string
  projectName: string
  projectPath: string
  novelMode: boolean
}

export interface SearchOpenFilePayload {
  path: string
  scrollImageSrc?: string | null
}

export function getSearchWindowContextFromLocation(): SearchWindowContext | null {
  if (typeof window === "undefined") return null
  const raw = new URLSearchParams(window.location.search).get("searchContext")
  if (!raw) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SearchWindowContext>
    if (
      typeof parsed.projectId !== "string" ||
      typeof parsed.projectName !== "string" ||
      typeof parsed.projectPath !== "string" ||
      typeof parsed.novelMode !== "boolean"
    ) {
      return null
    }
    return {
      projectId: parsed.projectId,
      projectName: parsed.projectName,
      projectPath: parsed.projectPath,
      novelMode: parsed.novelMode,
    }
  } catch {
    return null
  }
}

export async function openSearchWindow(context: SearchWindowContext): Promise<boolean> {
  if (!isTauri()) return false

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")

  const existing = await WebviewWindow.getByLabel(SEARCH_WINDOW_LABEL)
  if (existing) {
    await existing.emit(SEARCH_CONTEXT_EVENT, context)
    await existing.setFocus()
    await existing.show()
    return true
  }

  const searchContext = encodeURIComponent(JSON.stringify(context))
  const url = `/?searchContext=${searchContext}`
  const searchWindow = new WebviewWindow(SEARCH_WINDOW_LABEL, {
    title: "搜索",
    url,
    width: 760,
    height: 860,
    minWidth: 560,
    minHeight: 640,
    center: true,
    resizable: true,
    focus: true,
  })

  searchWindow.once("tauri://created", async () => {
    await searchWindow.emit(SEARCH_CONTEXT_EVENT, context)
  }).catch(() => {})

  searchWindow.once("tauri://error", (event) => {
    console.error("创建搜索窗口失败:", event.payload)
  }).catch(() => {})

  return true
}

