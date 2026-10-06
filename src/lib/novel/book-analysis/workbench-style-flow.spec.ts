import { beforeEach, describe, expect, it, vi } from "vitest"
import { STYLE_FACETS } from "./style-fingerprint"
import { createWorkbenchAdapter } from "./workbench-adapter"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
const mocks = vi.hoisted(() => ({ calls: vi.fn(), body: "他略一沉吟，继而开口。", hash: "a".repeat(64) }))
vi.mock("./workbench-storage", () => ({
  readWorkbenchChapters: async () => [{ id: "c1", order: 1, title: "第一章", content: mocks.body, sourceHash: mocks.hash }],
  saveWorkbenchRevision: vi.fn(), workbenchRevisionPath: () => "/unused",
}))
vi.mock("@/lib/llm-client", () => ({ streamChat: (...args: unknown[]) => mocks.calls(...args) }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.calls.mockImplementation(async (_config, messages, callbacks) => {
    const prompt = messages[0].content as string
    const rule = { dimension: "lexicon", observation: "用动作承接说话", condition: "作答前停顿", action: "先用短暂思考动作再接对白", boundary: "不机械重复", evidenceIds: ["E1_0"] }
    const raw = prompt.startsWith("核验文风画像")
      ? { checks: ["positioning", "R1", "W1"].map(id => ({ id, supported: true, portable: true, specific: true, reason: "有原文支持" })) }
      : prompt.startsWith("逐条核验")
        ? { checks: ["summary", "R1"].map(id => ({ id, supported: true, portable: true, relevant: true, reason: "有依据" })) }
        : prompt.startsWith("你是严谨")
          ? { subject: "文风", summary: "动作承接", limitations: "范围有限", rules: [rule] }
          : { subject: "文风", positioning: "克制的白话", limitations: "仅一个片段",
            coverage: Object.keys(STYLE_FACETS).map(dimension => ({ dimension, status: dimension === "lexicon" ? "observed" : "insufficient", reason: "范围有限" })),
            rules: [rule], lexicon: [{ word: "略一沉吟", kind: "expression", usage: "短暂停顿", evidenceIds: ["E1_0"] }], scenes: [] }
    callbacks.onToken(JSON.stringify(raw)); callbacks.onDone()
  })
})
function input(modern: boolean): Parameters<AnalysisSkillAdapter["runChunk"]>[0] {
  return {
    task: { id: "task", bookId: "book", workbenchVersion: 2, workbenchRequest: { selectedChapterIds: ["c1"], requirements: {}, ...(modern ? { styleProfileVersion: 1 } : {}) } },
    chunk: { chapterIds: ["c1"], segments: [{ chapterId: "c1", order: 1, start: 0, end: mocks.body.length, sourceHash: mocks.hash }] },
    bookPath: "/project/book", projectPath: "/project", skill: "style", llmConfig: {}, signal: new AbortController().signal,
  } as Parameters<AnalysisSkillAdapter["runChunk"]>[0]
}
describe("文风工作台完整适配路径", () => {
  it("新流程运行画像并隔离用户记忆，保留统计及证据", async () => {
    const result = await createWorkbenchAdapter("style").runChunk(input(true))
    expect(result.result.items[0].styleFingerprint?.lexicon[0].word).toBe("略一沉吟")
    expect(result.result.metrics?.counts.chars).toBe(mocks.body.length)
    expect(mocks.calls).toHaveBeenCalledTimes(2)
    for (const call of mocks.calls.mock.calls) expect(call[4]).toMatchObject({ skipUserMemory: true, max_tokens: 8000, temperature: 0.2 })
  })
  it("旧任务继续使用原提炼路径，不被强制重生成画像", async () => {
    const result = await createWorkbenchAdapter("style").runChunk(input(false))
    expect(result.result.items[0].styleFingerprint).toBeUndefined()
    expect(mocks.calls.mock.calls[0][4]).toBeUndefined()
  })
  it.each(["回调", "异常"])("服务余额不足通过%s返回时展示中文原因，不进入内容修订", async (mode) => {
    mocks.calls.mockImplementation(async (_config, _messages, callbacks) => {
      const error = new Error('HTTP 402: Payment Required - {"error":{"message":"Insufficient Balance"}}')
      if (mode === "异常") throw error
      callbacks.onError(error)
    })
    await expect(createWorkbenchAdapter("style").runChunk(input(true))).rejects.toThrow("模型服务余额不足")
    expect(mocks.calls).toHaveBeenCalledTimes(1)
  })
  it("其他请求错误不误报成余额不足", async () => {
    mocks.calls.mockImplementation(async (_config, _messages, callbacks) => callbacks.onError(new Error("HTTP 429: Too Many Requests")))
    await expect(createWorkbenchAdapter("style").runChunk(input(true))).rejects.toThrow("HTTP 429")
    expect(mocks.calls).toHaveBeenCalledTimes(1)
  })
  it("模型无可用通道时明确提示选择可用模型，不误报内容核验失败", async () => {
    mocks.calls.mockImplementation(async (_config, _messages, callbacks) => callbacks.onError(new Error('HTTP 503: {"error":{"code":"model_not_found","message":"No available channel for model example"}}')))
    await expect(createWorkbenchAdapter("style").runChunk(input(true))).rejects.toThrow("没有可用服务通道")
    expect(mocks.calls).toHaveBeenCalledTimes(1)
  })
})
