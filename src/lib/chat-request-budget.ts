import type { ChatMessage, ContentBlock } from "./llm-providers"

const HISTORY_TRUNCATED_MARKER = "[history truncated]\n"

function contentLength(content: ChatMessage["content"]): number {
  if (typeof content === "string") return content.length
  return content.reduce((sum, block) => {
    if (block.type === "text") return sum + block.text.length
    return sum + block.dataBase64.length
  }, 0)
}

function messageLength(message: ChatMessage): number {
  return contentLength(message.content)
}

function totalLength(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + messageLength(message), 0)
}

function clampTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= HISTORY_TRUNCATED_MARKER.length) {
    return HISTORY_TRUNCATED_MARKER.slice(0, maxChars)
  }
  return HISTORY_TRUNCATED_MARKER + text.slice(-(maxChars - HISTORY_TRUNCATED_MARKER.length))
}

function trimContent(content: ChatMessage["content"], maxChars: number): ChatMessage["content"] {
  if (typeof content === "string") return clampTail(content, maxChars)

  let remaining = maxChars
  const reversed: ContentBlock[] = []
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const block = content[i]
    if (!block) continue
    if (block.type !== "text") {
      const len = block.dataBase64.length
      if (len <= remaining) {
        reversed.push(block)
        remaining -= len
      }
      continue
    }

    const text = clampTail(block.text, remaining)
    if (text.length > 0) {
      reversed.push({ ...block, text })
      remaining -= text.length
    }
    if (remaining <= 0) break
  }

  return reversed.reverse()
}

function isLeadingSystemMessage(messages: ChatMessage[], index: number): boolean {
  return messages[index]?.role === "system" && messages.slice(0, index).every((message) => message.role === "system")
}

function trimMessage(message: ChatMessage, maxChars: number): ChatMessage {
  return {
    ...message,
    content: trimContent(message.content, Math.max(0, maxChars)),
  }
}

/**
 * Trims packed chat messages by character budget before sending them to an LLM.
 * The current user request is preserved because it carries the user's latest intent.
 */
export function trimChatMessagesToBudget(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  if (messages.length === 0) return messages
  if (!Number.isFinite(maxChars) || maxChars <= 0) return messages
  if (totalLength(messages) <= maxChars) return messages

  let next = [...messages]

  const canDrop = (message: ChatMessage, index: number) =>
    index !== next.length - 1 && !isLeadingSystemMessage(next, index) && message.role !== "system"

  while (totalLength(next) > maxChars) {
    const droppableIndices = next
      .map((message, index) => ({ message, index }))
      .filter(({ message, index }) => canDrop(message, index))

    if (droppableIndices.length <= 1) break
    next = next.filter((_message, index) => index !== droppableIndices[0]?.index)
  }

  if (totalLength(next) <= maxChars) return next

  for (let i = 0; i < next.length - 1 && totalLength(next) > maxChars; i += 1) {
    if (isLeadingSystemMessage(next, i) || next[i]?.role === "system") continue
    const excess = totalLength(next) - maxChars
    const current = next[i]
    if (!current) continue
    const targetLength = Math.max(0, messageLength(current) - excess)
    next[i] = trimMessage(current, targetLength)
  }

  if (totalLength(next) <= maxChars) return next

  for (let i = 0; i < next.length - 1 && totalLength(next) > maxChars; i += 1) {
    const current = next[i]
    if (!current) continue
    const excess = totalLength(next) - maxChars
    const targetLength = Math.max(0, messageLength(current) - excess)
    next[i] = trimMessage(current, targetLength)
  }

  return next
}
