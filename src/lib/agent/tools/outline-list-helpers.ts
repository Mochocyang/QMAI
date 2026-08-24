/**
 * list_outlines 列表与标注：文件夹优先，旧 frontmatter type 仅作兼容附加。
 */

import { listDirectory, readFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { DEFAULT_OUTLINE_FOLDERS } from "@/lib/novel/outline-workbench"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

const STANDARD_OUTLINE_FOLDERS = new Set(DEFAULT_OUTLINE_FOLDERS.map((folder) => folder.name))

export interface OutlineListEntry {
  /** 相对 outlines 根目录的路径，含 .md */
  relativePath: string
  absolutePath: string
  /** 路径首段命中标准大纲文件夹时 */
  folder?: string
  type?: string
  outlineType?: string
}

function scalarFrontmatterString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

export function extractOutlineTypeFields(content: string): {
  type?: string
  outlineType?: string
} {
  const { frontmatter } = parseFrontmatter(content)
  if (!frontmatter) return {}
  return {
    type: scalarFrontmatterString(frontmatter.type),
    outlineType: scalarFrontmatterString(frontmatter.outline_type),
  }
}

/** 从相对路径首段解析标准大纲文件夹名 */
export function extractOutlineFolder(relativePath: string): string | undefined {
  const first = relativePath.split("/").filter(Boolean)[0]
  if (!first || first.toLowerCase().endsWith(".md")) return undefined
  return STANDARD_OUTLINE_FOLDERS.has(first) ? first : undefined
}

async function collectOutlineMarkdownFiles(
  rootDir: string,
  depth = 0,
  maxDepth = 4,
): Promise<Array<{ name: string; path: string }>> {
  let entries: FileNode[] = []
  try {
    entries = await listDirectory(rootDir)
  } catch {
    return []
  }

  const files: Array<{ name: string; path: string }> = []
  for (const entry of entries) {
    if (!entry.is_dir) {
      if (entry.name.toLowerCase().endsWith(".md")) {
        files.push({ name: entry.name, path: entry.path })
      }
      continue
    }
    if (depth >= maxDepth) continue
    files.push(...(await collectOutlineMarkdownFiles(entry.path, depth + 1, maxDepth)))
  }
  return files
}

function toRelativePath(outlinesDir: string, absolutePath: string): string {
  const root = normalizePath(outlinesDir).replace(/\/$/, "")
  const full = normalizePath(absolutePath)
  if (full === root) return ""
  if (full.startsWith(`${root}/`)) return full.slice(root.length + 1)
  return full.split("/").pop() ?? full
}

export function formatOutlineListLine(entry: OutlineListEntry, index: number): string {
  const parts = [`${index + 1}. ${entry.relativePath}`]
  if (entry.folder) parts.push(`folder=${entry.folder}`)
  if (entry.type) parts.push(`type=${entry.type}`)
  if (entry.outlineType) parts.push(`outline_type=${entry.outlineType}`)
  return parts.join("  ")
}

const FRONTMATTER_READ_CHARS = 8192

export async function listOutlineEntries(
  outlinesDir: string,
  readTextFile: (path: string) => Promise<string> = readFile,
): Promise<OutlineListEntry[]> {
  const files = await collectOutlineMarkdownFiles(outlinesDir)
  const entries: OutlineListEntry[] = []

  for (const file of files) {
    const relativePath = toRelativePath(outlinesDir, file.path) || file.name
    const folder = extractOutlineFolder(relativePath)
    let type: string | undefined
    let outlineType: string | undefined
    try {
      const content = await readTextFile(file.path)
      // 只需 frontmatter；大卷纲全文可达数百 KB，避免 list 时整文件读入。
      const fields = extractOutlineTypeFields(content.slice(0, FRONTMATTER_READ_CHARS))
      type = fields.type
      outlineType = fields.outlineType
    } catch {
      // 单个文件读失败仍列入清单
    }
    entries.push({
      relativePath,
      absolutePath: file.path,
      folder,
      type,
      outlineType,
    })
  }

  entries.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN", { numeric: true }),
  )
  return entries
}

export function buildOutlineListToolResult(
  entries: OutlineListEntry[],
  targetChapterNumber?: number,
): string {
  if (entries.length === 0) {
    return "可用大纲列表:\n（空）"
  }

  const lines = [
    "可用大纲列表:",
    ...entries.map((entry, index) => formatOutlineListLine(entry, index)),
    "",
    "说明：优先按文件夹（folder）分流；无标准文件夹时再参考旧 frontmatter 的 type / outline_type。",
    "- 大纲：索引/总纲入口，用来发现规则与卷纲入口；通常不是本章剧情细纲。",
    "- 设定：全书硬约束/机制，写正文前关注并读取相关项；不要用章号匹配。",
    "- 章纲：本章主候选，按目标章号定位后读正文。",
    "- 卷纲：卷级候选，确认章号落在该卷后再读。",
    "- 人物小传 / 伏笔 / 组织：辅助资料，不当本章剧情大纲。",
    "- 旧兼容：overview≈大纲，concept≈设定，outline≈卷纲/章纲（视 outline_type）。",
    "不要只凭文件名选择；不要跳过 大纲/设定（或旧 overview/concept）只读一份卷纲。",
  ]

  if (typeof targetChapterNumber === "number" && targetChapterNumber > 0) {
    lines.push(
      `本次目标章号：第 ${targetChapterNumber} 章。请优先在章纲中定位，并结合设定/大纲约束，为该章找到对应大纲。`,
    )
  }

  return lines.join("\n")
}
