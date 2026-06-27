import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"

export type LlmProvider = LlmConfig["provider"]

/**
 * Providers that don't need an API key to operate:
 *   - `ollama` runs on a local HTTP endpoint with no auth
 *   - `custom` is an OpenAI-compatible local-or-LAN endpoint that
 *     may or may not require auth (LM Studio, llama.cpp, vLLM
 *     defaults are all unauthenticated; users who deploy behind a
 *     proxy can still set apiKey to add Bearer auth)
 *   - `claude-code` spawns the Claude Code CLI subprocess, which
 *     authenticates via the user's existing ~/.claude OAuth — no
 *     API key is needed (or accepted) at this layer.
 *   - `codex-cli` spawns the Codex CLI subprocess, which authenticates
 *     via the user's existing Codex/ChatGPT login.
 *
 * Hosted providers (openai, anthropic, google, minimax) require a
 * key from the user.
 */
export const PROVIDERS_WITHOUT_KEY: ReadonlySet<LlmProvider> = new Set<LlmProvider>([
  "ollama",
  "custom",
  "claude-code",
  "codex-cli",
])

/**
 * Maps LlmConfig.provider values to their corresponding LLM_PRESETS id,
 * for providers that are gated by a single well-known preset toggle.
 */
const PRESET_ID_BY_PROVIDER: Partial<Record<LlmProvider, string>> = {
  "claude-code": "claude-code-cli",
  "codex-cli": "codex-cli",
  "ollama": "ollama-local",
}

function isPresetEnabled(providerConfigs: ProviderConfigs, presetId: string): boolean {
  const entry = providerConfigs[presetId]
  return entry?.enabled === true
}

function hasEnabledCustomPreset(providerConfigs: ProviderConfigs): boolean {
  for (const preset of LLM_PRESETS) {
    if (preset.provider !== "custom") continue
    if (isPresetEnabled(providerConfigs, preset.id)) return true
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

  if (cfg.provider === "claude-code" || cfg.provider === "codex-cli") {
    const presetId = PRESET_ID_BY_PROVIDER[cfg.provider]
    return presetId !== undefined && isPresetEnabled(providerConfigs, presetId)
  }

  if (cfg.provider === "ollama") {
    return isPresetEnabled(providerConfigs, "ollama-local") && hasModel
  }

  if (cfg.provider === "custom") {
    if (hasKey && hasModel) return true
    return hasEnabledCustomPreset(providerConfigs) && hasModel
  }

  return hasKey && hasModel
}
