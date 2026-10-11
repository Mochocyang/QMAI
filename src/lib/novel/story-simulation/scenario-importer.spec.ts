import { beforeEach, describe, expect, it, vi } from "vitest"
import { writeFileAtomic, listDirectory, fileExists } from "@/commands/fs"
import {
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  type ScenarioMessage,
  type ScenarioSession,
} from "./scenario-types"
import {
  buildScenarioChapterBody,
  importScenarioToChapter,
} from "./scenario-importer"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async () => {}),
  fileExists: vi.fn(async () => false),
  listDirectory: vi.fn(async () => []),
  readFile: vi.fn(async () => ""),
}))

const mockWrite = vi.mocked(writeFileAtomic)
const mockList = vi.mocked(listDirectory)
const mockExists = vi.mocked(fileExists)

function msg(over: Partial<ScenarioMessage>): ScenarioMessage {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "character",
    speakerId: "甲",
    speakerName: "甲",
    round: 1,
    content: "我认为……",
    timestamp: "2026-10-11T00:00:00.000Z",
    ...over,
  }
}

const session: ScenarioSession = {
  id: "scenario-1",
  title: "论中庸",
  setup: {
    id: "scenario-1",
    title: "论中庸",
    rules: {
      directive: "生成一场关于《中庸》的辩论",
      scene: "在书院讲堂",
      reference: "《中庸》",
    },
    format: "debate",
    rounds: 2,
    participants: [
      {
        id: SCENARIO_MODERATOR_USER_ID,
        name: SCENARIO_MODERATOR_USER_NAME,
        isModerator: true,
      },
      { id: "甲", name: "甲", isModerator: false },
      { id: "乙", name: "乙", isModerator: false },
    ],
    sourceChapters: 4,
    createdAt: "2026-10-11T00:00:00.000Z",
  },
  messages: [
    msg({
      kind: "moderator",
      speakerId: SCENARIO_MODERATOR_USER_ID,
      speakerName: SCENARIO_MODERATOR_USER_NAME,
      round: 0,
      content: "今日辩题：《中庸》",
    }),
    msg({ speakerName: "甲", round: 1, content: "天命之谓性。" }),
    msg({ kind: "user", speakerId: "user", speakerName: "作者", round: 2, content: "请聚焦于「诚」。" }),
    msg({ kind: "system", speakerId: "system", speakerName: "系统", round: 2, content: "场景切换" }),
  ],
  status: "completed",
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
}

beforeEach(() => {
  mockWrite.mockClear()
  mockList.mockReset()
  mockList.mockResolvedValue([])
  mockExists.mockReset()
  mockExists.mockResolvedValue(false)
})

describe("buildScenarioChapterBody", () => {
  it("输出元信息与脚本式对白", () => {
    const body = buildScenarioChapterBody(session)
    expect(body).toContain("舞台情景：论中庸（辩论）")
    expect(body).toContain("参考点：《中庸》")
    expect(body).toContain("情景：在书院讲堂")
    expect(body).toContain(`主持人·${SCENARIO_MODERATOR_USER_NAME}：今日辩题：《中庸》`)
    expect(body).toContain("甲：天命之谓性。")
    expect(body).toContain("作者（主持人）：请聚焦于「诚」。")
    expect(body).toContain("（场景切换）")
  })

  it("无对话时给出占位说明", () => {
    const body = buildScenarioChapterBody({ ...session, messages: [] })
    expect(body).toContain("本场情景没有对话内容")
  })
})

describe("importScenarioToChapter", () => {
  it("写出带 frontmatter 的章节草稿并返回章节号", async () => {
    const result = await importScenarioToChapter("D:/book", session)
    expect(result.chapterNumber).toBe(1)
    expect(result.backedUp).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    const [path, content] = mockWrite.mock.calls[0] as unknown as [string, string]
    expect(path.replace(/\\/g, "/")).toContain("wiki/chapters/chapter-001.md")
    expect(content).toContain("type: chapter")
    expect(content).toContain("chapter_number: 1")
    expect(content).toContain("chapter_status: draft")
    expect(content).toContain("source: stage-scenario")
    expect(content).toContain('scenario_id: "scenario-1"')
    expect(content).toContain("# 第1章 论中庸")
  })

  it("章节文件已存在且未开启覆盖时抛错", async () => {
    mockExists.mockResolvedValue(true)
    await expect(
      importScenarioToChapter("D:/book", session),
    ).rejects.toThrow(/已存在/)
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
