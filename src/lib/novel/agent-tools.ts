/**
 * Agent Tools - 文件操作工具层
 *
 * 为 AI Agent 提供安全的文件读写能力：
 * - 读取指定范围的文件
 * - 应用修改（search & replace）
 * - 列出可操作的文件
 */

import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { FileEditAction } from "./agent-parser"

export interface FileEditResult {
  filePath: string
  success: boolean
  error?: string
  /** 修改前的完整内容（用于 undo） */
  originalContent?: string
  /** 修改后的完整内容 */
  newContent?: string
}

/**
 * 列出指定目录下的所有 markdown 文件
 */
export async function listScopeFiles(
  projectPath: string,
  scope: "chapters" | "outlines",
): Promise<{ name: string; path: string }[]> {
  const pp = normalizePath(projectPath)
  const dir = scope === "chapters" ? `${pp}/wiki/chapters` : `${pp}/wiki/outlines`
  try {
    const tree = await listDirectory(dir)
    return tree
      .filter((f) => f.name.endsWith(".md"))
      .map((f) => ({ name: f.name, path: `${dir}/${f.name}` }))
  } catch {
    return []
  }
}

/**
 * 读取指定范围内的文件内容（用于注入 Agent 上下文）
 */
export async function readScopeFileContents(
  projectPath: string,
  scope: "chapters" | "outlines",
  maxFiles = 10,
  maxCharsPerFile = 4000,
): Promise<{ name: string; path: string; content: string }[]> {
  const files = await listScopeFiles(projectPath, scope)
  const results: { name: string; path: string; content: string }[] = []

  for (const file of files.slice(0, maxFiles)) {
    try {
      const content = await readFile(file.path)
      const trimmed = content.length > maxCharsPerFile
        ? content.slice(0, maxCharsPerFile) + "\n...(内容已截断)"
        : content
      results.push({ ...file, content: trimmed })
    } catch {
      // skip unreadable files
    }
  }

  return results
}

/**
 * 应用单个文件修改
 * 使用 search & replace 策略：在文件中找到 search 文本，替换为 replace 文本
 */
export async function applyFileEdit(
  projectPath: string,
  edit: FileEditAction,
): Promise<FileEditResult> {
  const pp = normalizePath(projectPath)
  // 安全检查：确保路径在允许范围内
  const fullPath = edit.filePath.startsWith(pp)
    ? edit.filePath
    : `${pp}/${edit.filePath}`

  const normalizedPath = normalizePath(fullPath)

  // 检查路径是否在 wiki/chapters 或 wiki/outlines 下
  if (!normalizedPath.includes("/wiki/chapters/") && !normalizedPath.includes("/wiki/outlines/")) {
    return {
      filePath: edit.filePath,
      success: false,
      error: "只能修改 wiki/chapters/ 或 wiki/outlines/ 下的文件",
    }
  }

  try {
    const originalContent = await readFile(normalizedPath)

    if (!originalContent.includes(edit.search)) {
      return {
        filePath: edit.filePath,
        success: false,
        error: "未找到要替换的内容（search 文本不匹配）",
        originalContent,
      }
    }

    const newContent = originalContent.replace(edit.search, edit.replace)
    await writeFile(normalizedPath, newContent)

    return {
      filePath: edit.filePath,
      success: true,
      originalContent,
      newContent,
    }
  } catch (err) {
    return {
      filePath: edit.filePath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 批量应用文件修改
 */
export async function applyFileEdits(
  projectPath: string,
  edits: FileEditAction[],
): Promise<FileEditResult[]> {
  const results: FileEditResult[] = []
  for (const edit of edits) {
    results.push(await applyFileEdit(projectPath, edit))
  }
  return results
}

/**
 * 撤销文件修改（恢复原始内容）
 */
export async function undoFileEdit(result: FileEditResult): Promise<boolean> {
  if (!result.success || !result.originalContent) return false
  try {
    const pp = result.filePath
    await writeFile(pp, result.originalContent)
    return true
  } catch {
    return false
  }
}
