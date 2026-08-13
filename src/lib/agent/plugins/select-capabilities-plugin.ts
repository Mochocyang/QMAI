import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { buildAvailableCapabilities } from "../capabilities/registry"
import { selectCapabilities } from "../capabilities/selector"
import { resolveAiWorkflowMode } from "../workflow-mode"
import { detectLocalEntityMiss } from "@/lib/novel/local-entity-names"
import { getOutlineSkillNames, getWritingSkillNames } from "@/lib/novel/skill-route-registry"

const PLAN_PHASE_ALLOWED_TOOLS = new Set([
  "read_chapter",
  "read_outline",
  "read_memory",
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "list_chapters",
  "list_outlines",
  "list_memories",
  "list_deductions",
  "search_chapters",
  "load_context",
  "trim_context",
  "web_search",
  "read_web_page",
  "summarize_search_results",
])

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

      const mode = resolveAiWorkflowMode(input.aiWorkflowMode)
      const needsEntityMissCheck =
        mode !== "fast" && (route.intent === "character_query" || route.intent === "setting_query")
      const localEntityMiss = needsEntityMissCheck
        ? await detectLocalEntityMiss(input.projectPath, input.userMessage)
        : false

      const selectedCapabilities = selectCapabilities({
        capabilities: availableCapabilities,
        intent: route.intent,
        mode,
        userMessage: input.userMessage,
        blockedSources: input.blockedSources as any,
        localEntityMiss,
      })

      const isPlanPhase = Boolean(input.planExecuteEnabled)
      const filteredCapabilities = isPlanPhase
        ? selectedCapabilities.filter(
            (cap) => cap.toolName && PLAN_PHASE_ALLOWED_TOOLS.has(cap.toolName),
          )
        : selectedCapabilities
      const injectedSkillIds = new Set((input.selectedSkills ?? []).map((skill) => skill.id))
      const deterministicSkillNames = route.intent === "generate_outline"
        ? getOutlineSkillNames(input.userMessage)
        : getWritingSkillNames(route.intent, input.userMessage)
      const capabilitiesWithoutDuplicateSkillTool = injectedSkillIds.size > 0 || deterministicSkillNames.length > 0
        ? filteredCapabilities.filter((capability) => capability.toolName !== "apply_skill")
        : filteredCapabilities

      return {
        selectedCapabilities: capabilitiesWithoutDuplicateSkillTool,
        enabledToolNames: capabilitiesWithoutDuplicateSkillTool
          .map((capability) => capability.toolName)
          .filter((name): name is string => Boolean(name)),
      }
    },
  }
}
