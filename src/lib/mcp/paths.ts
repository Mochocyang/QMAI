import { isPathInside, normalizeComparablePath, normalizePath } from "@/lib/path-utils"

export type ProjectDocumentKind = "chapter" | "outline"

function hasParentSegment(path: string): boolean {
  return normalizePath(path).split("/").includes("..")
}

export function classifyProjectDocument(projectPath: string, filePath: string): ProjectDocumentKind | null {
  const project = normalizeComparablePath(projectPath)
  const file = normalizePath(filePath)
  if (!project || !file || hasParentSegment(file) || hasParentSegment(project)) return null
  if (!file.toLowerCase().endsWith(".md")) return null
  if (!isPathInside(file, project)) return null
  if (/\/(?:wiki|QM)\/chapters\//.test(file)) return "chapter"
  if (/\/(?:wiki|QM)\/outlines\//.test(file)) return "outline"
  return null
}

export function requireProjectDocument(projectPath: string, filePath: string): ProjectDocumentKind {
  const kind = classifyProjectDocument(projectPath, filePath)
  if (!kind) throw new Error("只能操作当前项目知识库中的章节或大纲文件")
  return kind
}
