import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

export type ChapterPlanSelfCheckStatus = "pass" | "warning" | "error" | "unknown"

export interface ChapterPlanSelfCheckIssue {
  severity: "warning" | "error" | "info"
  problem: string
  risk: string
  suggestion: string
}

export interface ParsedChapterPlanSelfCheckResult {
  status: ChapterPlanSelfCheckStatus
  summary: string
  issues: ChapterPlanSelfCheckIssue[]
  formattedText: string
}

export interface ChapterPlanSelfCheckContext {
  chapterGoal?: string
  characterStates?: string
  cognitionStates?: string
  foreshadowingStates?: string
  timeline?: string
  canonRules?: string
  mustAvoid?: string
}

function buildContextSection(context?: ChapterPlanSelfCheckContext): string {
  if (!context) return ""
  const rows = [
    ["当前章节目标", context.chapterGoal],
    ["人物状态", context.characterStates],
    ["角色认知状态", context.cognitionStates],
    ["伏笔状态", context.foreshadowingStates],
    ["时间线", context.timeline],
    ["正史规则", context.canonRules],
    ["必须避免", context.mustAvoid],
  ].filter(([, value]) => typeof value === "string" && value.trim())

  if (rows.length === 0) return ""
  return [
    "",
    "项目上下文核对资料：",
    "请把章节计划逐项对照以下资料，不得只检查计划形式完整性。",
    ...rows.map(([label, value]) => `${label}：${String(value).trim().slice(0, 1200)}`),
  ].join("\n")
}

export function buildChapterPlanSelfCheckPrompt(
  planContent: string,
  context?: ChapterPlanSelfCheckContext,
): string {
  const contextSection = buildContextSection(context)
  return [
    "你是小说章节计划自检助手。",
    "请轻量检查这份章节计划是否足以指导后续正文生成。",
    "",
    "计划自检清单：",
    "1. 固定段落是否完整：本章目标、已知依据、执行边界、分场景执行计划、信息流与伏笔、验收标准、风险与兜底。",
    "2. 本章目标是否写清剧情推进、人物状态变化、读者期待、章末状态和核心问题。",
    "3. 已知依据是否区分已读取资料、缺失项和最小写作假设；不得把未读取资料写成事实。",
    "4. 执行边界是否明确必须执行、禁止违背、可自由发挥三层约束。",
    "5. 分场景执行计划是否包含 2-4 个 S1/S2/S3 场景，且每个场景都有目的、冲突、转折、输出结果、验收标准。",
    "6. 信息流与伏笔是否写清揭示、隐藏、误导、埋设/推进/回收伏笔，以及不能提前给出的信息。",
    "7. 验收标准是否可检查，能用正文里是否出现、是否完成、是否违背来判断。",
    "8. 风险与兜底是否覆盖水文、解释腔、人物认知越界、提前泄密、场景断裂、钩子凭空出现。",
    "9. 章末钩子是否来自本章推进结果，并自然导向下一章。",
    "10. 对话目标和人物行动是否明确，并会带来关系、认知、处境或信息状态变化。",
    "",
    "输出要求：",
    "1. 只输出一个 JSON 对象，不改计划、不写正文、不输出 markdown 代码块。",
    "2. 字段：status、summary、issues；status 只能是 pass、warning、error。",
    "3. summary 用一句中文概括；issues 最多 5 条，每条含 severity、problem、risk、suggestion。",
    "4. 缺失段落、缺失场景字段或不可验收的标准必须进入 issues，并给出可直接修订计划的 suggestion。",
    "5. 可确认通过时 status 为 pass，issues 为空数组。",
    contextSection,
    "",
    "待自检章节计划：",
    planContent.trim(),
  ].join("\n")
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function normalizeStatus(value: unknown): ChapterPlanSelfCheckStatus {
  return value === "pass" || value === "warning" || value === "error" ? value : "unknown"
}

function normalizeSeverity(value: unknown): "warning" | "error" | "info" {
  return value === "error" || value === "info" || value === "warning" ? value : "warning"
}

function formatSelfCheckResult(input: {
  status: ChapterPlanSelfCheckStatus
  summary: string
  issues: ChapterPlanSelfCheckIssue[]
}): string {
  const lines = [`状态：${input.status}`]
  if (input.summary) lines.push(input.summary)
  if (input.issues.length > 0) {
    lines.push("")
    input.issues.forEach((issue, index) => {
      lines.push(`${index + 1}. [${issue.severity}] ${issue.problem}`)
      if (issue.risk) lines.push(`风险：${issue.risk}`)
      if (issue.suggestion) lines.push(`建议：${issue.suggestion}`)
    })
  }
  return lines.join("\n")
}

export function parseChapterPlanSelfCheckResult(text: string): ParsedChapterPlanSelfCheckResult {
  const raw = text.trim()
  const jsonText = extractJsonObject(raw)
  if (!jsonText) {
    return { status: "unknown", summary: raw, issues: [], formattedText: raw }
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((item): ChapterPlanSelfCheckIssue => {
          const obj = typeof item === "object" && item ? item as Record<string, unknown> : {}
          return {
            severity: normalizeSeverity(obj.severity),
            problem: String(obj.problem ?? ""),
            risk: String(obj.risk ?? ""),
            suggestion: String(obj.suggestion ?? ""),
          }
        }).filter((issue) => issue.problem || issue.risk || issue.suggestion)
      : []
    const result = {
      status: normalizeStatus(parsed.status),
      summary: String(parsed.summary ?? ""),
      issues,
    }
    return {
      ...result,
      formattedText: formatSelfCheckResult(result),
    }
  } catch {
    return { status: "unknown", summary: raw, issues: [], formattedText: raw }
  }
}

export async function runChapterPlanSelfCheck(
  llmConfig: LlmConfig,
  planContent: string,
  context?: ChapterPlanSelfCheckContext,
): Promise<string> {
  const trimmedPlan = planContent.trim()
  if (!trimmedPlan) {
    throw new Error("没有可自检的章节计划")
  }

  let result = ""
  let streamError: Error | undefined
  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterPlanSelfCheckPrompt(trimmedPlan, context) }],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { streamError = error },
    },
    undefined,
    { reasoning: { mode: "off" } },
  )
  if (streamError) throw streamError
  return parseChapterPlanSelfCheckResult(result.trim()).formattedText || "自检完成，未返回具体结果。"
}

export function buildChapterPlanRevisionPrompt(planContent: string, selfCheckResult: string): string {
  return [
    "你是小说章节计划修订助手。",
    "请基于自检结果对原章节计划做最小必要修订。",
    "",
    "硬性要求：",
    "1. 只输出修订后的章节计划，不要输出解释、改动说明或正文。",
    "2. 保留原计划中合理的章节目标、场景序列、人物动机、伏笔动作和结尾钩子。",
    "3. 只修复自检指出的问题：缺固定段落、缺场景字段、信息流矛盾、伏笔不明、执行边界不足、验收标准不可检查。",
    "4. 必须补足对话目标、人物行动结果、信息状态变化、章末钩子来源和水文风险兜底。",
    "5. 修订后的计划必须保持 7 段结构：本章目标、已知依据、执行边界、分场景执行计划、信息流与伏笔、验收标准、风险与兜底。",
    "",
    "原章节计划：",
    planContent.trim(),
    "",
    "计划自检结果：",
    selfCheckResult.trim(),
  ].join("\n")
}

export async function runChapterPlanRevision(
  llmConfig: LlmConfig,
  planContent: string,
  selfCheckResult: string,
): Promise<string> {
  if (!planContent.trim()) throw new Error("没有可修订的章节计划")
  if (!selfCheckResult.trim()) throw new Error("没有可用于修订的自检结果")

  let result = ""
  let streamError: Error | undefined
  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterPlanRevisionPrompt(planContent, selfCheckResult) }],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { streamError = error },
    },
    undefined,
    { reasoning: { mode: "off" } },
  )
  if (streamError) throw streamError
  return result.trim() || "修订失败：模型未返回修订计划。"
}
