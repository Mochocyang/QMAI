import { describe, it, expect } from "vitest"
import {
  createTaskBreakpoint,
  updateBreakpointStage,
  buildBreakpointResumePrompt,
} from "./task-breakpoint"

describe("createTaskBreakpoint", () => {
  it("should create a breakpoint with required fields", () => {
    const bp = createTaskBreakpoint({
      taskGoal: "写下一章",
      currentStage: "planning",
    })
    expect(bp.taskId).toBeTruthy()
    expect(bp.taskGoal).toBe("写下一章")
    expect(bp.currentStage).toBe("planning")
    expect(bp.completedStages).toEqual([])
    expect(bp.usedSkills).toEqual([])
    expect(bp.usedTools).toEqual([])
    expect(bp.searches).toEqual([])
    expect(bp.mcpCalls).toEqual([])
    expect(bp.createdAt).toBeGreaterThan(0)
    expect(bp.updatedAt).toBeGreaterThan(0)
  })

  it("should accept optional fields", () => {
    const bp = createTaskBreakpoint({
      taskGoal: "润色章节",
      currentStage: "output",
      completedStages: ["planning", "drafting"],
      usedSkills: ["节奏检查", "正文输出协议"],
      usedTools: ["read_chapter", "write_chapter"],
    })
    expect(bp.completedStages).toEqual(["planning", "drafting"])
    expect(bp.usedSkills).toEqual(["节奏检查", "正文输出协议"])
    expect(bp.usedTools).toEqual(["read_chapter", "write_chapter"])
  })
})

describe("updateBreakpointStage", () => {
  it("should advance stage and record completed stage", () => {
    const bp = createTaskBreakpoint({ taskGoal: "test", currentStage: "planning" })
    const updated = updateBreakpointStage(bp, "drafting", "planning")
    expect(updated.currentStage).toBe("drafting")
    expect(updated.completedStages).toEqual(["planning"])
    expect(updated.updatedAt).toBeGreaterThanOrEqual(bp.updatedAt)
  })

  it("should advance stage without recording completed", () => {
    const bp = createTaskBreakpoint({ taskGoal: "test", currentStage: "reading" })
    const updated = updateBreakpointStage(bp, "writing")
    expect(updated.currentStage).toBe("writing")
    expect(updated.completedStages).toEqual([])
  })
})

describe("buildBreakpointResumePrompt", () => {
  it("should build a resume prompt with all information", () => {
    const bp = createTaskBreakpoint({
      taskGoal: "生成下一章",
      currentStage: "drafting",
      completedStages: ["planning"],
      usedSkills: ["章节承接"],
      usedTools: ["read_chapter", "load_context"],
      searches: [{ query: "人物背景", provider: "web", resultCount: 3, searchedAt: Date.now(), status: "ok", sources: [] }],
      mcpCalls: [{ serverId: "graph", serverName: "GraphRAG", toolName: "query", calledAt: Date.now(), status: "ok" }],
    })
    const prompt = buildBreakpointResumePrompt(bp)
    expect(prompt).toContain("任务断点恢复")
    expect(prompt).toContain("原始用户请求：生成下一章")
    expect(prompt).toContain("已完成阶段：planning")
    expect(prompt).toContain("当前阶段：drafting")
    expect(prompt).toContain("已使用的 Skill：章节承接")
  })
})
