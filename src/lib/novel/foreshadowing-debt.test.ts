import { describe, it, expect } from "vitest"
import { analyzeForeshadowingDebt } from "./foreshadowing-debt"
import { createEmptyForeshadowingStore, type ForeshadowingStore } from "./foreshadowing-tracker"

describe("foreshadowing-debt", () => {
  it("returns full score for empty store", () => {
    const store = createEmptyForeshadowingStore()
    const report = analyzeForeshadowingDebt(store, 10)
    expect(report.debtScore).toBe(100)
    expect(report.totalUnresolved).toBe(0)
    expect(report.criticalCount).toBe(0)
    expect(report.warningCount).toBe(0)
  })

  it("marks recently planted as normal", () => {
    const store: ForeshadowingStore = {
      items: [{
        id: "fs-1", name: "神秘人物", description: "出现神秘人物",
        status: "planted", plantedChapter: 8, advancedChapters: [],
        relatedCharacters: [], relatedEvents: [], notes: "",
      }],
      lastUpdated: new Date().toISOString(),
    }
    const report = analyzeForeshadowingDebt(store, 10)
    const item = report.items[0]
    expect(item.debtLevel).toBe("normal")
  })

  it("marks stale planted as critical", () => {
    const store: ForeshadowingStore = {
      items: [{
        id: "fs-1", name: "神秘人物", description: "出现神秘人物",
        status: "planted", plantedChapter: 1, advancedChapters: [],
        relatedCharacters: [], relatedEvents: [], notes: "",
      }],
      lastUpdated: new Date().toISOString(),
    }
    const report = analyzeForeshadowingDebt(store, 20)
    expect(report.items[0].debtLevel).toBe("critical")
    expect(report.criticalCount).toBe(1)
  })

  it("marks stale advanced as warning", () => {
    const store: ForeshadowingStore = {
      items: [{
        id: "fs-2", name: "王国秘密", description: "王国隐藏的秘密",
        status: "advanced", plantedChapter: 1, advancedChapters: [5],
        relatedCharacters: [], relatedEvents: [], notes: "",
      }],
      lastUpdated: new Date().toISOString(),
    }
    const report = analyzeForeshadowingDebt(store, 30)
    expect(report.items[0].debtLevel).toBe("warning")
    expect(report.warningCount).toBe(1)
  })

  it("handles resolved items correctly", () => {
    const store: ForeshadowingStore = {
      items: [{
        id: "fs-3", name: "已回收伏笔", description: "已完成",
        status: "resolved", plantedChapter: 1, advancedChapters: [3],
        resolvedChapter: 5, relatedCharacters: [], relatedEvents: [], notes: "",
      }],
      lastUpdated: new Date().toISOString(),
    }
    const report = analyzeForeshadowingDebt(store, 30)
    expect(report.totalUnresolved).toBe(0)
    expect(report.debtScore).toBe(100)
  })

  it("accepts custom thresholds", () => {
    const store: ForeshadowingStore = {
      items: [{
        id: "fs-1", name: "测试", description: "测试伏笔",
        status: "planted", plantedChapter: 1, advancedChapters: [],
        relatedCharacters: [], relatedEvents: [], notes: "",
      }],
      lastUpdated: new Date().toISOString(),
    }
    const defaultReport = analyzeForeshadowingDebt(store, 4)
    expect(defaultReport.items[0].debtLevel).toBe("normal")

    const customReport = analyzeForeshadowingDebt(store, 4, { plantedStale: 2 })
    expect(customReport.items[0].debtLevel).toBe("critical")
  })
})