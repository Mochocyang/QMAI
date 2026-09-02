import { describe, expect, it } from "vitest"
import {
  buildAgentConfig,
  effectiveToolsEnabled,
  isFunctionCallingEnabled,
  modelSupportsTools,
} from "./config"
import { ToolRegistry } from "./registry"
import type { LlmConfig } from "@/stores/wiki-store"

const baseLlm: LlmConfig = {
  provider: "openai",
  apiKey: "sk",
  model: "gpt-4o",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
}

describe("function calling helpers", () => {
  it("treats undefined functionCallingEnabled as enabled", () => {
    expect(isFunctionCallingEnabled(baseLlm)).toBe(true)
  })

  it("respects explicit false", () => {
    expect(isFunctionCallingEnabled({ ...baseLlm, functionCallingEnabled: false })).toBe(false)
  })

  it("combines model blacklist with provider switch", () => {
    expect(effectiveToolsEnabled("gpt-4o", baseLlm)).toBe(true)
    expect(effectiveToolsEnabled("o3-mini", baseLlm)).toBe(false)
    expect(effectiveToolsEnabled("gpt-4o", { ...baseLlm, functionCallingEnabled: false })).toBe(false)
    expect(modelSupportsTools("gpt-4o")).toBe(true)
  })

  it("blocks Claude Code CLI from agent tools", () => {
    expect(modelSupportsTools("opus", "claude-code")).toBe(false)
  })

  it("allows cursor-cli native tools", () => {
    expect(modelSupportsTools("composer-2-fast", "cursor-cli")).toBe(true)
    expect(effectiveToolsEnabled("composer-2-fast", { ...baseLlm, provider: "cursor-cli", model: "composer-2-fast" })).toBe(true)
    expect(effectiveToolsEnabled("composer-2-fast", {
      ...baseLlm,
      provider: "cursor-cli",
      model: "composer-2-fast",
      functionCallingEnabled: false,
    })).toBe(false)
  })

  it("allows Codex app-server dynamic tools", () => {
    expect(modelSupportsTools("gpt-5", "codex-cli")).toBe(true)
  })
})

describe("buildAgentConfig functionCallingEnabled", () => {
  it("registers no tools when function calling is disabled", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("gpt-4o", "system", registry, {
      wikiPath: "/tmp/wiki",
      getSkillConfig: () => null,
      getChatConversations: () => [],
      getOutlineConversations: () => [],
      llmConfig: { ...baseLlm, functionCallingEnabled: false },
    })

    expect(config.tools).toEqual([])
    expect(registry.list()).toEqual([])
  })

  it("keeps cursor-cli on native tools without a text-JSON prompt", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("composer-2-fast", "You are helpful", registry, {
      wikiPath: "/tmp/wiki",
      getSkillConfig: () => null,
      getChatConversations: () => [],
      getOutlineConversations: () => [],
      llmConfig: { ...baseLlm, provider: "cursor-cli", model: "composer-2-fast" },
    })

    expect(config.systemPrompt).toBe("You are helpful")
    expect(config.systemPrompt).not.toContain("只输出一个 JSON")
  })
})
