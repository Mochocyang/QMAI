import { listDirectory } from "@/commands/fs"
import type { ReferenceCategory, ReferenceToken } from "./types"

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

function createFileProvider(
  category: Extract<ReferenceCategory, "chapter" | "memory" | "outline" | "deduction">,
  relativeDir: string,
  extension: ".md" | ".json",
): ReferenceProvider {
  return {
    category,
    fetchItems: async (projectPath) => {
      try {
        const pp = normalizeProjectPath(projectPath)
        const dirPath = `${pp}/${relativeDir}`
        const files = await listDirectory(dirPath)
        return files
          .filter((file) => !file.is_dir && file.name.endsWith(extension))
          .map((file) => {
            const title = file.name.slice(0, -extension.length)
            return {
              id: simpleId(),
              category,
              title,
              path: `${dirPath}/${file.name}`,
              displayTitle: truncateTitle(title),
            }
          })
      } catch {
        return []
      }
    },
  }
}

export const chapterProvider = createFileProvider(
  "chapter",
  "wiki/chapters",
  ".md",
)

export const memoryProvider = createFileProvider(
  "memory",
  "wiki/memory",
  ".md",
)

export const outlineProvider = createFileProvider(
  "outline",
  "wiki/outlines",
  ".md",
)

export const deductionProvider = createFileProvider(
  "deduction",
  ".qmai/simulations",
  ".json",
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
