import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
}))

import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { useWritingStatsStore, writingDayTotal } from "./writing-stats-store"
import { localDayKey } from "@/lib/writing-stats-persistence"

const mockedFileExists = vi.mocked(fileExists)
const mockedReadFile = vi.mocked(readFile)
const mockedWriteFileAtomic = vi.mocked(writeFileAtomic)

const PROJECT = "E:/Novel"
const CHAPTER = "E:/Novel/wiki/chapters/第1章.md"

function markdown(body: string, title = "第1章 试炼"): string {
  return `---\ntype: chapter\n---\n\n# ${title}\n\n${body}\n`
}

/** 直接读状态，绕过 React。 */
const stats = () => useWritingStatsStore.getState()

async function openProject(file: unknown = null) {
  if (file === null) {
    mockedFileExists.mockResolvedValue(false)
  } else {
    mockedFileExists.mockResolvedValue(true)
    mockedReadFile.mockResolvedValue(JSON.stringify(file))
  }
  await stats().initializeProject(PROJECT)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  stats().reset()
  mockedWriteFileAtomic.mockResolvedValue(undefined)
})

describe("initializeProject", () => {
  it("没有统计文件时从零开始，目标为默认值", async () => {
    await openProject()
    expect(stats().humanChars).toBe(0)
    expect(stats().aiChars).toBe(0)
    expect(stats().dailyTargetChars).toBe(3000)
    expect(stats().hydrated).toBe(true)
  })

  it("读取当天已有数字，并把今日从历史里摘出来（避免 flush 时重复计）", async () => {
    const today = localDayKey()
    await openProject({
      dailyTargetChars: 5000,
      days: {
        [today]: { humanChars: 111, aiChars: 222 },
        "2020-01-01": { humanChars: 7, aiChars: 8 },
      },
      chapters: {},
    })
    expect(stats().humanChars).toBe(111)
    expect(stats().aiChars).toBe(222)
    expect(stats().dailyTargetChars).toBe(5000)
    expect(stats().days[today]).toBeUndefined()
    expect(stats().days["2020-01-01"]).toEqual({ humanChars: 7, aiChars: 8 })
  })
})

describe("primeChapter — 打基线不计账", () => {
  it("打开一本老书不会把已有正文算成今天手写的", async () => {
    await openProject()
    stats().primeChapter(CHAPTER, markdown("这是很久以前就写好的三十万字里的一段。"))
    expect(stats().humanChars).toBe(0)
    expect(stats().aiChars).toBe(0)
    expect(stats().provenance["wiki/chapters/第1章.md"]?.sources.every((s) => s === "unknown"))
      .toBe(true)
  })

  it("打基线后打字只算新敲的那些字", async () => {
    await openProject()
    stats().primeChapter(CHAPTER, markdown("旧正文。"))
    stats().recordChapter(CHAPTER, markdown("旧正文。新写的四个字"), "human")
    expect(stats().humanChars).toBe("新写的四个字".length)
  })

  it("能按落盘摘要恢复上一会话的归属：AI 旧稿在手写后删掉，只扣 AI", async () => {
    // 上一会话：整章 AI 生成
    await openProject()
    stats().recordChapter(CHAPTER, markdown("斗气分九段。"), "ai")
    await stats().flush()
    const saved = JSON.parse(mockedWriteFileAtomic.mock.calls[0]![1] as string)

    // 新会话：重新载入
    stats().reset()
    await openProject(saved)
    stats().primeChapter(CHAPTER, markdown("斗气分九段。"))
    const entry = stats().provenance["wiki/chapters/第1章.md"]
    expect(entry?.sources).toEqual(new Array("斗气分九段。".length).fill("ai"))

    // 删掉 AI 那段：只扣 AI
    stats().recordChapter(CHAPTER, markdown(""), "human")
    expect(stats().aiChars).toBe(0)
    expect(stats().humanChars).toBe(0)
  })

  it("磁盘上的正文与摘要对不上时重打基线，不硬凑归属", async () => {
    await openProject({
      days: {},
      chapters: {
        "wiki/chapters/第1章.md": { len: 6, hash: "deadbeef", rle: "a6" },
      },
    })
    stats().primeChapter(CHAPTER, markdown("完全不同的另一段正文。"))
    expect(stats().provenance["wiki/chapters/第1章.md"]?.sources.every((s) => s === "unknown"))
      .toBe(true)
  })
})

describe("recordChapter — AI 与手写分开记账", () => {
  it("AI 整章生成时全部记到 AI（新章没有基线也要记）", async () => {
    await openProject()
    const body = "斗气大陆，斗气分九段。萧炎曾是天才，后跌为废物。"
    stats().recordChapter(CHAPTER, markdown(body), "ai")
    expect(stats().aiChars).toBe(body.length)
    expect(stats().humanChars).toBe(0)
  })

  it("AI 覆盖一份已有旧稿时只把换掉的字算今天产出，绝不整份算成新写的", async () => {
    await openProject()
    const oldBody = "斗气大陆，斗气分九段。萧炎曾是天才，后跌为废物。"
    const newBody = "斗气大陆，斗气分十段。萧炎曾是天才，后沦为废物。"
    // 关键前提：这一章在内存里没有账本（用户没打开过），落盘摘要也因为
    // 内容变了而校验不过 —— 这正是批量去 AI 味时绝大多数章节的处境。
    stats().recordChapter(CHAPTER, markdown(newBody), "ai", markdown(oldBody))

    // 整份旧稿 23 字，其中只有少数几个字被换掉，不能全算今天写的。
    expect(stats().aiChars).toBeGreaterThan(0)
    expect(stats().aiChars).toBeLessThan(oldBody.length)
    // 旧正文一律按 unknown 打基线：既不进 AI 也不进手写。
    expect(stats().humanChars).toBe(0)
  })

  it("批量覆盖 30 章不会把「今日 AI 生成」顶成几十万字（回归：曾整章累加）", async () => {
    await openProject()
    const body = "斗气大陆，斗气分九段。萧炎曾是天才，后跌为废物。"
    for (let i = 1; i <= 30; i += 1) {
      const path = `E:/Novel/wiki/chapters/第${i}章.md`
      // 内容一字未改地重写一遍 —— 最极端的「原样覆盖」。
      stats().recordChapter(path, markdown(body), "ai", markdown(body))
    }
    expect(stats().aiChars).toBe(0)
  })

  it("同一章被 AI 反复重写不会线性累加（第二次改写只算第二次的差额）", async () => {
    await openProject()
    const v1 = "斗气分九段。"
    const v2 = "斗气分十段。"
    const v3 = "斗气分十一段。"
    stats().recordChapter(CHAPTER, markdown(v2), "ai", markdown(v1))
    const afterFirst = stats().aiChars
    expect(afterFirst).toBeGreaterThan(0)
    // 第二次：账本已在内存里，走差分，只算这一次真正换掉的字。
    stats().recordChapter(CHAPTER, markdown(v3), "ai", markdown(v2))
    expect(stats().aiChars).toBe(afterFirst + 1)
  })

  it("旧正文交给记账层后，此后用户手写的字仍然只算他敲的那些", async () => {
    await openProject()
    const oldBody = "斗气大陆，斗气分九段。"
    const newBody = "斗气大陆，斗气分十段。"
    stats().recordChapter(CHAPTER, markdown(newBody), "ai", markdown(oldBody))
    const aiAfterRewrite = stats().aiChars
    stats().recordChapter(CHAPTER, markdown(`${newBody}他忽然笑了。`), "human")
    expect(stats().humanChars).toBe("他忽然笑了。".length)
    expect(stats().aiChars).toBe(aiAfterRewrite)
  })

  it("手写与 AI 混排时各记各的，合计等于正文字数", async () => {
    await openProject()
    const aiBody = "斗气分九段。"
    stats().recordChapter(CHAPTER, markdown(aiBody), "ai")
    stats().recordChapter(CHAPTER, markdown(`${aiBody}他忽然笑了。`), "human")
    expect(stats().aiChars).toBe(aiBody.length)
    expect(stats().humanChars).toBe("他忽然笑了。".length)
    expect(stats().aiChars + stats().humanChars).toBe(`${aiBody}他忽然笑了。`.length)
  })

  it("删除从对应那一栏扣减，扣到 0 就不再变负", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("斗气分九段。"), "ai")
    stats().recordChapter(CHAPTER, markdown("斗气分九段。"), "ai")
    // 删掉 AI 内容
    stats().recordChapter(CHAPTER, markdown(""), "human")
    expect(stats().aiChars).toBe(0)
    expect(stats().humanChars).toBe(0)
  })

  it("改标题 / 动 frontmatter 不计入任何一栏", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("他推开门。", "第1章 试炼"), "human")
    const before = stats().humanChars
    stats().recordChapter(CHAPTER, markdown("他推开门。", "第1章 改名了很长很长"), "human")
    stats().recordChapter(
      CHAPTER,
      "---\ntype: chapter\nchapter_number: 1\nstatus: final\n---\n\n# 第1章 改名了很长很长\n\n他推开门。\n",
      "human",
    )
    expect(stats().humanChars).toBe(before)
  })

  it("首次见到且来源不是 AI 时只打基线、不计账", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("打开就存在的旧正文。"), "human")
    expect(stats().humanChars).toBe(0)
    expect(stats().provenance["wiki/chapters/第1章.md"]?.sources.every((s) => s === "unknown"))
      .toBe(true)
  })

  it("外部同步来源（unknown）既不进手写也不进 AI", async () => {
    await openProject()
    stats().primeChapter(CHAPTER, markdown("旧正文。"))
    stats().recordChapter(CHAPTER, markdown("旧正文。外部工具塞进来的一段。"), "unknown")
    expect(stats().humanChars).toBe(0)
    expect(stats().aiChars).toBe(0)
  })

  it("项目未初始化时记账是空操作，不抛错", () => {
    expect(() => stats().recordChapter(CHAPTER, markdown("x"), "human")).not.toThrow()
    expect(stats().humanChars).toBe(0)
  })
})

describe("跨天", () => {
  it("日期变化时昨日归档、今日归零", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("今天写的一句。"), "ai")
    expect(stats().aiChars).toBe("今天写的一句。".length)

    // 把系统时间推到明天
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    vi.useFakeTimers()
    vi.setSystemTime(tomorrow)
    try {
      stats().recordChapter(CHAPTER, markdown("今天写的一句。明天又加一句"), "human")
      expect(stats().humanChars).toBe("明天又加一句".length)
      expect(stats().aiChars).toBe(0)
      // 昨天的数字被归档，没丢
      const yesterdayKey = Object.keys(stats().days)[0]
      expect(stats().days[yesterdayKey!]?.aiChars).toBe("今天写的一句。".length)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("setDailyTarget 与 flush", () => {
  it("目标字数被钳到合法区间", async () => {
    await openProject()
    stats().setDailyTarget(0)
    expect(stats().dailyTargetChars).toBe(100)
    stats().setDailyTarget(1e9)
    expect(stats().dailyTargetChars).toBe(100_000)
    stats().setDailyTarget(2500)
    expect(stats().dailyTargetChars).toBe(2500)
  })

  it("flush 把今日数字并入 days 后落盘，且章节摘要带长度/哈希/游程", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("斗气分九段。"), "ai")
    await stats().flush()

    const written = JSON.parse(mockedWriteFileAtomic.mock.calls.at(-1)![1] as string)
    expect(written.days[localDayKey()]).toEqual({
      humanChars: 0,
      aiChars: "斗气分九段。".length,
    })
    const entry = written.chapters["wiki/chapters/第1章.md"]
    expect(entry.len).toBe("斗气分九段。".length)
    expect(typeof entry.hash).toBe("string")
    expect(entry.rle).toBe(`a${"斗气分九段。".length}`)
  })

  it("落盘的摘要能被下一次会话原样恢复（往返等价）", async () => {
    await openProject()
    stats().recordChapter(CHAPTER, markdown("斗气分九段。"), "ai")
    stats().recordChapter(CHAPTER, markdown("斗气分九段。他忽然笑了。"), "human")
    await stats().flush()
    const saved = JSON.parse(mockedWriteFileAtomic.mock.calls.at(-1)![1] as string)

    stats().reset()
    await openProject(saved)
    stats().primeChapter(CHAPTER, markdown("斗气分九段。他忽然笑了。"))
    const restored = stats().provenance["wiki/chapters/第1章.md"]!
    expect(restored.sources).toEqual([
      ...new Array("斗气分九段。".length).fill("ai"),
      ...new Array("他忽然笑了。".length).fill("human"),
    ])
  })

  it("未初始化项目时 flush 不写盘", async () => {
    await stats().flush()
    expect(mockedWriteFileAtomic).not.toHaveBeenCalled()
  })

  it("打字不会每一下都写盘：节流到 2.5s 后只落一次盘", async () => {
    await openProject()
    vi.useFakeTimers()
    try {
      const node = "E:/Novel/wiki/chapters/第1章.md"
      let body = "雨停了。"
      for (const char of "他推开门。") {
        body += char
        stats().recordChapter(node, markdown(body), "human")
      }
      // 连打 5 个字，一次盘都没写
      expect(mockedWriteFileAtomic).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2499)
      expect(mockedWriteFileAtomic).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockedWriteFileAtomic).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("writingDayTotal", () => {
  it("今日合计 = 手写 + AI", () => {
    expect(writingDayTotal({ humanChars: 3, aiChars: 4 })).toBe(7)
    expect(writingDayTotal(undefined)).toBe(0)
  })
})
