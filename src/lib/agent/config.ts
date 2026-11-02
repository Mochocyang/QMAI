import type { LlmConfig } from "@/stores/wiki-store"
import type { ToolRegistry } from "./registry"
import type { AgentConfig } from "./types"
import { DEFAULT_MAX_ROUNDS } from "./types"
import { registerAllBuiltInTools } from "./tools"
import type { ToolFactoryOptions } from "./tools"
import { registerPluginTools, toHostToolName } from "@/lib/plugins/tool-bridge"
import type { PluginToolDescriptor, PluginToolInvoker } from "@/lib/plugins/types"

const TOOL_UNSUPPORTED_MODEL_PREFIXES: string[] = [
  "o1",
  "o3-mini",
  "deepseek-reasoner",
  "claude-code",
]

const TOOL_UNSUPPORTED_PROVIDERS = new Set<LlmConfig["provider"]>([
  "claude-code",
])

/**
 * 模型名可以留空的提供方：留空时由本机 CLI/代理选默认模型。
 * Antigravity CLI 的主 Agent 留空时用 gemini-3.8-flash-medium。
 */
const EMPTY_MODEL_OK_PROVIDERS = new Set<LlmConfig["provider"]>([
  "antigravity-cli",
])

interface BuildAgentConfigOptions extends ToolFactoryOptions {
  llmConfig: LlmConfig
  requestOverrides?: AgentConfig["requestOverrides"]
  /** 已启用插件的工具声明（由插件管理状态提供） */
  pluginTools?: PluginToolDescriptor[]
  /** 调用插件工具的实现（走 Tauri 命令） */
  invokePluginTool?: PluginToolInvoker
}

export function modelSupportsTools(
  modelId: string,
  provider?: LlmConfig["provider"],
): boolean {
  if (provider && TOOL_UNSUPPORTED_PROVIDERS.has(provider)) return false

  const id = modelId.trim().toLowerCase()
  if (!id) return Boolean(provider && EMPTY_MODEL_OK_PROVIDERS.has(provider))

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

  // 插件工具必须在 clear() 与内置注册之后追加：
  // ① buildAgentConfig 每次进来先 registry.clear()，提前注册会被抹掉；
  // ② registerPluginTools 自己跳过同名项，不会覆盖内置工具。
  // 插件工具必须与内置工具受同一套过滤：调用方用 disabledTools 表达「只读聊天」
  // 这类意图时，不能被插件工具绕过。
  if (toolsEnabled && options.pluginTools?.length && options.invokePluginTool) {
    const disabled = new Set(options.disabledTools ?? [])
    const allowed = options.enabledToolNames ? new Set(options.enabledToolNames) : null
    const visible = options.pluginTools.filter((t) => {
      const hostName = toHostToolName(t.pluginId, t.name)
      return !disabled.has(hostName) && (!allowed || allowed.has(hostName))
    })
    registerPluginTools(registry, visible, options.invokePluginTool)
  }

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
