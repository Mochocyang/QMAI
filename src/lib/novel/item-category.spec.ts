import { describe, expect, it } from "vitest"
import type { ChapterSnapshot } from "./chapter-ingest"
import {
  collectItemRecords,
  formatItemBriefings,
  normalizeItemCategory,
  normalizeItemCategoryRecord,
  selectBriefingItems,
  type ItemRecord,
} from "./item-category"

function snapshot(overrides: Partial<ChapterSnapshot> & { chapterNumber: number }): ChapterSnapshot {
  return {
    chapterId: `chapter-${overrides.chapterNumber}`,
    summary: "",
    characters: [],
    locations: [],
    organizations: [],
    items: [],
    events: [],
    characterStateChanges: [],
    relationshipChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges: [],
    newCanonFacts: [],
    timelineEvents: [],
    conflicts: [],
    endingHook: "",
    graphNodes: [],
    graphEdges: [],
    ...overrides,
  }
}

function record(overrides: Partial<ItemRecord> & { name: string }): ItemRecord {
  return {
    holder: "",
    previousHolders: "",
    abilities: "",
    limitations: "",
    origin: "",
    lastChapterNumber: 1,
    ...overrides,
  }
}

describe("normalizeItemCategory", () => {
  it("接受英文 id 与中文标签", () => {
    expect(normalizeItemCategory("protagonist")).toBe("protagonist")
    expect(normalizeItemCategory("主角使用")).toBe("protagonist")
    expect(normalizeItemCategory("反派")).toBe("antagonist")
    expect(normalizeItemCategory("配角")).toBe("supporting")
    expect(normalizeItemCategory("没有意义")).toBe("trivial")
  })

  it("容忍大小写与首尾空白", () => {
    expect(normalizeItemCategory("  Protagonist  ")).toBe("protagonist")
    expect(normalizeItemCategory("无意义")).toBe("trivial")
  })

  it("认不出来就返回 undefined —— 不猜", () => {
    // 猜错会把无意义道具当主角道具注入提示词，比不分类更糟。
    expect(normalizeItemCategory("重要")).toBeUndefined()
    expect(normalizeItemCategory("其他")).toBeUndefined()
    expect(normalizeItemCategory("")).toBeUndefined()
    expect(normalizeItemCategory(42)).toBeUndefined()
    expect(normalizeItemCategory(null)).toBeUndefined()
  })

  it("整份记录丢掉认不出的键值，全空则不落盘", () => {
    expect(normalizeItemCategoryRecord({ 玄重尺: "主角使用", 茶: "重要" }))
      .toEqual({ 玄重尺: "protagonist" })
    expect(normalizeItemCategoryRecord({ 茶: "重要" })).toBeUndefined()
    expect(normalizeItemCategoryRecord(null)).toBeUndefined()
    // 数组是无效形状：曾经这里若按对象处理会得到 {0:"...",1:"..."} 这种垃圾键。
    expect(normalizeItemCategoryRecord(["主角使用"])).toBeUndefined()
  })
})

describe("collectItemRecords", () => {
  it("合并多章：后出现的非空值覆盖先前的", () => {
    const records = collectItemRecords([
      snapshot({
        chapterNumber: 1,
        items: ["玄重尺"],
        itemDetails: { 玄重尺: { holder: "萧炎", previousHolders: "", abilities: "沉重", limitations: "", origin: "药老所赠" } },
      }),
      snapshot({
        chapterNumber: 5,
        items: ["玄重尺"],
        itemDetails: { 玄重尺: { holder: "纳兰嫣然", previousHolders: "萧炎", abilities: "", limitations: "需斗气", origin: "" } },
      }),
    ])
    expect(records).toHaveLength(1)
    expect(records[0].holder, "持有者应更新为最后一次出现").toBe("纳兰嫣然")
    expect(records[0].previousHolders).toBe("萧炎")
    expect(records[0].abilities, "新值空着时保留旧值，不能把已知信息擦掉").toBe("沉重")
    expect(records[0].origin).toBe("药老所赠")
    expect(records[0].lastChapterNumber).toBe(5)
  })

  it("后来的章节只提到道具、没填详情时，不会清空已有持有者", () => {
    const records = collectItemRecords([
      snapshot({
        chapterNumber: 2,
        items: ["玉佩"],
        itemDetails: { 玉佩: { holder: "林月", previousHolders: "", abilities: "", limitations: "", origin: "" } },
      }),
      // 第 7 章再次出现，但提取没填 itemDetails
      snapshot({ chapterNumber: 7, items: ["玉佩"] }),
    ])
    expect(records[0].holder, "不能因为后一章没填详情就把持有者抹掉").toBe("林月")
    expect(records[0].lastChapterNumber).toBe(7)
  })

  it("itemDetails 的键也算出现，即使没列进 items", () => {
    const records = collectItemRecords([
      snapshot({
        chapterNumber: 3,
        items: [],
        itemDetails: { 黑玉断续膏: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" } },
      }),
    ])
    expect(records.map((item) => item.name)).toEqual(["黑玉断续膏"])
  })

  it("分类跟着道具走，且后一章的分类覆盖前一章", () => {
    const records = collectItemRecords([
      snapshot({ chapterNumber: 1, items: ["断剑"], itemCategories: { 断剑: "trivial" } }),
      snapshot({ chapterNumber: 4, items: ["断剑"], itemCategories: { 断剑: "protagonist" } }),
    ])
    expect(records[0].category).toBe("protagonist")
  })

  it("旧快照没有 itemCategories 时，分类是 undefined 而不是报错", () => {
    const records = collectItemRecords([snapshot({ chapterNumber: 1, items: ["旧物"] })])
    expect(records[0].category).toBeUndefined()
  })

  it("乱序传入也按章节升序应用，结果与升序一致", () => {
    const first = snapshot({ chapterNumber: 1, items: ["剑"], itemDetails: { 剑: { holder: "甲", previousHolders: "", abilities: "", limitations: "", origin: "" } } })
    const later = snapshot({ chapterNumber: 9, items: ["剑"], itemDetails: { 剑: { holder: "乙", previousHolders: "甲", abilities: "", limitations: "", origin: "" } } })
    expect(collectItemRecords([later, first])[0].holder).toBe("乙")
    expect(collectItemRecords([first, later])[0].holder).toBe("乙")
  })

  /*
   * 下面两条钉的是「改 items 形状」这个陷阱本身。
   *
   * 快照没有 schemaVersion，磁盘上可能存在任何历史形状；而
   * normalizeSnapshotList() 会把非字符串元素静默变成 "" 再 filter 掉。
   * 表现是「物品莫名消失 / 图谱里出现 [object Object] 节点」，且**不报错**。
   * 所以这里明确钉住：无论磁盘上是什么，合并结果里的 name 一定是**非空字符串**。
   */
  it("磁盘上是畸形元素时，不会产出 [object Object] 这种名字", () => {
    const malformed = snapshot({
      chapterNumber: 1,
      items: [{ name: "对象道具" }, 42, null, "正常道具"] as unknown as string[],
    })
    const records = collectItemRecords([malformed])
    for (const item of records) {
      expect(typeof item.name).toBe("string")
      expect(item.name).not.toContain("[object")
      expect(item.name.length).toBeGreaterThan(0)
    }
    // 能被文本化的数字会留下（42 → "42"），对象与 null 空串会被丢掉。
    expect(records.map((item) => item.name).sort()).toEqual(["42", "正常道具"])
  })

  it("收集结果里的每个字段都是字符串，不会把对象漏进提示词", () => {
    const weird = snapshot({
      chapterNumber: 1,
      items: ["怪东西"],
      // 详情字段给错类型（历史数据/模型抽风）
      itemDetails: { 怪东西: { holder: { name: "某人" }, previousHolders: "", abilities: [], limitations: "", origin: "" } } as never,
    })
    const [item] = collectItemRecords([weird])
    for (const value of [item.name, item.holder, item.previousHolders, item.abilities, item.limitations, item.origin]) {
      expect(typeof value).toBe("string")
      expect(value).not.toContain("[object")
    }
    // holder 是对象 → 取不到文本 → 视为未知，而不是 "[object Object]"
    expect(item.holder).toBe("")
  })
})

describe("selectBriefingItems", () => {
  const cast = ["萧炎", "药老"]

  it("持有者在本章出场角色里 → 入选", () => {
    const items = selectBriefingItems(
      [record({ name: "玄重尺", holder: "萧炎" })],
      { characterNames: cast, matchingText: "萧炎修炼" },
    )
    expect(items.map((item) => item.name)).toEqual(["玄重尺"])
  })

  it("名字出现在本章任务/细纲文本里 → 入选（即使持有者不在场）", () => {
    const items = selectBriefingItems(
      [record({ name: "陨落心炎", holder: "药老" })],
      { characterNames: ["萧炎"], matchingText: "本章要写萧炎夺取陨落心炎" },
    )
    expect(items.map((item) => item.name)).toEqual(["陨落心炎"])
  })

  it("两条口径都不满足 → 不入选（这才是「相关」，不是把全部道具倒进去）", () => {
    const items = selectBriefingItems(
      [record({ name: "无关之物", holder: "路人甲" })],
      { characterNames: cast, matchingText: "萧炎在药老指导下修炼" },
    )
    expect(items).toEqual([])
  })

  it("trivial 道具直接剔除 —— 这是分类真正的价值", () => {
    const items = selectBriefingItems(
      [
        record({ name: "玄重尺", holder: "萧炎", category: "protagonist" }),
        record({ name: "路人的茶", holder: "萧炎", category: "trivial" }),
      ],
      { characterNames: cast, matchingText: "萧炎喝茶" },
    )
    expect(items.map((item) => item.name)).toEqual(["玄重尺"])
  })

  it("未分类（旧快照）不剔除：缺字段不等于没有意义", () => {
    const items = selectBriefingItems(
      [record({ name: "旧道具", holder: "萧炎" })],
      { characterNames: cast, matchingText: "" },
    )
    expect(items.map((item) => item.name)).toEqual(["旧道具"])
  })

  it("文本点名的排在只看持有者的前面", () => {
    const items = selectBriefingItems(
      [
        record({ name: "甲尺", holder: "萧炎", lastChapterNumber: 20 }),
        record({ name: "乙剑", holder: "路人", lastChapterNumber: 1 }),
      ],
      { characterNames: cast, matchingText: "萧炎祭出乙剑" },
    )
    expect(items.map((item) => item.name), "文本里点名的信号更强").toEqual(["乙剑", "甲尺"])
  })

  it("同一档内按最近出现排序", () => {
    const items = selectBriefingItems(
      [
        record({ name: "旧的", holder: "萧炎", lastChapterNumber: 2 }),
        record({ name: "新的", holder: "药老", lastChapterNumber: 18 }),
      ],
      { characterNames: cast, matchingText: "" },
    )
    expect(items.map((item) => item.name)).toEqual(["新的", "旧的"])
  })

  it("遵守上限", () => {
    const many = Array.from({ length: 30 }, (_, i) => record({ name: `道具${i}`, holder: "萧炎" }))
    expect(selectBriefingItems(many, { characterNames: cast, matchingText: "", limit: 5 })).toHaveLength(5)
  })

  it("持有者与角色名互相包含也算在场（「萧炎」vs「萧炎（本体）」）", () => {
    const items = selectBriefingItems(
      [record({ name: "尺", holder: "萧炎（本体）" })],
      { characterNames: ["萧炎"], matchingText: "" },
    )
    expect(items).toHaveLength(1)
  })
})

describe("formatItemBriefings", () => {
  it("输出持有者、分类与能力，且不留空壳标签", () => {
    const lines = formatItemBriefings([
      record({ name: "玄重尺", holder: "萧炎", category: "protagonist", abilities: "沉重如山", limitations: "耗斗气", origin: "药老所赠" }),
    ])
    expect(lines[0]).toContain("**玄重尺**")
    expect(lines[0]).toContain("当前持有：萧炎")
    expect(lines[0]).toContain("（主角使用）")
    expect(lines[0]).toContain("能力：沉重如山")
    expect(lines[0]).toContain("限制：耗斗气")
    expect(lines[0]).toContain("来源：药老所赠")
  })

  it("没有详情时只留名字，不写「能力：」这种空壳", () => {
    const lines = formatItemBriefings([record({ name: "无名之物" })])
    expect(lines[0]).toBe("- **无名之物**")
    expect(lines[0]).not.toContain("能力")
    expect(lines[0]).not.toContain("当前持有")
  })

  it("未分类时不显示分类括号", () => {
    const lines = formatItemBriefings([record({ name: "旧物", holder: "甲" })])
    expect(lines[0]).toBe("- **旧物** 当前持有：甲")
  })
})
