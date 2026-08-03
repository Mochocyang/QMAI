import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

const ENTITY_DIRS = ["wiki/entities", "wiki/characters", "wiki/concepts"] as const
const MIN_NAME_LENGTH = 2

function flattenMarkdownFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMarkdownFiles(node.children))
      continue
    }
    if (!node.is_dir && node.name.toLowerCase().endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

/**
 * 列出本地实体相关目录下的 .md 文件名（去扩展名），不读正文。
 */
export async function listLocalEntityNames(projectPath: string): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const names = new Set<string>()

  await Promise.all(
    ENTITY_DIRS.map(async (relativeDir) => {
      try {
        const nodes = await listDirectory(`${pp}/${relativeDir}`)
        for (const file of flattenMarkdownFiles(nodes)) {
          const name = file.name.replace(/\.md$/i, "").trim()
          if (name.length >= MIN_NAME_LENGTH) names.add(name)
        }
      } catch {
        // 目录不存在时忽略
      }
    }),
  )

  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"))
}

/**
 * 用户消息是否提到任一本地实体名（子串匹配，名称长度 ≥ 2）。
 */
export function hasLocalEntityMention(message: string, names: readonly string[]): boolean {
  if (!message.trim() || names.length === 0) return false
  return names.some((name) => name.length >= MIN_NAME_LENGTH && message.includes(name))
}

/**
 * 人物/设定查询时：本地实体表为空，或消息未命中任何本地实体名。
 */
export async function detectLocalEntityMiss(
  projectPath: string,
  userMessage: string,
): Promise<boolean> {
  const names = await listLocalEntityNames(projectPath)
  return !hasLocalEntityMention(userMessage, names)
}
