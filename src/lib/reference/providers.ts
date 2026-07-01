import { listDirectory } from "@/commands/fs"
import type { ReferenceCategory, ReferenceToken } from "./types"

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
        return files.map((file) => ({
          id: simpleId(),
          category,
          title: file.title,
          path: file.path,
          displayTitle: truncateTitle(file.title),
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
