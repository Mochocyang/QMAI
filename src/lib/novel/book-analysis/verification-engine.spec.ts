import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Map<string, Array<{ name: string; path: string; is_dir: boolean }>>(),
  writes: new Map<string, string>(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    const key = path.replace(/\\/g, "/")
    if (!mockFs.files.has(key)) throw new Error(`missing ${key}`)
    return mockFs.files.get(key)!
  }),
  listDirectory: vi.fn(async (path: string) => mockFs.directories.get(path.replace(/\\/g, "/")) ?? []),
  writeFile: vi.fn(async (path: string, content: string) => {
    mockFs.writes.set(path.replace(/\\/g, "/"), content)
  }),
  createDirectory: vi.fn(async () => undefined),
  fileExists: vi.fn(async (path: string) => mockFs.files.has(path.replace(/\\/g, "/"))),
}))

import { createVerificationEngine, MAX_VERIFY_UNITS, scheduleVerification } from "./verification-engine"
import type { AnalysisStageCache } from "./analysis-stage-cache"
import { parseVerifyResult, pressureKindsFor } from "./verification-prompts"

const VERIFY_JSON = JSON.stringify({
  triple: [
    { key: "crossDomain", status: "pass", detail: "两处独立佐证", evidenceCount: 2 },
    { key: "predictive", status: "warn", detail: "部分可预测", evidenceCount: 0 },
    { key: "unique", status: "pass", detail: "特征具体", evidenceCount: 1 },
  ],
  pressure: [
    { kind: "apply", prompt: "迁移到都市题材", verdict: "pass", reason: "自洽" },
    { kind: "boundary", prompt: "纯日常流水", verdict: "fail", reason: "不适用" },
  ],
})

function makeEngine(callModel: (prompt: string) => string) {
  return createVerificationEngine({
    callModel: vi.fn(async (messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>) => {
      const user = messages.find((message) => message.role === "user")
      return callModel(typeof user?.content === "string" ? user.content : user?.content.map((block) => block.text ?? "").join("") ?? "")
    }),
    now: () => 1700000000000,
  })
}

function makeCharacter(id: string, name: string, importance: number) {
  return {
    id,
    name,
    aliases: [],
    importance,
    category: "protagonist" as const,
    firstAppearance: 1,
    lastAppearance: 2,
    appearanceCount: 3,
    description: "",
    personality: "沉稳",
    speechStyle: "简洁",
    relationships: [],
    keyEvents: [],
    corpus: "原文片段：韩立盘膝而坐。原文片段2：韩立睁开眼。",
  }
}

beforeEach(() => {
  mockFs.files.clear()
  mockFs.directories.clear()
  mockFs.writes.clear()
})

describe("parseVerifyResult", () => {
  it("解析围栏 JSON 并规范化字段", () => {
    const result = parseVerifyResult("```json\n" + VERIFY_JSON + "\n```")
    expect(result.triple).toHaveLength(3)
    expect(result.triple[1].status).toBe("warn")
    expect(result.pressure).toHaveLength(2)
  })

  it("脏输入返回空结构不抛错", () => {
    expect(parseVerifyResult("模型罢工了").triple).toEqual([])
  })
})

describe("pressureKindsFor", () => {
  it("角色 2 条、文风/故事 3 条", () => {
    expect(pressureKindsFor("characters")).toEqual(["apply", "boundary"])
    expect(pressureKindsFor("style")).toHaveLength(3)
    expect(pressureKindsFor("story")).toHaveLength(3)
  })
})

describe("createVerificationEngine.runVerification", () => {
  it("characters：逐角色验证并落盘 json+md，超上限截断", async () => {
    mockFs.directories.set("book/characters", Array.from({ length: MAX_VERIFY_UNITS + 3 }, (_, index) => ({
      name: `c${index}.json`,
      path: `book/characters/c${index}.json`,
      is_dir: false,
    })))
    for (let index = 0; index < MAX_VERIFY_UNITS + 3; index++) {
      mockFs.files.set(`book/characters/c${index}.json`, JSON.stringify(makeCharacter(`c${index}`, `角色${index}`, index)))
    }
    const engine = makeEngine(() => VERIFY_JSON)
    const report = await engine.runVerification("characters", "book", {} as never)

    expect(report.units).toHaveLength(MAX_VERIFY_UNITS)
    expect(report.skippedUnitCount).toBe(3)
    expect(report.costBounded).toBe(true)
    expect(report.units[0].passed).toBe(true) // warn 不算 fail
    // 截断后取 importance 最高的前 N 个
    expect(report.units[0].name).toBe("角色22")
    expect(mockFs.writes.has("book/verification/characters-verification.json")).toBe(true)
    const md = mockFs.writes.get("book/verification/characters-verification.md")!
    expect(md).toContain("角色提取")
    expect(md).toContain("跨域佐证")
    expect(md).toContain("压力测试")
  })

  it("style：读取 style-profile.json 生成单单元报告", async () => {
    mockFs.files.set("book/style-profile.json", JSON.stringify({
      schemaVersion: 1,
      generatedAt: 1,
      sampledChapterIds: ["ch-1"],
      narrativeDensity: "中高",
      descriptionWeight: "", emotionRendering: "", sentenceStyle: "", rhetoricDensity: "",
      transitionStyle: "", narrativeVoice: "", dialogueStyle: "", thematicHabits: "",
      constitution: "1. 短句优先",
      samples: ["样本一：短句推进。", "样本二：动作带情绪。"],
    }))
    const engine = makeEngine(() => VERIFY_JSON)
    const report = await engine.runVerification("style", "book", {} as never)
    expect(report.units).toHaveLength(1)
    expect(report.summary.total).toBe(1)
    expect(mockFs.writes.has("book/verification/style-verification.json")).toBe(true)
  })

  it("story：读取 story-map.json 生成报告", async () => {
    mockFs.files.set("book/story-map.json", JSON.stringify({
      schemaVersion: 1,
      bookId: "b",
      bookTitle: "测试书",
      mainLineLabel: "成长主线",
      mainSummary: "一路升级",
      createdAt: 1,
      chapters: [{
        id: "ch-0001", order: 1, title: "一", summary: "开篇",
        mainEvents: [{ label: "获得传承", beats: ["a"], characters: [] }],
        branches: [{ id: "b1", kind: "task", label: "任务", triggeredBy: "获得传承", events: [] }],
      }],
    }))
    const engine = makeEngine(() => VERIFY_JSON)
    const report = await engine.runVerification("story", "book", {} as never)
    expect(report.units).toHaveLength(1)
    expect(report.units[0].name).toContain("成长主线")
    expect(mockFs.writes.has("book/verification/story-verification.md")).toBe(true)
  })

  it("LLM 失败时补齐三项 fail，报告结构完整", async () => {
    mockFs.files.set("book/style-profile.json", JSON.stringify({
      constitution: "x", samples: [], sampledChapterIds: [],
    }))
    const engine = makeEngine(() => "输出异常")
    const report = await engine.runVerification("style", "book", {} as never)
    expect(report.units[0].triple).toHaveLength(3)
    expect(report.units[0].triple.every((item) => item.status === "fail")).toBe(true)
    expect(report.units[0].passed).toBe(false)
    expect(report.summary.fail).toBe(1)
  })

  it("style 源文件缺失时返回空报告不抛错", async () => {
    // 不写入 style-profile.json
    const engine = makeEngine(() => VERIFY_JSON)
    const report = await engine.runVerification("style", "book", {} as never)
    expect(report.units).toHaveLength(0)
    expect(report.summary.total).toBe(0)
  })

  it("story 源文件缺失时返回空报告不抛错", async () => {
    const engine = makeEngine(() => VERIFY_JSON)
    const report = await engine.runVerification("story", "book", {} as never)
    expect(report.units).toHaveLength(0)
    expect(report.summary.total).toBe(0)
  })
})

describe("scheduleVerification", () => {
  it("数据缺失时吞异常不抛出（best-effort）", async () => {
    await expect(scheduleVerification("nowhere", "style", {} as never)).resolves.toBeUndefined()
  })
})


describe("后台验证复用与用量回传", () => {
  function cacheFixture() {
    const values = new Map<string, unknown>()
    const stageCache: AnalysisStageCache = {
      createKey: async (input) => JSON.stringify({ stage: input.stage, materials: input.materials, model: input.llmConfig.model }),
      read: async (_input, key) => values.get(key) as never ?? null,
      write: async (_input, key, value) => { values.set(key, value) },
    }
    return { stageCache, values }
  }
  it("有效验证结果重复复用，重新提取、材料变化或模型变化重新校验", async () => {
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "克制", samples: ["原文一"] }))
    const { stageCache } = cacheFixture()
    const onRequestTrace = vi.fn()
    const callModel = vi.fn(async (_messages, _config, _signal, onTrace) => { onTrace?.({ requestId: "verify" }); return JSON.stringify({ ...JSON.parse(VERIFY_JSON), pressure: [...JSON.parse(VERIFY_JSON).pressure, { kind: "confusion", prompt: "辨别相邻风格", verdict: "pass", reason: "边界明确" }] }) })
    const engine = createVerificationEngine({ stageCache, callModel })
    const config = { model: "fixture" } as never
    await engine.runVerification("style", "book", config, { onRequestTrace })
    await engine.runVerification("style", "book", config, { onRequestTrace })
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(onRequestTrace).toHaveBeenCalledWith(expect.objectContaining({ requestId: "verify" }))
    await engine.runVerification("style", "book", config, { forceRefresh: true })
    expect(callModel).toHaveBeenCalledTimes(2)
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "浓烈", samples: ["原文二"] }))
    await engine.runVerification("style", "book", config)
    await engine.runVerification("style", "book", { model: "other" } as never)
    expect(callModel).toHaveBeenCalledTimes(4)
  })
  it("无效输出和取消结果不缓存，不用失败占位结果省掉下一次真实校验", async () => {
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "克制", samples: [] }))
    const { stageCache, values } = cacheFixture()
    const callModel = vi.fn(async () => "无效输出")
    const engine = createVerificationEngine({ stageCache, callModel })
    await engine.runVerification("style", "book", {} as never)
    await engine.runVerification("style", "book", {} as never)
    expect(callModel).toHaveBeenCalledTimes(2)
    expect(values.size).toBe(0)
    const controller = new AbortController(); controller.abort()
    await expect(engine.runVerification("style", "book", {} as never, { signal: controller.signal })).rejects.toThrow("取消")
    expect(callModel).toHaveBeenCalledTimes(2)
  })
})


function completeVerifyRaw(detail: string) {
  return JSON.stringify({
    triple: ["crossDomain", "predictive", "unique"].map((key) => ({ key, status: "fail", detail, evidenceCount: 0 })),
    pressure: ["apply", "boundary", "confusion"].map((kind) => ({ kind, prompt: "场景检验", verdict: "fail", reason: detail })),
  })
}
function memoryStageCache() {
  const values = new Map<string, unknown>()
  const cache: AnalysisStageCache = {
    createKey: async (input) => JSON.stringify(input.materials),
    read: async (_input, key) => values.get(key) as never ?? null,
    write: async (_input, key, value) => { values.set(key, value) },
  }
  return { cache, values }
}

describe("验证缓存和并发报告审查回归", () => {
  it("JSON格式正确但缺必填判定时不缓存，显式fail的完整审计仍可复用", async () => {
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "样本", samples: [] }))
    const { cache, values } = memoryStageCache()
    const incomplete = JSON.stringify({
      triple: ["crossDomain", "predictive", "unique"].map((key) => ({ key })),
      pressure: ["apply", "boundary", "confusion"].map((kind) => ({ kind, prompt: "有场景但没有判定" })),
    })
    const callModel = vi.fn(async () => incomplete)
    const engine = createVerificationEngine({ stageCache: cache, callModel })
    await engine.runVerification("style", "book", {} as never)
    await engine.runVerification("style", "book", {} as never)
    expect(callModel).toHaveBeenCalledTimes(2)
    expect(values.size).toBe(0)
    callModel.mockResolvedValue(completeVerifyRaw("证据不足，明确判定未通过"))
    await engine.runVerification("style", "book", {} as never)
    await engine.runVerification("style", "book", {} as never)
    expect(callModel).toHaveBeenCalledTimes(3)
  })

  it("旧验证阻塞在建目录时，新验证完成后旧报告不能覆盖新的JSON和Markdown", async () => {
    const { cache } = memoryStageCache()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const blocked = new Promise<void>((resolve) => { entered = resolve })
    const createDirectory = vi.fn(async () => {})
    createDirectory.mockImplementationOnce(async () => { entered(); await gate })
    const callModel = vi.fn(async () => completeVerifyRaw("old-result"))
    callModel.mockImplementationOnce(async () => completeVerifyRaw("old-result"))
    callModel.mockImplementationOnce(async () => completeVerifyRaw("new-result"))
    const engine = createVerificationEngine({ stageCache: cache, createDirectory, callModel })
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "旧版", samples: [] }))
    const oldRun = engine.runVerification("style", "book", {} as never)
    await blocked
    mockFs.files.set("book/style-profile.json", JSON.stringify({ constitution: "新版", samples: [] }))
    const newRun = engine.runVerification("style", "book", {} as never)
    await vi.waitFor(() => expect(callModel).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([oldRun, newRun])
    expect(mockFs.writes.get("book/verification/style-verification.json")).toContain("new-result")
    expect(mockFs.writes.get("book/verification/style-verification.md")).toContain("new-result")
    expect(mockFs.writes.get("book/verification/style-verification.json")).not.toContain("old-result")
  })
})
