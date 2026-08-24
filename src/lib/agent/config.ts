import type { LlmConfig } from "@/stores/wiki-store"
import type { ToolRegistry } from "./registry"
import type { AgentConfig } from "./types"
import { DEFAULT_MAX_ROUNDS } from "./types"
import { registerAllBuiltInTools } from "./tools"
import type { ToolFactoryOptions } from "./tools"

const TOOL_UNSUPPORTED_MODEL_PREFIXES: string[] = [
  "o1",
  "o3-mini",
  "deepseek-reasoner",
  "claude-code",
  "cursor-cli",
]

const TOOL_UNSUPPORTED_PROVIDERS = new Set<LlmConfig["provider"]>([
  "claude-code",
  "cursor-cli",
])

/** cursor-api-proxy 无法返回原生 tool_calls delta，需从文本中解析工具调用。 */
export function providerUsesTextToolCalls(provider: LlmConfig["provider"]): boolean {
  return provider === "cursor-cli"
}

interface BuildAgentConfigOptions extends ToolFactoryOptions {
  llmConfig: LlmConfig
  requestOverrides?: AgentConfig["requestOverrides"]
}

export function modelSupportsTools(
  modelId: string,
  provider?: LlmConfig["provider"],
): boolean {
  if (provider && TOOL_UNSUPPORTED_PROVIDERS.has(provider)) return false

  const id = modelId.trim().toLowerCase()
  if (!id) return false

  const modelPart = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id

  return !TOOL_UNSUPPORTED_MODEL_PREFIXES.some((prefix) => {
    const lowerPrefix = prefix.toLowerCase()
    return id.startsWith(lowerPrefix) || modelPart.startsWith(lowerPrefix)
  })
}

/** Provider/user switch: undefined/true keeps tools; false strips tools/tool_choice. */
export function isFunctionCallingEnabled(llmConfig: LlmConfig): boolean {
  return llmConfig.functionCallingEnabled !== false
}

export function effectiveToolsEnabled(
  modelId: string,
  llmConfig: LlmConfig,
): boolean {
  return modelSupportsTools(modelId, llmConfig.provider) && isFunctionCallingEnabled(llmConfig)
}

export function buildAgentConfig(
  modelId: string,
  systemPrompt: string,
  registry: ToolRegistry,
  options: BuildAgentConfigOptions,
): AgentConfig {
  registry.clear()
  const fcEnabled = isFunctionCallingEnabled(options.llmConfig)
  registerAllBuiltInTools(registry, fcEnabled
    ? options
    : {
        ...options,
        enabledToolNames: [],
        mcpTools: [],
      })

  const prompt = providerUsesTextToolCalls(options.llmConfig.provider) && fcEnabled
    ? `${systemPrompt}\n\n当需要调用工具时，请只输出一个 JSON 对象，格式为 {"name":"工具名","arguments":{...}}，不要附加其他说明文字。收到工具结果后继续推理；若无需工具则直接回答。`
    : systemPrompt

  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    tools: registry.list(),
    systemPrompt: prompt,
    llmConfig: options.llmConfig,
    modelId,
    projectPath: options.projectPath,
    requestOverrides: options.requestOverrides,
  }
}
