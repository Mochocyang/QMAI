import type { LlmConfig } from "@/stores/wiki-store"
import type { ToolRegistry } from "./registry"
import type { AgentConfig } from "./types"
import { DEFAULT_MAX_ROUNDS } from "./types"
import { registerAllBuiltInTools } from "./tools"
import type { ToolFactoryOptions } from "./tools"

export const TOOL_UNSUPPORTED_MODEL_PREFIXES: string[] = [
  "o1",
  "o3-mini",
  "deepseek-reasoner",
  "claude-code",
  "codex-cli",
]

export interface BuildAgentConfigOptions extends ToolFactoryOptions {
  llmConfig: LlmConfig
}

export function modelSupportsTools(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  if (!id) return false

  const modelPart = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id

  return !TOOL_UNSUPPORTED_MODEL_PREFIXES.some((prefix) => {
    const lowerPrefix = prefix.toLowerCase()
    return id.startsWith(lowerPrefix) || modelPart.startsWith(lowerPrefix)
  })
}

export function buildAgentConfig(
  modelId: string,
  systemPrompt: string,
  registry: ToolRegistry,
  options: BuildAgentConfigOptions,
): AgentConfig {
  registry.clear()
  registerAllBuiltInTools(registry, options)

  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    tools: registry.list(),
    systemPrompt,
    llmConfig: options.llmConfig,
    modelId,
  }
}
