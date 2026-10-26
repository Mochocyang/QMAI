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


/**
 * 系统只放稳定规则；本轮资料前移到历史之前单独成段，本轮要求留在尾部。
 *
 * 分三段的目的（真机实测依据：资料放 user 尾部时第二轮只命中 85.8%，
 * 前移到 system 之后能到 98.7%）：
 * - `systemContent`：软件规则 + 项目稳定核心 + 稳定技能/规则，逐字节不随轮次变。
 * - `chapterPrefix`：本轮参考资料（人物状态/伏笔/检索/推演）。一章之内基本不变，
 *   作为独立消息插在 system 之后、历史之前，才能被下一轮完整命中。
 * - `taskContext`：会话摘要 + 本轮执行要求。每轮都变，只能留在最尾部。
 *   会话摘要**不能**放进 chapterPrefix：它每轮重算，一进去就把前缀打断。
 */
export function buildContextHubPromptParts(
  softwareRules: string,
  result: ContextHubResult,
  dynamicRules: string[] = [],
  stableRules: string[] = [],
): { systemContent: ContentBlock[]; chapterPrefix: ContentBlock[]; taskContext: ContentBlock[] } {
  const stableText = stableRules.filter((value) => value.trim()).join("\n\n")
  const systemContent = [
    ...buildContextHubSystemContent(softwareRules, {
      ...result,
      sessionSummary: "",
      dynamicContext: "",
    }),
    ...(stableText ? [{ type: "text" as const, text: `\n\n${stableText}` }] : []),
  ].filter((block) => block.type !== "text" || block.text.length > 0)
    .map((block) => block.type === "text" ? { ...block, cacheControl: true } : block)

  const summary = result.sessionSummary ? `## 当前会话摘要\n${result.sessionSummary}` : ""
  const material = result.dynamicContext ? `## 本轮参考资料\n${result.dynamicContext}` : ""
  const rules = dynamicRules.filter((value) => value.trim()).join("\n\n")

  const chapterPrefix: ContentBlock[] = material
    ? [{ type: "text", text: material, cacheControl: true }]
    : []
  const taskContext: ContentBlock[] = []
  if (summary) taskContext.push({ type: "text", text: summary })
  if (rules) taskContext.push({ type: "text", text: `${summary ? "\n\n" : ""}## 本轮执行要求\n${rules}` })
  return { systemContent, chapterPrefix, taskContext }
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
