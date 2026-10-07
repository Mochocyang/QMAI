// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MemoryCenterSnapshotCard } from "@/lib/novel/memory-center"
import { DEFAULT_SNAPSHOT_PAGE_SIZE, SnapshotCollection } from "./memory-center-snapshots"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** 与 zh.json 里的真实文案一致的最小替身，让断言能读到人看得懂的字符串。 */
const t = (key: string, opts?: Record<string, unknown>) => {
  const table: Record<string, string> = {
    "novel.memoryCenter.snapshots.chapter": `第${opts?.chapter}章`,
    "novel.memoryCenter.snapshots.outlineFallback": `大纲快照 ${opts?.number}`,
    "novel.memoryCenter.snapshots.synced": "已同步到记忆",
    "novel.memoryCenter.snapshots.unsynced": "尚未同步",
    "novel.memoryCenter.snapshots.openSnapshot": "查看记忆",
    "novel.memoryCenter.snapshots.summaryFallback": "该章节暂未生成摘要。",
    "novel.memoryCenter.snapshots.rangeStart": "起始章",
    "novel.memoryCenter.snapshots.rangeEnd": "结束章",
    "novel.memoryCenter.snapshots.clearRange": "清除区间",
    "novel.memoryCenter.snapshots.rangeSummary": `区间 ${opts?.start}–${opts?.end} 章，共${opts?.count}条`,
    "novel.memoryCenter.snapshots.recentSummary": `最近${opts?.shown}章（共${opts?.total}章）`,
    "novel.memoryCenter.snapshots.outlineSummary": `共 ${opts?.count} 条大纲快照`,
    "novel.memoryCenter.noChapterSnapshots": "暂无章节快照",
    "novel.memoryCenter.noOutlineSnapshots": "暂无大纲快照",
    "novel.memoryCenter.showMore": "显示更多",
    "novel.memoryCenter.edit": "编辑",
    "novel.memoryCenter.delete": "删除",
    "novel.snapshot.characterStateChanges": "人物状态变化",
    "novel.snapshot.knowledgeChanges": "认知变化",
    "novel.snapshot.foreshadowingChanges": "伏笔变化",
    "novel.snapshot.timelineEvents": "时间线事件",
    "novel.snapshot.endingHook": "结尾钩子",
  }
  return table[key] ?? key
}

function makeCard(chapterNumber: number, chapterTitle?: string): MemoryCenterSnapshotCard {
  return {
    chapterNumber,
    chapterTitle,
    summary: `摘要 ${chapterNumber}`,
    endingHook: "",
    memorySynced: false,
    snapshotPath: `.novel/snapshots/${chapterNumber}.snapshot.md`,
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

const noop = () => {}

async function renderCollection(
  cards: MemoryCenterSnapshotCard[],
  variant: "chapter" | "outline" = "chapter",
) {
  await act(async () => {
    root.render(
      <SnapshotCollection
        cards={cards}
        variant={variant}
        onOpen={noop}
        onEdit={noop}
        onDelete={noop}
        t={t}
      />,
    )
  })
}

const cardTitles = () =>
  [...host.querySelectorAll('[data-ui="memory-snapshot"] .text-sm.font-semibold')]
    .map((node) => node.textContent?.trim())

const showMoreButton = () =>
  host.querySelector<HTMLButtonElement>('[data-ui="memory-show-more"]')

const rangeInputs = () => [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')]

describe("快照集合：渐进披露", () => {
  it(`超过 ${DEFAULT_SNAPSHOT_PAGE_SIZE} 张时只渲染前 ${DEFAULT_SNAPSHOT_PAGE_SIZE} 张，并给出「显示更多」`, async () => {
    const cards = Array.from({ length: 20 }, (_, index) => makeCard(20 - index))
    await renderCollection(cards)

    expect(host.querySelectorAll('[data-ui="memory-snapshot"]')).toHaveLength(DEFAULT_SNAPSHOT_PAGE_SIZE)
    expect(showMoreButton()).not.toBeNull()

    await act(async () => { showMoreButton()!.click() })
    expect(host.querySelectorAll('[data-ui="memory-snapshot"]')).toHaveLength(20)
    // 全部展开后按钮必须消失，否则会留一个点了没反应的按钮
    expect(showMoreButton()).toBeNull()
  })

  it("不足一页时既不截断也不显示「显示更多」", async () => {
    await renderCollection([makeCard(3), makeCard(2)])
    expect(host.querySelectorAll('[data-ui="memory-snapshot"]')).toHaveLength(2)
    expect(showMoreButton()).toBeNull()
  })
})

describe("快照集合：区间筛选", () => {
  it("按起始章筛选后只留下范围内的卡片", async () => {
    await renderCollection([makeCard(5), makeCard(3), makeCard(1)])
    const [start] = rangeInputs()

    await act(async () => {
      // React 受控 input 需要走原生 setter 才能触发 onChange
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(start, "3")
      start.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(cardTitles()).toEqual(["第5章", "第3章"])
  })

  it("筛选生效时不截断（用户已缩小范围，再分页会让人以为结果不全）", async () => {
    const cards = Array.from({ length: 20 }, (_, index) => makeCard(index + 1))
    await renderCollection(cards)
    const [start] = rangeInputs()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(start, "1")
      start.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // 20 张全部命中区间 1–20，应当全部渲染，而不是又回到 15 张
    expect(host.querySelectorAll('[data-ui="memory-snapshot"]')).toHaveLength(20)
    expect(showMoreButton()).toBeNull()
  })

  it("清除区间按钮把筛选与分页一起复位", async () => {
    await renderCollection([makeCard(5), makeCard(3), makeCard(1)])
    const [start] = rangeInputs()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

    await act(async () => {
      setter.call(start, "3")
      start.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(cardTitles()).toEqual(["第5章", "第3章"])

    const clear = host.querySelector<HTMLButtonElement>('[aria-label="清除区间"]')
    expect(clear).not.toBeNull()
    await act(async () => { clear!.click() })
    expect(cardTitles()).toEqual(["第5章", "第3章", "第1章"])
  })
})

describe("快照集合：大纲变体", () => {
  it("大纲不渲染区间筛选（编号是哈希，按它筛没有语义）", async () => {
    await renderCollection([makeCard(-5, "人物小传")], "outline")
    expect(rangeInputs()).toHaveLength(0)
    expect(host.querySelector('[data-ui="memory-snapshot-collection"]')?.getAttribute("data-variant")).toBe("outline")
  })

  it("大纲标题缺失时用编号绝对值兜底，不出现负号", async () => {
    await renderCollection([makeCard(-817)], "outline")
    expect(cardTitles()).toEqual(["大纲快照 817"])
  })

  it("空列表给出对应的空态文案，而不是一片空白", async () => {
    await renderCollection([], "outline")
    expect(host.textContent).toContain("暂无大纲快照")
    await renderCollection([], "chapter")
    expect(host.textContent).toContain("暂无章节快照")
  })
})
