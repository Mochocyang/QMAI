import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"
import { isProviderAvailable } from "@/lib/llm-model-keys"

type LlmProvider = LlmConfig["provider"]

/**
 * Maps LlmConfig.provider values to their corresponding LLM_PRESETS id,
 * for providers that are gated by a single well-known preset toggle.
 */
const PRESET_ID_BY_PROVIDER: Partial<Record<LlmProvider, string>> = {
  "claude-code": "claude-code-cli",
  "codex-cli": "codex-cli",
  "cursor-cli": "cursor-cli",
  "antigravity-cli": "antigravity-cli",
  "ollama": "ollama-local",
}

function isPresetAvailable(providerConfigs: ProviderConfigs, presetId: string): boolean {
  const entry = providerConfigs[presetId]
  // 与设置页、模型选择器一致：兼容已有模型但尚无 enabled 字段的旧配置。
  return !!entry && isProviderAvailable(presetId, entry)
}

function hasEnabledCustomPreset(providerConfigs: ProviderConfigs): boolean {
  for (const key of Object.keys(providerConfigs)) {
    if (!key.startsWith("custom-")) continue
    if (providerConfigs[key]?.enabled === true) return true
  }
  return false
}

/**
 * Single source of truth for "is the user's LLM configuration good
 * enough to make calls?" Replaces ad-hoc `apiKey || provider ===
 * "ollama" || …` checks scattered across ingest, sweep, lint,
 * chat, and clip-watcher — every one of which had to be edited
 * by hand whenever a new no-key provider was added, and at least
 * three of which were silently out of date when the
 * Claude Code CLI provider shipped.
 *
 * Use this everywhere a guard like "do we have an LLM?" is
 * needed; the type-level union plus the exhaustiveness test in
 * `has-usable-llm.test.ts` ensures future provider additions
 * land in exactly one bucket and don't slip through.
 */
export function hasUsableLlm(
  cfg: Pick<LlmConfig, "provider" | "apiKey" | "model">,
  providerConfigs: ProviderConfigs = {},
): boolean {
  const hasKey = cfg.apiKey.trim().length > 0
  const hasModel = cfg.model.trim().length > 0

  if (cfg.provider === "claude-code" || cfg.provider === "codex-cli" || cfg.provider === "cursor-cli" || cfg.provider === "antigravity-cli") {
    const presetId = PRESET_ID_BY_PROVIDER[cfg.provider]!
    return isPresetAvailable(providerConfigs, presetId)
  }

  if (cfg.provider === "ollama") {
    return isPresetAvailable(providerConfigs, "ollama-local") && hasModel
  }

  if (cfg.provider === "custom") {
    if (hasKey && hasModel) return true
    return hasEnabledCustomPreset(providerConfigs) && hasModel
  }

  return hasKey && hasModel
}
