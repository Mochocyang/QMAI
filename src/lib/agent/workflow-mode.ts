export type AiWorkflowMode = "fast" | "standard" | "strict"

export const DEFAULT_AI_WORKFLOW_MODE: AiWorkflowMode = "standard"

export function resolveAiWorkflowMode(value: boolean | AiWorkflowMode | null | undefined): AiWorkflowMode {
  if (value === true) return "strict"
  if (value === false || value == null) return DEFAULT_AI_WORKFLOW_MODE
  return value
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
