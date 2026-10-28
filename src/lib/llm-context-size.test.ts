import { describe, expect, it } from "vitest"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import {
  MIN_USER_LLM_CONTEXT_SIZE,
  normalizeProviderConfigs,
  normalizeUserLlmContextSize,
} from "./llm-context-size"

describe("user LLM context size", () => {
  it.each([undefined, 0, 4_096, 128_000, 200_000])(
    "raises legacy value %s to 204800",
    (value) => {
      expect(normalizeUserLlmContextSize(value)).toBe(MIN_USER_LLM_CONTEXT_SIZE)
    },
  )

  it.each([204_800, 262_144, 307_200, 409_600, 524_288, 1_000_000])(
    "keeps supported value %i",
    (value) => {
      expect(normalizeUserLlmContextSize(value)).toBe(value)
    },
  )

  it("normalizes provider overrides without changing unrelated fields", () => {
    const configs = normalizeProviderConfigs({
      custom: {
        apiKey: "secret",
        model: "model-a",
        maxContextSize: 32_768,
        enabled: false,
      },
    })
    expect(configs.custom).toEqual({
      apiKey: "secret",
      model: "model-a",
      maxContextSize: 204_800,
      enabled: false,
    })
  })

  /*
   * 回归守卫：下限只对「用户手填」的 provider 生效。
   * 插件 provider 的窗口是上游目录声明的客观事实（设计 3.4），不套这个下限；
   * 改动见 provider-sync.spec.ts 的 plugin_provider_keeps_its_declared_small_context_window。
   */
  it("user_hand_typed_window_still_respects_the_floor", () => {
    const configs = normalizeProviderConfigs({
      openai: { apiKey: "sk-user", maxContextSize: 1_000 },
    })
    expect(configs.openai.maxContextSize).toBe(MIN_USER_LLM_CONTEXT_SIZE)
  })

  it("exports no built-in preset below the minimum", () => {
    for (const preset of LLM_PRESETS) {
      if (preset.suggestedContextSize === undefined) continue
      expect(preset.suggestedContextSize).toBeGreaterThanOrEqual(204_800)
    }
  })
})
