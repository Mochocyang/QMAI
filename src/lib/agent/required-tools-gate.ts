import type { NovelTaskIntent } from "@/lib/novel/task-router"
import { OUTLINE_FIND_CHAPTER_INTENTS } from "@/lib/novel/outline-find-protocol"
import type { AiWorkflowMode } from "./workflow-mode"

interface RequiredToolsGateInput {
  requiredToolsOnce?: string[] | null
  availableToolNames: Iterable<string>
  calledToolNames: Iterable<string>
  toolsEnabled: boolean
}

/** 返回仍缺失的必调工具名；空数组表示不拦截。 */
export function missingRequiredToolsOnce(input: RequiredToolsGateInput): string[] {
  const required = (input.requiredToolsOnce ?? []).filter((name) => name.trim())
  if (!input.toolsEnabled || required.length === 0) return []

  const available = new Set(input.availableToolNames)
  const applicable = required.filter((name) => available.has(name))
  if (applicable.length === 0) return []

  const called = new Set(input.calledToolNames)
  return applicable.filter((name) => !called.has(name))
}

export function shouldBlockFinalWithoutRequiredTools(input: RequiredToolsGateInput): boolean {
  return missingRequiredToolsOnce(input).length > 0
}

export function buildRequiredToolNudgeMessage(missing: string[]): string {
  const names = missing.join("、")
  return [
    "系统约束：禁止直接输出章节终稿正文。",
    `本轮必须先调用以下工具：${names}。`,
    "请立即调用 run_chapter_workflow（可先补读必要上下文），不要把章节正文作为本轮最终回复。",
  ].join("\n")
}

export class RequiredToolsNotCalledError extends Error {
  readonly missingTools: string[]

  constructor(missingTools: string[]) {
    super(
      `章节写作未调用必选工具（${missingTools.join("、")}），已拒绝未走工作流的终稿。请重试并调用 run_chapter_workflow。`,
    )
    this.name = "RequiredToolsNotCalledError"
    this.missingTools = missingTools
  }
}

export class RequiredToolFallbackError extends Error {
  readonly toolName: string

  constructor(toolName: string, detail: string) {
    super(`必选工作流执行失败（${toolName}）：${detail}`)
    this.name = "RequiredToolFallbackError"
    this.toolName = toolName
  }
}

interface ResolveRequiredToolsOnceInput {
  novelMode: boolean
  intent?: string | null
  mode?: AiWorkflowMode | null
  planExecuteActive: boolean
  enabledToolNames?: string[] | null
}

/**
 * 非 fast 章节写作、且工具可用、非计划收集阶段时，要求至少调用一次 run_chapter_workflow。
 */
export function resolveRequiredToolsOnce(
  input: ResolveRequiredToolsOnceInput,
): string[] | undefined {
  if (!input.novelMode) return undefined
  if (input.planExecuteActive) return undefined
  if (!input.intent || !OUTLINE_FIND_CHAPTER_INTENTS.has(input.intent as NovelTaskIntent)) {
    return undefined
  }
  const mode = input.mode ?? "strict"
  if (mode === "fast") return undefined

  const enabled = input.enabledToolNames
  if (Array.isArray(enabled) && !enabled.includes("run_chapter_workflow")) {
    return undefined
  }

  return ["run_chapter_workflow"]
}
