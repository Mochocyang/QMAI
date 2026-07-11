export interface NextStepRecommendationItem {
  id: string
  label: string
  reason: string
}

export interface NextStepRecommendation {
  completedModule: string
  completedScope: string
  recommendations: NextStepRecommendationItem[]
}

export type NextStepExtractionSource = "strict" | "recovered" | "fallback" | "none"

export interface NextStepExtractionResult {
  cleanText: string
  recommendation: NextStepRecommendation | null
  source: NextStepExtractionSource
}

export interface ExtractNextStepOptions {
  allowFallback?: boolean
  completedModule?: string
  completedScope?: string
}

const COMPLETE_PATTERN = /<!--\s*next_step\s*-->([\s\S]*?)<!--\s*\/next_step\s*-->/i
const START_PATTERN = /<!--\s*next_step\s*-->/i
const END_PATTERN = /<!--\s*\/next_step\s*-->/gi
const NAKED_MARKER_PATTERN = /\b\/?next_step\b\s*:?/gi

const FORBIDDEN_PATTERNS = [
  /生成.*正文/,
  /写.*正文/,
  /创作.*正文/,
  /正文.*生成/,
  /正文.*写/,
  /生成.*章节内容/,
  /生成.*正文章节/,
  /章节正文/,
  /写正文/,
  /生成正文/,
  /写章节内容/,
]

export function isRecommendationForbidden(label: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(label))
}

export function parseNextStep(text: string): NextStepRecommendation | null {
  return extractNextStep(text).recommendation
}

export function extractNextStep(
  text: string,
  options: ExtractNextStepOptions = {},
): NextStepExtractionResult {
  const complete = text.match(COMPLETE_PATTERN)
  if (complete) {
    const recommendation = parsePayload(complete[1])
    return {
      cleanText: cleanNextStepArtifacts(text),
      recommendation,
      source: recommendation ? "strict" : options.allowFallback ? "fallback" : "none",
    }
  }

  const start = text.search(START_PATTERN)
  if (start >= 0) {
    const marker = text.slice(start).match(START_PATTERN)?.[0] ?? ""
    const payloadText = text.slice(start + marker.length)
    const recommendation = parsePayload(payloadText)
    if (recommendation) {
      return {
        cleanText: cleanNextStepArtifacts(text),
        recommendation,
        source: "recovered",
      }
    }
    if (options.allowFallback) {
      return {
        cleanText: cleanNextStepArtifacts(text),
        recommendation: buildSafeRecommendation(options),
        source: "fallback",
      }
    }
  }

  return {
    cleanText: cleanNextStepArtifacts(text),
    recommendation: options.allowFallback ? buildSafeRecommendation(options) : null,
    source: options.allowFallback ? "fallback" : "none",
  }
}

export function cleanNextStepArtifacts(text: string): string {
  let cleaned = text.replace(COMPLETE_PATTERN, "")
  const start = cleaned.search(START_PATTERN)
  if (start >= 0) cleaned = cleaned.slice(0, start)
  cleaned = cleaned.replace(END_PATTERN, "").replace(NAKED_MARKER_PATTERN, "")
  cleaned = cleaned.replace(/```(?:json)?\s*$/i, "")
  return cleaned.trim()
}

function parsePayload(payloadText: string): NextStepRecommendation | null {
  const normalized = payloadText.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
  const json = extractJsonObject(normalized)
  if (!json) return null

  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const raw = payload as Record<string, unknown>
  const recommendations = normalizeRecommendations(raw.recommendations)
  return {
    completedModule: String(raw.completedModule ?? raw.completed_module ?? ""),
    completedScope: String(raw.completedScope ?? raw.completed_scope ?? ""),
    recommendations,
  }
}

function normalizeRecommendations(value: unknown): NextStepRecommendationItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      id: String(item.id ?? ""),
      label: String(item.label ?? item.title ?? ""),
      reason: String(item.reason ?? item.description ?? ""),
    }))
    .filter((item) => item.id && item.label)
    .filter((item) => !isRecommendationForbidden(item.label))
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function buildSafeRecommendation(options: ExtractNextStepOptions): NextStepRecommendation {
  return {
    completedModule: options.completedModule ?? "当前模块",
    completedScope: options.completedScope ?? "",
    recommendations: [
      { id: "A", label: "继续完善当前模块", reason: "继续补充当前大纲模块的细节与一致性。" },
      { id: "D", label: "自定义", reason: "由你描述下一步需要完善的内容。" },
    ],
  }
}

export function buildNextStepPromptSuffix(): string {
  return [
    "",
    "## 下一步推荐输出要求",
    "生成完成后，在回复末尾附加 <!-- next_step --> 标记块，按 JSON 输出。",
    "字段：completedModule、completedScope、recommendations（每项含 id、label、reason）。",
    "推荐方向仅限大纲体系，不得推荐生成正文或写正文。",
    "必须包含一个 id 为 D 的“自定义”选项。",
  ].join("\n")
}
