import { describe, expect, it } from "vitest"

import {
  getStableAvailableModelKey,
  hasAvailableModels,
  isProviderAvailable,
} from "@/lib/llm-model-keys"
import type { ProviderConfigs } from "@/stores/wiki-store"

function saved(id: string, name = id) {
  return { id, model: id, name, createdAt: 1 }
}

describe("stable available model keys", () => {
  it("hard-disables explicit false while keeping configured legacy providers usable", () => {
    const disabled = { enabled: false, apiKey: "old-key", savedModels: [saved("disabled-model")] }
    const legacy = { apiKey: "legacy-key", savedModels: [saved("legacy-model")] }
    const configs: ProviderConfigs = { openai: disabled, anthropic: legacy }

    expect(isProviderAvailable("openai", disabled)).toBe(false)
    expect(isProviderAvailable("anthropic", legacy)).toBe(true)
    expect(hasAvailableModels(configs)).toBe(true)
    expect(getStableAvailableModelKey("legacy-model", configs)).toBe("anthropic/legacy-model")
  })

  it("treats a slash-containing legacy model id as a whole when its prefix is not a provider", () => {
    const configs: ProviderConfigs = {
      openai: { enabled: true, apiKey: "key", savedModels: [saved("vendor/family/model-v1")] },
    }

    expect(getStableAvailableModelKey("vendor/family/model-v1", configs))
      .toBe("openai/vendor/family/model-v1")
  })

  it("uses provider/model parsing when the slash prefix is a real provider id", () => {
    const configs: ProviderConfigs = {
      vendor: { enabled: true, apiKey: "key", savedModels: [saved("family/model-v1")] },
      openai: { enabled: true, apiKey: "key", savedModels: [saved("vendor/family/model-v1")] },
    }

    expect(getStableAvailableModelKey("vendor/family/model-v1", configs))
      .toBe("vendor/family/model-v1")
  })

  it("uses the existing available-provider order for duplicate legacy model ids", () => {
    const configs: ProviderConfigs = {
      "custom-first": { enabled: true, apiKey: "key", savedModels: [saved("shared/model")] },
      anthropic: { enabled: true, apiKey: "key", savedModels: [saved("shared/model")] },
      openai: { enabled: true, apiKey: "key", savedModels: [saved("shared/model")] },
    }

    expect(getStableAvailableModelKey("shared/model", configs))
      .toBe("anthropic/shared/model")
  })

  it("falls back to a full legacy model id when the real provider prefix is disabled", () => {
    const legacyModelId = "anthropic/claude-3-7-sonnet"
    const configs: ProviderConfigs = {
      anthropic: { enabled: false, apiKey: "old-key", savedModels: [saved("claude-3-7-sonnet")] },
      openrouter: { enabled: true, apiKey: "key", savedModels: [saved(legacyModelId)] },
    }

    expect(getStableAvailableModelKey(legacyModelId, configs))
      .toBe("openrouter/anthropic/claude-3-7-sonnet")
  })

  it("uses stable available-provider order when multiple other providers store the full legacy id", () => {
    const legacyModelId = "anthropic/claude-3-7-sonnet"
    const configs: ProviderConfigs = {
      anthropic: { enabled: true, apiKey: "key", savedModels: [saved("another-model")] },
      "custom-first": { enabled: true, apiKey: "key", savedModels: [saved(legacyModelId)] },
      openrouter: { enabled: true, apiKey: "key", savedModels: [saved(legacyModelId)] },
      groq: { enabled: true, apiKey: "key", savedModels: [saved(legacyModelId)] },
    }

    expect(getStableAvailableModelKey(legacyModelId, configs))
      .toBe("openrouter/anthropic/claude-3-7-sonnet")
  })

})
