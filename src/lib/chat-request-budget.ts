import type { ChatMessage, ContentBlock } from "./llm-providers"
import { LlmContextBudgetError } from "./context-budget"
import { estimateContextTokens } from "./context-hub/token-estimator"

const HISTORY_TRUNCATED_MARKER = "[history truncated]\n"
const CONTENT_TRUNCATED_MARKER = "\n[内容已压缩，保留首尾]\n"

function contentLength(content: ChatMessage["content"]): number {
  if (typeof content === "string") return content.length
  return content.reduce((sum, block) => {
    if (block.type === "text") return sum + block.text.length
    return sum + block.dataBase64.length
  }, 0)
}

function messageLength(message: ChatMessage): number {
  const toolArgumentsLength = message.tool_calls?.reduce(
    (sum, call) => sum + call.function.arguments.length,
    0,
  ) ?? 0
  return contentLength(message.content) + toolArgumentsLength
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

function clampHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= CONTENT_TRUNCATED_MARKER.length) return text.slice(0, maxChars)
  const available = maxChars - CONTENT_TRUNCATED_MARKER.length
  const head = Math.ceil(available * 0.55)
  const tail = Math.max(0, available - head)
  return `${text.slice(0, head)}${CONTENT_TRUNCATED_MARKER}${tail > 0 ? text.slice(-tail) : ""}`
}

function trimContent(content: ChatMessage["content"], maxChars: number, preserveHead = false): ChatMessage["content"] {
  if (typeof content === "string") return preserveHead ? clampHeadTail(content, maxChars) : clampTail(content, maxChars)

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

    const text = preserveHead ? clampHeadTail(block.text, remaining) : clampTail(block.text, remaining)
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

function trimMessage(message: ChatMessage, maxChars: number, preserveHead = false): ChatMessage {
  const toolArgumentsLength = message.tool_calls?.reduce(
    (sum, call) => sum + call.function.arguments.length,
    0,
  ) ?? 0
  const contentBudget = Math.max(0, maxChars - toolArgumentsLength)
  const content = trimContent(message.content, contentBudget, preserveHead)
  let remainingArguments = Math.max(0, maxChars - contentLength(content))
  const toolCalls = message.tool_calls?.map((call) => {
    const argumentsValue = call.function.arguments
    if (argumentsValue.length <= remainingArguments) {
      remainingArguments -= argumentsValue.length
      return call
    }
    const compactedArguments = remainingArguments >= 2 ? "{}" : argumentsValue.slice(0, remainingArguments)
    remainingArguments = Math.max(0, remainingArguments - compactedArguments.length)
    return {
      ...call,
      function: { ...call.function, arguments: compactedArguments },
    }
  })
  return {
    ...message,
    content,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  }
}

function groupHistory(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === "assistant" && message.tool_calls?.length) {
      const callIds = new Set(message.tool_calls.map((call) => call.id))
      const group = [message]
      while (index + 1 < messages.length) {
        const next = messages[index + 1]!
        if (next.role !== "tool" || !next.tool_call_id || !callIds.has(next.tool_call_id)) break
        group.push(next)
        index += 1
      }
      groups.push(group)
      continue
    }
    groups.push([message])
  }
  return groups
}

const MESSAGE_OVERHEAD_TOKENS = 4

function contentTokenLength(content: ChatMessage["content"]): number {
  if (typeof content === "string") return estimateContextTokens(content)
  return content.reduce((sum, block) => {
    if (block.type === "text") return sum + estimateContextTokens(block.text)
    return sum + estimateContextTokens(block.dataBase64)
  }, 0)
}

function toolMetadataTokens(message: ChatMessage): number {
  const toolCallTokens = message.tool_calls?.reduce(
    (sum, call) => sum + estimateContextTokens(
      `${call.id}\n${call.function.name}\n${call.function.arguments}`,
    ),
    0,
  ) ?? 0
  return toolCallTokens + estimateContextTokens(
    `${message.tool_call_id ?? ""}\n${message.name ?? ""}`,
  )
}

function messageTokenLength(message: ChatMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + contentTokenLength(message.content) + toolMetadataTokens(message)
}

function minimumMessageTokenLength(message: ChatMessage, requireContent: boolean): number {
  const fixedMetadataTokens = MESSAGE_OVERHEAD_TOKENS + estimateContextTokens(
    `${message.tool_call_id ?? ""}\n${message.name ?? ""}`,
  )
  const minimumToolTokens = message.tool_calls?.reduce(
    (sum, call) => sum + estimateContextTokens(`${call.id}\n${call.function.name}\n{}`),
    0,
  ) ?? 0
  return fixedMetadataTokens + minimumToolTokens + (requireContent ? 1 : 0)
}

export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTokenLength(message), 0)
}

export function estimateRequestScaffoldTokens(tools: unknown): number {
  if (!tools) return 0
  try {
    return estimateContextTokens(JSON.stringify(tools))
  } catch {
    return 0
  }
}

function clampTextToTokenBudget(
  text: string,
  maxTokens: number,
  preserveHead: boolean,
): string {
  if (estimateContextTokens(text) <= maxTokens) return text
  if (maxTokens <= 0) return ""
  let low = 0
  let high = text.length
  let best = ""
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = preserveHead
      ? clampHeadTail(text, mid)
      : clampTail(text, mid)
    if (estimateContextTokens(candidate) <= maxTokens) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function trimContentToTokenBudget(
  content: ChatMessage["content"],
  maxTokens: number,
  preserveHead = false,
): ChatMessage["content"] {
  if (typeof content === "string") {
    return clampTextToTokenBudget(content, maxTokens, preserveHead)
  }
  let remaining = maxTokens
  const reversed: ContentBlock[] = []
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index]
    if (!block) continue
    if (block.type !== "text") {
      const tokens = estimateContextTokens(block.dataBase64)
      if (tokens <= remaining) {
        reversed.push(block)
        remaining -= tokens
      }
      continue
    }
    const text = clampTextToTokenBudget(block.text, remaining, preserveHead)
    if (text) {
      reversed.push({ ...block, text })
      remaining -= estimateContextTokens(text)
    }
    if (remaining <= 0) break
  }
  return reversed.reverse()
}

function trimMessageToTokenBudget(
  message: ChatMessage,
  maxTokens: number,
  preserveHead = false,
): ChatMessage {
  const fixedMetadataTokens = MESSAGE_OVERHEAD_TOKENS + estimateContextTokens(
    `${message.tool_call_id ?? ""}\n${message.name ?? ""}`,
  )
  const originalToolCalls = message.tool_calls
  const minimumToolTokens = originalToolCalls?.reduce(
    (sum, call) => sum + estimateContextTokens(`${call.id}\n${call.function.name}\n{}`),
    0,
  ) ?? 0
  const contentBudget = Math.max(0, maxTokens - fixedMetadataTokens - minimumToolTokens)
  const content = trimContentToTokenBudget(message.content, contentBudget, preserveHead)
  let remaining = Math.max(
    0,
    maxTokens - fixedMetadataTokens - contentTokenLength(content),
  )
  const toolCalls = originalToolCalls?.map((call) => {
    const fixed = estimateContextTokens(`${call.id}\n${call.function.name}\n`)
    const fullArguments = estimateContextTokens(call.function.arguments)
    const argumentsValue = fixed + fullArguments <= remaining
      ? call.function.arguments
      : "{}"
    remaining = Math.max(
      0,
      remaining - fixed - estimateContextTokens(argumentsValue),
    )
    return {
      ...call,
      function: { ...call.function, arguments: argumentsValue },
    }
  })
  return {
    ...message,
    content,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  }
}

function hasNonEmptyContent(message: ChatMessage | undefined): boolean {
  if (!message) return false
  if (typeof message.content === "string") return message.content.trim().length > 0
  return message.content.some((block) => block.type !== "text" || block.text.trim().length > 0)
}

/**
 * Token-aware request trimmer. Tool-call/result groups stay paired; system
 * constraints and the latest user request may be shortened but never emptied.
 */
export function trimChatMessagesToTokenBudget(
  messages: ChatMessage[],
  maxTokens: number,
): ChatMessage[] {
  if (messages.length === 0) return messages
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw new LlmContextBudgetError()
  if (estimateChatMessagesTokens(messages) <= maxTokens) return messages

  const leadingSystems: ChatMessage[] = []
  let firstNonSystem = 0
  while (firstNonSystem < messages.length && messages[firstNonSystem]?.role === "system") {
    leadingSystems.push(messages[firstNonSystem]!)
    firstNonSystem += 1
  }
  const bodyGroups = groupHistory(messages.slice(firstNonSystem))
  let latestUserGroup = -1
  for (let index = bodyGroups.length - 1; index >= 0; index -= 1) {
    if (bodyGroups[index]!.some((message) => message.role === "user")) {
      latestUserGroup = index
      break
    }
  }
  const retainedGroups = bodyGroups.map((group, index) => ({
    group,
    protected: index === latestUserGroup || index === bodyGroups.length - 1,
  }))
  let next = [...leadingSystems, ...retainedGroups.flatMap((entry) => entry.group)]

  while (estimateChatMessagesTokens(next) > maxTokens) {
    const removableIndex = retainedGroups.findIndex((entry) => !entry.protected)
    if (removableIndex < 0) break
    retainedGroups.splice(removableIndex, 1)
    next = [...leadingSystems, ...retainedGroups.flatMap((entry) => entry.group)]
  }
  if (estimateChatMessagesTokens(next) <= maxTokens) return next

  let latestUserIndex = -1
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role === "user") {
      latestUserIndex = index
      break
    }
  }

  // Old assistant/tool payloads are expendable before protected instructions.
  for (let index = 0; index < next.length && estimateChatMessagesTokens(next) > maxTokens; index += 1) {
    if (index === latestUserIndex || next[index]?.role === "system") continue
    const current = next[index]!
    const excess = estimateChatMessagesTokens(next) - maxTokens
    next[index] = trimMessageToTokenBudget(
      current,
      Math.max(
        minimumMessageTokenLength(current, false),
        messageTokenLength(current) - excess,
      ),
    )
  }

  // System messages remain non-empty and retain both ends when compressed.
  for (let index = 0; index < next.length && estimateChatMessagesTokens(next) > maxTokens; index += 1) {
    if (next[index]?.role !== "system") continue
    const current = next[index]!
    const excess = estimateChatMessagesTokens(next) - maxTokens
    next[index] = trimMessageToTokenBudget(
      current,
      Math.max(
        minimumMessageTokenLength(current, true),
        messageTokenLength(current) - excess,
      ),
      true,
    )
  }

  if (latestUserIndex >= 0 && estimateChatMessagesTokens(next) > maxTokens) {
    const current = next[latestUserIndex]!
    const excess = estimateChatMessagesTokens(next) - maxTokens
    next[latestUserIndex] = trimMessageToTokenBudget(
      current,
      Math.max(
        minimumMessageTokenLength(current, true),
        messageTokenLength(current) - excess,
      ),
      true,
    )
  }

  const protectedSystemsValid = messages
    .filter((message) => message.role === "system" && hasNonEmptyContent(message))
    .every((_message, index) => hasNonEmptyContent(next.filter((entry) => entry.role === "system")[index]))
  const latestUserValid = latestUserIndex < 0 || hasNonEmptyContent(next[latestUserIndex])
  if (
    estimateChatMessagesTokens(next) > maxTokens
    || !protectedSystemsValid
    || !latestUserValid
  ) {
    throw new LlmContextBudgetError()
  }
  return next
}

/**
 * Trims packed chat messages by character budget before sending them to an LLM.
 * The current user request is preserved because it carries the user's latest intent.
 */
export function trimChatMessagesToBudget(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  if (messages.length === 0) return messages
  if (!Number.isFinite(maxChars) || maxChars <= 0) return messages
  if (totalLength(messages) <= maxChars) return messages

  const leadingSystems: ChatMessage[] = []
  let firstNonSystem = 0
  while (firstNonSystem < messages.length - 1 && messages[firstNonSystem]?.role === "system") {
    leadingSystems.push(messages[firstNonSystem]!)
    firstNonSystem += 1
  }
  const bodyGroups = groupHistory(messages.slice(firstNonSystem))
  let latestUserGroup = -1
  for (let index = bodyGroups.length - 1; index >= 0; index -= 1) {
    if (bodyGroups[index]!.some((message) => message.role === "user")) {
      latestUserGroup = index
      break
    }
  }
  const retainedGroups = bodyGroups.map((group, index) => ({
    group,
    protected: index === latestUserGroup || index === bodyGroups.length - 1,
  }))
  let next = [...leadingSystems, ...retainedGroups.flatMap((entry) => entry.group)]

  while (totalLength(next) > maxChars) {
    const removableIndex = retainedGroups.findIndex((entry) => !entry.protected)
    if (removableIndex < 0) break
    const removableCount = retainedGroups.filter((entry) => !entry.protected).length
    const removableGroup = retainedGroups[removableIndex]!.group
    const containsToolProtocol = removableGroup.some(
      (message) => message.role === "tool" || Boolean(message.tool_calls?.length),
    )
    if (removableCount === 1 && !containsToolProtocol) break
    retainedGroups.splice(removableIndex, 1)
    next = [...leadingSystems, ...retainedGroups.flatMap((entry) => entry.group)]
  }

  if (totalLength(next) <= maxChars) return next

  let latestUserIndex = -1
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role === "user") {
      latestUserIndex = index
      break
    }
  }
  if (latestUserIndex < 0) latestUserIndex = next.length - 1

  for (let i = 0; i < next.length && totalLength(next) > maxChars; i += 1) {
    if (i === latestUserIndex || isLeadingSystemMessage(next, i) || next[i]?.role === "system") continue
    const excess = totalLength(next) - maxChars
    const current = next[i]
    if (!current) continue
    const targetLength = Math.max(0, messageLength(current) - excess)
    next[i] = trimMessage(current, targetLength)
  }

  if (totalLength(next) <= maxChars) return next

  for (let i = 0; i < next.length && totalLength(next) > maxChars; i += 1) {
    if (i === latestUserIndex) continue
    const current = next[i]
    if (!current) continue
    const excess = totalLength(next) - maxChars
    const targetLength = Math.max(0, messageLength(current) - excess)
    next[i] = trimMessage(current, targetLength)
  }

  if (totalLength(next) <= maxChars) return next

  const excess = totalLength(next) - maxChars
  next[latestUserIndex] = trimMessage(
    next[latestUserIndex]!,
    Math.max(0, messageLength(next[latestUserIndex]!) - excess),
    true,
  )
  return next
}
