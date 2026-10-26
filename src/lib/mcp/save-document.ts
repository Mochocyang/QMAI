import { writeFileAtomic } from "@/commands/fs"
import { refreshProjectState } from "@/lib/project-refresh"
import { getOpenDocumentGuard } from "./open-document"
import { requireProjectDocument } from "./paths"

export async function saveProjectDocument(input: {
  projectPath: string
  path: string
  content: string
  overwrite?: boolean
}, write: (path: string, content: string) => Promise<void> = writeFileAtomic): Promise<string> {
  requireProjectDocument(input.projectPath, input.path)
  const guard = getOpenDocumentGuard(input.path)
  if (guard?.isDirty() && input.overwrite !== true) {
    throw new Error("该文件在编辑器中有未保存的修改。确认覆盖请传入 overwrite: true")
  }
  await write(input.path, input.content)
  guard?.applyMarkdown(input.content)
  await refreshProjectState(input.projectPath)
  return `已保存 ${input.path}`
}
