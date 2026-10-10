import { describe, expect, it } from "vitest"
import {
  EVENT_OUTLINE_MAX_EVENTS,
  EVENT_OUTLINE_MIN_EVENTS,
  normalizeEventOutlineData,
  validateEventOutlineData,
  type EventOutlineData,
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
    expect(validateEventOutlineData(data({ events: [1, 2, 3, 4].map((id) => event(id)) })).ok).toBe(true)
    const tooFew = validateEventOutlineData(data({ events: [1, 2, 3].map((id) => event(id)) }))
    expect(tooFew.ok).toBe(false)
    expect(tooFew.problems.join("\n")).toContain(`${EVENT_OUTLINE_MIN_EVENTS}`)
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

  it("抓手少于 2 条报错", () => {
    const thin = data({ events: [{ id: 1, title: "开场", points: ["只有一条"] }, event(2), event(3), event(4)] })
    expect(validateEventOutlineData(thin).problems.join("\n")).toContain("抓手")
  })

  it("标题过长报错", () => {
    const long = data({ events: [event(1, "这是一个被写得太长以至于超过了二十四个字上限的事件标题用来触发校验"), event(2), event(3), event(4)] })
    expect(validateEventOutlineData(long).problems.join("\n")).toContain("24")
  })

  it("单事件字数过低时报错（300 字 8 个事件）", () => {
    const eight = Array.from({ length: 8 }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ targetWords: 300, events: eight })).problems.join("\n")).toContain("每个事件")
  })

  it("数据为 null 时报错而不抛异常", () => {
    const result = validateEventOutlineData(null)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
  })
})
