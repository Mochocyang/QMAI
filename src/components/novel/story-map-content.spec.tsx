// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { StoryMap } from "@/lib/novel/book-analysis/story-map-types"
import { StoryMapContent } from "./book-analysis-library-layout"

const listStoryMapHistory = vi.hoisted(() => vi.fn())
const readFile = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({ readFile }))
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      branches: [],
    })),
  }
}

function renderContent(bookPath: string) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<StoryMapContent bookPath={bookPath} />)
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe("StoryMapContent 历史导图展示", () => {
  it("渲染全部历史导图卡片，最新的在前", async () => {
    listStoryMapHistory.mockResolvedValue([
      {
        dirName: "story-map-100",
        map: makeMap(100, "主线A", [1, 2]),
        jsonPath: "E:/book/story-maps/story-map-100/story-map.json",
        htmlPath: "E:/book/story-maps/story-map-100/story-map.html",
      },
      {
        dirName: "story-map-200",
        map: makeMap(200, "主线B", [3, 4]),
        jsonPath: "E:/book/story-maps/story-map-200/story-map.json",
        htmlPath: "E:/book/story-maps/story-map-200/story-map.html",
      },
    ])
    readFile.mockResolvedValue("<html>map</html>")
    const { container, cleanup } = renderContent("E:/book")
    await act(async () => {})

    const titleNodes = Array.from(container.querySelectorAll("div"))
      .filter((node) => typeof node.className === "string"
        && node.className.includes("truncate")
        && node.className.includes("text-base"))
    const titles = titleNodes.map((node) => node.textContent ?? "")
    expect(titles[0]).toContain("主线：主线B")
    expect(titles[1]).toContain("主线：主线A")

    expect(container.textContent).toContain("《测试作品》故事导图")
    expect(container.textContent).toContain("覆盖第 1～2 章")
    expect(container.textContent).toContain("覆盖第 3～4 章")

    const expandButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("查看全部"))
    expect(expandButtons.length).toBe(2)
    cleanup()
  })

  it("点击「查看全部」展开，再点「收起」恢复预览高度", async () => {
    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-100",
      map: makeMap(100, "主线A", [1]),
      jsonPath: "E:/book/story-maps/story-map-100/story-map.json",
      htmlPath: "E:/book/story-maps/story-map-100/story-map.html",
    }])
    readFile.mockResolvedValue("<html>map</html>")
    const { container, cleanup } = renderContent("E:/book")
    await act(async () => {})

    const expandButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("查看全部")) as HTMLButtonElement
    const iframe = container.querySelector("iframe") as HTMLIFrameElement
    expect(iframe.className).toContain("h-[300px]")

    act(() => expandButton.click())
    expect(iframe.className).toContain("h-[70vh]")
    expect(expandButton.textContent).toContain("收起")

    act(() => expandButton.click())
    expect(iframe.className).toContain("h-[300px]")
    cleanup()
  })

  it("无历史目录时回退展示根目录 story-map.html（旧数据兼容）", async () => {
    listStoryMapHistory.mockResolvedValue([])
    readFile.mockResolvedValue("<html>legacy</html>")
    const { container, cleanup } = renderContent("E:/book")
    await act(async () => {})

    expect(container.textContent).toContain("故事导图")
    expect(container.querySelector("iframe")).not.toBeNull()
    cleanup()
  })

  it("没有任何导图时显示提示文案", async () => {
    listStoryMapHistory.mockResolvedValue([])
    readFile.mockRejectedValue(new Error("missing"))
    const { container, cleanup } = renderContent("E:/book")
    await act(async () => {})

    expect(container.textContent).toContain("尚未提取故事导图")
    cleanup()
  })

  it("refreshKey 变化时重新读取历史导图（故事任务完成后自动刷新）", async () => {
    listStoryMapHistory.mockClear()
    readFile.mockClear()
    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-100",
      map: makeMap(100, "主线A", [1]),
      jsonPath: "E:/book/story-maps/story-map-100/story-map.json",
      htmlPath: "E:/book/story-maps/story-map-100/story-map.html",
    }])
    readFile.mockResolvedValue("<html>map</html>")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<StoryMapContent bookPath="E:/book" refreshKey={0} />)
    })
    await act(async () => {})
    expect(listStoryMapHistory).toHaveBeenCalledTimes(1)

    // 故事任务完成 → 刷新键递增 → 重新读取（新导图立即出现，无需切换页签）
    act(() => {
      root.render(<StoryMapContent bookPath="E:/book" refreshKey={1} />)
    })
    await act(async () => {})
    expect(listStoryMapHistory).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    document.body.removeChild(container)
  })
})
