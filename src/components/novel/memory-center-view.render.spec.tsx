// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MemoryCenterData, MemoryCenterSnapshotCard } from "@/lib/novel/memory-center"
import { useWikiStore } from "@/stores/wiki-store"

const hoisted = vi.hoisted(() => ({
  loadMemoryCenterData: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: hoisted.readFile,
  writeFile: hoisted.writeFile,
  deleteFile: hoisted.deleteFile,
}))
vi.mock("@/lib/novel/memory-center", () => ({
  loadMemoryCenterData: hoisted.loadMemoryCenterData,
}))
vi.mock("@/components/editor/wiki-reader", () => ({
  WikiReader: ({ body }: { body: string }) => <div data-testid="wiki-reader">{body}</div>,
}))

import { MemoryCenterView } from "./memory-center-view"
// 用真实 i18n 初始化，标签就按用户看到的中文断言；否则 t() 只会回显键名，
// 「统计条写的是快照总数」这类断言就变成在比较键名，失去意义。
import "@/i18n"

let host: HTMLDivElement
let root: Root

const PROJECT = { id: "p1", name: "测试小说", path: "E:/Novel" }

function makeCard(chapterNumber: number, chapterTitle?: string): MemoryCenterSnapshotCard {
  return {
    chapterNumber,
    chapterTitle,
    summary: `摘要 ${chapterNumber}`,
    endingHook: "",
    memorySynced: false,
    snapshotPath: `.novel/snapshots/${chapterNumber}.snapshot.json`,
    characterStateChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges: [],
    timelineEvents: [],
    hasMoreCharacterStateChanges: false,
    hasMoreKnowledgeChanges: false,
    hasMoreForeshadowingChanges: false,
    hasMoreTimelineEvents: false,
  }
}

function makeData(): MemoryCenterData {
  return {
    stats: {
      // 章节+大纲总数，故意与「章节快照」标签的条数不同，用来钉住不能混用
      snapshotCount: 5,
      syncedSnapshotCount: 2,
      characterCount: 3,
      activeForeshadowingCount: 1,
      memoryFileCount: 1,
    },
    snapshots: [makeCard(4), makeCard(2), makeCard(-7, "总大纲"), makeCard(-3, "人物小传"), makeCard(-9, "力量体系")],
    allChapterNumbers: [4, 2],
    files: [
      {
        key: "character-states",
        title: "character-states",
        path: "E:/Novel/wiki/memory/character-states.md",
        sections: [{ title: "主角", items: ["许七安：警觉"], groups: [] }],
      },
    ],
    dismantlingProjects: [],
  }
}

async function render() {
  await act(async () => { root.render(<MemoryCenterView />) })
  // loadMemoryCenterData 是异步的，等它落地
  await act(async () => { await Promise.resolve() })
}

const tabs = () =>
  [...host.querySelectorAll<HTMLElement>('[data-ui="memory-tab"]')]

const tabByLabel = (label: string) =>
  tabs().find((tab) => tab.textContent?.includes(label))

async function clickTab(label: string) {
  const tab = tabByLabel(label)
  expect(tab, `标签「${label}」应当存在`).toBeTruthy()
  await act(async () => { tab!.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  useWikiStore.setState({ project: PROJECT })
  hoisted.loadMemoryCenterData.mockResolvedValue(makeData())
  hoisted.readFile.mockImplementation(async (path: string) => `# ${path}\n\n正文内容`)
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("记忆中心：单页结构", () => {
  it("渲染 8 个标签，顺序为两类快照在前、6 个记忆文件在后", async () => {
    await render()
    expect(tabs().map((tab) => tab.getAttribute("data-tab-key"))).toEqual([
      "snapshots",
      "outline-snapshots",
      "character-states",
      "character-cognition",
      "foreshadowing-tracker",
      "timeline",
      "canon-facts",
      "conflicts",
    ])
  })

  it("不再渲染中间栏式的分类列表，也没有「先选一个项目」的占位", async () => {
    await render()
    expect(host.textContent).not.toContain("请先从左侧记忆列表选择一个项目")
    expect(host.querySelectorAll("button").length).toBeGreaterThan(0)
  })

  it("每个标签都带计数，且两种快照的计数各算各的", async () => {
    await render()
    // 章节快照 2 条、大纲快照 3 条 —— 不能都显示 stats.snapshotCount(5)
    expect(tabByLabel("章节快照")?.textContent).toContain("2")
    expect(tabByLabel("大纲快照")?.textContent).toContain("3")
    expect(tabByLabel("人物状态")?.textContent).toContain("1")
  })

  it("统计条首个 chip 写「快照总数」并显示 5，而不是「章节快照」", async () => {
    await render()
    const statsBar = host.querySelector('[data-ui="memory-stats"]')
    expect(statsBar?.textContent).toContain("快照总数")
    expect(statsBar?.textContent).toContain("5")
    // 「章节快照」这个名字属于标签，不该再出现在统计条上，否则 5 与 2 同名不同值
    expect(statsBar?.textContent).not.toContain("章节快照")
  })

  it("默认停在章节快照标签，按章号降序", async () => {
    await render()
    expect(tabByLabel("章节快照")?.getAttribute("aria-selected")).toBe("true")
    const titles = [...host.querySelectorAll('[data-ui="memory-snapshot"] .text-sm.font-semibold')]
      .map((node) => node.textContent?.trim())
    // 只出章节卡，不出大纲卡
    expect(titles).toEqual(["第4章", "第2章"])
  })

  it("切到大纲快照后按标题排列，并按编号绝对值兜底不露负号", async () => {
    await render()
    await clickTab("大纲快照")

    const titles = [...host.querySelectorAll('[data-ui="memory-snapshot"] .text-sm.font-semibold')]
      .map((node) => node.textContent?.trim())
    // 按标题 localeCompare：力量体系 < 人物小传 < 总大纲
    expect(titles).toEqual(["力量体系", "人物小传", "总大纲"])
    expect(titles.join()).not.toContain("-")
  })

  it("切标签会换掉内容区，且同一时刻只渲染一个标签页", async () => {
    await render()
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)

    await clickTab("时间线")
    expect(tabByLabel("时间线")?.getAttribute("aria-selected")).toBe("true")
    expect(tabByLabel("章节快照")?.getAttribute("aria-selected")).toBe("false")
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)
  })

  it("切到记忆文件标签时才读盘（按需读取，不是一次性全读）", async () => {
    await render()
    expect(hoisted.readFile).not.toHaveBeenCalled()

    await clickTab("人物状态")
    expect(hoisted.readFile).toHaveBeenCalledWith("E:/Novel/wiki/memory/character-states.md")
  })

  it("记忆文件标签渲染的是对应文件的内容", async () => {
    await render()
    await clickTab("人物状态")
    expect(host.querySelector('[data-testid="wiki-reader"]')?.textContent)
      .toContain("E:/Novel/wiki/memory/character-states.md")
  })

  it("标签条是单排不换行（滚动而不是折行）", async () => {
    await render()
    const strip = host.querySelector<HTMLElement>('[data-ui="memory-tabs"]')
    expect(strip).not.toBeNull()
    // 结构上是一排：所有标签是同一个 flex 容器的直接子元素
    const children = [...strip!.children]
    expect(children.every((child) => child.getAttribute("data-ui") === "memory-tab")).toBe(true)
    expect(children).toHaveLength(8)
  })
})

describe("记忆中心：整窗单页", () => {
  it("根元素带页面与状态标识，供 UI 测试皮肤挂样式", async () => {
    await render()
    const page = host.querySelector('[data-ui-page="memory"]')
    expect(page).not.toBeNull()
    expect(page?.getAttribute("data-ui-state")).toBe("ready")
  })

  it("选中的标签带 aria-controls，内容区带 aria-labelledby，可被读屏关联", async () => {
    await render()
    const selected = tabByLabel("章节快照")!
    const panel = host.querySelector('[role="tabpanel"]')!
    expect(selected.id).toBe("memory-tab-snapshots")
    expect(panel.getAttribute("aria-labelledby")).toBe("memory-tab-snapshots")
    expect(panel.id).toBe(selected.getAttribute("aria-controls"))
  })
})
