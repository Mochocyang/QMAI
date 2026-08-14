import { describe, expect, it } from "vitest"
import { createBuildSystemPromptPlugin } from "./build-system-prompt-plugin"
import { normalizeUserSkill } from "@/lib/novel/skill-library"
import { buildOutlineFindProtocol } from "@/lib/novel/outline-find-protocol"

describe("BuildSystemPromptPlugin selected skills", () => {
  it("injects selected skill prompt before final model execution", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: "base prompt",
      buildTaskDirectiveFn: () => "task directive",
    })

    const result = await plugin.run({
      userMessage: "帮我写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      novelSystemPrompt: "context prompt",
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
      selectedSkills: [
        normalizeUserSkill({
          id: "three-four",
          name: "三翻四抖",
          kind: ["structure"],
          stages: ["drafting"],
          modes: ["standard"],
          content: "三次转折，四次震惊。",
          source: "project",
        }),
      ],
    })

    expect(result.finalSystemPrompt).toContain("base prompt")
    expect(result.finalSystemPrompt).toContain("context prompt")
    expect(result.finalSystemPrompt).toContain("本次启用 Skill")
    expect(result.finalSystemPrompt).toContain("三翻四抖")
    expect(result.finalSystemPrompt).toContain("三次转折，四次震惊。")
    expect(result.finalSystemPrompt).toContain("task directive")
    expect(result.finalSystemRulesPrompt).toContain("base prompt")
    expect(result.finalSystemRulesPrompt).toContain("本次启用 Skill")
    expect(result.finalSystemRulesPrompt).toContain("task directive")
    expect(result.finalSystemRulesPrompt).not.toContain("context prompt")
    expect(result.stableSystemRulesPrompt).toBe("base prompt")
    expect(result.dynamicSystemRulesPrompt).toContain("本次启用 Skill")
    expect(result.dynamicSystemRulesPrompt).toContain("task directive")
    expect(result.dynamicSystemRulesPrompt).not.toContain("base prompt")
  })

  it("does not inject chapter plan protocol from standard mode unless Plan Execute is enabled", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: "base prompt",
      buildTaskDirectiveFn: () => "task directive",
    })

    const result = await plugin.run({
      userMessage: "帮我写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      planExecuteEnabled: false,
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
    })

    expect(result.finalSystemPrompt).not.toContain("章节创作计划协议")
    expect(result.finalSystemPrompt).not.toContain("chapter_plan")
  })

  it("injects chapter plan protocol when Plan Execute is enabled with standard mode", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: "base prompt",
      buildTaskDirectiveFn: () => "task directive",
    })

    const result = await plugin.run({
      userMessage: "帮我写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "standard",
      planExecuteEnabled: true,
      taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
    })

    expect(result.finalSystemPrompt).toContain("章节主编策划协议")
    expect(result.finalSystemPrompt).toContain("chapter_plan")
    expect(result.finalSystemPrompt).toContain("本章策划案")
    expect(result.finalSystemPrompt).not.toContain("章节蓝图")
    expect(result.finalSystemPrompt).not.toContain("维度一")
    expect(result.finalSystemPrompt).not.toContain("维度四")
    expect(result.finalSystemPrompt).toContain("### 1. 本章目标")
    expect(result.finalSystemPrompt).toContain("### 2. 已知依据")
    expect(result.finalSystemPrompt).toContain("### 3. 执行边界")
    expect(result.finalSystemPrompt).toContain("### 4. 分场景执行计划")
    expect(result.finalSystemPrompt).toContain("### 5. 信息流与伏笔")
    expect(result.finalSystemPrompt).toContain("### 6. 验收标准")
    expect(result.finalSystemPrompt).toContain("### 7. 风险与兜底")
    expect(result.finalSystemPrompt).not.toContain("承接与边界")
    expect(result.finalSystemPrompt).not.toContain("戏剧问题与信息流")
    expect(result.finalSystemPrompt).not.toContain("执行分层")
    expect(result.finalSystemPrompt).not.toContain("结尾钩子")
    expect(result.finalSystemPrompt).toContain("1200-1800字")
    expect(result.finalSystemPrompt).toContain("S1/S2/S3")
    expect(result.finalSystemPrompt).toContain("目的、冲突、转折、输出结果、验收标准")
    expect(result.finalSystemPrompt).toContain("输出结果")
    expect(result.finalSystemPrompt).toContain("验收标准")
    expect(result.finalSystemPrompt).toContain("必须执行")
    expect(result.finalSystemPrompt).toContain("禁止违背")
    expect(result.finalSystemPrompt).toContain("可自由发挥")
    expect(result.finalSystemPrompt).toContain("planBlueprint")
    expect(result.finalSystemPrompt).toContain("大纲定位协议")
    expect(result.finalSystemPrompt).toContain("list_outlines")
    expect(result.finalSystemPrompt).toContain("按文件夹分流")
    expect(result.finalSystemRulesPrompt).toContain("章节主编策划协议")
    expect(result.finalSystemRulesPrompt).not.toContain("context prompt")
    const finalPrompt = result.finalSystemPrompt ?? ""
    expect(finalPrompt.length).toBeLessThan(4500)
  })

  it("injects outline find protocol for chapter writing even without Plan Execute", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: "base prompt",
      buildTaskDirectiveFn: () => "task directive",
    })

    const result = await plugin.run({
      userMessage: "写第167章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "strict",
      planExecuteEnabled: false,
      taskRoute: {
        intent: "write_chapter",
        confidence: 0.95,
        chapterNumber: 167,
        extractedParams: { chapterNumber: "167" },
      },
    })

    expect(result.finalSystemPrompt).toContain("大纲定位协议")
    expect(result.finalSystemPrompt).toContain("本次写作目标：第 167 章")
    expect(result.finalSystemPrompt).toContain("overview")
    expect(result.finalSystemPrompt).not.toContain("章节主编策划协议")
    const occurrences = (result.finalSystemPrompt?.match(/大纲定位协议/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it("does not inject outline find protocol for non-writing intents", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: "base prompt",
    })

    const result = await plugin.run({
      userMessage: "陈远现在知道什么",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      aiWorkflowMode: "strict",
      taskRoute: { intent: "character_query", confidence: 0.9, extractedParams: {} },
    })

    expect(result.finalSystemPrompt).not.toContain("大纲定位协议")
  })

  it("dedupes outline find protocol already present in base system prompt", async () => {
    const plugin = createBuildSystemPromptPlugin({
      baseSystemPrompt: ["base", buildOutlineFindProtocol(1), "tail"].join("\n\n"),
    })

    const result = await plugin.run({
      userMessage: "写下一章",
      projectPath: "/project",
      agentConfig: {} as any,
      novelMode: true,
      taskRoute: {
        intent: "write_chapter",
        confidence: 0.9,
        chapterNumber: 167,
        extractedParams: {},
      },
    })

    const occurrences = (result.finalSystemPrompt?.match(/大纲定位协议/g) ?? []).length
    expect(occurrences).toBe(1)
    expect(result.finalSystemPrompt).toContain("本次写作目标：第 167 章")
  })

  it.each(["fast", "standard", "strict"] as const)(
    "injects chapter plan protocol when Plan Execute is enabled with %s mode",
    async (mode) => {
      const plugin = createBuildSystemPromptPlugin({
        baseSystemPrompt: "base prompt",
        buildTaskDirectiveFn: () => "task directive",
      })

      const result = await plugin.run({
        userMessage: "帮我写下一章",
        projectPath: "/project",
        agentConfig: {} as any,
        novelMode: true,
        aiWorkflowMode: mode,
        planExecuteEnabled: true,
        taskRoute: { intent: "write_chapter", confidence: 0.9, extractedParams: {} },
      })

      expect(result.finalSystemPrompt).toContain("章节主编策划协议")
      expect(result.finalSystemPrompt).toContain("<!-- chapter_plan -->")
      expect(result.finalSystemPrompt).toContain("<!-- /chapter_plan -->")
      expect(result.finalSystemPrompt).toContain("等待用户确认")
    },
  )
})
