import { describe, expect, it } from "vitest"
import {
  EVENT_OUTLINE_MAX_EVENTS,
  EVENT_OUTLINE_MIN_EVENTS,
  extractEventOutlineData,
  normalizeEventOutlineData,
  validateEventOutlineData,
  type EventOutlineData,
  type EventOutlineEvent,
} from "./event-outline"

function event(id: number, title = `事件${id}`) {
  return { id, title, points: ["台词：你来啦", "神情：她手一抖"] }
}

function data(overrides: Partial<EventOutlineData> = {}): EventOutlineData {
  return {
    version: 1,
    chapterNumber: 12,
    title: "第12章 · 令牌初现",
    targetWords: 3000,
    events: [1, 2, 3, 4, 5, 6].map((id) => event(id)),
    endingHook: "令牌上的四个字亮起时，院外传来脚步声。",
    ...overrides,
  }
}

describe("normalizeEventOutlineData", () => {
  it("接受标准的 eventOutlineData 信封", () => {
    const result = normalizeEventOutlineData({ eventOutlineData: data() })
    expect(result?.chapterNumber).toBe(12)
    expect(result?.events).toHaveLength(6)
  })

  it("接受裸对象", () => {
    expect(normalizeEventOutlineData(data())?.title).toBe("第12章 · 令牌初现")
  })

  it("把 id 重排为从 1 起的连续序号", () => {
    const raw = { ...data(), events: [event(7), event(9), event(11), event(13)] }
    expect(normalizeEventOutlineData(raw)?.events.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it("剔除空抓手并去空白", () => {
    const raw = { ...data(), events: [{ id: 1, title: " 开场 ", points: ["   ", "有内容"] }] }
    const result = normalizeEventOutlineData(raw)
    expect(result?.events[0].title).toBe("开场")
    expect(result?.events[0].points).toEqual(["有内容"])
  })

  it("没有任何事件时返回 null", () => {
    expect(normalizeEventOutlineData({ chapterNumber: 3, events: [] })).toBeNull()
  })

  it("空事件槽与有效事件混排时只保留有效事件", () => {
    const result = normalizeEventOutlineData({
      ...data(),
      events: [{ title: "a", points: ["p", "q"] }, {}, null],
    })
    expect(result?.events).toHaveLength(1)
    expect(result?.events[0].id).toBe(1)
    expect(result?.events[0].points).toEqual(["p", "q"])
  })

  it("不吞 chapterOutlineData 这类章节细纲 JSON", () => {
    expect(
      normalizeEventOutlineData({
        chapterOutlineData: { story: {}, chapters: [{ n: 1, events: [{ what: "a", cause: "b" }] }] },
      }),
    ).toBeNull()
  })

  it("能从「约3000字」「第12章」这类带字的文本里读出数字", () => {
    const result = normalizeEventOutlineData({ ...data(), chapterNumber: "第12章", targetWords: "约3000字" })
    expect(result?.chapterNumber).toBe(12)
    expect(result?.targetWords).toBe(3000)
  })

  it("非对象输入返回 null", () => {
    expect(normalizeEventOutlineData("不是对象")).toBeNull()
    expect(normalizeEventOutlineData(null)).toBeNull()
  })
})

describe("validateEventOutlineData", () => {
  it("标准数据通过", () => {
    expect(validateEventOutlineData(data()).ok).toBe(true)
  })

  it("事件数下边界 4 通过，3 拒绝", () => {
    // targetWords 固定在单事件合理区间内，让这条用例只考察事件数这一个边界。
    const boundary = Array.from({ length: EVENT_OUTLINE_MIN_EVENTS }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ targetWords: 1200, events: boundary })).ok).toBe(true)
    const tooFew = validateEventOutlineData(
      data({ targetWords: 1200, events: boundary.slice(0, EVENT_OUTLINE_MIN_EVENTS - 1) }),
    )
    expect(tooFew.ok).toBe(false)
    expect(tooFew.problems.join("\n")).toContain(`事件数为 ${EVENT_OUTLINE_MIN_EVENTS - 1}`)
  })

  it("事件数上边界 8 通过，9 拒绝", () => {
    const eight = Array.from({ length: EVENT_OUTLINE_MAX_EVENTS }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ events: eight })).ok).toBe(true)
    const nine = Array.from({ length: 9 }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ events: nine })).ok).toBe(false)
  })

  it("id 不连续时报错", () => {
    const broken = data({ events: [event(1), event(3), event(4), event(5)] })
    expect(validateEventOutlineData(broken).problems.join("\n")).toContain("序号")
  })

  it("缺结尾钩子报错", () => {
    expect(validateEventOutlineData(data({ endingHook: "   " })).problems.join("\n")).toContain("结尾钩子")
  })

  it("整份缺 endingHook 时不抛异常，仍给出缺钩子的问题", () => {
    const raw: Record<string, unknown> = { ...data() }
    delete raw.endingHook
    const result = validateEventOutlineData(raw as unknown as EventOutlineData)
    expect(result.problems.join("\n")).toContain("结尾钩子")
  })

  it("缺目标字数或目标字数为 0 时报错", () => {
    const zero = validateEventOutlineData(data({ targetWords: 0 }))
    expect(zero.ok).toBe(false)
    expect(zero.problems.join("\n")).toContain("targetWords")
    const missing = validateEventOutlineData({ ...data(), targetWords: undefined } as unknown as EventOutlineData)
    expect(missing.ok).toBe(false)
    expect(missing.problems.join("\n")).toContain("targetWords")
  })

  it("缺目标章号时报错而不抛异常", () => {
    // 与 targetWords 同一口径：整份缺字段（undefined）也要算缺章号。
    const raw: Record<string, unknown> = { ...data() }
    delete raw.chapterNumber
    const result = validateEventOutlineData(raw as unknown as EventOutlineData)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("章号")
  })

  it("抓手少于 2 条报错", () => {
    const thin = data({ events: [{ id: 1, title: "开场", points: ["只有一条"] }, event(2), event(3), event(4)] })
    expect(validateEventOutlineData(thin).problems.join("\n")).toContain("抓手")
  })

  it("抓手超过 5 条报错", () => {
    const fat = {
      id: 1,
      title: "开场",
      points: ["一", "二", "三", "四", "五", "六"],
    }
    const result = validateEventOutlineData(data({ events: [fat, event(2), event(3), event(4)] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("细节抓手为 6 条")
  })

  it("抓手不是列表时给出真实问题且不抛异常", () => {
    const stringPoints = { id: 1, title: "开场", points: "x" } as unknown as EventOutlineEvent
    const result = validateEventOutlineData(data({ events: [stringPoints, event(2), event(3), event(4)] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("细节抓手不是列表")
    // 不能说成「1 条，应有 2~5 条」——那会让人以为只要再加一条。
    expect(result.problems.join("\n")).not.toContain("1 条，应有")
  })

  it("标题过长报错", () => {
    const long = data({ events: [event(1, "这是一个被写得太长以至于超过了二十四个字上限的事件标题用来触发校验"), event(2), event(3), event(4)] })
    expect(validateEventOutlineData(long).problems.join("\n")).toContain("超过 24 字")
  })

  it("标题恰好 24 字通过", () => {
    const exact = "甲".repeat(24)
    expect(exact.length).toBe(24)
    const result = validateEventOutlineData(data({ events: [event(1, exact), event(2), event(3), event(4)] }))
    expect(result.ok).toBe(true)
  })

  it("字数分配超出参考区间时只给提示，不阻断（targetWords 4000 / 4 个事件）", () => {
    const result = validateEventOutlineData(
      data({ targetWords: 4000, events: [1, 2, 3, 4].map((id) => event(id)) }),
    )
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.advisories.join("\n")).toContain("每个事件约 1000 字")
  })

  it("单事件字数过低时只给提示，不阻断（300 字 8 个事件）", () => {
    const eight = Array.from({ length: 8 }, (_, i) => event(i + 1))
    const result = validateEventOutlineData(data({ targetWords: 300, events: eight }))
    expect(result.advisories.join("\n")).toContain("每个事件")
    expect(result.ok).toBe(true)
  })

  it("数据为 null 时报错而不抛异常", () => {
    const result = validateEventOutlineData(null)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.advisories).toEqual([])
  })

  it("结构不完整的对象不抛异常，只返回问题清单", () => {
    const empty = validateEventOutlineData({} as EventOutlineData)
    expect(empty.ok).toBe(false)
    expect(empty.advisories).toEqual([])
    const brokenEvent = validateEventOutlineData({ events: [null] } as unknown as EventOutlineData)
    expect(brokenEvent.ok).toBe(false)
    expect(brokenEvent.problems.join("\n")).toContain("不是对象")
  })
})

describe("extractEventOutlineData", () => {
  const payload = JSON.stringify({
    eventOutlineData: {
      version: 1,
      chapterNumber: 12,
      title: "第12章 · 令牌初现",
      targetWords: 3000,
      events: [1, 2, 3, 4].map((id) => event(id)),
      endingHook: "院外传来脚步声。",
    },
  })

  it("从 ```json 围栏里取出数据", () => {
    const content = `## 第12章事件细纲\n\n正文说明\n\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("从没有语言标记的围栏里取出数据", () => {
    const content = `说明\n\n\`\`\`\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.chapterNumber).toBe(12)
  })

  it("从裸对象里取出数据", () => {
    expect(extractEventOutlineData(`前文\n${payload}\n后文`)?.title).toBe("第12章 · 令牌初现")
  })

  it("跳过不是事件细纲的 JSON 围栏", () => {
    const other = JSON.stringify({ outlineSaveRequest: { fileName: "x.md" } })
    const content = `\`\`\`json\n${other}\n\`\`\`\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("没有数据时返回 null", () => {
    expect(extractEventOutlineData("只有正文，没有结构化数据")).toBeNull()
  })

  it("不把章纲（chapterOutlineData）误当事件细纲", () => {
    const chapterOutline = JSON.stringify({
      chapterOutlineData: { title: "章纲", story: {}, chapters: [{ n: 1, events: [{ what: "a", cause: "b" }] }] },
    })
    expect(extractEventOutlineData(`\`\`\`json\n${chapterOutline}\n\`\`\``)).toBeNull()
  })

  it("围栏内 JSON 非法时继续尝试下一个围栏", () => {
    const content = `\`\`\`json\n{ 这不是合法 JSON\n\`\`\`\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("JSON 字符串里的花括号不会提前截断对象", () => {
    const tricky = JSON.stringify({
      eventOutlineData: {
        version: 1, chapterNumber: 3, title: "第3章 · 带 } 的标题", targetWords: 3000,
        events: [{ id: 1, title: '引号"与}与反斜杠\\', points: ["a", "b"] }],
        endingHook: "钩子 }\\",
      },
    })
    expect(extractEventOutlineData(`\`\`\`json\n${tricky}\n\`\`\``)?.events).toHaveLength(1)
  })
})
