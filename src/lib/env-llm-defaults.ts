import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"

const trimEnv = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : ""
}

const readContextSize = (): number => {
  const raw = Number(trimEnv(import.meta.env.VITE_QMAI_LLM_CONTEXT_SIZE))
  return Number.isFinite(raw) && raw > 0 ? raw : 204800
}

export function loadEnvLlmDefault(): {
  config: LlmConfig
  providerConfigs: ProviderConfigs
  activePresetId: string
} | null {
  const apiKey = trimEnv(import.meta.env.VITE_QMAI_LLM_API_KEY)
  const customEndpoint = trimEnv(import.meta.env.VITE_QMAI_LLM_ENDPOINT)
  const model = trimEnv(import.meta.env.VITE_QMAI_LLM_MODEL)

  if (!apiKey || !customEndpoint || !model) return null

  const maxContextSize = readContextSize()
  const config: LlmConfig = {
    provider: "custom",
    apiKey,
    model,
    ollamaUrl: "http://localhost:11434",
    customEndpoint,
    maxContextSize,
    apiMode: "chat_completions",
    reasoning: { mode: "auto" },
  }

  return {
    config,
    providerConfigs: {
      custom: {
        apiKey,
        model,
        baseUrl: customEndpoint,
        apiMode: "chat_completions",
        maxContextSize,
        reasoning: { mode: "auto" },
      },
    },
    activePresetId: "custom",
  }
}
