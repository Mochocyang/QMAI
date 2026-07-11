import { writeFile, readFile, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"
import { normalizeLoadedRunStates, type ConversationRunStates } from "@/lib/conversation-run-state"
import { normalizePath } from "@/lib/path-utils"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500

/**
 * 按项目路径的写入锁，防止同一项目的多个保存操作并发写入。
 * 当某个项目正在保存时，后续的保存请求会被跳过（最新数据会被下一次保存覆盖）。
 */
const saveLocks = new Map<string, Promise<void>>()

/**
 * 获取指定项目的写入锁。
 * 如果已有保存操作在进行中，返回 null 表示跳过本次保存。
 * 否则返回一个 release 函数，调用后释放锁。
 */
function acquireSaveLock(projectPath: string): (() => void) | null {
  if (saveLocks.has(projectPath)) {
    console.warn(`persist: 项目 ${projectPath} 正在保存中，跳过本次保存`)
    return null
  }
  let release: () => void = () => {}
  const lock = new Promise<void>((resolve) => {
    release = () => {
      saveLocks.delete(projectPath)
      resolve()
    }
  })
  saveLocks.set(projectPath, lock)
  return release
}

/**
 * 带重试的异步操作包装。
 * 首次失败后等待 RETRY_DELAY_MS，之后每次翻倍（指数退避），最多重试 MAX_RETRIES 次。
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt)
        console.warn(`persist: ${label} 失败(第${attempt + 1}次)，${delay}ms 后重试:`, err)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

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
  const release = acquireSaveLock(`review:${pp}`)
  if (!release) return // 已有保存操作在进行中，跳过
  try {
    await ensureDir(pp)
    await withRetry(
      () => writeFile(`${pp}/.qmai/review.json`, JSON.stringify(items, null, 2)),
      "saveReviewItems",
    )
  } finally {
    release()
  }
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
  runStates: ConversationRunStates
}

interface ConversationManifest {
  conversations: Conversation[]
  runStates?: ConversationRunStates
}

function normalizeConversationRunStates(
  conversations: Conversation[],
  runStates: ConversationRunStates | undefined,
): ConversationRunStates {
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  return Object.fromEntries(
    Object.entries(normalizeLoadedRunStates(runStates)).filter(([id]) => conversationIds.has(id)),
  )
}

function normalizeConversation(conv: Conversation): Conversation {
  return {
    ...conv,
    deAiMode: Boolean(conv.deAiMode),
    selectedDeAiSkillId:
      conv.selectedDeAiSkillId === null || typeof conv.selectedDeAiSkillId === "string"
        ? conv.selectedDeAiSkillId
        : undefined,
  }
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[],
  maxMessages?: number,
  runStates: ConversationRunStates = {},
): Promise<void> {
  const pp = normalizePath(projectPath)
  const release = acquireSaveLock(`chat:${pp}`)
  if (!release) return // 已有保存操作在进行中，跳过
  try {
    await ensureDir(pp)

    // Save conversation list
    await withRetry(
      () => writeFile(
        `${pp}/.qmai/conversations.json`,
        JSON.stringify({ conversations, runStates }, null, 2),
      ),
      "saveChatHistory(conversations)",
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
      await withRetry(
        () => writeFile(
          `${pp}/.qmai/chats/${convId}.json`,
          JSON.stringify(toSave, null, 2),
        ),
        `saveChatHistory(chat:${convId})`,
      )
    }
  } finally {
    release()
  }
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  const pp = normalizePath(projectPath)
  try {
    // Try new format: separate files per conversation
    const convContent = await readFile(`${pp}/.qmai/conversations.json`)
    const parsedManifest = JSON.parse(convContent) as Conversation[] | ConversationManifest
    const rawConversations = Array.isArray(parsedManifest)
      ? parsedManifest
      : Array.isArray(parsedManifest?.conversations)
        ? parsedManifest.conversations
        : []
    const conversations = rawConversations.map(normalizeConversation)
    const rawRunStates = Array.isArray(parsedManifest) ? {} : parsedManifest.runStates
    const runStates = normalizeConversationRunStates(conversations, rawRunStates)

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

    return { conversations, messages: allMessages, runStates }
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
          selectedDeAiSkillId: undefined,
        }
        const migratedMessages = legacyMessages.map((m) => ({
          ...m,
          conversationId: "default",
        }))
        return { conversations: [defaultConv], messages: migratedMessages, runStates: {} }
      }

      // Old combined format
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const data = parsed as PersistedChatData
        const conversations = Array.isArray(data.conversations)
          ? data.conversations.map(normalizeConversation)
          : []
        return {
          conversations,
          messages: Array.isArray(data.messages) ? data.messages : [],
          runStates: normalizeConversationRunStates(conversations, data.runStates),
        }
      }
      console.warn("persist: 聊天历史数据格式无效")
      return { conversations: [], messages: [], runStates: {} }
    } catch {
      return { conversations: [], messages: [], runStates: {} }
    }
  }
}
