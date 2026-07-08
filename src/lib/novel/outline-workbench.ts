import { normalizePath } from "@/lib/path-utils"

export interface DefaultOutlineFolder {
  id: string
  name: string
}

export const DEFAULT_OUTLINE_FOLDERS: DefaultOutlineFolder[] = [
  { id: "story", name: "大纲" },
  { id: "volume", name: "卷纲" },
  { id: "chapter", name: "章纲" },
  { id: "characters", name: "人物小传" },
  { id: "settings", name: "设定" },
  { id: "foreshadowing", name: "伏笔" },
  { id: "organizations", name: "组织" },
]

export const DEFAULT_OUTLINE_FOLDER_PATHS = [
  ...DEFAULT_OUTLINE_FOLDERS.map((folder) => folder.name),
  "设定/角色",
  "设定/世界观",
  "设定/势力",
  "设定/伏笔",
  "设定/地图",
  "设定/状态",
] as const

export const LEGACY_OUTLINE_FOLDER_MIGRATIONS = [
  { from: "大纲文件夹", to: "大纲" },
  { from: "卷纲文件夹", to: "卷纲" },
  { from: "章纲文件夹", to: "章纲" },
  { from: "人物小传文件夹", to: "人物小传" },
  { from: "设定文件夹", to: "设定" },
  { from: "伏笔文件夹", to: "伏笔" },
  { from: "组织文件夹", to: "组织" },
] as const

export type OutlineSaveType =
  | "story-outline"
  | "volume-outline"
  | "chapter-outline"
  | "character-brief"
  | "setting-outline"
  | "foreshadowing-plan"
  | "organization-outline"

export interface OutlineSaveTarget {
  folderName: string
  fileName: string
  outlineType: OutlineSaveType
}

export interface OutlineFileMoveInput {
  outlineRoot: string
  sourcePath: string
  targetFolderPath: string
  targetExists: boolean
}

export type OutlineFileMovePlan =
  | { ok: true; targetPath: string }
  | { ok: false; error: string }

export function getOutlineRoot(projectPath: string): string {
  return `${normalizePath(projectPath)}/wiki/outlines`
}

export function getDefaultOutlineFolderPath(projectPath: string, folderName: string): string {
  return `${getOutlineRoot(projectPath)}/${folderName}`
}

function normalizeComparablePath(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

export function isPathInsideOutlineRoot(path: string, outlineRoot: string): boolean {
  const normalizedPath = normalizeComparablePath(path)
  const normalizedRoot = normalizeComparablePath(outlineRoot)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function sanitizeOutlineFileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function formatChapterOutlineFileName(chapterNumber: number, title = ""): string {
  const padded = String(Math.max(1, Math.floor(chapterNumber))).padStart(3, "0")
  const safeTitle = sanitizeOutlineFileNamePart(title)
  return safeTitle ? `章纲-第${padded}章-${safeTitle}.md` : `章纲-第${padded}章.md`
}

function getFileName(path: string): string {
  return normalizePath(path).split("/").pop() ?? ""
}

export function planOutlineFileMove(input: OutlineFileMoveInput): OutlineFileMovePlan {
  const outlineRoot = normalizeComparablePath(input.outlineRoot)
  const sourcePath = normalizeComparablePath(input.sourcePath)
  const targetFolderPath = normalizeComparablePath(input.targetFolderPath)
  const fileName = getFileName(sourcePath)

  if (!fileName.toLowerCase().endsWith(".md") || !isPathInsideOutlineRoot(sourcePath, outlineRoot)) {
    return { ok: false, error: "只能移动大纲目录内的 Markdown 文件。" }
  }

  if (!isPathInsideOutlineRoot(targetFolderPath, outlineRoot)) {
    return { ok: false, error: "目标文件夹必须位于大纲目录内。" }
  }

  if (input.targetExists) {
    return { ok: false, error: "目标文件已存在，请更换文件夹或重命名后再移动。" }
  }

  return { ok: true, targetPath: `${targetFolderPath}/${fileName}` }
}

function extractChapterNumberAndTitle(title: string, content: string): { number: number; title: string } | null {
  const candidates = [title, content]
  for (const candidate of candidates) {
    const match = candidate.match(/第\s*(\d{1,4})\s*章\s*([^\n#]*)/)
    if (!match) continue
    return {
      number: Number(match[1]),
      title: match[2]?.trim() ?? "",
    }
  }
  return null
}

function ensureMarkdownFileName(title: string): string {
  const safe = sanitizeOutlineFileNamePart(title) || "大纲"
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`
}

interface OutlineClassificationRule {
  folderName: string
  outlineType: OutlineSaveType
  filePrefix: string
  keywords?: string[]
  pattern?: RegExp
}

const OUTLINE_CLASSIFICATION_RULES: OutlineClassificationRule[] = [
  {
    folderName: "卷纲",
    outlineType: "volume-outline",
    filePrefix: "卷纲",
    pattern: /第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷|卷纲|分卷/,
  },
  {
    folderName: "章纲",
    outlineType: "chapter-outline",
    filePrefix: "章纲",
    keywords: ["章节细纲", "章纲", "细纲", "章节计划", "下一章计划"],
  },
  {
    folderName: "人物小传",
    outlineType: "character-brief",
    filePrefix: "人物小传",
    keywords: ["人物小传", "角色小传", "人物设定", "角色设定", "男主", "女主", "男配", "女配", "反派"],
  },
  {
    folderName: "组织",
    outlineType: "organization-outline",
    filePrefix: "组织",
    keywords: ["组织", "势力", "阵营", "门派", "家族"],
  },
  {
    folderName: "伏笔",
    outlineType: "foreshadowing-plan",
    filePrefix: "伏笔",
    keywords: ["伏笔", "线索", "回收"],
  },
  {
    folderName: "设定",
    outlineType: "setting-outline",
    filePrefix: "设定",
    keywords: ["设定", "世界观", "世界规则", "力量体系", "金手指", "地图", "地点", "地理", "背景"],
  },
]

function matchesOutlineRule(rule: OutlineClassificationRule, text: string): boolean {
  if (rule.pattern?.test(text)) return true
  return rule.keywords?.some((keyword) => text.includes(keyword)) ?? false
}

function formatClassifiedOutlineFileName(title: string, prefix: string): string {
  const safe = sanitizeOutlineFileNamePart(title) || prefix
  const normalizedPrefix = sanitizeOutlineFileNamePart(prefix)
  const withPrefix = safe.startsWith(normalizedPrefix) ? safe : `${normalizedPrefix}-${safe}`
  return withPrefix.toLowerCase().endsWith(".md") ? withPrefix : `${withPrefix}.md`
}

export function inferOutlineSaveTarget(title: string, content: string): OutlineSaveTarget {
  const chapter = extractChapterNumberAndTitle(title, content)
  if (chapter) {
    return {
      folderName: "章纲",
      fileName: formatChapterOutlineFileName(chapter.number, chapter.title),
      outlineType: "chapter-outline",
    }
  }

  const classificationText = `${title}\n${content}`
  const rule = OUTLINE_CLASSIFICATION_RULES.find((item) => matchesOutlineRule(item, classificationText))
  if (rule) {
    return {
      folderName: rule.folderName,
      fileName: formatClassifiedOutlineFileName(title, rule.filePrefix),
      outlineType: rule.outlineType,
    }
  }

  return {
    folderName: "大纲",
    fileName: ensureMarkdownFileName(title),
    outlineType: "story-outline",
  }
}
