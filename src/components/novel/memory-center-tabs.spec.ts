import { describe, expect, it, vi } from "vitest"
import type {
  MemoryCenterData,
  MemoryCenterFilePreview,
  MemoryCenterSnapshotCard,
} from "@/lib/novel/memory-center"
import {
  MEMORY_FILE_KEYS,
  MEMORY_TAB_KEYS,
  MEMORY_TAB_LABEL_KEYS,
  countMemoryFileEntries,
  outlineSnapshotTitle,
  resolveMemoryTabCount,
  selectChapterSnapshotCards,
  selectOutlineSnapshotCards,
} from "./memory-center-tabs"

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

function makeFile(key: string, sections: MemoryCenterFilePreview["sections"]): MemoryCenterFilePreview {
  return { key, title: key, path: `/p/wiki/memory/${key}.md`, sections }
}

function makeData(overrides: Partial<MemoryCenterData> = {}): MemoryCenterData {
  return {
    stats: {
      snapshotCount: 0,
      syncedSnapshotCount: 0,
      characterCount: 0,
      activeForeshadowingCount: 0,
      memoryFileCount: 0,
    },
    snapshots: [],
    allChapterNumbers: [],
    files: [],
    dismantlingProjects: [],
    ...overrides,
  }
}

describe("记忆中心标签清单", () => {
  it("恰好 8 个标签，顺序为「两类快照在前、6 个记忆文件在后」", () => {
    expect(MEMORY_TAB_KEYS).toHaveLength(8)
    expect(MEMORY_TAB_KEYS.slice(0, 2)).toEqual(["snapshots", "outline-snapshots"])
    expect(MEMORY_TAB_KEYS.slice(2)).toEqual([...MEMORY_FILE_KEYS])
  })

  /*
   * 原侧栏用 filter 把 dismantling-library 从列表里剔除，是一条"靠过滤隐藏"的防线。
   * 单页后标签清单是源码里的常量，防线改成"清单本身就不含它"。
   * plot-framework 同理：它的分支在改动前就已不可达。
   */
  it("不含 dismantling-library 与 plot-framework（拆文库不得出现在记忆中心）", () => {
    expect(MEMORY_TAB_KEYS).not.toContain("dismantling-library")
    expect(MEMORY_TAB_KEYS).not.toContain("plot-framework")
  })

  it("每个标签都有 i18n 文案键，且不重复", () => {
    const keys = MEMORY_TAB_KEYS.map((key) => MEMORY_TAB_LABEL_KEYS[key])
    expect(keys.every((key) => typeof key === "string" && key.length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("记忆中心标签计数", () => {
  const data = makeData({
    snapshots: [makeCard(3), makeCard(1), makeCard(-7, "力量体系")],
    files: [
      makeFile("character-states", [
        { title: "主角", groups: [{ title: "许七安", items: ["状态：警觉"] }], items: [] },
        { title: "配角", groups: [], items: ["甲", "乙"] },
      ]),
    ],
  })

  it("章节快照标签只统计正数卡片", () => {
    expect(resolveMemoryTabCount("snapshots", data)).toBe(2)
  })

  it("大纲快照标签只统计负数卡片", () => {
    expect(resolveMemoryTabCount("outline-snapshots", data)).toBe(1)
  })

  it("记忆文件标签统计条目数（section.items 与 section.groups 之和）", () => {
    // 主角组 1 个 group + 配角 2 个 item = 3
    expect(resolveMemoryTabCount("character-states", data)).toBe(3)
  })

  it("文件不存在时计数为 0，而不是抛错", () => {
    expect(resolveMemoryTabCount("conflicts", data)).toBe(0)
  })

  it("数据尚未加载（null）时所有计数为 0", () => {
    for (const key of MEMORY_TAB_KEYS) {
      expect(resolveMemoryTabCount(key, null)).toBe(0)
    }
  })

  it("countMemoryFileEntries 对缺失文件返回 0", () => {
    expect(countMemoryFileEntries(null)).toBe(0)
    expect(countMemoryFileEntries(undefined)).toBe(0)
  })
})

describe("记忆中心快照筛选", () => {
  it("章节卡片只取正数，且按章号降序", () => {
    const data = makeData({ snapshots: [makeCard(1), makeCard(-3), makeCard(7), makeCard(4)] })
    expect(selectChapterSnapshotCards(data).map((c) => c.chapterNumber)).toEqual([7, 4, 1])
  })

  /*
   * 大纲快照的编号是文件名的哈希（chapter-ingest.ts:1437，-(hash%999+1)），
   * 按它排序等于随机顺序。标题才是大纲文件名，所以必须按标题排。
   */
  it("大纲卡片只取负数，且按标题排序而不是按哈希编号", () => {
    const data = makeData({
      snapshots: [
        makeCard(-817, "总大纲"),
        makeCard(-5, "人物小传"),
        makeCard(-42, "力量体系"),
        makeCard(2),
      ],
    })
    expect(selectOutlineSnapshotCards(data).map((c) => c.chapterTitle))
      .toEqual(["力量体系", "人物小传", "总大纲"])
  })

  it("大纲标题缺失时按编号兜底排序，不会抛错", () => {
    const data = makeData({ snapshots: [makeCard(-3), makeCard(-9)] })
    expect(selectOutlineSnapshotCards(data)).toHaveLength(2)
  })

  it("不修改传入的数据（筛选必须返回新数组）", () => {
    const snapshots = [makeCard(1), makeCard(-3, "乙"), makeCard(-4, "甲")]
    const data = makeData({ snapshots })
    selectOutlineSnapshotCards(data)
    expect(snapshots.map((c) => c.chapterNumber)).toEqual([1, -3, -4])
  })

  it("数据为 null 时返回空数组", () => {
    expect(selectChapterSnapshotCards(null)).toEqual([])
    expect(selectOutlineSnapshotCards(null)).toEqual([])
  })

  /*
   * 原实现直接渲染 `大纲快照(${card.chapterNumber})`，负数会露出 "-817" 这种写法。
   */
  it("大纲兜底标题用编号绝对值，不出现负号", () => {
    const t = vi.fn((_key: string, opts?: Record<string, unknown>) => `大纲快照 ${opts?.number}`)
    const title = outlineSnapshotTitle(makeCard(-817), t)
    expect(title).toBe("大纲快照 817")
    expect(title).not.toContain("-")
  })

  it("大纲有标题时优先用标题", () => {
    const t = vi.fn(() => "兜底")
    expect(outlineSnapshotTitle(makeCard(-5, "人物小传"), t)).toBe("人物小传")
    expect(t).not.toHaveBeenCalled()
  })
})
