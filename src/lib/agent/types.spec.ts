import { describe, expect, it } from "vitest"
import type { AgentConfig } from "./types"

describe("AgentConfig Stage F 扩展", () => {
  it("支持 projectPath 和 taskGoal 可选字段", () => {
    const config: AgentConfig = {
      maxRounds: 15,
      tools: [],
      systemPrompt: "",
      llmConfig: {} as any,
      projectPath: "/test/path",
      taskGoal: "写第一章",
    }

    expect(config.projectPath).toBe("/test/path")
    expect(config.taskGoal).toBe("写第一章")
  })
})
