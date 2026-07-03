import type { PluginConfig } from "./pipeline"

export type ScenarioType = "chat" | "outline_gen" | "chapter_gen" | "review" | "general"

export const DEFAULT_SCENARIO_CONFIGS: Record<ScenarioType, PluginConfig> = {
  general: {},
  chat: {},
  outline_gen: {
    disabledPlugins: ["soul_dialog"],
  },
  chapter_gen: {},
  review: {
    disabledPlugins: ["soul_dialog", "confidence_gate"],
  },
}

export function getScenarioConfig(scenario: ScenarioType): PluginConfig {
  return DEFAULT_SCENARIO_CONFIGS[scenario]
}
