/**
 * 标记块协议共用的无语义机械。
 *
 * 大纲共创、章节共创、计划协议、意图分析的字段各不相同，但「从开闭标记里扫出
 * JSON」是同一件事。补协议那一轮调用仍只服务共创。
 *
 * 本模块不含业务语义：模块名、错误文案、字段校验都由调用方决定。reason 是稳定
 * 枚举，调用方映射成自己的文案。
 */

import { jsonrepair } from "jsonrepair"
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
  | "unparseable"
  | "not_object"

export type MarkedJsonScan =
  | { kind: "none" }
  | { kind: "payload"; payload: Record<string, unknown> }
  | { kind: "invalid"; reason: MarkedJsonInvalidReason }

/** 区域内所有配平的顶层 `{...}`；某个 `{` 配不平时跳过它继续找，不让一个孤立括号吞掉后面的协议。 */
function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const found = extractLeadingJsonObject(text.slice(cursor))
    if (found) {
      objects.push(found.json)
      cursor = text.length - found.remainder.length
      continue
    }
    const next = text.indexOf("{", cursor)
    if (next < 0) break
    cursor = next + 1
  }
  return objects
}

function parseObjectCandidate(candidate: string): Record<string, unknown> | null {
  for (const attempt of [() => candidate, () => jsonrepair(candidate)]) {
    try {
      const parsed: unknown = JSON.parse(attempt())
      if (isPlainObject(parsed)) return parsed
    } catch {
      // 换下一种方式
    }
  }
  return null
}

/**
 * 扫描 `openPattern ... closePattern` 标记块里的 JSON 对象。
 *
 * 模型常见的不规范输出都要收下：漏写闭合标记、JSON 外包一层 ```json 围栏、
 * JSON 后面再补一句说明。判断依据只有一个——区域里有没有一个配平且能解析的对象；
 * 没写完的括号（流式截断）仍然判失败，绝不拼补成一份假协议。
 * 区域里有多个对象时，按 identityKeys 的顺序取「最后一个带该字符串字段」的对象，
 * 默认认 status。意图分析要传 ["clarity", "status"]：正文字段优先，旧数据的 status 其次。
 */
export function scanMarkedJsonPayload(
  text: string,
  openPattern: RegExp,
  closePattern: RegExp,
  identityKeys: readonly string[] = ["status"],
): MarkedJsonScan {
  const openMatch = stateless(openPattern).exec(text)
  if (!openMatch) return { kind: "none" }

  const afterOpen = text.slice(openMatch.index + openMatch[0].length)
  const closeMatch = stateless(closePattern).exec(afterOpen)
  const region = closeMatch ? afterOpen.slice(0, closeMatch.index) : afterOpen

  const candidates = extractBalancedJsonObjects(region)
  if (candidates.length === 0) {
    const bare = region.replace(/```(?:json)?/gi, "").trim()
    if (!bare || bare.includes("{")) return { kind: "invalid", reason: "missing_payload" }
    try {
      JSON.parse(bare)
      return { kind: "invalid", reason: "not_object" }
    } catch {
      return { kind: "invalid", reason: "missing_payload" }
    }
  }

  const parsed = candidates
    .map(parseObjectCandidate)
    .filter((payload): payload is Record<string, unknown> => payload !== null)
  if (parsed.length === 0) return { kind: "invalid", reason: "unparseable" }

  return { kind: "payload", payload: pickIdentifiedPayload(parsed, identityKeys) }
}

function pickIdentifiedPayload(
  parsed: Record<string, unknown>[],
  identityKeys: readonly string[],
): Record<string, unknown> {
  for (const key of identityKeys) {
    const matches = parsed.filter((payload) => typeof payload[key] === "string")
    if (matches.length > 0) return matches[matches.length - 1]
  }
  return parsed[parsed.length - 1]
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
