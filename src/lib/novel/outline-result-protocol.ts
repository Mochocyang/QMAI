export interface OutlineWritebackItem {
  type: string
  name: string
  content: string
  targetFolder: string
}

export interface OutlineSubAgentResult {
  agentId: string
  agentName: string
  stage: string
  usedSkills: string[]
  confidence: number
  summary: string
  contentMarkdown: string
  constraints: string[]
  writebackItems: OutlineWritebackItem[]
  risks: string[]
  questions: string[]
}

export interface OutlineSubAgentFallbackContext {
  agentId: string
  agentName: string
  usedSkills?: string[]
  stage?: string
}

export interface OutlineFinalResult {
  outlineType: string
  targetFolder: string
  fileName: string
  status: string
  contentMarkdown: string
  qualityCheck: {
    valid: boolean
    errors: string[]
    warnings: string[]
  }
  writebackItems: OutlineWritebackItem[]
  sourceAgents: string[]
}

export type OutlineProtocolParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function extractJsonPayload(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  if (trimmed.startsWith("{")) return trimmed
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim()
  }
  return trimmed
}

function parseJsonObject(text: string): OutlineProtocolParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(extractJsonPayload(text))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "结构化输出必须是 JSON 对象。" }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: `结构化输出 JSON 解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

function missingFields(data: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => data[field] === undefined || data[field] === null || data[field] === "")
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asWritebackItems(value: unknown): OutlineWritebackItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      type: String(item.type ?? ""),
      name: String(item.name ?? ""),
      content: String(item.content ?? ""),
      targetFolder: String(item.target_folder ?? item.targetFolder ?? ""),
    }))
}

export function parseOutlineSubAgentResult(text: string): OutlineProtocolParseResult<OutlineSubAgentResult> {
  const parsed = parseJsonObject(text)
  if (!parsed.ok) return parsed

  const required = [
    "agent_id",
    "agent_name",
    "stage",
    "used_skills",
    "confidence",
    "summary",
    "content_markdown",
    "constraints",
    "writeback_items",
    "risks",
    "questions",
  ]
  const missing = missingFields(parsed.value, required)
  if (missing.length > 0) {
    return { ok: false, error: `子 Agent 输出缺少必要字段：${missing.join("、")}` }
  }

  return {
    ok: true,
    value: {
      agentId: String(parsed.value.agent_id),
      agentName: String(parsed.value.agent_name),
      stage: String(parsed.value.stage),
      usedSkills: asStringArray(parsed.value.used_skills),
      confidence: Number(parsed.value.confidence),
      summary: String(parsed.value.summary),
      contentMarkdown: String(parsed.value.content_markdown),
      constraints: asStringArray(parsed.value.constraints),
      writebackItems: asWritebackItems(parsed.value.writeback_items),
      risks: asStringArray(parsed.value.risks),
      questions: asStringArray(parsed.value.questions),
    },
  }
}

function summarizeMarkdown(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean)
  const summary = lines.slice(0, 2).join("；")
  return summary.slice(0, 120) || "已输出本 Agent 负责内容。"
}

export function coerceOutlineSubAgentResult(
  text: string,
  context: OutlineSubAgentFallbackContext,
): OutlineProtocolParseResult<OutlineSubAgentResult> {
  const parsed = parseOutlineSubAgentResult(text)
  if (parsed.ok) return parsed

  const contentMarkdown = text.trim()
  if (!contentMarkdown) {
    return { ok: false, error: parsed.error }
  }

  return {
    ok: true,
    value: {
      agentId: context.agentId,
      agentName: context.agentName,
      stage: context.stage ?? "markdown_fallback",
      usedSkills: context.usedSkills ?? [],
      confidence: 0.55,
      summary: summarizeMarkdown(contentMarkdown),
      contentMarkdown,
      constraints: [],
      writebackItems: [],
      risks: [`子 Agent 未按结构化 JSON 协议输出，已按 Markdown 内容容错接入：${parsed.error}`],
      questions: [],
    },
  }
}

export function parseOutlineFinalResult(text: string): OutlineProtocolParseResult<OutlineFinalResult> {
  const parsed = parseJsonObject(text)
  if (!parsed.ok) return parsed

  const required = [
    "outline_type",
    "target_folder",
    "file_name",
    "status",
    "content_markdown",
    "quality_check",
    "writeback_items",
    "source_agents",
  ]
  const missing = missingFields(parsed.value, required)
  if (missing.length > 0) {
    return { ok: false, error: `最终大纲输出缺少必要字段：${missing.join("、")}` }
  }

  const quality = parsed.value.quality_check as Record<string, unknown>
  return {
    ok: true,
    value: {
      outlineType: String(parsed.value.outline_type),
      targetFolder: String(parsed.value.target_folder),
      fileName: String(parsed.value.file_name),
      status: String(parsed.value.status),
      contentMarkdown: String(parsed.value.content_markdown),
      qualityCheck: {
        valid: Boolean(quality?.valid),
        errors: asStringArray(quality?.errors),
        warnings: asStringArray(quality?.warnings),
      },
      writebackItems: asWritebackItems(parsed.value.writeback_items),
      sourceAgents: asStringArray(parsed.value.source_agents),
    },
  }
}
