import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChapterExecutionContract } from "./chapter-execution-contract"
import { contractToTaskBriefText } from "./chapter-execution-contract"

export type ChapterExecutionReportStatus = "pass" | "warning" | "fail" | "unknown"

export interface ChapterExecutionSceneResult {
  id: string
  passed: boolean
  missing: string[]
  evidence: string
  repairInstruction: string
}

export interface ChapterExecutionReport {
  status: ChapterExecutionReportStatus
  sceneResults: ChapterExecutionSceneResult[]
  mustDoResults: Array<{ item: string; passed: boolean; evidence: string }>
  mustAvoidResults: Array<{ item: string; violated: boolean; evidence: string }>
  finalHookPassed: boolean
  repairItems: string[]
}

export function buildChapterExecutionReportPrompt(
  contract: ChapterExecutionContract,
  finalContent: string,
): string {
  return [
    "你是章节执行报告检查助手。",
    "请根据 ChapterExecutionContract 对最终正文逐项验收。",
    "只输出 JSON，不输出 markdown 代码块，不改写正文。",
    "",
    "JSON 字段：status、sceneResults、mustDoResults、mustAvoidResults、finalHookPassed、repairItems。",
    "status 只能是 pass / warning / fail。",
    "sceneResults 每项包含 id、passed、missing、evidence、repairInstruction。",
    "mustDoResults 每项包含 item、passed、evidence。",
    "mustAvoidResults 每项包含 item、violated、evidence。",
    "repairItems 只列需要返修的具体失败项；不要写笼统建议。",
    "",
    "ChapterExecutionContract：",
    contractToTaskBriefText(contract),
    "",
    "最终正文：",
    finalContent.trim(),
  ].join("\n")
}

export async function runChapterExecutionReportCheck(
  llmConfig: LlmConfig,
  contract: ChapterExecutionContract,
  finalContent: string,
  signal?: AbortSignal,
): Promise<ChapterExecutionReport> {
  let responseText = ""
  let streamError: Error | null = null

  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterExecutionReportPrompt(contract, finalContent) }],
    {
      onToken: (token: string) => {
        responseText += token
      },
      onDone: () => {},
      onError: (error: Error) => {
        streamError = error
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return parseChapterExecutionReportJson(responseText)
}

export function parseChapterExecutionReportJson(text: string): ChapterExecutionReport {
  const jsonText = extractJsonObject(text)
  if (!jsonText) return createUnknownReport()
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    return {
      status: normalizeStatus(parsed.status),
      sceneResults: normalizeSceneResults(parsed.sceneResults),
      mustDoResults: normalizeMustDoResults(parsed.mustDoResults),
      mustAvoidResults: normalizeMustAvoidResults(parsed.mustAvoidResults),
      finalHookPassed: parsed.finalHookPassed === true,
      repairItems: stringArray(parsed.repairItems),
    }
  } catch {
    return createUnknownReport()
  }
}

export function extractExecutionRepairItems(report: ChapterExecutionReport): string[] {
  if (report.repairItems.length > 0) return report.repairItems
  return report.sceneResults
    .filter((result) => !result.passed)
    .map((result) => result.repairInstruction || `${result.id} 未完成：${result.missing.join("；")}`)
    .filter(Boolean)
}

export function executionReportToToolSummary(report: ChapterExecutionReport, repaired = false): string {
  const statusLabel = repaired
    ? "已返修"
    : report.status === "pass"
      ? "通过"
      : report.status === "warning"
        ? "有警告"
        : report.status === "fail"
          ? "需返修"
          : "检查失败"
  const completedScenes = report.sceneResults
    .filter((item) => item.passed)
    .map((item) => item.id)
    .join("/") || "无"
  const repairItems = extractExecutionRepairItems(report)
  return [
    `执行状态：${statusLabel}`,
    `完成场景：${completedScenes}`,
    `待处理偏离项：${repairItems.length > 0 ? repairItems.join("；") : "无"}`,
  ].join("\n")
}

function createUnknownReport(): ChapterExecutionReport {
  return {
    status: "unknown",
    sceneResults: [],
    mustDoResults: [],
    mustAvoidResults: [],
    finalHookPassed: false,
    repairItems: [],
  }
}

function normalizeStatus(value: unknown): ChapterExecutionReportStatus {
  return value === "pass" || value === "warning" || value === "fail" ? value : "unknown"
}

function normalizeSceneResults(value: unknown): ChapterExecutionSceneResult[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return {
      id: stringValue(record.id),
      passed: record.passed === true,
      missing: stringArray(record.missing),
      evidence: stringValue(record.evidence),
      repairInstruction: stringValue(record.repairInstruction),
    }
  }).filter((item) => item.id)
}

function normalizeMustDoResults(value: unknown): ChapterExecutionReport["mustDoResults"] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return {
      item: stringValue(record.item),
      passed: record.passed === true,
      evidence: stringValue(record.evidence),
    }
  }).filter((item) => item.item)
}

function normalizeMustAvoidResults(value: unknown): ChapterExecutionReport["mustAvoidResults"] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return {
      item: stringValue(record.item),
      violated: record.violated === true,
      evidence: stringValue(record.evidence),
    }
  }).filter((item) => item.item)
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text
  const start = fenced.indexOf("{")
  const end = fenced.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return fenced.slice(start, end + 1)
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(stringValue).filter(Boolean)))
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|[；;]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
