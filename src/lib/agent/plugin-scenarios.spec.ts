import { describe, expect, it } from "vitest"
import { DEFAULT_SCENARIO_CONFIGS, getScenarioConfig, type ScenarioType } from "./plugin-scenarios"
import { createNovelPrePluginChain } from "./novel-pre-plugin-chain"
import { filterPluginsByConfig, type PrePlugin } from "./pipeline"

const ALL_PLUGIN_NAMES = [
  "route_task",
  "confidence_gate",
  "resolve_chapter",
  "build_context_pack",
  "select_skills",
  "select_capabilities",
  "soul_dialog",
  "trim_context",
  "build_system_prompt",
]

function getPluginNames(plugins: PrePlugin[]): string[] {
  return plugins.map((p) => p.name)
}

describe("plugin-scenarios", () => {
  describe("DEFAULT_SCENARIO_CONFIGS", () => {
    it("has all 5 scenarios defined", () => {
      const scenarios = Object.keys(DEFAULT_SCENARIO_CONFIGS) as ScenarioType[]
      expect(scenarios).toHaveLength(5)
      expect(scenarios).toContain("chat")
      expect(scenarios).toContain("outline_gen")
      expect(scenarios).toContain("chapter_gen")
      expect(scenarios).toContain("review")
      expect(scenarios).toContain("general")
    })
  })

  describe("getScenarioConfig", () => {
    it("returns config for general scenario", () => {
      const config = getScenarioConfig("general")
      expect(config).toBeDefined()
    })

    it("returns config for each scenario", () => {
      const scenarios: ScenarioType[] = ["chat", "outline_gen", "chapter_gen", "review", "general"]
      for (const scenario of scenarios) {
        const config = getScenarioConfig(scenario)
        expect(config).toBeDefined()
      }
    })
  })

  describe("scenario plugin filtering", () => {
    const allPlugins = createNovelPrePluginChain()

    it("general: all plugins enabled", () => {
      const config = getScenarioConfig("general")
      const filtered = filterPluginsByConfig(allPlugins, config)
      const names = getPluginNames(filtered)
      expect(names).toEqual(ALL_PLUGIN_NAMES)
    })

    it("chat: all plugins enabled", () => {
      const config = getScenarioConfig("chat")
      const filtered = filterPluginsByConfig(allPlugins, config)
      const names = getPluginNames(filtered)
      expect(names).toEqual(ALL_PLUGIN_NAMES)
    })

    it("outline_gen: disables soul_dialog", () => {
      const config = getScenarioConfig("outline_gen")
      const filtered = filterPluginsByConfig(allPlugins, config)
      const names = getPluginNames(filtered)
      expect(names).not.toContain("soul_dialog")
      expect(names).toContain("route_task")
      expect(names).toContain("confidence_gate")
      expect(names).toContain("resolve_chapter")
      expect(names).toContain("build_context_pack")
      expect(names).toContain("select_skills")
      expect(names).toContain("select_capabilities")
      expect(names).toContain("trim_context")
      expect(names).toContain("build_system_prompt")
      expect(names).toHaveLength(8)
    })

    it("chapter_gen: all plugins enabled", () => {
      const config = getScenarioConfig("chapter_gen")
      const filtered = filterPluginsByConfig(allPlugins, config)
      const names = getPluginNames(filtered)
      expect(names).toEqual(ALL_PLUGIN_NAMES)
    })

    it("review: disables soul_dialog and confidence_gate", () => {
      const config = getScenarioConfig("review")
      const filtered = filterPluginsByConfig(allPlugins, config)
      const names = getPluginNames(filtered)
      expect(names).not.toContain("soul_dialog")
      expect(names).not.toContain("confidence_gate")
      expect(names).toContain("route_task")
      expect(names).toContain("resolve_chapter")
      expect(names).toContain("build_context_pack")
      expect(names).toContain("select_skills")
      expect(names).toContain("select_capabilities")
      expect(names).toContain("trim_context")
      expect(names).toContain("build_system_prompt")
      expect(names).toHaveLength(7)
    })
  })
})
