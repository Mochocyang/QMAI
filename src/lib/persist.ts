import { writeFile, readFile, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"
import { normalizePath } from "@/lib/path-utils"

function safeParseArray<T>(content: string, fieldName: string = "items"): T[] {
  try {
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) {
      console.warn(`persist: 解析数据不是数组，字段: ${fieldName}`)
      return []
    }
    return parsed as T[]
  } catch (err) {
    console.error(`persist: JSON 解析失败，字段: ${fieldName}`, err)
    return []
  }
}

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.qmai`).catch(() => {})
  await createDirectory(`${projectPath}/.qmai/chats`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFile(`${pp}/.qmai/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  const pp = normalizePath(projectPath)
  try {
    const content = await readFile(`${pp}/.qmai/review.json`)
    return safeParseArray<ReviewItem>(content, "reviewItems")
  } catch {
    return []
  }
}

interface PersistedChatData {
  conversations: Conversation[]
  messages: DisplayMessage[]
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[],
  maxMessages?: number
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)

  // Save conversation list
  await writeFile(
    `${pp}/.qmai/conversations.json`,
    JSON.stringify(conversations, null, 2)
  )

  // Save each conversation's messages separately
  const byConversation = new Map<string, DisplayMessage[]>()
  for (const msg of messages) {
    const list = byConversation.get(msg.conversationId) ?? []
    list.push(msg)
    byConversation.set(msg.conversationId, list)
  }

  for (const [convId, msgs] of byConversation) {
    // Keep last N messages per conversation
    const toSave = msgs.slice(-(maxMessages || 100))
    await writeFile(
      `${pp}/.qmai/chats/${convId}.json`,
      JSON.stringify(toSave, null, 2)
    )
  }
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  const pp = normalizePath(projectPath)
  try {
    // Try new format: separate files per conversation
    const convContent = await readFile(`${pp}/.qmai/conversations.json`)
    const conversations = safeParseArray<Conversation>(convContent, "conversations")

    const allMessages: DisplayMessage[] = []
    for (const conv of conversations) {
      try {
        const msgContent = await readFile(`${pp}/.qmai/chats/${conv.id}.json`)
        const msgs = safeParseArray<DisplayMessage>(msgContent, "messages")
        allMessages.push(...msgs)
      } catch {
        // Conversation file missing, skip
      }
    }

    return { conversations, messages: allMessages }
  } catch {
    // Fall back to old format
    try {
      const content = await readFile(`${pp}/.qmai/chat-history.json`)
      const parsed = JSON.parse(content)

      if (Array.isArray(parsed)) {
        // Very old format: flat array
        const legacyMessages = parsed as DisplayMessage[]
        const defaultConv: Conversation = {
          id: "default",
          title: "Previous Conversations",
          createdAt: legacyMessages[0]?.timestamp ?? Date.now(),
          updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? Date.now(),
          deAiMode: false,
        }
        const migratedMessages = legacyMessages.map((m) => ({
          ...m,
          conversationId: "default",
        }))
        return { conversations: [defaultConv], messages: migratedMessages }
      }

      // Old combined format
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const data = parsed as PersistedChatData
        return data
      }
      console.warn("persist: 聊天历史数据格式无效")
      return { conversations: [], messages: [] }
    } catch {
      return { conversations: [], messages: [] }
    }
  }
}
