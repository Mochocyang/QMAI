import { describe, expect, it } from "vitest"
import { buildPlanExecutePolicyPrompt, shouldRequirePlan } from "./plan-execute-policy"

describe("Plan Execute policy", () => {
  it("does not require a plan when Plan Execute is disabled", () => {
    expect(shouldRequirePlan(false, "fast", "write_chapter")).toBe(false)
    expect(shouldRequirePlan(false, "standard", "write_chapter")).toBe(false)
    expect(shouldRequirePlan(false, "strict", "write_chapter")).toBe(false)
  })

  it("creates a lightweight plan in fast mode when Plan Execute is enabled", () => {
    expect(shouldRequirePlan(true, "fast", "write_chapter")).toBe(true)
    expect(buildPlanExecutePolicyPrompt("fast")).toContain("快速模式")
    expect(buildPlanExecutePolicyPrompt("fast")).toContain("先创建轻量计划")
  })

  it("requires a short plan in standard mode when Plan Execute is enabled", () => {
    expect(shouldRequirePlan(true, "standard", "write_chapter")).toBe(true)
    expect(buildPlanExecutePolicyPrompt("standard")).toContain("先给出简短计划")
  })

  it("requires plan execute and review in strict mode when Plan Execute is enabled", () => {
    expect(shouldRequirePlan(true, "strict", "rewrite_chapter")).toBe(true)
    expect(buildPlanExecutePolicyPrompt("strict")).toContain("必须先计划")
    expect(buildPlanExecutePolicyPrompt("strict")).toContain("执行后审查")
  })

  it("requires a user-facing executable plan instead of workflow narration", () => {
    const prompt = buildPlanExecutePolicyPrompt("standard")
    expect(prompt).toContain("任务目标")
    expect(prompt).toContain("已读取依据")
    expect(prompt).toContain("缺失资料")
    expect(prompt).toContain("确认后动作")
    expect(prompt).toContain("不要把工具流程说明当成计划")
  })
})
