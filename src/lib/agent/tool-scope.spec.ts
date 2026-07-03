import { describe, expect, it } from "vitest"
import type { AgentConfig, Tool } from "./types"
import { scopeAgentConfigTools } from "./tool-scope"

function tool(name: string): Tool {
  return {
    name,
    description: name,
    category: "read",
    parameters: {},
    execute: async () => name,
  }
}

const baseConfig: AgentConfig = {
  maxRounds: 3,
  tools: [
    tool("read_chapter"),
    tool("write_chapter"),
    tool("web_search"),
  ],
  systemPrompt: "system",
  llmConfig: {} as AgentConfig["llmConfig"],
  modelId: "test-model",
}

describe("scopeAgentConfigTools", () => {
  it("keeps the original tool set when no enabled tool list is provided", () => {
    const scoped = scopeAgentConfigTools(baseConfig)

    expect(scoped).toBe(baseConfig)
    expect(scoped.tools.map((item) => item.name)).toEqual([
      "read_chapter",
      "write_chapter",
      "web_search",
    ])
  })

  it("filters the AgentConfig tools to the selected capability tool names", () => {
    const scoped = scopeAgentConfigTools(baseConfig, ["read_chapter", "web_search"])

    expect(scoped).not.toBe(baseConfig)
    expect(scoped.tools.map((item) => item.name)).toEqual([
      "read_chapter",
      "web_search",
    ])
    expect(baseConfig.tools.map((item) => item.name)).toContain("write_chapter")
  })
})
