import { normalizePath } from "@/lib/path-utils"

export interface OpenDocumentGuard {
  path: string
  isDirty: () => boolean
  /** 编辑器里的当前正文。一键提取改状态时用来保住未保存修改。 */
  getMarkdown?: () => string
  applyMarkdown: (markdown: string) => void
}

let current: OpenDocumentGuard | null = null

export function registerOpenDocument(guard: OpenDocumentGuard | null): void {
  current = guard
}

export function getOpenDocumentGuard(path: string): OpenDocumentGuard | null {
  if (!current) return null
  return normalizePath(current.path) === normalizePath(path) ? current : null
}
