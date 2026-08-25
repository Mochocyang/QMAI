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
    callModel: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      const user = messages.find((message) => message.role === "user")
      return callModel(user?.content ?? "")
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
