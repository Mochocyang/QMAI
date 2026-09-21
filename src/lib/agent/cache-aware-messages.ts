import type { ChatMessage, ContentBlock } from "@/lib/llm-providers"
import { markHistoryCacheBoundary, withContextHubTaskContent } from "@/lib/context-hub/prompt-content"

/** 仅调整外发副本：内部工作消息仍保留系统契约，保证多轮裁剪不丢初始目标。 */
export function buildAgentRequestMessages(messages: readonly ChatMessage[], taskContract: string): ChatMessage[] {
  const cacheable = messages.some((message) => Array.isArray(message.content)
    && message.content.some((block) => block.type === "text" && block.cacheControl))
  const hasUser = messages.some((message) => message.role === "user")
  if (!cacheable || !hasUser) {
    const result = [...messages]
    if (!result.some((message) => message.role === "system" && message.content === taskContract)) {
      const index = result.findIndex((message) => message.role !== "system")
      result.splice(index < 0 ? result.length : index, 0, { role: "system", content: taskContract })
    }
    return result
  }

  const dynamic: ContentBlock[] = []
  const result = messages.filter((message) => !(message.role === "system" && message.content === taskContract))
    .map((message): ChatMessage => {
      if (message.role !== "system" || !Array.isArray(message.content)) return message
      const lastBreakpoint = message.content.reduce((last, block, index) => block.type === "text" && block.cacheControl ? index : last, -1)
      if (lastBreakpoint < 0) return message
      dynamic.push(...message.content.slice(lastBreakpoint + 1))
      return { ...message, content: message.content.slice(0, lastBreakpoint + 1) }
    })
  const existingBreakpoints = result.reduce((count, message) => count + (Array.isArray(message.content)
    ? message.content.filter((block) => block.type === "text" && block.cacheControl).length
    : 0), 0)
  // 给同一Agent任务的多轮调用复用本轮资料；为历史边界预留一个断点。
  if (existingBreakpoints < 3) {
    for (let index = dynamic.length - 1; index >= 0; index -= 1) {
      const block = dynamic[index]
      if (block.type !== "text" || !block.text.trim()) continue
      dynamic[index] = { ...block, cacheControl: true }
      break
    }
  }
  dynamic.push({ type: "text", text: `\n\n${taskContract}` })
  const userIndex = result.reduce((last, message, index) => message.role === "user" ? index : last, -1)
  const user = result[userIndex]
  return [
    ...markHistoryCacheBoundary(result.slice(0, userIndex)),
    { ...user, content: withContextHubTaskContent(user.content, dynamic) },
    ...result.slice(userIndex + 1),
  ]
}
