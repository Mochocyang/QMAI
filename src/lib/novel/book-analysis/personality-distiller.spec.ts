import { describe, expect, it, vi } from "vitest"
import { selectPersonalityPassages, distillPersonality } from "./personality-distiller"
import { personality, portabilityApproval } from "@/test-helpers/portable-personality-fixture"

describe("按人物显著行为提炼", () => {
  it("不读取无关角色段落，跨早中晚章节取样并保留来源位置", () => {
    const chapters = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, order: i + 1, content: `# 第${i + 1}章\n许七安在压力下作出选择。${"有关行动。".repeat(280)}`,
    }))
    chapters.push({ id: "other", order: 31, content: "路人甲逛街。" })
    const selected = selectPersonalityPassages(chapters, ["许七安"], 12)
    expect(selected).toHaveLength(12)
    expect(selected[0].chapterId).toBe("c0")
    expect(selected.at(-1)?.chapterId).toBe("c29")
    expect(selected.some((item) => item.chapterId === "other")).toBe(false)
    expect(selected.every((item) => item.text.length <= 1600)).toBe(true)
  })
  it("只接受能在选取片段逐字找到的证据，缺失证据不保存成品", async () => {
    const call = vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith("人格规则迁移核验") ? portabilityApproval : personality))
    const passages = personality.evidence.map((item) => ({ chapterId: item.chapterId, text: item.quote }))
    const output = await distillPersonality("许七安", passages, call)
    expect(output.rules).toHaveLength(2)
    expect(call.mock.calls[0][0]).toContain("职业")
    await expect(distillPersonality("许七安", [{ chapterId: "c1", text: "他在街上散步，什么也没有发生。" }], call))
      .rejects.toThrow("证据")
    expect(call).toHaveBeenCalledTimes(4)
  })
  it("引用由原文回填，模型改写的引文不会成为证据", async () => {
    const fakeQuotes = { ...personality, evidence: personality.evidence.map((item) => ({ ...item, quote: "模型编造的台词" })) }
    const passages = personality.evidence.map((item) => ({ chapterId: item.chapterId, text: item.quote }))
    const output = await distillPersonality("许七安", passages, async (prompt) =>
      JSON.stringify(prompt.startsWith("人格规则迁移核验") ? portabilityApproval : fakeQuotes))
    expect(output.evidence[0].quote).toBe(personality.evidence[0].quote)
  })
  it("证据只修正一次，修正成功才返回，不无限循环", async () => {
    const call = vi.fn().mockResolvedValueOnce("{}").mockResolvedValueOnce(JSON.stringify(personality)).mockResolvedValueOnce(JSON.stringify(portabilityApproval))
    const passages = personality.evidence.map((item) => ({ chapterId: item.chapterId, text: item.quote }))
    await expect(distillPersonality("许七安", passages, call)).resolves.toHaveProperty("version", 1)
    expect(call).toHaveBeenCalledTimes(3)
    expect(call.mock.calls[1][0]).toContain("上轮结果未通过校验")
  })
  it("即使引文正确，迁移核验发现职业能力混入也不允许保存", async () => {
    const denied = { checks: portabilityApproval.checks.map((item) => ({ ...item, portable: false, reason: "要求原型特殊能力" })) }
    const call = vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith("人格规则迁移核验") ? denied : personality))
    const passages = personality.evidence.map((item) => ({ chapterId: item.chapterId, text: item.quote }))
    await expect(distillPersonality("许七安", passages, call)).rejects.toThrow("特殊能力")
    expect(call).toHaveBeenCalledTimes(4)
  })
})
