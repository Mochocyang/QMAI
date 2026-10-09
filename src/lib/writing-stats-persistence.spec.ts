import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
}))

import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import {
  clampDailyTargetChars,
  countProjectChapterWords,
  DAILY_TARGET_CHARS_MAX,
  DAILY_TARGET_CHARS_MIN,
  DEFAULT_DAILY_TARGET_CHARS,
  emptyWritingStatsFile,
  loadWritingStats,
  localDayKey,
  normalizeWritingStatsFile,
  pruneWritingStatsDays,
  saveWritingStats,
  writingStatsChapterKey,
  writingStatsPath,
} from "./writing-stats-persistence"

const mockedReadFile = vi.mocked(readFile)
const mockedFileExists = vi.mocked(fileExists)
const mockedWriteFileAtomic = vi.mocked(writeFileAtomic)
const mockedCreateDirectory = vi.mocked(createDirectory)
const mockedListDirectory = vi.mocked(listDirectory)

function chapterFile(name: string, path = `/proj/wiki/chapters/${name}`) {
  return { name, path, is_dir: false }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("writingStatsPath", () => {
  it("落在项目根的 .novel 下，并容忍多余斜杠", () => {
    expect(writingStatsPath("E:\\Novel\\")).toBe("E:/Novel/.novel/writing-stats.json")
    expect(writingStatsPath("/home/a/b")).toBe("/home/a/b/.novel/writing-stats.json")
  })
})

describe("localDayKey", () => {
  it("按本地时区出 YYYY-MM-DD，不走 UTC", () => {
    // 本地时间 1 月 1 日 00:30 —— 在 UTC+8 会落到上一年的 12 月 31 日
    const local = new Date(2026, 0, 1, 0, 30, 0)
    expect(localDayKey(local)).toBe("2026-01-01")
    expect(localDayKey(new Date(2026, 9, 9, 23, 59, 59))).toBe("2026-10-09")
  })
})

describe("clampDailyTargetChars", () => {
  it("钳到合法区间，NaN 回默认值", () => {
    expect(clampDailyTargetChars(3000)).toBe(3000)
    expect(clampDailyTargetChars(0)).toBe(DAILY_TARGET_CHARS_MIN)
    expect(clampDailyTargetChars(-5)).toBe(DAILY_TARGET_CHARS_MIN)
    expect(clampDailyTargetChars(DAILY_TARGET_CHARS_MAX + 1)).toBe(DAILY_TARGET_CHARS_MAX)
    expect(clampDailyTargetChars(Number.NaN)).toBe(DEFAULT_DAILY_TARGET_CHARS)
    expect(clampDailyTargetChars(2999.6)).toBe(3000)
  })
})

describe("normalizeWritingStatsFile", () => {
  it("全垃圾输入退化成空文件，而不是抛错", () => {
    for (const raw of [null, undefined, 42, "text", [], { days: 5, chapters: "x" }]) {
      expect(normalizeWritingStatsFile(raw)).toEqual(emptyWritingStatsFile())
    }
  })

  it("逐字段校验：坏的一天/一章被丢掉，好的保留", () => {
    const file = normalizeWritingStatsFile({
      version: 999,
      dailyTargetChars: 5000,
      days: {
        "2026-10-09": { humanChars: 100, aiChars: 20 },
        "2026-10-10": { humanChars: -1, aiChars: 20 },
        "2026-10-11": { humanChars: 1.5, aiChars: 20 },
        "2026-10-12": { humanChars: "100", aiChars: 20 },
        "not-a-date": { humanChars: 1, aiChars: 1 },
      },
      chapters: {
        "wiki/chapters/a.md": { len: 10, hash: "abc", rle: "a10" },
        "wiki/chapters/b.md": { len: -1, hash: "abc", rle: "a10" },
        "wiki/chapters/c.md": { len: 10, hash: 5, rle: "a10" },
        "wiki/chapters/d.md": null,
      },
    })

    expect(file.version).toBe(1)
    expect(file.dailyTargetChars).toBe(5000)
    expect(Object.keys(file.days)).toEqual(["2026-10-09"])
    expect(Object.keys(file.chapters)).toEqual(["wiki/chapters/a.md"])
  })

  it("目标字数越界时在读取时就被钳住", () => {
    expect(normalizeWritingStatsFile({ dailyTargetChars: 1 }).dailyTargetChars)
      .toBe(DAILY_TARGET_CHARS_MIN)
    expect(normalizeWritingStatsFile({ dailyTargetChars: 1e9 }).dailyTargetChars)
      .toBe(DAILY_TARGET_CHARS_MAX)
  })

  it("读到超过保留天数的历史时自动裁剪，只留最近的", () => {
    const days: Record<string, { humanChars: number; aiChars: number }> = {}
    // 从 2026-01-01 起连续 100 天，日期必须真实递增，否则排的是字符串
    const start = new Date(2026, 0, 1)
    const keys: string[] = []
    for (let i = 0; i < 100; i += 1) {
      const date = new Date(start.getTime() + i * 86_400_000)
      const key = localDayKey(date)
      keys.push(key)
      days[key] = { humanChars: i, aiChars: 0 }
    }
    const pruned = pruneWritingStatsDays(days, 10)
    expect(Object.keys(pruned)).toHaveLength(10)
    // 留下的是最近的 10 天
    expect(Object.keys(pruned)).toEqual(keys.slice(-10))
  })
})

describe("loadWritingStats / saveWritingStats", () => {
  it("文件不存在时给空文件，不报错", async () => {
    mockedFileExists.mockResolvedValue(false)
    expect(await loadWritingStats("/proj")).toEqual(emptyWritingStatsFile())
  })

  it("JSON 坏掉时给空文件（统计坏了不能挡住写作）", async () => {
    mockedFileExists.mockResolvedValue(true)
    mockedReadFile.mockResolvedValue("{ 这不是 JSON")
    expect(await loadWritingStats("/proj")).toEqual(emptyWritingStatsFile())
  })

  it("读回时走同一套校验", async () => {
    mockedFileExists.mockResolvedValue(true)
    mockedReadFile.mockResolvedValue(JSON.stringify({
      dailyTargetChars: 4000,
      days: { "2026-10-09": { humanChars: 12, aiChars: 34 } },
      chapters: {},
    }))
    const file = await loadWritingStats("/proj")
    expect(file.dailyTargetChars).toBe(4000)
    expect(file.days["2026-10-09"]).toEqual({ humanChars: 12, aiChars: 34 })
  })

  it("保存前先建目录，再原子写盘", async () => {
    mockedCreateDirectory.mockResolvedValue(undefined)
    mockedWriteFileAtomic.mockResolvedValue(undefined)
    await saveWritingStats("/proj/", emptyWritingStatsFile())
    expect(mockedCreateDirectory).toHaveBeenCalledWith("/proj/.novel")
    expect(mockedWriteFileAtomic).toHaveBeenCalledWith(
      "/proj/.novel/writing-stats.json",
      expect.stringContaining('"version": 1'),
    )
  })
})

describe("writingStatsChapterKey", () => {
  it("用相对路径做键，项目整体搬走也不丢账", () => {
    expect(writingStatsChapterKey("E:/Novel", "E:/Novel/wiki/chapters/第1章.md"))
      .toBe("wiki/chapters/第1章.md")
    expect(writingStatsChapterKey("E:\\Novel\\", "E:\\Novel\\wiki\\chapters\\卷1\\第2章.md"))
      .toBe("wiki/chapters/卷1/第2章.md")
  })
})

describe("countProjectChapterWords", () => {
  it("逐章求和，与 countChapterBodyWords 同口径", async () => {
    mockedListDirectory.mockResolvedValue([
      chapterFile("第1章.md"),
      { name: "卷1", path: "/proj/wiki/chapters/卷1", is_dir: true, children: [
        chapterFile("第2章.md", "/proj/wiki/chapters/卷1/第2章.md"),
      ] },
    ])
    mockedReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("第1章.md")) return "---\ntype: chapter\n---\n\n# 第1章\n\n他推开门。\n"
      return "---\ntype: chapter\n---\n\n# 第2章\n\n外面下着雨。\n"
    })

    // 他推开门。= 5 字；外面下着雨。= 6 字
    expect(await countProjectChapterWords("/proj")).toBe(11)
  })

  it("单章读失败按 0 计，不让一个坏文件毁掉整本书的字数", async () => {
    mockedListDirectory.mockResolvedValue([
      chapterFile("a.md"),
      chapterFile("b.md"),
    ])
    mockedReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("a.md")) throw new Error("读取失败")
      return "# 标题\n\n正文三段。\n"
    })
    // 正文三段。= 5 字
    expect(await countProjectChapterWords("/proj")).toBe(5)
  })

  it("还没有 chapters 目录时是 0 字，不是「未知」", async () => {
    mockedListDirectory.mockRejectedValue(new Error("目录不存在"))
    expect(await countProjectChapterWords("/proj")).toBe(0)
  })
})
