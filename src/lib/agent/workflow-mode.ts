export type AiWorkflowMode = "fast" | "standard" | "strict"

export const DEFAULT_AI_WORKFLOW_MODE: AiWorkflowMode = "standard"

export function resolveAiWorkflowMode(value: AiWorkflowMode | null | undefined): AiWorkflowMode {
  return value ?? DEFAULT_AI_WORKFLOW_MODE
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
