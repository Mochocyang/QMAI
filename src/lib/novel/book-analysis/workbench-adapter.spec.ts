import { describe, expect, it, vi } from "vitest"
import { distillWorkbenchItem } from "./workbench-adapter"
import { buildEvidenceCandidates } from "./workbench-core"

describe("三类按需结果校验", () => {
  it.each(["characters", "story", "style"] as const)("%s需求传入，原文证据保持不变", async (skill) => {
    const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "他先核对了账簿，然后才给出回答。" }])
    const result = { subject: "甲", summary: "先核对", limitations: "仅此片段", rules: [{ dimension: skill === "characters" ? "mentalModel" : "判断", observation: "核对账簿", condition: "不确定", action: "核对再判断", boundary: "未知例外", evidenceIds: [evidence[0].id] }] }
    const call = vi.fn(async (prompt: string) => prompt.startsWith("逐条核验") ? '{"checks":[{"id":"summary","supported":true,"portable":true,"relevant":true,"reason":"有依据"},{"id":"R1","supported":true,"portable":true,"relevant":true,"reason":"有依据"}]}' : JSON.stringify(result))
    const item = await distillWorkbenchItem(skill, "甲", "只研究权势压力", evidence, call)
    expect(item.rules).toHaveLength(1)
    expect(call.mock.calls[0][0]).toContain("只研究权势压力")
    expect(call).toHaveBeenCalledTimes(2)
  })
  it("没有证据或核验不完整不能入库，最多修正一次", async () => {
    const call = vi.fn(async () => "{}")
    await expect(distillWorkbenchItem("story", "故事", "", [], call)).rejects.toThrow()
    expect(call.mock.calls.length).toBeLessThanOrEqual(2)
  })
  it("角色和故事使用短证据编号并反馈全部语义问题，不只修复第一条", async () => {
    const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "他先核对账簿，再回答。" }])
    const response = { subject: "甲", summary: "先核对", limitations: "仅片段", rules: [{ dimension: "mentalModel", observation: "核对账簿", condition: "不确定", action: "先核对再回答", boundary: "未知", evidenceIds: ["E1"] }] }
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(response))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["summary", "R1"].map(id => ({ id, supported: false, portable: true, relevant: true, reason: id === "summary" ? "摘要范围过大" : "行动前提不成立" })) }))
      .mockResolvedValueOnce(JSON.stringify(response))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["summary", "R1"].map(id => ({ id, supported: true, portable: true, relevant: true, reason: "有依据" })) }))
    const item = await distillWorkbenchItem("characters", "甲", "", evidence, call)
    expect(item.rules[0].evidenceIds).toEqual([evidence[0].id])
    expect(call.mock.calls[0][0]).toContain('"id":"E1"')
    expect(call.mock.calls[2][0]).toContain("摘要范围过大")
    expect(call.mock.calls[2][0]).toContain("行动前提不成立")
  })
})
