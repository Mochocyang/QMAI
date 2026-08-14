import { beforeEach, describe, expect, it, vi } from "vitest"

const memStore = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    const content = memStore.get(path)
    if (content == null) throw new Error("missing")
    return content
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    memStore.set(path, content)
  }),
}))

import {
  getTimelineEvents,
  mergeSnapshotTimeline,
  rebuildTimelineFromSnapshots,
  replaceChapterTimelineEntries,
  timelineEntriesFromSnapshots,
} from "./timeline"

const projectPath = "E:/Novel"
const timelinePath = "E:/Novel/.novel/timeline.json"

beforeEach(() => {
  memStore.clear()
})

describe("replaceChapterTimelineEntries", () => {
  it("replaces the chapter instead of appending reworded events", () => {
    const existing = [
      { chapterNumber: 239, event: "先遣队抵达边境" },
      { chapterNumber: 240, event: "当日晚，三处数据链直通节点完成首轮通联测试。" },
      { chapterNumber: 240, event: "协议落地后第三天，A-50第一次进入叙利亚空域。" },
    ]

    const next = replaceChapterTimelineEntries(existing, 240, [
      "数据链通联测试完成",
      "A-50首次进入叙利亚空域",
    ])

    expect(next).toEqual([
      { chapterNumber: 239, event: "先遣队抵达边境" },
      { chapterNumber: 240, event: "数据链通联测试完成" },
      { chapterNumber: 240, event: "A-50首次进入叙利亚空域" },
    ])
  })

  it("clears the chapter when the new extract has no timeline events", () => {
    const existing = [
      { chapterNumber: 1, event: "开场" },
      { chapterNumber: 2, event: "旧事件" },
    ]
    expect(replaceChapterTimelineEntries(existing, 2, [])).toEqual([
      { chapterNumber: 1, event: "开场" },
    ])
  })

  it("drops blank and duplicate events from the same extract", () => {
    const next = replaceChapterTimelineEntries([], 3, [
      "  进城  ",
      "",
      "进城",
      "开战",
    ])
    expect(next).toEqual([
      { chapterNumber: 3, event: "进城" },
      { chapterNumber: 3, event: "开战" },
    ])
  })
})

describe("timelineEntriesFromSnapshots", () => {
  it("rebuilds the full timeline from current snapshots", () => {
    const entries = timelineEntriesFromSnapshots([
      { chapterNumber: 1, timelineEvents: ["开场", "开场"] },
      { chapterNumber: 2, timelineEvents: ["  进城  ", ""] },
    ])
    expect(entries).toEqual([
      { chapterNumber: 1, event: "开场" },
      { chapterNumber: 2, event: "进城" },
    ])
  })
})

describe("mergeSnapshotTimeline", () => {
  it("overwrites the same chapter on reextract instead of appending", async () => {
    memStore.set(timelinePath, JSON.stringify({
      version: 1,
      serial: 2,
      updatedAt: "",
      entries: [
        { chapterNumber: 240, event: "当日晚，三处数据链直通节点完成首轮通联测试。" },
        { chapterNumber: 240, event: "协议落地后第三天，A-50第一次进入叙利亚空域。" },
      ],
    }))

    await mergeSnapshotTimeline(projectPath, 240, [
      "数据链通联测试完成",
      "A-50首次进入叙利亚空域",
    ])

    const events = await getTimelineEvents(projectPath)
    expect(events).toEqual([
      { chapterNumber: 240, event: "数据链通联测试完成" },
      { chapterNumber: 240, event: "A-50首次进入叙利亚空域" },
    ])
  })
})

describe("rebuildTimelineFromSnapshots", () => {
  it("drops stale chapter events that are no longer in snapshots", async () => {
    memStore.set(timelinePath, JSON.stringify({
      version: 1,
      serial: 3,
      updatedAt: "",
      entries: [
        { chapterNumber: 1, event: "旧开场" },
        { chapterNumber: 240, event: "旧通联测试" },
        { chapterNumber: 240, event: "新通联测试" },
      ],
    }))

    await rebuildTimelineFromSnapshots(projectPath, [
      { chapterNumber: 1, timelineEvents: ["开场"] },
      { chapterNumber: 240, timelineEvents: ["数据链通联测试完成"] },
    ])

    expect(await getTimelineEvents(projectPath)).toEqual([
      { chapterNumber: 1, event: "开场" },
      { chapterNumber: 240, event: "数据链通联测试完成" },
    ])
  })
})
