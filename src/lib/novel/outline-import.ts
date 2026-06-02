import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { getFileName, getFileStem, getRelativePath, normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"
import { makeSafeFileSlug } from "@/lib/wiki-filename"

export const OUTLINE_IMPORT_EXTENSIONS = [
  "md",
  "mdx",
  "txt",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "odt",
  "ods",
  "odp",
  "xls",
  "csv",
  "json",
  "html",
  "htm",
  "rtf",
  "xml",
  "yaml",
  "yml",
] as const

const OUTLINE_IMPORT_EXTENSION_SET = new Set<string>(OUTLINE_IMPORT_EXTENSIONS)

function yamlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function sanitizeImportedBody(content: string): string {
  let next = content.replace(/^\uFEFF/, "").trim()
  const frontmatterMatch = next.match(/^---\n[\s\S]*?\n---\n?/)
  if (frontmatterMatch) {
    next = next.slice(frontmatterMatch[0].length).trim()
  }
  return next
}

function buildOutlineMarkdown(title: string, content: string): string {
  const body = sanitizeImportedBody(content)
  const lines = [
    "---",
    "type: outline",
    `title: "${yamlEscape(title)}"`,
    "---",
    "",
  ]

  if (body.startsWith("#")) {
    lines.push(body)
  } else {
    lines.push(`# ${title}`)
    if (body) {
      lines.push("")
      lines.push(body)
    }
  }

  lines.push("")
  return lines.join("\n")
}

function isOutlineImportablePath(path: string): boolean {
  const normalizedPath = normalizePath(path)
  const fileName = getFileName(normalizedPath)
  if (!fileName || fileName.startsWith(".")) return false
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : ""
  return OUTLINE_IMPORT_EXTENSION_SET.has(extension)
}

async function ensureOutlineDirectory(projectPath: string, segments: string[]): Promise<string> {
  let current = `${normalizePath(projectPath)}/wiki/outlines`
  await createDirectory(current).catch(() => {})

  for (const segment of segments) {
    current = `${current}/${makeSafeFileSlug(segment, "folder")}`
    await createDirectory(current).catch(() => {})
  }

  return current
}

async function getUniqueOutlinePath(dir: string, fileName: string): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${dir}/${stem}-${index}${extension}`
    if (!(await fileExists(candidate))) return candidate
  }

  return `${dir}/${stem}-${Date.now()}${extension}`
}

async function importSingleOutlineFile(
  projectPath: string,
  sourcePath: string,
  targetFolders: string[] = [],
): Promise<string | null> {
  const normalizedSourcePath = normalizePath(sourcePath)
  if (!isOutlineImportablePath(normalizedSourcePath)) return null

  const title = getFileStem(normalizedSourcePath).trim() || "untitled"
  const targetDir = await ensureOutlineDirectory(projectPath, targetFolders)
  const targetPath = await getUniqueOutlinePath(targetDir, `${makeSafeFileSlug(title)}.md`)
  const content = await readFile(normalizedSourcePath)

  await writeFile(targetPath, buildOutlineMarkdown(title, content))
  return targetPath
}

function collectImportableFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []

  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    if (node.is_dir && node.children) {
      files.push(...collectImportableFiles(node.children))
      continue
    }
    if (!node.is_dir && isOutlineImportablePath(node.path)) {
      files.push(node)
    }
  }

  return files
}

export async function importOutlineFiles(projectPath: string, sourcePaths: string[]): Promise<string[]> {
  const importedPaths: string[] = []

  for (const sourcePath of sourcePaths) {
    try {
      const importedPath = await importSingleOutlineFile(projectPath, sourcePath)
      if (importedPath) importedPaths.push(importedPath)
    } catch (error) {
      console.error("[outline-import] failed to import file:", sourcePath, error)
    }
  }

  return importedPaths
}

export async function importOutlineFolder(projectPath: string, selectedFolder: string): Promise<string[]> {
  const normalizedFolder = normalizePath(selectedFolder)
  const rootFolderName = getFileName(normalizedFolder) || "imported-outline"
  const tree = await listDirectory(normalizedFolder)
  const sourceFiles = collectImportableFiles(tree)
  const importedPaths: string[] = []

  for (const sourceFile of sourceFiles) {
    const relativePath = getRelativePath(normalizePath(sourceFile.path), normalizedFolder)
    const segments = relativePath.split("/").filter(Boolean)
    segments.pop()

    try {
      const importedPath = await importSingleOutlineFile(projectPath, sourceFile.path, [rootFolderName, ...segments])
      if (importedPath) importedPaths.push(importedPath)
    } catch (error) {
      console.error("[outline-import] failed to import folder file:", sourceFile.path, error)
    }
  }

  return importedPaths
}
