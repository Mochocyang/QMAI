import type { ContentBlock } from "@/lib/llm-providers"
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
