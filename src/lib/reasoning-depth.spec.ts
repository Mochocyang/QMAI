import { describe, expect, it } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  REASONING_DEPTH_STEPS,
  applyReasoningDepth,
  normalizeReasoningDepth,
  reasoningDepthFromIndex,
  reasoningDepthToIndex,
} from "./reasoning-depth"

const baseConfig: LlmConfig = {
  provider: "openai",
  apiKey: "key",
  model: "gpt-5",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 204800,
}

describe("normalizeReasoningDepth", () => {
  it("keeps every slider stop", () => {
    for (const step of REASONING_DEPTH_STEPS) {
      expect(normalizeReasoningDepth(step)).toBe(step)
    }
  })

  it("falls back to auto for the custom mode the settings page can still hold", () => {
    expect(normalizeReasoningDepth("custom")).toBe("auto")
  })

  it("falls back to auto for garbage", () => {
    expect(normalizeReasoningDepth(undefined)).toBe("auto")
    expect(normalizeReasoningDepth(null)).toBe("auto")
    expect(normalizeReasoningDepth(3)).toBe("auto")
    expect(normalizeReasoningDepth("HIGH")).toBe("auto")
  })
})

describe("reasoning depth index mapping", () => {
  it("puts auto at the left end and max at the right", () => {
    expect(reasoningDepthToIndex("auto")).toBe(0)
    expect(reasoningDepthToIndex("max")).toBe(REASONING_DEPTH_STEPS.length - 1)
  })

  it("round-trips every stop", () => {
    for (const step of REASONING_DEPTH_STEPS) {
      expect(reasoningDepthFromIndex(reasoningDepthToIndex(step))).toBe(step)
    }
  })

  it("clamps out-of-range slider positions instead of returning undefined", () => {
    expect(reasoningDepthFromIndex(-4)).toBe("auto")
    expect(reasoningDepthFromIndex(99)).toBe("max")
    expect(reasoningDepthFromIndex(Number.NaN)).toBe("auto")
  })
})

describe("applyReasoningDepth", () => {
  it("leaves the config untouched at the auto stop", () => {
    const configured: LlmConfig = {
      ...baseConfig,
      reasoning: { mode: "custom", budgetTokens: 20000 },
    }
    expect(applyReasoningDepth(configured, "auto")).toBe(configured)
  })

  it("does not erase a custom budget configured in settings", () => {
    const configured: LlmConfig = {
      ...baseConfig,
      reasoning: { mode: "custom", budgetTokens: 20000 },
    }
    expect(applyReasoningDepth(configured, "auto").reasoning).toEqual({
      mode: "custom",
      budgetTokens: 20000,
    })
  })

  it("overrides the provider mode for every explicit stop", () => {
    for (const step of ["off", "low", "medium", "high", "max"] as const) {
      const applied = applyReasoningDepth(
        { ...baseConfig, reasoning: { mode: "auto" } },
        step,
      )
      expect(applied.reasoning?.mode).toBe(step)
    }
  })

  it("stamps a mode onto a config that had no reasoning block at all", () => {
    expect(applyReasoningDepth(baseConfig, "high").reasoning).toEqual({ mode: "high" })
  })

  it("never mutates the input config", () => {
    const configured: LlmConfig = { ...baseConfig, reasoning: { mode: "off" } }
    applyReasoningDepth(configured, "max")
    expect(configured.reasoning).toEqual({ mode: "off" })
  })

  it("treats an unrecognised persisted depth as auto rather than mode undefined", () => {
    const configured: LlmConfig = { ...baseConfig, reasoning: { mode: "low" } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applied = applyReasoningDepth(configured, undefined as any)
    expect(applied.reasoning).toEqual({ mode: "low" })
  })
})
