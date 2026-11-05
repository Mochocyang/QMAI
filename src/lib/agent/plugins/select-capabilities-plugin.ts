import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { buildAvailableCapabilities } from "../capabilities/registry"
import { selectCapabilities } from "../capabilities/selector"
import { resolveAiWorkflowMode } from "../workflow-mode"
import { listLocalEntityNames } from "@/lib/novel/local-entity-names"
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
      })

      const mode = resolveAiWorkflowMode(input.aiWorkflowMode)
      const localEntityHint = mode !== "fast"
        && (route.intent === "character_query" || route.intent === "setting_query")
        ? await buildLocalEntityHint(input.projectPath, input.userMessage)
        : undefined

      const selectedCapabilities = selectCapabilities({
        capabilities: availableCapabilities,
        intent: route.intent,
        mode,
        userMessage: input.userMessage,
        blockedSources: input.blockedSources as any,
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
        ...(localEntityHint ? { localEntityHint } : {}),
      }
    },
  }
}

/** 本地实体名命中只写进提示，不决定 web_search 开或关。未命中则不提示。 */
async function buildLocalEntityHint(projectPath: string, userMessage: string): Promise<string | undefined> {
  const names = await listLocalEntityNames(projectPath)
  const hits = names.filter((name) => userMessage.includes(name)).slice(0, 8)
  if (hits.length === 0) return undefined
  return `本地实体名命中（只作上下文，不决定是否联网）：${hits.join("、")}`
}
