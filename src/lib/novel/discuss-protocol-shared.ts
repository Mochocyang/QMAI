/**
 * 共创类协议共用的无语义机械。
 *
 * 大纲「共创」（outline_discuss）与章节「共创」（chapter_discuss）在协议语义上不同
 * （前者是多轮分歧拍板，后者是一批方向候选单选），但底层的文本处理完全一致：
 * 从标记块里扫出 JSON、剥离标记、以及在模型只吐正文时补一次协议。
 *
 * 本模块只负责这些机械，**不含任何业务语义**：模块名、错误文案、协议字段校验
 * 都由各自的协议模块决定。返回值里的 reason 是稳定枚举，由调用方映射成各自的文案，
 * 以保证大纲侧既有错误串不被改写。
 */

import { streamChat, type ChatMessage } from "@/lib/llm-client"

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** 去掉 g 标记，避免带 lastIndex 的正则被跨次调用污染。 */
function stateless(pattern: RegExp): RegExp {
  return pattern.global ? new RegExp(pattern.source, pattern.flags.replace(/g/g, "")) : pattern
}

/** 从文本里取出第一个完整的顶层 JSON 对象（可用于未闭合标记的流式截断兜底）。 */
export function extractLeadingJsonObject(text: string): { json: string; remainder: string } | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return { json: text.slice(start, index + 1), remainder: text.slice(index + 1) }
      }
    }
  }
  return null
}

export type MarkedJsonInvalidReason =
  | "missing_payload"
  | "trailing_content"
  | "unparseable"
  | "not_object"

export type MarkedJsonScan =
  | { kind: "none" }
  | { kind: "payload"; payload: Record<string, unknown> }
  | { kind: "invalid"; reason: MarkedJsonInvalidReason }

/**
 * 扫描 `openPattern ... closePattern` 标记块里的 JSON 对象。
 *
 * 与既有大纲协议对称：支持未闭合标记兜底（流式截断），并把解析失败原因
 * 归一成 reason 码，交给调用方映射文案。
 */
export function scanMarkedJsonPayload(
  text: string,
  openPattern: RegExp,
  closePattern: RegExp,
): MarkedJsonScan {
  const openMatch = stateless(openPattern).exec(text)
  if (!openMatch) return { kind: "none" }

  const afterOpen = text.slice(openMatch.index + openMatch[0].length)
  const closeMatch = stateless(closePattern).exec(afterOpen)
  const unclosedPayload = closeMatch ? null : extractLeadingJsonObject(afterOpen)
  const payloadText = closeMatch
    ? afterOpen.slice(0, closeMatch.index).trim()
    : unclosedPayload?.json
  if (!payloadText) {
    return { kind: "invalid", reason: "missing_payload" }
  }
  if (!closeMatch && unclosedPayload?.remainder.trim()) {
    return { kind: "invalid", reason: "trailing_content" }
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return { kind: "invalid", reason: "unparseable" }
  }
  if (!isPlainObject(payload)) {
    return { kind: "invalid", reason: "not_object" }
  }
  return { kind: "payload", payload }
}

/** 剥掉标记块（含未闭合的尾部残留），与既有 stripXxxMarkers 行为一致。 */
export function stripMarkedBlock(text: string, openPattern: RegExp, closePattern: RegExp): string {
  const openSrc = stateless(openPattern).source
  const closeSrc = stateless(closePattern).source
  return text
    .replace(new RegExp(`${openSrc}[\\s\\S]*?${closeSrc}`, "gi"), "")
    .replace(new RegExp(`${openSrc}[\\s\\S]*$`, "gi"), "")
    .replace(new RegExp(closeSrc, "gi"), "")
}

/** 修复轮用确定性采样：这是格式转写，不是创作。 */
export function buildRepairRequestOverrides(maxTokens: number): {
  temperature: number
  max_tokens: number
} {
  return { temperature: 0, max_tokens: maxTokens }
}

export interface RepairJsonProtocolWithAiOptions {
  /** 已构建好的修复轮消息（通常只有一条 user 消息）。 */
  messages: ChatMessage[]
  maxTokens: number
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  /** 可注入，便于测试。 */
  stream?: typeof streamChat
}

/**
 * 通用「补协议」修复轮：把一段只含正文的回复转写成带协议块的回复。
 *
 * 与大纲侧行为一致：失败时抛出原始错误，不伪装成空修复。
 */
export async function repairJsonProtocolWithAi(
  options: RepairJsonProtocolWithAiOptions,
): Promise<string> {
  const stream = options.stream ?? streamChat
  let result = ""
  let repairError: Error | null = null
  await stream(
    options.llmConfig,
    options.messages,
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { repairError = error },
    },
    options.signal,
    buildRepairRequestOverrides(options.maxTokens),
  )
  if (repairError) throw repairError
  return result.trim()
}
