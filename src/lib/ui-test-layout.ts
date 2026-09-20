import type { FileNode } from "@/types/wiki"

export const UI_TEST_AI_DEFAULT_WIDTH = 320
export const UI_TEST_AI_MIN_WIDTH = 280
export const UI_TEST_AI_MAX_WIDTH = 520
export const UI_TEST_PANEL_GAP = 12

export function getUiTestPanelLayout(containerWidth: number, requestedWidth: number, viewportWidth: number) {
  const width = Math.max(0, Number.isFinite(containerWidth) ? containerWidth : 0)
  const editorMin = viewportWidth >= 1180 ? 480 : 360
  const tabs = viewportWidth < 768 || width < editorMin + UI_TEST_AI_MIN_WIDTH + UI_TEST_PANEL_GAP
  if (tabs) return { mode: "tabs" as const, aiWidth: width, editorWidth: width, maxAiWidth: UI_TEST_AI_MAX_WIDTH }
  const maxAiWidth = Math.min(UI_TEST_AI_MAX_WIDTH, width - UI_TEST_PANEL_GAP - editorMin)
  const desired = Number.isFinite(requestedWidth) ? requestedWidth : UI_TEST_AI_DEFAULT_WIDTH
  const aiWidth = Math.round(Math.max(UI_TEST_AI_MIN_WIDTH, Math.min(maxAiWidth, desired)))
  return { mode: "split" as const, aiWidth, editorWidth: width - UI_TEST_PANEL_GAP - aiWidth, maxAiWidth }
}

export function resizeUiTestAiByKey(width: number, key: string): number {
  if (key === "Home") return UI_TEST_AI_MIN_WIDTH
  if (key === "End") return UI_TEST_AI_MAX_WIDTH
  const step = key === "ArrowLeft" ? 16 : key === "ArrowRight" ? -16 : 0
  return Math.max(UI_TEST_AI_MIN_WIDTH, Math.min(UI_TEST_AI_MAX_WIDTH, width + step))
}

export function filterUiTestDirectory(nodes: FileNode[], query: string, titles: Map<string, string>): FileNode[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return nodes
  return nodes.flatMap((node) => {
    if (`${node.name} ${titles.get(node.path) ?? ""}`.toLocaleLowerCase().includes(term)) return [node]
    if (!node.is_dir) return []
    const children = filterUiTestDirectory(node.children ?? [], term, titles)
    return children.length ? [{ ...node, children }] : []
  })
}

/** 恢复的是本书内相对文档；拒绝跨书、越级路径与错误视图类型。 */
export function getUiTestDocumentPath(projectPath: string, storedPath: string | null | undefined, view: "wiki" | "sources"): string | null {
  if (typeof storedPath !== "string") return null
  const base = projectPath.replace(/\\/g, "/").replace(/\/+$/, "")
  const path = storedPath.replace(/\\/g, "/")
  if (path.split("/").some(part => part === ".." || part === ".")) return null
  const relative = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  const folder = view === "sources" ? "outlines" : "chapters"
  if (!relative.startsWith(`wiki/${folder}/`) || !relative.toLowerCase().endsWith(".md")) return null
  return `${base}/${relative}`
}
