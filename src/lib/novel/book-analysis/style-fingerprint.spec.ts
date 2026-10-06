import { describe, expect, it, vi } from "vitest"
import { STYLE_FACETS, parseStyleFingerprintItem, distillStyleFingerprint, compileStyleFingerprint } from "./style-fingerprint"
import { buildEvidenceCandidates } from "./workbench-core"

const body = "他略一沉吟，便收回目光。\n“此事不急。”他缓缓说道。\n过了片刻，他略一沉吟，仍未开口。"
async function fixture() {
  const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: body }])
  const raw = {
    subject: "文风", positioning: "克制的白话叙述，以短暂迟疑承接行动判断。", limitations: "只有一个短片段，不代表全书。",
    coverage: Object.keys(STYLE_FACETS).map((dimension) => ({ dimension, status: dimension === "lexicon" ? "observed" : "insufficient", reason: "仅分析当前片段" })),
    rules: [{ dimension: "lexicon", observation: "重复使用沉吟引出短暂停顿", condition: "人物作答前短暂考虑", action: "以简短思考动作承接回应，避免长段解释心理", boundary: "不用于每次说话", evidenceIds: [evidence[0].id, evidence[2].id] }],
    lexicon: [{ word: "略一沉吟", kind: "expression", usage: "回应前的停顿，不能机械反复插入", evidenceIds: [evidence[0].id] }],
    scenes: [{ scene: "试探性对白", guidance: "在确有犹豫时用动作短暂延迟回答", evidenceIds: [evidence[0].id] }],
  }
  return { evidence, raw }
}
describe("结构化文风画像", () => {
  it("模型使用短证据编号，落盘仍是原文定位编号，未知编号不会被猜测", async () => {
    const { evidence, raw } = await fixture()
    const aliases = new Map(evidence.map((e, i) => [e.id, `E${i + 1}`]))
    const response = JSON.stringify(raw, (key, value) => key === "evidenceIds" ? value.map((id: string) => aliases.get(id)) : value)
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: true, specific: true, reason: "有编号依据" })) })
      : response)
    const item = await distillStyleFingerprint("", evidence, call)
    expect(call.mock.calls[0][0]).toContain('"id":"E1"')
    expect(item.rules[0].evidenceIds).toEqual([evidence[0].id, evidence[2].id])
    expect(item.styleFingerprint!.lexicon[0].evidenceIds).toEqual([evidence[0].id, evidence[2].id])
    const broken = vi.fn(async () => response.replaceAll('"E1"', '"E99999"'))
    await expect(distillStyleFingerprint("", evidence, broken)).rejects.toThrow("E99999")
    expect(broken).toHaveBeenCalledTimes(2)
  })
  it("从编号原文回填词汇频次，保留不足维度，不制造全书结论", async () => {
    const { evidence, raw } = await fixture()
    const item = parseStyleFingerprintItem(raw, evidence)
    expect(item.styleFingerprint?.lexicon[0]).toMatchObject({ word: "略一沉吟", count: 2, chapterCount: 1 })
    expect(item.styleFingerprint?.coverage.filter((c) => c.status === "insufficient")).toHaveLength(7)
    expect(compileStyleFingerprint(item)).toContain("词汇与搭配")
    expect(compileStyleFingerprint(item)).toContain("略一沉吟")
    expect(compileStyleFingerprint(item)).toContain("没有充分依据")
  })
  it("拒绝假词、假引文编号和无规则却声称已分析的维度", async () => {
    const { evidence, raw } = await fixture()
    await expect(Promise.resolve().then(() => parseStyleFingerprintItem({ ...raw, lexicon: [{ ...raw.lexicon[0], word: "原文不存在" }] }, evidence))).rejects.toThrow("词项")
    expect(() => parseStyleFingerprintItem({ ...raw, rules: [{ ...raw.rules[0], evidenceIds: ["fake"] }] }, evidence)).toThrow("证据")
    expect(() => parseStyleFingerprintItem({ ...raw, rules: [] }, evidence)).toThrow()
  })
  it("覆盖状态由实际规则计算，不因模型多报或少报维度而废弃有据规则", async () => {
    const { evidence, raw } = await fixture()
    raw.coverage.find(c => c.dimension === "lexicon")!.status = "insufficient"
    raw.coverage.find(c => c.dimension === "syntax")!.status = "observed"
    const item = parseStyleFingerprintItem(raw, evidence)
    expect(item.styleFingerprint?.coverage.find(c => c.dimension === "lexicon")?.status).toBe("observed")
    expect(item.styleFingerprint?.coverage.find(c => c.dimension === "syntax")).toMatchObject({ status: "insufficient", reason: expect.stringContaining("未生成") })
    expect(item.rules).toHaveLength(1)
    expect(() => parseStyleFingerprintItem({ ...raw, rules: [{ ...raw.rules[0], evidenceIds: ["伪造"] }] }, evidence)).toThrow("证据")
  })
  it("不要求模型重复生成可计算的覆盖表，缺省维度仍明确未知", async () => {
    const { evidence, raw } = await fixture()
    const item = parseStyleFingerprintItem({ ...raw, coverage: undefined }, evidence)
    expect(item.styleFingerprint?.coverage).toHaveLength(8)
    expect(item.styleFingerprint?.coverage.filter(c => c.status === "insufficient")).toHaveLength(7)
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: true, specific: true, reason: "有依据" })) })
      : JSON.stringify({ ...raw, coverage: undefined }))
    await distillStyleFingerprint("", evidence, call)
    expect(call).toHaveBeenCalledTimes(2)
  })
  it("一次列出多个词项结构错误并给出原文匹配编号，不在首错处停止", async () => {
    const { evidence, raw } = await fixture()
    const broken = { ...raw, lexicon: [
      { ...raw.lexicon[0], evidenceIds: [evidence[1].id] },
      { word: "缓缓", kind: "adverb", usage: "修饰说话", evidenceIds: [evidence[1].id] },
    ] }
    let message = ""
    try { parseStyleFingerprintItem(broken, evidence) } catch (error) { message = (error as Error).message }
    expect(message).toContain("略一沉吟")
    expect(message).toContain("adverb")
    expect(message).toContain("expression")
    expect(message).toContain(evidence[0].id)
  })
  it("根字段错误和条目错误同时反馈，避免修订时遗漏定位与局限", async () => {
    const { evidence, raw } = await fixture()
    let message = ""
    try { parseStyleFingerprintItem({ ...raw, positioning: "", limitations: "", lexicon: [{ ...raw.lexicon[0], kind: "adverb" }] }, evidence) }
    catch (error) { message = (error as Error).message }
    expect(message).toContain("positioning")
    expect(message).toContain("limitations")
    expect(message).toContain("adverb")
  })
  it("生成词项由程序逐字定位，模型只负责选词与解释，不可生成原文没有的词", async () => {
    const { evidence, raw } = await fixture()
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: true, specific: true, reason: "用法有实际原文支持" })) })
      : JSON.stringify({ ...raw, lexicon: [{ word: "略一沉吟", kind: "expression", usage: "回应前停顿" }] }))
    const item = await distillStyleFingerprint("", evidence, call)
    expect(item.styleFingerprint?.lexicon[0].evidenceIds).toEqual([evidence[0].id, evidence[2].id])
    expect(call.mock.calls[1][0]).toContain('"evidenceIds":["E1","E3"]')
    const fake = vi.fn(async () => JSON.stringify({ ...raw, lexicon: [{ word: "从未出现的词", kind: "expression", usage: "假的" }] }))
    await expect(distillStyleFingerprint("", evidence, fake)).rejects.toThrow()
    expect(fake).toHaveBeenCalledTimes(2)
  })
  it("专有词只作观察，不编译为目标作品的常用词", async () => {
    const { evidence, raw } = await fixture()
    raw.lexicon[0].kind = "source-term"
    const runtime = compileStyleFingerprint(parseStyleFingerprintItem(raw, evidence))
    expect(runtime).not.toContain("略一沉吟")
    expect(runtime).toContain("不迁移原作专有名词")
  })
  it("专有词只需核验观察依据，可迁移性为否不否定整个画像", async () => {
    const { evidence, raw } = await fixture()
    raw.lexicon[0].kind = "source-term"
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: id !== "W1", specific: true, reason: "专有词只作来源观察" })) })
      : JSON.stringify(raw))
    const item = await distillStyleFingerprint("", evidence, call)
    expect(compileStyleFingerprint(item)).not.toContain("略一沉吟")
    expect(call).toHaveBeenCalledTimes(2)
  })
  it("生成和独立核验覆盖写作习惯，修复次数有限", async () => {
    const { evidence, raw } = await fixture()
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map((id) => ({ id, supported: true, portable: true, specific: true, reason: "可在片段中核验" })) })
      : JSON.stringify(raw))
    await distillStyleFingerprint("", evidence, call)
    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[0][0]).toContain("不是用户的写作风格")
    expect(call.mock.calls[0][0]).toContain("语体定位")
    expect(call.mock.calls[0][0]).toContain("句法")
    const broken = vi.fn(async () => "{}")
    const save = vi.fn(async () => {})
    await expect(distillStyleFingerprint("", evidence, broken, undefined, undefined, save)).rejects.toThrow()
    expect(broken).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it("整体定位使用完整样本核验，来源观察不要求迁移到新作", async () => {
    const { evidence, raw } = await fixture()
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: id !== "positioning", specific: true, reason: "定位仅描述来源样本" })) })
      : JSON.stringify(raw))
    await expect(distillStyleFingerprint("", evidence, call)).resolves.toMatchObject({ summary: raw.positioning })
    expect(call.mock.calls[1][0]).toContain(evidence[1].text)
    expect(call).toHaveBeenCalledTimes(2)
  })
  it("一次反馈所有失败项，定点修订且不改动已通过规则", async () => {
    const { evidence, raw } = await fixture()
    const revised = "当前片段以克制白话描写短暂停顿。"
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: !["positioning", "S1"].includes(id), portable: true, specific: true, reason: id === "positioning" ? "整体定位扩大了样本" : id === "S1" ? "单个角色不能概括所有对白" : "依据充分" })) }))
      .mockResolvedValueOnce(JSON.stringify({ replacements: [{ id: "positioning", value: revised }, { id: "S1", value: null }] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "positioning", supported: true, portable: false, specific: true, reason: "已限定样本" }] }))
    const save = vi.fn(async () => {})
    const item = await distillStyleFingerprint("", evidence, call, undefined, undefined, save)
    expect(call).toHaveBeenCalledTimes(4)
    expect(call.mock.calls[2][0]).toContain("整体定位扩大了样本")
    expect(call.mock.calls[2][0]).toContain("单个角色不能概括所有对白")
    expect(call.mock.calls[2][0]).toContain('"id":"S1","value":{"scene":')
    expect(call.mock.calls[3][0]).not.toContain(raw.rules[0].action)
    expect(save).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("S1"))
    expect(item.rules).toEqual(parseStyleFingerprintItem(raw, evidence).rules)
    expect(item.styleFingerprint?.positioning).toBe(revised)
    expect(item.styleFingerprint?.scenes).toEqual([])
    expect(item.styleFingerprint?.coverage).toEqual(raw.coverage)
    expect(item.limitations).toContain("移除")
  })
  it("删去不支持的规则后重算覆盖状态和核验编号", async () => {
    const { evidence, raw } = await fixture()
    raw.rules.push({ ...raw.rules[0], dimension: "dialogue" })
    raw.coverage.find(c => c.dimension === "dialogue")!.status = "observed"
    const replacement = { ...raw.rules[1], observation: "用动作表示回答前的停顿" }
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["positioning", "R1", "R2", "W1", "S1"].map(id => ({ id, supported: !id.startsWith("R"), portable: true, specific: true, reason: "需要限定规则" })) }))
      .mockResolvedValueOnce(JSON.stringify({ replacements: [{ id: "R1", value: null }, { id: "R2", value: replacement }] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "R1", supported: true, portable: true, specific: true, reason: "修订后有依据" }] }))
    const item = await distillStyleFingerprint("", evidence, call)
    expect(item.rules).toHaveLength(1)
    expect(item.rules[0]).toMatchObject({ id: "R1", dimension: "dialogue", observation: replacement.observation })
    expect(item.styleFingerprint?.coverage.find(c => c.dimension === "lexicon")?.status).toBe("insufficient")
    expect(item.styleFingerprint?.coverage.find(c => c.dimension === "dialogue")?.status).toBe("observed")
  })
  it.each(["修改通过项", "伪造证据", "遗漏修订项", "删除全部规则", "复核不通过"])("修订仍有%s时保存草稿并停止，不循环重试", async (failure) => {
    const { evidence, raw } = await fixture()
    const value = { ...raw.rules[0], evidenceIds: failure === "伪造证据" ? ["E999"] : raw.rules[0].evidenceIds }
    const replacements = failure === "遗漏修订项" ? [] : [{ id: failure === "修改通过项" ? "S1" : "R1", value: failure === "删除全部规则" ? null : value }]
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: id !== "R1", portable: true, specific: true, reason: "该规则缺乏依据" })) }))
      .mockResolvedValueOnce(JSON.stringify({ replacements }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "R1", supported: false, portable: true, specific: true, reason: "修订仍缺乏依据" }] }))
    const save = vi.fn(async () => {})
    await expect(distillStyleFingerprint("", evidence, call, undefined, undefined, save)).rejects.toThrow()
    expect(call.mock.calls.length).toBeLessThanOrEqual(4)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it("可选词项复核不通过时单独排除并记录，不丢弃已验证规则", async () => {
    const { evidence, raw } = await fixture()
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockResolvedValueOnce(JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: id !== "W1", portable: true, specific: true, reason: "词项用法不可靠" })) }))
      .mockResolvedValueOnce(JSON.stringify({ replacements: [{ id: "W1", value: raw.lexicon[0] }] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "W1", supported: false, portable: true, specific: true, reason: "修订仍不能支持该用法" }] }))
    const save = vi.fn(async () => {})
    const item = await distillStyleFingerprint("", evidence, call, undefined, undefined, save)
    expect(item.rules).toEqual(parseStyleFingerprintItem(raw, evidence).rules)
    expect(item.styleFingerprint?.lexicon).toEqual([])
    expect(item.styleFingerprint?.omitted).toEqual([expect.objectContaining({ kind: "lexicon", label: "略一沉吟", reason: "修订仍不能支持该用法" })])
    expect(compileStyleFingerprint(item)).not.toContain("略一沉吟")
    expect(save).toHaveBeenCalledTimes(2)
    expect(call).toHaveBeenCalledTimes(4)
  })
  it("汇总保留未采纳记录，但不把被否定内容送回模型作为分析依据", async () => {
    const { evidence, raw } = await fixture()
    const prior = parseStyleFingerprintItem(raw, evidence)
    prior.styleFingerprint!.omitted = [{ kind: "scene", label: "不应作为生成依据的建议", reason: "没有依据" }]
    const call = vi.fn(async (prompt: string) => prompt.startsWith("核验文风画像")
      ? JSON.stringify({ checks: ["positioning", "R1", "W1", "S1"].map(id => ({ id, supported: true, portable: true, specific: true, reason: "有依据" })) })
      : JSON.stringify(raw))
    const item = await distillStyleFingerprint("", evidence, call, [prior])
    expect(item.styleFingerprint?.omitted).toEqual(prior.styleFingerprint!.omitted)
    expect(call.mock.calls[0][0]).not.toContain("不应作为生成依据的建议")
  })
})
