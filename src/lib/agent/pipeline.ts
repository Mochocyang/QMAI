import type { AgentConfig } from "./types"
import type { TaskRouteResult } from "@/lib/novel/task-router"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { LegacyAiWorkflowMode } from "./workflow-mode"
import type { UserSkill } from "@/lib/novel/skill-library"
import type { AiCapability, SelectedCapabilityTrace } from "./capabilities/types"

export interface PrePluginInput {
  userMessage: string
  projectPath: string
  agentConfig: AgentConfig
  novelMode?: boolean
  selectedFile?: string | null
  lastGeneratedChapterNumber?: number
  historyMessages?: Array<{ role: string; content: string }>
  taskRoute?: TaskRouteResult | null
  effectiveTaskRoute?: TaskRouteResult | null
  contextPack?: ContextPack | null
  aiWorkflowMode?: LegacyAiWorkflowMode
  planExecuteEnabled?: boolean
  availableSkills?: UserSkill[]
  selectedSkills?: UserSkill[]
  mcpCapabilities?: AiCapability[]
  availableCapabilities?: AiCapability[]
  selectedCapabilities?: SelectedCapabilityTrace[]
  novelSystemPrompt?: string
  finalSystemPrompt?: string
  finalSystemRulesPrompt?: string
  shouldStop?: boolean
  stopReason?: string
  [key: string]: unknown
}

export interface PrePluginOutput {
  taskRoute?: TaskRouteResult | null
  effectiveTaskRoute?: TaskRouteResult | null
  contextPack?: ContextPack | null
  selectedSkills?: UserSkill[]
  selectedCapabilities?: SelectedCapabilityTrace[]
  enabledToolNames?: string[]
  novelSystemPrompt?: string
  finalSystemPrompt?: string
  finalSystemRulesPrompt?: string
  shouldStop?: boolean
  stopReason?: string
  [key: string]: unknown
}

export interface PrePlugin {
  name: string
  priority: number
  run(input: PrePluginInput): Promise<PrePluginOutput>
}

export interface PluginConfig {
  enabledPlugins?: string[]
  disabledPlugins?: string[]
}

export interface PrePluginChainResult extends PrePluginOutput {
  errors: Array<{ pluginName: string; error: string }>
  executedPlugins: string[]
}

export interface PrePluginChain {
  run(input: PrePluginInput, config?: PluginConfig): Promise<PrePluginChainResult>
}

export function filterPluginsByConfig(plugins: PrePlugin[], config?: PluginConfig): PrePlugin[] {
  if (!config) return plugins
  const { enabledPlugins, disabledPlugins } = config
  return plugins.filter((plugin) => {
    if (disabledPlugins?.includes(plugin.name)) return false
    if (enabledPlugins !== undefined && !enabledPlugins.includes(plugin.name)) return false
    return true
  })
}

export function createPrePluginChain(plugins: PrePlugin[]): PrePluginChain {
  const sorted = [...plugins].sort((a, b) => a.priority - b.priority)
  return {
    run: async (input: PrePluginInput, config?: PluginConfig): Promise<PrePluginChainResult> => {
      const activePlugins = filterPluginsByConfig(sorted, config)
      let current: PrePluginInput & PrePluginOutput = { ...input }
      const errors: Array<{ pluginName: string; error: string }> = []
      const executed: string[] = []
      for (const plugin of activePlugins) {
        executed.push(plugin.name)
        try {
          const output = await plugin.run(current)
          current = { ...current, ...output }
          if (output.shouldStop) {
            return { ...current, shouldStop: true, stopReason: output.stopReason, errors, executedPlugins: executed }
          }
        } catch (e) {
          errors.push({ pluginName: plugin.name, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return { ...current, errors, executedPlugins: executed }
    },
  }
}
