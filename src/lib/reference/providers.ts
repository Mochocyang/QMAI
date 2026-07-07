import { listDirectory, readFile } from "@/commands/fs"
import type { ReferenceCategory, ReferenceToken, SkillSubtype } from "./types"
import type { SkillKind, SkillMode, SkillStage } from "@/lib/novel/skill-library"

type ReferenceFileNode = {
  name: string
  path?: string
  is_dir: boolean
  children?: ReferenceFileNode[]
}

export interface ReferenceProvider {
  category: ReferenceCategory
  fetchItems: (projectPath: string) => Promise<ReferenceToken[]>
}

interface SkillSummary {
  id: string
  name: string
  subtype: SkillSubtype
  kind?: SkillKind[]
  stages?: SkillStage[]
  modes?: SkillMode[]
}

interface ConversationSummary {
  id: string
  title: string
}

function simpleId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function truncateTitle(title: string, maxLen = 20): string {
  return title.length > maxLen ? title.slice(0, maxLen) + "..." : title
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/")
}

function nodePath(baseDir: string, node: ReferenceFileNode): string {
  const normalizedPath = node.path ? normalizeProjectPath(node.path) : ""
  if (normalizedPath && normalizedPath !== node.name) return normalizedPath
  return `${baseDir}/${node.name}`
}

function stripExtension(name: string, extensions: string[]): string {
  const extension = extensions.find((candidate) => name.toLowerCase().endsWith(candidate))
  return extension ? name.slice(0, -extension.length) : name
}

function unquoteYamlValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim()
}

function extractFrontmatterField(content: string, field: string): string | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch?.[1]) return null
  const fieldPattern = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m")
  const fieldMatch = frontmatterMatch[1].match(fieldPattern)
  return fieldMatch?.[1] ? unquoteYamlValue(fieldMatch[1]) : null
}

function extractMarkdownHeading(content: string): string | null {
  const headingMatch = content.match(/^#\s+(.+?)\s*$/m)
  return headingMatch?.[1]?.trim() || null
}

function extractMarkdownTitle(content: string): string | null {
  return extractFrontmatterField(content, "title") || extractMarkdownHeading(content)
}

function extractSimulationMarkdownTitle(content: string): string | null {
  const title = extractMarkdownTitle(content)
  if (title && title !== "推演结果") return title

  const recommendedBranch = content.match(/^###\s+(.+?)\s*$(?=[\s\S]*?^- 推荐：是\s*$)/m)
  if (recommendedBranch?.[1]) return `推演结果：${recommendedBranch[1].trim()}`

  const firstBranch = content.match(/^##\s+分支\s*$[\s\S]*?^###\s+(.+?)\s*$/m)
  if (firstBranch?.[1]) return `推演结果：${firstBranch[1].trim()}`

  return title
}

function formatDateTitle(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function extractSimulationJsonTitle(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as {
      title?: unknown
      shortTitle?: unknown
      frameworkTitle?: unknown
      report?: {
        createdAt?: unknown
        branches?: Array<{ title?: unknown; recommendation?: unknown }>
      }
    }
    if (typeof parsed.shortTitle === "string" && parsed.shortTitle.trim()) return parsed.shortTitle.trim()
    if (typeof parsed.title === "string" && parsed.title.trim()) return parsed.title.trim()
    if (typeof parsed.frameworkTitle === "string" && parsed.frameworkTitle.trim()) {
      return `当前绑定：${parsed.frameworkTitle.trim()}`
    }
    const branches = Array.isArray(parsed.report?.branches) ? parsed.report.branches : []
    const branchTitle = branches.find((branch) => branch.recommendation === true)?.title ?? branches[0]?.title
    if (typeof branchTitle === "string" && branchTitle.trim()) return `推演结果：${branchTitle.trim()}`
    const createdAt = formatDateTitle(parsed.report?.createdAt)
    return createdAt ? `推演结果：${createdAt}` : null
  } catch {
    return null
  }
}

function hasAsciiLetter(value: string): boolean {
  return /[A-Za-z]/.test(value)
}

function fallbackDisplayTitle(
  category: Extract<ReferenceCategory, "chapter" | "memory" | "outline" | "deduction">,
  rawTitle: string,
  path: string,
): string {
  const stem = rawTitle.split("/").pop() || rawTitle
  if (!hasAsciiLetter(rawTitle)) return rawTitle

  if (category === "chapter") {
    const chapterNumber = stem.match(/chapter[-_\s]*(\d+)/i)?.[1] || stem.match(/(\d+)/)?.[1]
    return chapterNumber ? `第${Number.parseInt(chapterNumber, 10)}章` : "章节"
  }

  if (category === "memory") return "记忆条目"
  if (category === "outline") return "大纲条目"

  const normalizedPath = normalizeProjectPath(path)
  if (normalizedPath.includes("/bindings/")) return "当前绑定"
  if (normalizedPath.includes("/frameworks/")) return "故事框架"
  if (normalizedPath.includes("/results/")) return "推演结果"
  return "推演资料"
}

async function resolveDisplayTitle(
  category: Extract<ReferenceCategory, "chapter" | "memory" | "outline" | "deduction">,
  file: { title: string; path: string },
): Promise<string> {
  try {
    const content = await readFile(file.path)
    if (typeof content === "string" && content.trim()) {
      const lowerPath = file.path.toLowerCase()
      const parsedTitle = lowerPath.endsWith(".json")
        ? extractSimulationJsonTitle(content)
        : category === "deduction"
          ? extractSimulationMarkdownTitle(content)
          : extractMarkdownTitle(content)
      if (parsedTitle?.trim()) return parsedTitle.trim()
    }
  } catch {
    // 文件内容读取失败时使用中文兜底名，避免把技术文件名暴露为主标题。
  }

  return fallbackDisplayTitle(category, file.title, file.path)
}

async function collectReferenceFiles(
  baseDir: string,
  nodes: ReferenceFileNode[],
  extensions: string[],
  parentParts: string[] = [],
  visitedDirs = new Set<string>(),
): Promise<Array<{ title: string; path: string }>> {
  const items: Array<{ title: string; path: string }> = []

  for (const node of nodes) {
    const path = nodePath(baseDir, node)
    if (node.is_dir) {
      const nextParentParts = [...parentParts, node.name]
      const childNodes = node.children ?? await (async () => {
        if (visitedDirs.has(path)) return []
        visitedDirs.add(path)
        try {
          return await listDirectory(path) as ReferenceFileNode[]
        } catch {
          return []
        }
      })()
      items.push(...await collectReferenceFiles(path, childNodes, extensions, nextParentParts, visitedDirs))
      continue
    }

    if (!extensions.some((extension) => node.name.toLowerCase().endsWith(extension))) {
      continue
    }

    const stem = stripExtension(node.name, extensions)
    const title = [...parentParts, stem].join("/")
    items.push({ title, path })
  }

  return items
}

function createFileProvider(
  category: Extract<ReferenceCategory, "chapter" | "memory" | "outline" | "deduction">,
  relativeDir: string,
  extensions: Array<".md" | ".json">,
): ReferenceProvider {
  return {
    category,
    fetchItems: async (projectPath) => {
      try {
        const pp = normalizeProjectPath(projectPath)
        const dirPath = `${pp}/${relativeDir}`
        const files = await collectReferenceFiles(
          dirPath,
          await listDirectory(dirPath) as ReferenceFileNode[],
          extensions,
        )
        return await Promise.all(files.map(async (file) => {
          const title = await resolveDisplayTitle(category, file)
          return {
            id: simpleId(),
            category,
            title,
            path: file.path,
            displayTitle: truncateTitle(title),
          }
        }))
      } catch {
        return []
      }
    },
  }
}

export const chapterProvider = createFileProvider(
  "chapter",
  "wiki/chapters",
  [".md"],
)

export const memoryProvider = createFileProvider(
  "memory",
  "wiki/memory",
  [".md"],
)

export const outlineProvider = createFileProvider(
  "outline",
  "wiki/outlines",
  [".md"],
)

export const deductionProvider = createFileProvider(
  "deduction",
  ".qmai/simulations",
  [".md", ".json"],
)

export function createSkillProvider(getSkills: () => SkillSummary[]): ReferenceProvider {
  return {
    category: "skill",
    fetchItems: async () =>
      getSkills().map((skill) => ({
        id: simpleId(),
        category: "skill" as const,
        title: skill.name,
        skillId: skill.id,
        skillSubtype: skill.subtype,
        skillKinds: skill.kind,
        skillStages: skill.stages,
        skillModes: skill.modes,
        displayTitle: truncateTitle(skill.name),
      })),
  }
}

export function createChatHistoryProvider(
  getConversations: () => ConversationSummary[],
): ReferenceProvider {
  return {
    category: "chat_history",
    fetchItems: async () =>
      getConversations().map((conversation) => ({
        id: simpleId(),
        category: "chat_history" as const,
        title: conversation.title,
        conversationId: conversation.id,
        displayTitle: truncateTitle(conversation.title),
      })),
  }
}

export function createOutlineHistoryProvider(
  getConversations: () => ConversationSummary[],
): ReferenceProvider {
  return {
    category: "outline_history",
    fetchItems: async () =>
      getConversations().map((conversation) => ({
        id: simpleId(),
        category: "outline_history" as const,
        title: conversation.title,
        conversationId: conversation.id,
        displayTitle: truncateTitle(conversation.title),
      })),
  }
}
