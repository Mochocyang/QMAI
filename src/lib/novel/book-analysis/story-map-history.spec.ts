import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject, fileExists, readFileRaw } from "@/test-helpers/fs-temp"
import type { StoryMap } from "./story-map-types"
import { listStoryMapHistory, writeStoryMapFiles } from "./story-map-history"

vi.mock("@/commands/fs", () => realFs)

function makeMap(createdAt: number, mainLineLabel: string, orders: number[]): StoryMap {
  return {
    schemaVersion: 1,
    bookId: "book-1",
    bookTitle: "测试作品",
    mainLineLabel,
    mainSummary: "",
    createdAt,
    chapters: orders.map((order) => ({
      id: `ch-${order}`,
      order,
      title: `第${order}章`,
      summary: "摘要",
      mainEvents: [{ label: `主线事件${order}`, beats: [], characters: [] }],
      branches: order % 2 === 0 ? [{ id: `b-${order}`, kind: "foreshadow", label: `伏笔${order}`, triggeredBy: "", events: [] }] : [],
    })),
  }
}

describe("story map history storage", () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const temp = await createTempProject("story-map-history")
    dir = temp.path
    cleanup = temp.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  it("每次生成写入独立历史目录，且根目录保留最新引用", async () => {
    const first = makeMap(100, "主线A", [1, 2])
    const second = makeMap(200, "主线B", [3, 4])

    await writeStoryMapFiles(dir, first)
    await writeStoryMapFiles(dir, second)

    // 历史目录两份，各自保留 json + html
    expect(await fileExists(`${dir}/story-maps/story-map-100/story-map.json`)).toBe(true)
    expect(await fileExists(`${dir}/story-maps/story-map-100/story-map.html`)).toBe(true)
    expect(await fileExists(`${dir}/story-maps/story-map-200/story-map.json`)).toBe(true)
    expect(await fileExists(`${dir}/story-maps/story-map-200/story-map.html`)).toBe(true)

    // 根目录最新引用指向最近一次
    const latest = JSON.parse(await readFileRaw(`${dir}/story-map.json`)) as StoryMap
    expect(latest.createdAt).toBe(200)
    expect(await fileExists(`${dir}/story-map.html`)).toBe(true)
  })

  it("同一毫秒重复生成时自动追加序号，互不覆盖", async () => {
    const a = makeMap(100, "主线A", [1])
    const b = makeMap(100, "主线B", [2])

    await writeStoryMapFiles(dir, a)
    await writeStoryMapFiles(dir, b)

    expect(await fileExists(`${dir}/story-maps/story-map-100/story-map.json`)).toBe(true)
    expect(await fileExists(`${dir}/story-maps/story-map-100-1/story-map.json`)).toBe(true)
    // 根目录最新为后写入那份
    const latest = JSON.parse(await readFileRaw(`${dir}/story-map.json`)) as StoryMap
    expect(latest.mainLineLabel).toBe("主线B")
  })

  it("listStoryMapHistory 按生成时间升序返回全部历史", async () => {
    await writeStoryMapFiles(dir, makeMap(300, "主线C", [7]))
    await writeStoryMapFiles(dir, makeMap(100, "主线A", [1]))
    await writeStoryMapFiles(dir, makeMap(200, "主线B", [4]))

    const history = await listStoryMapHistory(dir)
    expect(history.map((entry) => entry.map.createdAt)).toEqual([100, 200, 300])
    expect(history.map((entry) => entry.map.mainLineLabel)).toEqual(["主线A", "主线B", "主线C"])
    // html 路径存在
    expect(await fileExists(history[0].htmlPath)).toBe(true)
  })

  it("无历史目录时返回空数组", async () => {
    expect(await listStoryMapHistory(dir)).toEqual([])
  })

  it("损坏的历史目录被跳过，不影响其他历史", async () => {
    await writeStoryMapFiles(dir, makeMap(100, "主线A", [1]))
    // 写入一个没有有效 json 的目录
    await realFs.writeFile(`${dir}/story-maps/story-map-500/story-map.json`, "not-json{{")

    const history = await listStoryMapHistory(dir)
    expect(history).toHaveLength(1)
    expect(history[0].map.createdAt).toBe(100)
  })
})
