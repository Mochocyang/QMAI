import type { ChatMessage } from "@/lib/llm-providers"

export function buildSimpleExtractionMessages(prompt: string, cachePrefix?: string): ChatMessage[] {
  if (!cachePrefix) return [{ role: "user", content: prompt }]

  // 前缀由结构化构造器提供，按已知长度拆分，避免把原文标题误当作分隔符。
  return [{
    role: "user",
    content: [
      { type: "text", text: cachePrefix, cacheControl: true },
      { type: "text", text: prompt.slice(cachePrefix.length) },
    ],
  }]
}
