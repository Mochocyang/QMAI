import { describe, expect, it } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  DEFAULT_REASONING_DEPTH,
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
  it("keeps every stop", () => {
    for (const step of REASONING_DEPTH_STEPS) {
      expect(normalizeReasoningDepth(step)).toBe(step)
    }
  })

  it("默认档是「中」，且不再有「自动」这一档", () => {
    expect(DEFAULT_REASONING_DEPTH).toBe("medium")
    expect(REASONING_DEPTH_STEPS as readonly string[]).not.toContain("auto")
  })

  it("老数据里的 auto 落到默认档，不会留下「什么都不发」的中间态", () => {
    expect(normalizeReasoningDepth("auto")).toBe("medium")
  })

  it("falls back to the default stop for the custom mode the settings page can still hold", () => {
    expect(normalizeReasoningDepth("custom")).toBe("medium")
  })

  it("falls back to the default stop for garbage", () => {
    expect(normalizeReasoningDepth(undefined)).toBe("medium")
    expect(normalizeReasoningDepth(null)).toBe("medium")
    expect(normalizeReasoningDepth(3)).toBe("medium")
    expect(normalizeReasoningDepth("HIGH")).toBe("medium")
  })
})

describe("reasoning depth index mapping", () => {
  it("puts off at the left end and max at the right", () => {
    expect(reasoningDepthToIndex("off")).toBe(0)
    expect(reasoningDepthToIndex("max")).toBe(REASONING_DEPTH_STEPS.length - 1)
  })

  it("round-trips every stop", () => {
    for (const step of REASONING_DEPTH_STEPS) {
      expect(reasoningDepthFromIndex(reasoningDepthToIndex(step))).toBe(step)
    }
  })

  it("clamps out-of-range slider positions instead of returning undefined", () => {
    expect(reasoningDepthFromIndex(-4)).toBe("off")
    expect(reasoningDepthFromIndex(99)).toBe("max")
    expect(reasoningDepthFromIndex(Number.NaN)).toBe(DEFAULT_REASONING_DEPTH)
  })
})

describe("applyReasoningDepth", () => {
  it("stamps every explicit stop onto the config", () => {
    for (const step of REASONING_DEPTH_STEPS) {
      const applied = applyReasoningDepth(
        { ...baseConfig, reasoning: { mode: "medium" } },
        step,
      )
      expect(applied.reasoning?.mode).toBe(step)
    }
  })

  it("stamps a mode onto a config that had no reasoning block at all", () => {
    expect(applyReasoningDepth(baseConfig, "high").reasoning).toEqual({ mode: "high" })
  })

  it("keeps a custom budget that the settings page is still holding", () => {
    const configured: LlmConfig = {
      ...baseConfig,
      reasoning: { mode: "custom", budgetTokens: 20000 },
    }
    expect(applyReasoningDepth(configured, "low").reasoning).toEqual({
      mode: "low",
      budgetTokens: 20000,
    })
  })

  it("never mutates the input config", () => {
    const configured: LlmConfig = { ...baseConfig, reasoning: { mode: "off" } }
    applyReasoningDepth(configured, "max")
    expect(configured.reasoning).toEqual({ mode: "off" })
  })

  it("treats an unrecognised persisted depth as the default stop rather than mode undefined", () => {
    const configured: LlmConfig = { ...baseConfig, reasoning: { mode: "low" } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applied = applyReasoningDepth(configured, undefined as any)
    expect(applied.reasoning).toEqual({ mode: "medium" })
  })
})
