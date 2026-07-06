import { describe, expect, it } from "vitest"
import { createBuildSystemPromptPlugin } from "./build-system-prompt-plugin"
import { normalizeUserSkill } from "@/lib/novel/skill-library"

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
    const finalPrompt = result.finalSystemPrompt ?? ""
    expect(finalPrompt.length).toBeLessThan(3000)
  })
})
