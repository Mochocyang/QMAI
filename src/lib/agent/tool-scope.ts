import type { AgentConfig } from "./types"

export function scopeAgentConfigTools(
  config: AgentConfig,
  enabledToolNames?: string[] | null,
): AgentConfig {
  if (!enabledToolNames) return config

  const enabled = new Set(enabledToolNames)
  return {
    ...config,
    tools: config.tools.filter((tool) => enabled.has(tool.name)),
  }
}
