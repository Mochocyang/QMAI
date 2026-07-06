import { describe, expect, it } from "vitest"
import { buildChapterPlanExecutionSummary } from "./chapter-plan-execution-summary"

describe("buildChapterPlanExecutionSummary", () => {
  it("outputs a fixed execution structure with scene ids and priority buckets", () => {
    const plan = [
      "维度二·章节定位分析：本章目标是承接门缝声，推进锈钥匙线索。",
      "维度四·场景序列编排：1. 雨夜旧屋承接门缝声，功能：制造当前问题；2. 信纸揭示线索，功能：升级信息差；3. 屋外脚步声收束，功能：引出新威胁。",
      "维度五·冲突与人物引擎：对话目标：主角试探小晴，小晴隐瞒旧屋主人身份。",
      "维度六·边界与禁忌：必须推进锈钥匙；禁止提前揭露旧屋主人身份。",
      "维度七·节奏、字数与结尾钩子：结尾钩子是第二个人影贴近门口。",
    ].join("\n")

    const summary = buildChapterPlanExecutionSummary(plan)

    expect(summary).toContain("本章目标：")
    expect(summary).toContain("场景序列：")
    expect(summary).toContain("S1 雨夜旧屋承接门缝声")
    expect(summary).toContain("S2 信纸揭示线索")
    expect(summary).toContain("S3 屋外脚步声收束")
    expect(summary).toContain("必须执行：")
    expect(summary).toContain("禁止违背：")
    expect(summary).toContain("可自由发挥：")
    expect(summary).toContain("对话目标：")
    expect(summary).toContain("伏笔动作：")
    expect(summary).toContain("结尾钩子：")
  })

  it("keeps multiline S scene items under the scene-sequence dimension", () => {
    const plan = [
      "维度二·章节定位分析：本章目标是承接门缝声，推进锈钥匙线索。",
      "维度四·场景序列编排：",
      "S1 旧屋门口承接上一章门缝声，功能：制造当前问题。",
      "S2 堂屋信纸揭示锈钥匙线索，功能：升级信息差。",
      "S3 屋外第二个人影贴近门口，功能：引出新威胁。",
      "维度六·边界与禁忌：禁止提前揭露旧屋主人身份。",
      "维度七·节奏、字数与结尾钩子：结尾钩子是第二个人影贴近门口。",
    ].join("\n")

    const summary = buildChapterPlanExecutionSummary(plan)

    expect(summary).toContain("S1 旧屋门口承接上一章门缝声")
    expect(summary).toContain("S2 堂屋信纸揭示锈钥匙线索")
    expect(summary).toContain("S3 屋外第二个人影贴近门口")
  })

  it("keeps chapter execution constraints and removes low-value filler", () => {
    const plan = [
      "维度一·输入校验：本章写第3章。",
      "补充说明：这份计划用于帮助模型理解任务，不属于正文。",
      "维度四·场景序列编排：1. 雨夜旧屋承接门缝声；2. 信纸揭示线索；3. 屋外脚步声收束。",
      "维度五·人物、冲突与对话目标：主角试探小晴，小晴隐瞒关键信息。",
      "维度六·伏笔与边界禁忌：推进锈钥匙，不得提前揭露旧屋主人身份。",
      "维度七·节奏、字数与结尾钩子：结尾停在第二个人影贴近门口。",
      "感谢确认，下面才会开始写正文。",
    ].join("\n")

    const summary = buildChapterPlanExecutionSummary(plan)

    expect(summary).toContain("用户已确认的章节计划执行摘要")
    expect(summary).toContain("场景序列：")
    expect(summary).toContain("对话目标")
    expect(summary).toContain("伏笔")
    expect(summary).toContain("禁止违背")
    expect(summary).toContain("结尾钩子")
    expect(summary).not.toContain("感谢确认")
  })

  it("caps long confirmed plans while preserving the strongest execution lines", () => {
    const filler = Array.from({ length: 80 }, (_, index) => `普通说明 ${index}：只是在解释计划来源。`).join("\n")
    const plan = [
      filler,
      "维度四·场景序列编排：必须先写旧屋，再写信纸，最后写门外脚步。",
      "维度六·伏笔与边界禁忌：必须推进锈钥匙，禁止揭露旧屋主人身份。",
      "维度七·节奏、字数与结尾钩子：章末留下第二个人影。",
    ].join("\n")

    const summary = buildChapterPlanExecutionSummary(plan, 220)

    expect(summary.length).toBeLessThanOrEqual(260)
    expect(summary).toContain("旧屋")
    expect(summary).toContain("锈钥匙")
    expect(summary).toContain("计划执行摘要已截断")
  })

  it("falls back to key original plan lines when the structured summary lacks required execution anchors", () => {
    const plan = [
      "维度一·输入校验：本章写第3章。",
      "维度二·章节定位分析：承接上一章门缝声。",
      "维度六·边界与禁忌：禁止提前揭露旧屋主人身份。",
      "维度七·节奏、字数与结尾钩子：章末留下屋外脚步声。",
    ].join("\n")

    const summary = buildChapterPlanExecutionSummary(plan)

    expect(summary).toContain("原计划关键片段：")
    expect(summary).toContain("维度六·边界与禁忌：禁止提前揭露旧屋主人身份。")
    expect(summary).toContain("维度七·节奏、字数与结尾钩子：章末留下屋外脚步声。")
  })
})
