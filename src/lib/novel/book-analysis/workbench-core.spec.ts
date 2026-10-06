import { describe, expect, it } from "vitest"
import { buildWorkbenchPlan, buildEvidenceCandidates, parseWorkbenchItem, validateCoverage } from "./workbench-core"

describe("单页拆书的选择、覆盖与证据", () => {
  it("按真实ID拆分全书，不连续选择不补入中间章节", () => {
    const chapters = Array.from({ length: 923 }, (_, index) => ({ id: `c${index + 1}`, order: index + 1, content: "正文".repeat(20) }))
    const selected = chapters.filter((_, i) => i % 2 === 0).map((c) => c.id)
    const plan = buildWorkbenchPlan(chapters, selected, 24000)
    expect(plan.flatMap((chunk) => chunk.chapterIds)).toEqual(selected)
    expect(new Set(plan.map((chunk) => chunk.batch))).toHaveLength(5)
    expect(plan.every((chunk) => chunk.chapterIds.length <= 10)).toBe(true)
  })
  it("长章完整切片，尾部不截断，覆盖完整才通过", () => {
    const chapter = { id: "c101", order: 101, content: "长".repeat(51001) }
    const chunks = buildWorkbenchPlan([chapter], ["c101"], 24000)
    expect(chunks).toHaveLength(3)
    const coverage = chunks.flatMap((c) => c.segments)
    expect(coverage.map((s) => chapter.content.slice(s.start, s.end)).join("")).toBe(chapter.content)
    expect(() => validateCoverage(chunks, coverage)).not.toThrow()
    expect(() => validateCoverage(chunks, coverage.slice(0, -1))).toThrow("覆盖")
  })
  it("拒绝空选、缺失ID，不让用户以为已选择成功", () => {
    expect(() => buildWorkbenchPlan([], [], 24000)).toThrow()
    expect(() => buildWorkbenchPlan([], ["missing"], 24000)).toThrow("不存在")
  })
  it("原型姓名由程序在运行规则中归一化，但原作职业能力不能带入", async () => {
    const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "许七安没有立即回答，而是先核对了信息。" }])
    const input = { subject: "许七安", summary: "许七安先核验", limitations: "只限样本", rules: [{
      dimension: "mentalModel", observation: "核对信息", condition: "信息不足", action: "许七安先核对", boundary: "例外未知", evidenceIds: [evidence[0].id],
    }] }
    expect(parseWorkbenchItem(input, evidence, "许七安", "characters").summary).toBe("该人物先核验")
    expect(() => parseWorkbenchItem({ ...input, rules: [{ ...input.rules[0], action: "使用前世警察的刑侦知识破案" }] }, evidence, "许七安", "characters")).toThrow("职业")
  })
  it("引文由程序回填，保留正文位置和指纹；错误证据不接受", async () => {
    const candidates = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 10, text: "他没有立即定罪，而是先要求核对账册。", sourceHash: "a".repeat(64) }])
    const raw = { subject: "甲", summary: "先核对再判断", limitations: "只分析本次范围", rules: [{
      id: "R1", dimension: "mentalModel", observation: "先核对账册", condition: "信息不足", action: "先核对", boundary: "例外未知", evidenceIds: [candidates[0].id],
    }] }
    const item = parseWorkbenchItem(raw, candidates, "甲", "characters")
    expect(item.rules[0].evidenceIds).toEqual([candidates[0].id])
    expect(candidates[0]).toMatchObject({ start: 10, end: 28, sourceHash: "a".repeat(64) })
    expect(() => parseWorkbenchItem({ ...raw, rules: [{ ...raw.rules[0], evidenceIds: ["fake"] }] }, candidates, "甲", "characters")).toThrow("证据")
  })
  it("模型多选证据时保留前两个有效编号，而不是丢弃整个区块结果", async () => {
    const candidates = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "第一句原文。\n第二句原文。\n第三句原文。\n第四句原文。" }])
    expect(candidates.length).toBeGreaterThanOrEqual(4)
    const raw = { subject: "甲", summary: "先核对再判断", limitations: "只分析本次范围", rules: [{
      id: "R1", dimension: "mentalModel", observation: "观察", condition: "条件", action: "行动", boundary: "边界",
      evidenceIds: [candidates[0].id, candidates[1].id, candidates[2].id, candidates[3].id],
    }] }
    const item = parseWorkbenchItem(raw, candidates, "甲", "characters")
    expect(item.rules[0].evidenceIds).toEqual([candidates[0].id, candidates[1].id])
  })
  it("混杂有效与伪造编号时保留有效编号；全部无效才拒绝", async () => {
    const candidates = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "第一句原文。\n第二句原文。" }])
    const raw = { subject: "甲", summary: "先核对再判断", limitations: "只分析本次范围", rules: [{
      id: "R1", dimension: "mentalModel", observation: "观察", condition: "条件", action: "行动", boundary: "边界",
      evidenceIds: [candidates[0].id, "伪造E999", candidates[1].id],
    }] }
    expect(parseWorkbenchItem(raw, candidates, "甲", "characters").rules[0].evidenceIds).toEqual([candidates[0].id, candidates[1].id])
    expect(() => parseWorkbenchItem({ ...raw, rules: [{ ...raw.rules[0], evidenceIds: ["伪造A", "伪造B"] }] }, candidates, "甲", "characters")).toThrow("证据")
  })
})
