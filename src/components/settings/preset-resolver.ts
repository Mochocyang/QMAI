import type { LlmConfig } from "@/stores/wiki-store"
import type { ProviderOverride } from "@/stores/wiki-store"
import { AZURE_OPENAI_API_VERSION } from "@/lib/azure-openai"
import type { LlmPreset } from "./llm-presets"
import {
  normalizeUserLlmContextSize,
  normalizeUserLlmMaxOutputTokens,
} from "@/lib/llm-context-size"

/**
 * Build a full LlmConfig from a preset template + the user's saved
 * override fields for that preset. Falls back to the preset defaults
 * (or the existing LlmConfig) when an override is missing.
 */
export function resolveConfig(
  preset: LlmPreset,
  override: ProviderOverride | undefined,
  fallback: LlmConfig,
): LlmConfig {
  const ov = override ?? {}
  const apiKey = ov.apiKey ?? ""
  const model = ov.model?.trim() || preset.defaultModel || ""
  const rawMaxContextSize = normalizeUserLlmContextSize(
    ov.maxContextSize ?? preset.suggestedContextSize ?? fallback.maxContextSize,
  )
  const rawMaxOutputTokens = normalizeUserLlmMaxOutputTokens(
    ov.maxOutputTokens ?? preset.suggestedMaxOutputTokens ?? fallback.maxOutputTokens,
  )
  const reasoning = ov.reasoning ?? { mode: "auto" as const }
  const localCliIsolation = ov.localCliIsolation === true
  const functionCallingEnabled = ov.functionCallingEnabled !== false
  const codexCliTimeoutMinutes =
    typeof ov.codexCliTimeoutMinutes === "number" && Number.isFinite(ov.codexCliTimeoutMinutes)
      ? Math.max(1, Math.min(240, Math.floor(ov.codexCliTimeoutMinutes)))
      : undefined

  let config: LlmConfig

  if (preset.provider === "custom") {
    config = {
      provider: "custom",
      apiKey,
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: ov.baseUrl ?? preset.baseUrl ?? "",
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      apiMode: ov.apiMode ?? preset.apiMode ?? "chat_completions",
      reasoning,
      localCliIsolation: false,
      functionCallingEnabled,
    }
  } else if (preset.provider === "ollama") {
    config = {
      provider: "ollama",
      apiKey: "",
      model,
      ollamaUrl: ov.baseUrl ?? preset.baseUrl ?? "http://localhost:11434",
      customEndpoint: fallback.customEndpoint,
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      reasoning,
      localCliIsolation: false,
      functionCallingEnabled,
    }
  } else if (preset.provider === "azure") {
    config = {
      provider: "azure",
      apiKey,
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: ov.baseUrl ?? preset.baseUrl ?? "",
      azureApiVersion: ov.azureApiVersion ?? preset.azureApiVersion ?? AZURE_OPENAI_API_VERSION,
      azureModelFamily: ov.azureModelFamily ?? preset.azureModelFamily ?? "auto",
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      reasoning,
      localCliIsolation: false,
      functionCallingEnabled,
    }
  } else if (preset.provider === "claude-code" || preset.provider === "codex-cli") {
    // Subprocess transport — no apiKey, no endpoint URL. Model id is
    // passed straight to the local CLI's model flag when the user
    // explicitly sets one. Leaving it empty lets the local CLI use the
    // machine's own configured default model.
    config = {
      provider: preset.provider,
      apiKey: "",
      model: ov.model?.trim() || "",
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: fallback.customEndpoint,
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      reasoning,
      localCliIsolation,
      codexCliTimeoutMinutes: preset.provider === "codex-cli" ? codexCliTimeoutMinutes : undefined,
      functionCallingEnabled,
    }
  } else if (preset.provider === "cursor-cli") {
    // HTTP bridge via cursor-api-proxy. Optional apiKey only if the
    // proxy was started with CURSOR_BRIDGE_API_KEY.
    config = {
      provider: "cursor-cli",
      apiKey,
      model: ov.model?.trim() || preset.defaultModel || "",
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: ov.baseUrl ?? preset.baseUrl ?? "http://127.0.0.1:8765/v1",
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      apiMode: "chat_completions",
      reasoning,
      localCliIsolation: false,
      functionCallingEnabled,
    }
  } else {
    // openai / anthropic / google / minimax — use fixed endpoint baked into the
    // provider dispatch. We still let users override baseUrl via apiKey env if
    // needed by editing manually, but presets for these don't expose it.
    config = {
      provider: preset.provider,
      apiKey,
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: fallback.customEndpoint,
      maxContextSize: rawMaxContextSize,
      maxOutputTokens: rawMaxOutputTokens,
      reasoning,
      localCliIsolation: false,
      functionCallingEnabled,
    }
  }

  return config
}
