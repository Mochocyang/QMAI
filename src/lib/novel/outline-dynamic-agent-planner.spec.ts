import { describe, expect, it } from "vitest"
import {
  buildDynamicOutlinePlannerPrompt,
  parseDynamicOutlinePlan,
} from "./outline-dynamic-agent-planner"

const context = {
  userTask: "生成玄幻长篇大纲",
  projectSummary: "已有世界观；缺少人物关系和伏笔审查",
  existingModules: ["世界观"],
  missingModules: ["人物关系", "伏笔审查"],
  skills: [
    { name: "世界规则", description: "检查世界规则", stages: ["planning"], kinds: ["knowledge"] },
    { name: "人物设计", description: "设计人物关系", stages: ["planning", "review"], kinds: ["planning"] },
  ],
}

describe("动态大纲 Agent 规划器", () => {
  it("将用户任务、项目摘要、已有/缺失模块和全部 Skill 元数据写入规划提示词", () => {
    const prompt = buildDynamicOutlinePlannerPrompt(context)
    expect(prompt).toContain("生成玄幻长篇大纲")
    expect(prompt).toContain("已有世界观；缺少人物关系和伏笔审查")
    expect(prompt).toContain("世界观")
    expect(prompt).toContain("人物关系")
    expect(prompt).toContain("世界规则")
    expect(prompt).toContain("检查世界规则")
    expect(prompt).toContain("planning")
    expect(prompt).toContain("knowledge")
    expect(prompt).toContain("最多 12")
    expect(prompt).toContain("最多同时运行 3")
  })

  it("解析代码围栏中的动态任务，并标准化依赖、优先级和最终审查字段", () => {
    const result = parseDynamicOutlinePlan(`\n\`\`\`json\n${JSON.stringify({ tasks: [
      {
        id: "character",
        name: "人物关系 Agent",
        dimension: "人物关系",
        skill_names: ["人物设计"],
        task_prompt: "补齐人物关系",
        dependencies: [],
        priority: 90,
        final_review: false,
      },
      {
        id: "review",
        name: "最终审查 Agent",
        dimension: "一致性审查",
        skillNames: ["世界规则"],
        taskPrompt: "审查全部结果",
        dependencies: ["character"],
        priority: 10,
        finalReview: true,
      },
    ]})}\n\`\`\``)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan).toHaveLength(2)
    expect(result.plan[0]).toMatchObject({
      id: "character",
      dimension: "人物关系",
      skillNames: ["人物设计"],
      dependencies: [],
      priority: 90,
      finalReview: false,
      writeToolsEnabled: false,
    })
    expect(result.plan[1].finalReview).toBe(true)
  })

  it("拒绝使用不存在 Skill、循环依赖或超过 12 个任务的规划结果", () => {
    const unknownSkill = parseDynamicOutlinePlan(JSON.stringify({ tasks: [{
      id: "a", name: "A", dimension: "A", skillNames: ["不存在"], taskPrompt: "A",
    }] }), ["人物设计"])
    expect(unknownSkill.ok).toBe(false)

    const cycle = parseDynamicOutlinePlan(JSON.stringify({ tasks: [
      { id: "a", name: "A", dimension: "A", skillNames: [], taskPrompt: "A", dependencies: ["b"] },
      { id: "b", name: "B", dimension: "B", skillNames: [], taskPrompt: "B", dependencies: ["a"] },
    ] }))
    expect(cycle.ok).toBe(false)

    const tooMany = parseDynamicOutlinePlan(JSON.stringify({ tasks: Array.from({ length: 13 }, (_, index) => ({
      id: `a${index}`, name: `A${index}`, dimension: `D${index}`, skillNames: [], taskPrompt: "执行",
    })) }))
    expect(tooMany.ok).toBe(false)
  })
})
