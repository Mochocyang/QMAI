export type AiWorkflowMode = "fast" | "standard" | "strict"
export type OutlineWorkflowMode = Extract<AiWorkflowMode, "fast" | "standard">

export const DEFAULT_AI_WORKFLOW_MODE: AiWorkflowMode = "standard"
export const DEFAULT_OUTLINE_WORKFLOW_MODE: OutlineWorkflowMode = "standard"

const AI_WORKFLOW_MODES: readonly AiWorkflowMode[] = ["fast", "standard", "strict"]

export function isAiWorkflowMode(value: unknown): value is AiWorkflowMode {
  return typeof value === "string" && (AI_WORKFLOW_MODES as readonly string[]).includes(value)
}

export function isOutlineWorkflowMode(value: unknown): value is OutlineWorkflowMode {
  return value === "fast" || value === "standard"
}

export function resolveAiWorkflowMode(value: unknown): AiWorkflowMode {
  return isAiWorkflowMode(value) ? value : DEFAULT_AI_WORKFLOW_MODE
}

export function resolveOutlineWorkflowMode(
  value: OutlineWorkflowMode | AiWorkflowMode | null | undefined,
): OutlineWorkflowMode {
  return value === "fast" ? "fast" : DEFAULT_OUTLINE_WORKFLOW_MODE
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
