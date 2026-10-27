import { describe, expect, it, vi } from "vitest"
import {
  buildAgentConfig,
  effectiveToolsEnabled,
  isFunctionCallingEnabled,
  modelSupportsTools,
} from "./config"
import { ToolRegistry } from "./registry"
import type { LlmConfig } from "@/stores/wiki-store"
import type { PluginToolDescriptor } from "@/lib/plugins/types"

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

  it("blocks Antigravity CLI from agent tools", () => {
    expect(modelSupportsTools("gemini-3.8-flash-high", "antigravity-cli")).toBe(false)
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

  it("黑名单模型即便开关打开也不注册工具（tools 不能发给 o1/deepseek-reasoner）", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("deepseek-reasoner", "system", registry, {
      wikiPath: "/tmp/wiki",
      getSkillConfig: () => null,
      getChatConversations: () => [],
      getOutlineConversations: () => [],
      llmConfig: { ...baseLlm, provider: "custom", model: "deepseek-reasoner" },
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

describe("buildAgentConfig plugin tools", () => {
  const pluginTools: PluginToolDescriptor[] = [
    {
      pluginId: "chapter-insights",
      name: "analyze",
      description: "分析章节节奏",
      parameters: { chapterPath: { type: "string", description: "路径", required: true } },
    },
  ]

  const baseOptions = {
    wikiPath: "/tmp/wiki",
    getSkillConfig: () => null,
    getChatConversations: () => [],
    getOutlineConversations: () => [],
  }

  it("把插件工具追加进 agent config，调用走注入的 invoker", async () => {
    const registry = new ToolRegistry()
    const invokePluginTool = vi.fn(async () => "插件结果")
    const config = buildAgentConfig("gpt-4o", "system", registry, {
      ...baseOptions,
      llmConfig: baseLlm,
      pluginTools,
      invokePluginTool,
    })

    const tool = config.tools.find((t) => t.name === "chapter_insights__analyze")
    expect(tool).toBeDefined()
    expect(await tool!.execute({ chapterPath: "/x.md" })).toBe("插件结果")
    // 发给插件的是插件内原名，不是宿主前缀名
    expect(invokePluginTool).toHaveBeenCalledWith("chapter-insights", "analyze", { chapterPath: "/x.md" })
    // 内置工具仍在该 config 里，插件注册没有把内置挤掉
    expect(config.tools.length).toBeGreaterThan(1)
  })

  it("用户关闭 function calling 时插件工具同样不注入", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("gpt-4o", "system", registry, {
      ...baseOptions,
      llmConfig: { ...baseLlm, functionCallingEnabled: false },
      pluginTools,
      invokePluginTool: async () => "插件结果",
    })

    expect(config.tools).toEqual([])
    expect(registry.list()).toEqual([])
  })

  it("黑名单模型不注入插件工具（黑名单模型根本不接受 tools）", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("deepseek-reasoner", "system", registry, {
      ...baseOptions,
      llmConfig: { ...baseLlm, provider: "custom", model: "deepseek-reasoner" },
      pluginTools,
      invokePluginTool: async () => "插件结果",
    })

    expect(config.tools).toEqual([])
  })

  it("没有 invoker 时只注册内置工具，不抛错", () => {
    const registry = new ToolRegistry()
    const config = buildAgentConfig("gpt-4o", "system", registry, {
      ...baseOptions,
      llmConfig: baseLlm,
      pluginTools,
    })

    expect(config.tools.some((t) => t.name === "chapter_insights__analyze")).toBe(false)
  })
})
