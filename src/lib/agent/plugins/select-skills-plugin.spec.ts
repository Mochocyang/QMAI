import { describe, expect, it } from "vitest"
import { createSelectSkillsPlugin, buildSelectedSkillsPrompt } from "./select-skills-plugin"
import { normalizeUserSkill, type UserSkill } from "@/lib/novel/skill-library"

function skill(partial: Partial<UserSkill>): UserSkill {
  return normalizeUserSkill({
    id: partial.id,
    name: partial.name,
    description: partial.description ?? "",
    kind: partial.kind,
    stages: partial.stages,
    modes: partial.modes,
    content: partial.content ?? `${partial.name} content`,
    source: partial.source ?? "project",
  })
}

const availableSkills = [
  skill({ id: "chapter-bridge", name: "章节承接", kind: ["structure"], stages: ["planning", "drafting"], modes: ["standard", "strict"] }),
  skill({ id: "next-plan", name: "下一章计划", kind: ["planning"], stages: ["planning"], modes: ["standard", "strict"] }),
  skill({ id: "motivation", name: "人物动机", kind: ["planning"], stages: ["planning", "drafting"], modes: ["standard", "strict"] }),
  skill({ id: "conflict", name: "冲突升级", kind: ["structure"], stages: ["drafting"], modes: ["standard", "strict"] }),
  skill({ id: "plot-review", name: "剧情自检", kind: ["review"], stages: ["review"], modes: ["standard", "strict"] }),
  skill({ id: "output-protocol", name: "正文输出协议", kind: ["output"], stages: ["output"], modes: ["fast", "standard", "strict"] }),
  skill({ id: "de-ai", name: "去AI味", kind: ["style"], stages: ["rewrite", "output"], modes: ["fast", "standard", "strict"] }),
  skill({ id: "mainline", name: "主线检查", kind: ["review"], stages: ["review"], modes: ["strict"] }),
  skill({ id: "foreshadow", name: "伏笔管理", kind: ["structure", "review"], stages: ["planning", "review"], modes: ["strict"] }),
  skill({ id: "pace", name: "节奏检查", kind: ["review"], stages: ["review"], modes: ["strict"] }),
  skill({ id: "hook", name: "结尾钩子", kind: ["structure"], stages: ["drafting", "review"], modes: ["strict"] }),
  skill({ id: "knowledge", name: "世界观资料", kind: ["knowledge"], stages: ["planning"], modes: ["standard", "strict"] }),
]

describe("SelectSkillsPlugin", () => {
  it("selects standard writing skills for next chapter generation", async () => {
    const plugin = createSelectSkillsPlugin()

    const result = await plugin.run({
      userMessage: "帮我写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      availableSkills,
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toEqual([
      "章节承接",
      "下一章计划",
      "人物动机",
      "冲突升级",
      "剧情自检",
      "正文输出协议",
    ])
  })

  it("supplements standard writing with uploaded writing skills such as 三翻四抖", async () => {
    const plugin = createSelectSkillsPlugin()

    const result = await plugin.run({
      userMessage: "帮我写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      availableSkills: [
        ...availableSkills,
        skill({
          id: "skill:three-four",
          name: "三翻四抖",
          kind: ["structure", "planning"],
          stages: ["planning", "drafting"],
          modes: ["standard", "strict"],
          content: "三次转折，四次震惊。",
          source: "uploaded",
        }),
      ],
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toContain("三翻四抖")
  })

  it("keeps fast mode to output and optional style skills", async () => {
    const plugin = createSelectSkillsPlugin()

    const result = await plugin.run({
      userMessage: "直接写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "fast",
      availableSkills,
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toEqual([
      "正文输出协议",
      "去AI味",
    ])
  })

  it("selects strict review and structure skills for key chapter writing", async () => {
    const plugin = createSelectSkillsPlugin()

    const result = await plugin.run({
      userMessage: "帮我写关键转折章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "strict",
      availableSkills,
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toEqual([
      "章节承接",
      "下一章计划",
      "人物动机",
      "冲突升级",
      "剧情自检",
      "正文输出协议",
      "主线检查",
      "伏笔管理",
      "节奏检查",
      "结尾钩子",
    ])
  })

  it("does not select skills outside novel routed tasks", async () => {
    const plugin = createSelectSkillsPlugin()

    const result = await plugin.run({
      userMessage: "你好",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: false,
      aiWorkflowMode: "standard",
      availableSkills,
    })

    expect(result.selectedSkills).toEqual([])
  })

  it("builds a prompt section that hides skill analysis from final prose", () => {
    const prompt = buildSelectedSkillsPrompt([
      skill({ id: "three-four", name: "三翻四抖", kind: ["structure"], stages: ["planning", "drafting"], modes: ["standard"], content: "三次转折，四次震惊。" }),
    ])

    expect(prompt).toContain("本次启用 Skill")
    expect(prompt).toContain("三翻四抖")
    expect(prompt).toContain("三次转折，四次震惊。")
    expect(prompt).toContain("不要在最终回复中解释 Skill")
  })
})
