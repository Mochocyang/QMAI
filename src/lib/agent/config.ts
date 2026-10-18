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
]

const TOOL_UNSUPPORTED_PROVIDERS = new Set<LlmConfig["provider"]>([
  "claude-code",
])

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
  // 两条关闭通道都必须在这里生效：
  // ① 用户开关（functionCallingEnabled === false）；
  // ② 模型/提供方黑名单（o1、o3-mini、deepseek-reasoner、claude-code）。
  // 只判开关的话，黑名单模型在开关打开时仍会被注册工具并随请求发出，
  // 服务端直接 400；只判黑名单的话，用户关掉开关也不起作用。
  const toolsEnabled = effectiveToolsEnabled(modelId, options.llmConfig)
  registerAllBuiltInTools(registry, toolsEnabled
    ? options
    : {
        ...options,
        enabledToolNames: [],
      })

  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    tools: registry.list(),
    systemPrompt,
    llmConfig: options.llmConfig,
    modelId,
    projectPath: options.projectPath,
    requestOverrides: options.requestOverrides,
  }
}
