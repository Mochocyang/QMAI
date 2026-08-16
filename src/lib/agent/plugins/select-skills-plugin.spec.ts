import { describe, expect, it } from "vitest"
import { createSelectSkillsPlugin, buildSelectedSkillsPrompt, selectSkillsForRoute } from "./select-skills-plugin"
import { normalizeUserSkill, type UserSkill } from "@/lib/novel/skill-library"
import { SKILL_ROUTE_CATEGORY_IDS } from "@/lib/novel/skill-route"

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
  skill({ id: "de-ai", name: "基础去AI味", kind: ["style"], stages: ["rewrite", "output"], modes: ["fast", "standard", "strict"] }),
  skill({ id: "mainline", name: "主线检查", kind: ["review"], stages: ["review"], modes: ["strict"] }),
  skill({ id: "foreshadow", name: "伏笔管理", kind: ["structure", "review"], stages: ["planning", "review"], modes: ["strict"] }),
  skill({ id: "pace", name: "节奏检查", kind: ["review"], stages: ["review"], modes: ["strict"] }),
  skill({ id: "hook", name: "结尾钩子", kind: ["structure"], stages: ["drafting", "review"], modes: ["strict"] }),
  skill({ id: "knowledge", name: "世界观资料", kind: ["knowledge"], stages: ["planning"], modes: ["standard", "strict"] }),
]

describe("SelectSkillsPlugin", () => {
  it("selects old fast lightweight skills for standard mode", async () => {
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
      "正文输出协议",
      "基础去AI味",
    ])
  })

  it("does not supplement standard lightweight writing with uploaded skills", async () => {
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
          priority: 25,
        }),
      ],
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toEqual([
      "正文输出协议",
      "基础去AI味",
    ])
  })

  it("does not auto-select skills in fast mode", async () => {
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

    expect(result.selectedSkills).toEqual([])
  })

  it("selects writing route skills for key chapter writing", async () => {
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
      "正文输出协议",
      "基础去AI味",
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

  it("routes outline generation to outline folders and excludes writing-only skills", () => {
    const selected = selectSkillsForRoute([
      skill({
        id: "outline-plan",
        name: "章纲结构",
        kind: ["planning"],
        stages: ["planning"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.outline,
      }),
      skill({
        id: "character",
        name: "人物动机",
        kind: ["structure"],
        stages: ["planning"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.character,
      }),
      skill({
        id: "writing",
        name: "正文输出协议",
        kind: ["output"],
        stages: ["output"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
      }),
    ], "generate_outline", "standard")

    expect(selected.map((item) => item.name)).toEqual(["章纲结构", "人物动机"])
  })

  it("routes chapter writing to writing folders when categorized skills exist", () => {
    const selected = selectSkillsForRoute([
      skill({
        id: "outline-plan",
        name: "下一章计划",
        kind: ["planning"],
        stages: ["planning"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.outline,
      }),
      skill({
        id: "writing-output",
        name: "正文输出协议",
        kind: ["output"],
        stages: ["output"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
      }),
      skill({
        id: "writing-style",
        name: "场景描写",
        kind: ["style"],
        stages: ["drafting"],
        modes: ["standard", "strict"],
        categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
      }),
    ], "write_chapter", "strict")

    expect(selected.map((item) => item.name)).toEqual(["正文输出协议", "场景描写"])
  })

  it("injects canonical drafting and scene skills before Chinese helpers", () => {
    const selected = selectSkillsForRoute([
      skill({ id: "long", name: "long-form-drafting", kind: ["output"], stages: ["drafting"], modes: ["standard", "strict"], categoryId: SKILL_ROUTE_CATEGORY_IDS.writing }),
      skill({ id: "combat", name: "combat-action", kind: ["style"], stages: ["drafting"], modes: ["standard", "strict"], categoryId: SKILL_ROUTE_CATEGORY_IDS.writing }),
      skill({ id: "protocol", name: "正文输出协议", kind: ["output"], stages: ["output"], modes: ["standard", "strict"], categoryId: SKILL_ROUTE_CATEGORY_IDS.writing }),
    ], "write_chapter", "standard", "编写一章战斗场景")

    expect(selected.map((item) => item.name)).toEqual([
      "long-form-drafting",
      "combat-action",
      "正文输出协议",
    ])
  })

  it("prepends @ selected skills and canonical name hits before auto-routed skills", async () => {
    const plugin = createSelectSkillsPlugin()
    const combat = skill({
      id: "combat",
      name: "combat-action",
      kind: ["style"],
      stages: ["drafting"],
      modes: ["fast", "standard", "strict"],
      categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
    })

    const fromName = await plugin.run({
      userMessage: "写下一章 combat-action",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      availableSkills: [...availableSkills, combat],
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })
    expect(fromName.selectedSkills?.map((item) => item.name)).toEqual([
      "combat-action",
      "正文输出协议",
      "基础去AI味",
    ])

    const fromToken = await plugin.run({
      userMessage: "写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      availableSkills: [...availableSkills, combat],
      selectedSkills: [combat],
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })
    expect(fromToken.selectedSkills?.map((item) => item.name)).toEqual([
      "combat-action",
      "正文输出协议",
      "基础去AI味",
    ])
  })

  it("keeps explicit skills in fast mode without auto-selecting helpers", async () => {
    const plugin = createSelectSkillsPlugin()
    const combat = skill({
      id: "combat",
      name: "combat-action",
      kind: ["style"],
      stages: ["drafting"],
      modes: ["fast", "standard", "strict"],
      categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
    })

    const result = await plugin.run({
      userMessage: "直接写下一章 combat-action",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "fast",
      availableSkills: [...availableSkills, combat],
      selectedSkills: [combat],
      taskRoute: { intent: "write_chapter", confidence: 0.95, extractedParams: {} },
    })

    expect(result.selectedSkills?.map((item) => item.name)).toEqual(["combat-action"])
  })
})
