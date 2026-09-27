import { UiTestCustomProviders } from "@/components/uitest/models/provider-custom"
import type { ProviderConfigs, SavedModel, ReasoningConfig } from "@/stores/wiki-store"
import {
  normalizeUserLlmContextSize,
} from "@/lib/llm-context-size"

interface CustomProviderCard {
  id: string
  label: string
  apiMode: "chat_completions" | "responses" | "anthropic_messages"
  baseUrl: string
  apiKey: string
  model: string
  maxContextSize?: number
  maxOutputTokens?: number
  reasoning?: ReasoningConfig
  functionCallingEnabled?: boolean
  enabled: boolean
  savedModels: SavedModel[]
}

export function listCustomProviderCards(providerConfigs: ProviderConfigs): CustomProviderCard[] {
  return Object.keys(providerConfigs)
    .filter((key) => key.startsWith("custom-"))
    .map((key) => {
      const config = providerConfigs[key] ?? {}
      return {
        id: key,
        label: config.label ?? "自定义模型",
        apiMode: config.apiMode || "chat_completions",
        baseUrl: config.baseUrl || "",
        apiKey: config.apiKey || "",
        model: config.model || "",
        maxContextSize: normalizeUserLlmContextSize(config.maxContextSize),
        maxOutputTokens: config.maxOutputTokens,
        reasoning: config.reasoning,
        functionCallingEnabled: config.functionCallingEnabled,
        enabled: config.enabled ?? true,
        savedModels: config.savedModels || [],
      }
    })
}

export function CustomProviderCards() {
  return <UiTestCustomProviders />
}
