import { describe, expect, it } from "vitest"
import { analysisActivities, analysisOutcomeChanges } from "./analysis-activity"
import type { BookAnalysisPipelineTask } from "./analysis-pipeline-types"
function task(): BookAnalysisPipelineTask {
  return {
    workbenchVersion: 2, id: "task", projectPath: "/project", bookId: "book", bookTitle: "测试作品", selectedSkills: ["characters", "story", "style"],
    status: "running", currentSkill: "style", updatedAt: 10, createdAt: 1,
    modules: Object.fromEntries(["characters", "story", "style"].map((skill) => [skill, {
      skill, status: skill === "style" ? "running" : "completed", chunkIds: ["c1", "c2"],
      completedChunkIds: skill === "style" ? ["c1"] : ["c1", "c2"], resultPath: null, updatedAt: 10,
    }])),
  } as unknown as BookAnalysisPipelineTask
}
describe("拆书后台活动", () => {
  it("按三类Skill显示状态、分区块和实时阶段", () => {
    const rows = analysisActivities([task()], { "task:style:c2": { percentage: 35, stageLabel: "核对用词证据" } })
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ status: "running", title: "《测试作品》 · 文风 Skill", detail: "核对用词证据", completed: 1, total: 2 })
  })
  it("完成和失败生成同内容的结果记录，恢复旧任务不重复通知", () => {
    const before = task(), after = structuredClone(before)
    after.modules.style.status = "completed"; after.status = "completed"
    const events = analysisOutcomeChanges([after], [before])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ skill: "style", status: "completed" })
    expect(events[0].message).toContain("待确认")
    expect(analysisOutcomeChanges([after], [])).toHaveLength(0)
    expect(analysisOutcomeChanges([after], [after])).toHaveLength(0)
    const failed = structuredClone(before)
    failed.status = "failed"; failed.modules.style.status = "failed"; failed.error = "模型响应不完整"
    expect(analysisOutcomeChanges([failed], [before])[0].message).toContain("模型响应不完整")
  })
  it("角色识别失败保留在待选择阶段也能通知，手动取消不冒充失败", () => {
    const before = task()
    before.selectedSkills = ["characters"]; before.status = "awaiting-character-selection"
    before.modules.characters.status = "pending"; before.error = null
    const failed = { ...before, error: "识别返回为空" }
    expect(analysisOutcomeChanges([failed], [before])[0]).toMatchObject({ skill: "characters", status: "failed" })
    expect(analysisOutcomeChanges([{ ...before, status: "cancelled" }], [before])).toHaveLength(0)
  })
})
