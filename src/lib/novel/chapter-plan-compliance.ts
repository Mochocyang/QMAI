import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "./chapter-excerpts"

const FINAL_CONTENT_EXCERPT_MAX_CHARS = CHAPTER_BODY_EXCERPT_MAX_CHARS
const FINAL_CONTENT_EXCERPT_MARKER = "（正文中段已截断，保留开头与结尾用于检查承接和章末钩子。）"

export type ChapterPlanComplianceStatus =
  | "compliant"
  | "mostly_compliant"
  | "partial_deviation"
  | "clear_deviation"
  | "unknown"

export interface ChapterPlanComplianceDeviation {
  point: string
  evidence: string
  suggestion: string
}

export interface ParsedChapterPlanComplianceResult {
  status: ChapterPlanComplianceStatus
  summary: string
  deviations: ChapterPlanComplianceDeviation[]
  rawText: string
}

export function buildChapterPlanCompliancePrompt(planBlueprint: string, finalContent: string): string {
  return [
    "你是小说章节计划履约度检查助手。",
    "请对照用户已确认的章节计划，检查最终正文是否按计划执行。",
    "",
    "计划履约度检查维度：",
    "1. 场景序列：主要场景、顺序和转场是否符合计划。",
    "2. 场景戏剧功能：是否完成制造/升级/反转/暂解/引出新问题。",
    "3. 爽点/期待点：是否兑现旧期待并制造新期待。",
    "4. 冲突与人物：目标、阻力、结果是否符合计划。",
    "5. 信息流：揭示、隐藏、误导是否正确，是否提前泄露角色未知信息。",
    "6. 伏笔动作：埋设、推进、回收是否按计划执行。",
    "7. 对话目标：是否推动试探、隐瞒、压迫、诱导、关系或信息变化。",
    "8. 水文风险：是否有不推动剧情/人物关系/信息差/伏笔/危机的段落。",
    "9. 开头和结尾：开头是否承接并给当前问题；结尾钩子是否导向下一章。",
    "10. 边界禁忌：是否违背 canon、timeline、cognition、mustAvoid。",
    "",
    "输出要求：",
    "1. 只输出 JSON，不改写正文。",
    "2. status 只能是 compliant / mostly_compliant / partial_deviation / clear_deviation。",
    "3. JSON字段：status、summary、deviations；deviations 最多 5 条，每条含 point/evidence/suggestion。",
    "4. 只有影响正文质量的缺失、顺序错误或边界违背才标 partial_deviation / clear_deviation。",
    "",
    "用户已确认的章节计划：",
    planBlueprint.trim(),
    "",
    "最终正文：",
    buildFinalContentExcerpt(finalContent),
  ].join("\n")
}

export async function runChapterPlanComplianceCheck(
  llmConfig: LlmConfig,
  planBlueprint: string,
  finalContent: string,
  signal?: AbortSignal,
  onRequestTrace?: StreamCallbacks["onRequestTrace"],
): Promise<string> {
  if (!planBlueprint.trim()) return ""
  if (!finalContent.trim()) return ""

  let result = ""
  let streamError: Error | undefined
  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterPlanCompliancePrompt(planBlueprint, finalContent) }],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { streamError = error },
      onRequestTrace,
    },
    signal,
  )
  if (streamError) throw streamError
  return result.trim()
}

export function parseChapterPlanComplianceResult(text: string): ParsedChapterPlanComplianceResult {
  const rawText = text.trim()
  if (!rawText) {
    return { status: "unknown", summary: "", deviations: [], rawText }
  }

  const jsonObject = tryParseComplianceJson(rawText)
  if (jsonObject) {
    const status = normalizeComplianceStatus(jsonObject.status ?? jsonObject["履约度"], rawText)
    const summary = stringValue(jsonObject.summary ?? jsonObject["summary"] ?? jsonObject["总评"]) || firstNonEmptyLine(rawText)
    const deviations = normalizeDeviationArray(jsonObject.deviations ?? jsonObject["偏离点"])
    return { status, summary, deviations, rawText }
  }

  const status = normalizeComplianceStatus(undefined, rawText)
  const deviations = parseLegacyDeviationLines(rawText)
  return {
    status,
    summary: firstNonEmptyLine(rawText),
    deviations,
    rawText,
  }
}

export function shouldRepairChapterPlanDeviation(result: ParsedChapterPlanComplianceResult): boolean {
  if (result.status !== "partial_deviation" && result.status !== "clear_deviation") return false
  return result.deviations.some((item) => item.point.trim() || item.suggestion.trim())
}

export function buildChapterPlanDeviationRepairPrompt(
  planBlueprint: string,
  finalContent: string,
  complianceResult: ParsedChapterPlanComplianceResult | string,
): string {
  const parsed = typeof complianceResult === "string"
    ? parseChapterPlanComplianceResult(complianceResult)
    : complianceResult
  const deviationText = parsed.deviations.length > 0
    ? parsed.deviations
      .slice(0, 5)
      .map((item, index) =>
        [
          `${index + 1}. 偏离点：${item.point || "未说明"}`,
          `   正文证据：${item.evidence || "未说明"}`,
          `   建议修正：${item.suggestion || "未说明"}`,
        ].join("\n"),
      )
      .join("\n")
    : parsed.rawText

  return [
    "你是小说章节计划偏离点轻量返修助手。",
    "任务：只修复偏离点，不重写全章；保留原正文结构、叙事节奏、人物口吻和已有有效内容。",
    "禁止：扩写无关情节、替换整章、推翻已完成场景、改变计划之外的设定。",
    "输出：只输出返修后的完整章节正文，不解释。",
    "",
    "用户已确认的章节计划执行摘要：",
    planBlueprint.trim(),
    "",
    "计划履约检查结果：",
    `履约状态：${parsed.status}`,
    parsed.summary ? `总评：${parsed.summary}` : "",
    deviationText,
    "",
    "最终正文：",
    buildFinalContentExcerpt(finalContent),
  ].filter(Boolean).join("\n")
}

export async function runChapterPlanDeviationRepair(
  llmConfig: LlmConfig,
  planBlueprint: string,
  finalContent: string,
  complianceResult: ParsedChapterPlanComplianceResult | string,
  signal?: AbortSignal,
  onRequestTrace?: StreamCallbacks["onRequestTrace"],
): Promise<string> {
  if (!planBlueprint.trim()) return finalContent.trim()
  if (!finalContent.trim()) return ""

  let result = ""
  let streamError: Error | undefined
  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterPlanDeviationRepairPrompt(planBlueprint, finalContent, complianceResult) }],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { streamError = error },
      onRequestTrace,
    },
    signal,
  )
  if (streamError) throw streamError
  return result.trim() || finalContent.trim()
}

function tryParseComplianceJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text
  const start = fenced.indexOf("{")
  const end = fenced.lastIndexOf("}")
  if (start < 0 || end <= start) return null

  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function normalizeComplianceStatus(value: unknown, fallbackText: string): ChapterPlanComplianceStatus {
  const source = `${stringValue(value)}\n${fallbackText}`
  if (/clear_deviation|明显偏离/.test(source)) return "clear_deviation"
  if (/partial_deviation|部分偏离/.test(source)) return "partial_deviation"
  if (/mostly_compliant|基本符合/.test(source)) return "mostly_compliant"
  if (/compliant|履约度\s*[：:]\s*符合|^符合$/m.test(source)) return "compliant"
  return "unknown"
}

function normalizeDeviationArray(value: unknown): ChapterPlanComplianceDeviation[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 5)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return { point: stringValue(item), evidence: "", suggestion: "" }
      }
      const record = item as Record<string, unknown>
      return {
        point: stringValue(record.point ?? record["偏离点"]),
        evidence: stringValue(record.evidence ?? record["正文证据"]),
        suggestion: stringValue(record.suggestion ?? record["建议修正"]),
      }
    })
    .filter((item) => item.point || item.evidence || item.suggestion)
}

function parseLegacyDeviationLines(text: string): ChapterPlanComplianceDeviation[] {
  const deviations: ChapterPlanComplianceDeviation[] = []
  let current: ChapterPlanComplianceDeviation | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const point = matchLegacyField(trimmed, "偏离点")
    if (point !== null) {
      current = { point, evidence: "", suggestion: "" }
      deviations.push(current)
      continue
    }
    const evidence = matchLegacyField(trimmed, "正文证据")
    if (evidence !== null) {
      if (!current) {
        current = { point: "", evidence: "", suggestion: "" }
        deviations.push(current)
      }
      current.evidence = evidence
      continue
    }
    const suggestion = matchLegacyField(trimmed, "建议修正")
    if (suggestion !== null) {
      if (!current) {
        current = { point: "", evidence: "", suggestion: "" }
        deviations.push(current)
      }
      current.suggestion = suggestion
    }
  }
  return deviations.slice(0, 5).filter((item) => item.point || item.evidence || item.suggestion)
}

function matchLegacyField(line: string, field: string): string | null {
  const match = line.match(new RegExp(`${field}\\s*[：:]\\s*(.+)$`))
  return match?.[1]?.trim() ?? null
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
}

function buildFinalContentExcerpt(finalContent: string): string {
  const normalized = finalContent.trim()
  if (normalized.length <= FINAL_CONTENT_EXCERPT_MAX_CHARS) return normalized

  const marker = `\n\n${FINAL_CONTENT_EXCERPT_MARKER}\n\n`
  const available = Math.max(200, FINAL_CONTENT_EXCERPT_MAX_CHARS - marker.length)
  const headLength = Math.floor(available / 2)
  const tailLength = available - headLength
  return `${normalized.slice(0, headLength).trimEnd()}${marker}${normalized.slice(-tailLength).trimStart()}`
}
