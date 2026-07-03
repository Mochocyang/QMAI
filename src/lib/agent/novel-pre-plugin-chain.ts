import {
  createPrePluginChain,
  type PrePlugin,
  type PrePluginInput,
  type PrePluginChainResult,
  type PluginConfig,
} from "./pipeline"
import { getScenarioConfig, type ScenarioType } from "./plugin-scenarios"
import { createRouteTaskPlugin } from "./plugins/route-task-plugin"
import { createConfidenceGatePlugin } from "./plugins/confidence-gate-plugin"
import { createResolveChapterPlugin } from "./plugins/resolve-chapter-plugin"
import { createBuildContextPackPlugin } from "./plugins/build-context-pack-plugin"
import { createSelectSkillsPlugin } from "./plugins/select-skills-plugin"
import { createSelectCapabilitiesPlugin } from "./plugins/select-capabilities-plugin"
import { createSoulDialogPlugin } from "./plugins/soul-dialog-plugin"
import { createTrimContextPlugin } from "./plugins/trim-context-plugin"
import { createBuildSystemPromptPlugin } from "./plugins/build-system-prompt-plugin"
import type { BuildContextPackPluginDeps } from "./plugins/build-context-pack-plugin"

export interface NovelPrePluginDeps {
  selectedFile?: string | null
  lastGeneratedChapterNumber?: number
  requestSoulDialog?: (summary: string) => Promise<boolean>
  onError?: (pluginName: string, error: Error) => void
  buildContextPack?: BuildContextPackPluginDeps["buildContextPack"]
  loadClassificationConfig?: BuildContextPackPluginDeps["loadClassificationConfig"]
  applyRouteRules?: BuildContextPackPluginDeps["applyRouteRules"]
  enableClassification?: boolean
  featureName?: string
}

export function createNovelPrePluginChain(deps: NovelPrePluginDeps = {}): PrePlugin[] {
  const {
    selectedFile,
    lastGeneratedChapterNumber,
    requestSoulDialog,
    onError,
    buildContextPack,
    loadClassificationConfig,
    applyRouteRules,
    enableClassification = true,
    featureName,
  } = deps

  const plugins: PrePlugin[] = [
    createRouteTaskPlugin(),
    createConfidenceGatePlugin({
      onError: (e) => onError?.("confidence_gate", e),
    }),
    createResolveChapterPlugin({
      selectedFile,
      lastGeneratedChapterNumber,
      onError: (e) => onError?.("resolve_chapter", e),
    }),
    createBuildContextPackPlugin({
      buildContextPack,
      loadClassificationConfig,
      applyRouteRules,
      enableClassification,
      featureName,
      onError: (e) => onError?.("build_context_pack", e),
    }),
    createSelectSkillsPlugin(),
    createSelectCapabilitiesPlugin(),
    createSoulDialogPlugin({
      shouldRequestSoulDialog: (pack) => {
        if (!requestSoulDialog) return false
        return Boolean(pack?.characterAuras?.trim())
      },
      onError: (e) => onError?.("soul_dialog", e),
    }),
    createTrimContextPlugin({
      onError: (e) => onError?.("trim_context", e),
    }),
    createBuildSystemPromptPlugin({
      onError: (e) => onError?.("build_system_prompt", e),
    }),
  ]

  return plugins
}

export interface RunNovelPrePluginChainOptions {
  input: PrePluginInput
  deps?: NovelPrePluginDeps
  config?: PluginConfig
  scenario?: ScenarioType
}

export async function runNovelPrePluginChain(
  options: RunNovelPrePluginChainOptions,
): Promise<PrePluginChainResult> {
  const { input, deps, config, scenario } = options
  let finalConfig = config
  if (scenario) {
    const scenarioConfig = getScenarioConfig(scenario)
    if (config) {
      finalConfig = mergePluginConfigs(scenarioConfig, config)
    } else {
      finalConfig = scenarioConfig
    }
  }
  const plugins = createNovelPrePluginChain(deps)
  const chain = createPrePluginChain(plugins)
  return chain.run(input, finalConfig)
}

function mergePluginConfigs(base: PluginConfig, override: PluginConfig): PluginConfig {
  const enabledPlugins = override.enabledPlugins !== undefined
    ? override.enabledPlugins
    : base.enabledPlugins

  const disabledPlugins = [
    ...(base.disabledPlugins || []),
    ...(override.disabledPlugins || []),
  ]

  return {
    enabledPlugins,
    disabledPlugins: disabledPlugins.length > 0 ? disabledPlugins : undefined,
  }
}
