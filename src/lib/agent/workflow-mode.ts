export type AiWorkflowMode = "fast" | "standard" | "strict"
/**
 * AI 大纲的执行模式，与写作侧 AiWorkflowMode 解耦。
 * plan 为大纲专属的计划模式，discuss 为共创讨论模式（未定稿前不产出正文）。
 */
export type OutlineWorkflowMode = "fast" | "standard" | "plan" | "discuss"

export const DEFAULT_AI_WORKFLOW_MODE: AiWorkflowMode = "standard"
export const DEFAULT_OUTLINE_WORKFLOW_MODE: OutlineWorkflowMode = "standard"

const AI_WORKFLOW_MODES: readonly AiWorkflowMode[] = ["fast", "standard", "strict"]
const OUTLINE_WORKFLOW_MODES: readonly OutlineWorkflowMode[] = ["fast", "standard", "plan", "discuss"]

export function isAiWorkflowMode(value: unknown): value is AiWorkflowMode {
  return typeof value === "string" && (AI_WORKFLOW_MODES as readonly string[]).includes(value)
}

export function isOutlineWorkflowMode(value: unknown): value is OutlineWorkflowMode {
  return typeof value === "string" && (OUTLINE_WORKFLOW_MODES as readonly string[]).includes(value)
}

export function resolveAiWorkflowMode(value: unknown): AiWorkflowMode {
  return isAiWorkflowMode(value) ? value : DEFAULT_AI_WORKFLOW_MODE
}

export function resolveOutlineWorkflowMode(
  value: OutlineWorkflowMode | AiWorkflowMode | null | undefined,
): OutlineWorkflowMode {
  return isOutlineWorkflowMode(value) ? value : DEFAULT_OUTLINE_WORKFLOW_MODE
}

export function getWorkflowModeLabel(mode: AiWorkflowMode): string {
  switch (mode) {
    case "fast":
      return "快速"
    case "strict":
      return "严格"
    case "standard":
    default:
      return "标准"
  }
}
