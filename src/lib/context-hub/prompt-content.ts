import type { ChatMessage, ContentBlock } from "@/lib/llm-providers"
import type { ContextHubResult } from "./types"

export function buildContextHubSystemContent(
  softwareRules: string,
  result: ContextHubResult,
  dynamicParts: string[] = [],
): ContentBlock[] {
  const stableText = `## 项目稳定核心\n${result.stableCore}`
  const dynamicText = [
    result.sessionSummary ? `## 当前会话摘要\n${result.sessionSummary}` : "",
    result.dynamicContext ? `## 本轮动态上下文\n${result.dynamicContext}` : "",
    ...dynamicParts,
  ].filter((value) => value.trim()).join("\n\n")

  return [
    { type: "text", text: softwareRules.trim() ? `${softwareRules.trim()}\n\n` : "" },
    { type: "text", text: stableText, cacheControl: true },
    { type: "text", text: dynamicText ? `\n\n${dynamicText}` : "" },
  ]
}
export function flattenContextHubSystemContent(content: ContentBlock[]): string {
  return content.map((block) => block.type === "text" ? block.text : "").join("")
}


/** 系统只放稳定规则；本轮资料在历史之后注入，避免每轮改写整个会话前缀。 */
export function buildContextHubPromptParts(
  softwareRules: string,
  result: ContextHubResult,
  dynamicRules: string[] = [],
): { systemContent: ContentBlock[]; taskContext: ContentBlock[] } {
  const systemContent = buildContextHubSystemContent(softwareRules, {
    ...result,
    sessionSummary: "",
    dynamicContext: "",
  }).filter((block) => block.type !== "text" || block.text.length > 0)
    .map((block) => block.type === "text" ? { ...block, cacheControl: true } : block)
  const material = [
    result.sessionSummary ? `## 当前会话摘要\n${result.sessionSummary}` : "",
    result.dynamicContext ? `## 本轮参考资料\n${result.dynamicContext}` : "",
  ].filter(Boolean).join("\n\n")
  const rules = dynamicRules.filter((value) => value.trim()).join("\n\n")
  const taskContext: ContentBlock[] = []
  if (material) taskContext.push({ type: "text", text: material, cacheControl: true })
  if (rules) taskContext.push({ type: "text", text: `${material ? "\n\n" : ""}## 本轮执行要求\n${rules}` })
  return { systemContent, taskContext }
}

export function withContextHubTaskContent(
  userContent: ChatMessage["content"],
  taskContext: ContentBlock[],
): ContentBlock[] {
  const userBlocks: ContentBlock[] = typeof userContent === "string"
    ? [{ type: "text", text: userContent }]
    : userContent
  if (taskContext.length === 0) return [...userBlocks]
  const prefixEnd = userBlocks.reduce((last, block, index) => block.type === "text" && block.cacheControl ? index : last, -1) + 1
  return [
    ...userBlocks.slice(0, prefixEnd),
    ...(prefixEnd > 0 ? [{ type: "text" as const, text: "\n\n" }] : []),
    ...taskContext,
    { type: "text", text: "\n\n## 当前用户请求\n" },
    ...userBlocks.slice(prefixEnd),
  ]
}

/** 仅标记最后一个历史文本边界，不改写历史内容或累积每轮断点。 */
export function markHistoryCacheBoundary(messages: readonly ChatMessage[]): ChatMessage[] {
  const result = [...messages]
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const message = result[index]
    if ((message.role !== "user" && message.role !== "assistant") || message.tool_calls?.length) continue
    const blocks: ContentBlock[] = typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [...message.content]
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]
      if (block.type !== "text" || !block.text.trim()) continue
      blocks[blockIndex] = { ...block, cacheControl: true }
      result[index] = { ...message, content: blocks }
      return result
    }
  }
  return result
}
