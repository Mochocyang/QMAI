import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { getCurrentOpen, listBookshelf, openBookshelf } from "./bookshelf"
import { extractProjectMemory } from "./extract-memory"
import { formatProjectChapter } from "./format-chapter"
import { classifyProjectDocument } from "./paths"
import { renameProjectDocument, siblingFromMarkdown } from "./rename-document"
import { saveProjectDocument } from "./save-document"
import { runWritingConversation } from "./writing-conversation"

function textArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function requireProjectPath(args: Record<string, unknown>): string {
  const given = textArg(args.projectPath)
  if (given) return given
  const current = useWikiStore.getState().project?.path
  if (!current) throw new Error("没有打开的项目，请传入 projectPath")
  return current
}

function flattenMarkdown(nodes: FileNode[]): string[] {
  const files: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flattenMarkdown(node.children))
    else if (!node.is_dir && node.name.endsWith(".md")) files.push(node.path)
  }
  return files
}

async function siblingsFor(projectPath: string, path: string) {
  const kind = classifyProjectDocument(projectPath, path)
  if (!kind) return []
  const directory = normalizePath(path).slice(0, normalizePath(path).lastIndexOf("/"))
  const nodes = await listDirectory(directory).catch(() => [])
  const siblings = []
  for (const filePath of flattenMarkdown(nodes)) {
    if (normalizePath(filePath) === normalizePath(path)) continue
    try {
      siblings.push(siblingFromMarkdown(filePath, await readFile(filePath), kind))
    } catch {
      // 读不到的邻文件不参与重名判断。
    }
  }
  return siblings
}

export async function dispatchMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "list_bookshelf") return listBookshelf()
  if (name === "open_bookshelf") {
    return openBookshelf({
      id: textArg(args.id),
      name: textArg(args.name),
      path: textArg(args.path),
    })
  }
  if (name === "get_current") return getCurrentOpen()
  const projectPath = requireProjectPath(args)
  if (name === "writing_conversation") {
    return runWritingConversation({
      projectPath,
      message: textArg(args.message),
      conversationId: textArg(args.conversationId) || undefined,
      workflowMode: args.workflowMode,
      model: args.model,
      reasoningDepth: args.reasoningDepth,
    })
  }
  const path = textArg(args.path)
  if (!path) throw new Error("请提供文件 path")
  if (name === "save_document") {
    return saveProjectDocument({
      projectPath,
      path,
      content: typeof args.content === "string" ? args.content : "",
      overwrite: args.overwrite === true,
    })
  }
  if (name === "update_document_title") {
    const title = textArg(args.title)
    if (!title) throw new Error("标题不能为空")
    const renamed = await renameProjectDocument({
      projectPath,
      path,
      title,
      siblings: await siblingsFor(projectPath, path),
    })
    return `标题已改为 ${renamed.title}\n路径：${renamed.path}`
  }
  if (name === "extract_memory") {
    return extractProjectMemory({ projectPath, path, allowDraft: args.allowDraft === true })
  }
  if (name === "format_chapter") {
    return formatProjectChapter({ projectPath, path })
  }
  throw new Error(`未知的 MCP 工具：${name}`)
}

export async function handleMcpToolCall(params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const record = params && typeof params === "object" ? params as { name?: unknown; arguments?: unknown } : {}
  const name = typeof record.name === "string" ? record.name : ""
  const args = record.arguments && typeof record.arguments === "object"
    ? record.arguments as Record<string, unknown>
    : {}
  const text = await dispatchMcpTool(name, args)
  return { content: [{ type: "text", text }] }
}
