import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { buildAvailableCapabilities } from "../capabilities/registry"
import { selectCapabilities } from "../capabilities/selector"

export function createSelectCapabilitiesPlugin(): PrePlugin {
  return {
    name: "select_capabilities",
    priority: 37,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return { selectedCapabilities: [] }

      const route = input.effectiveTaskRoute || input.taskRoute
      if (!route) return { selectedCapabilities: [] }

      const availableCapabilities = input.availableCapabilities ?? buildAvailableCapabilities({
        toolNames: input.agentConfig.tools?.map((tool) => tool.name) ?? [],
        selectedSkills: input.selectedSkills ?? [],
        mcpCapabilities: input.mcpCapabilities ?? [],
      })

      const selectedCapabilities = selectCapabilities({
        capabilities: availableCapabilities,
        intent: route.intent,
        mode: input.aiWorkflowMode ?? "standard",
        userMessage: input.userMessage,
        blockedSources: input.blockedSources as any,
      })

      return {
        selectedCapabilities,
        enabledToolNames: selectedCapabilities
          .map((capability) => capability.toolName)
          .filter((name): name is string => Boolean(name)),
      }
    },
  }
}
