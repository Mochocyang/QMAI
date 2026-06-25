import type { ReasoningConfig } from "@/stores/wiki-store"

export function resolveUserVisibleReasoning(reasoning?: ReasoningConfig): ReasoningConfig {
  if (!reasoning) {
    return { mode: "auto" }
  }
  return reasoning
}
