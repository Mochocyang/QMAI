/**
 * 解析 LLM 返回的 JSON object：剥 fence / 定位 `{...}`，再用 jsonrepair 修复脏输出。
 */

import { jsonrepair } from "jsonrepair"

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim()
}

/** 提取第一个配平的 `{...}`（尊重字符串转义）；截断时返回从 `{` 到末尾。 */
export function extractJsonObjectCandidate(raw: string): string | null {
  const text = stripMarkdownFence(raw)
  const start = text.indexOf("{")
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\" && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return null
}

function tryParseArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed
  } catch {
    // fall through
  }
  return null
}

/** 提取第一个配平的 `[...]`（尊重字符串转义）；截断时返回从 `[` 到末尾。 */
export function extractJsonArrayCandidate(raw: string): string | null {
  const text = stripMarkdownFence(raw)
  const start = text.indexOf("[")
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\" && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

/**
 * 解析 LLM 返回的 JSON **数组**。
 *
 * 提示词写的是 `{"skills":[…]}`，但模型经常只给那个数组本身。
 * 这条以前没人接：`parseLlmJsonObject` 遇到 `[{…}]` 会取出里面第一个对象、
 * 再因为缺 `skills` 键而返回 null，于是整轮静默作废。
 */
export function parseLlmJsonArray(raw: string): unknown[] | null {
  const candidate = extractJsonArrayCandidate(raw)
  if (!candidate) return null

  const direct = tryParseArray(candidate)
  if (direct) return direct

  try {
    return tryParseArray(jsonrepair(candidate))
  } catch {
    return null
  }
}

export function parseLlmJsonObject(raw: string): Record<string, unknown> | null {
  const candidate = extractJsonObjectCandidate(raw)
  if (!candidate) return null

  const direct = tryParseObject(candidate)
  if (direct) return direct

  try {
    return tryParseObject(jsonrepair(candidate))
  } catch {
    return null
  }
}
