import { describe, expect, it } from "vitest"
import {
  applyBulkDeleteAndAbandon,
  applyCleanupIssue,
  looksLikeNoise,
  looksLikeStale,
  ruleBasedCleanupIssues,
  detectCleanupIssues,
  type ForeshadowingSummary,
} from "./foreshadowing-cleanup"
import { createEmptyForeshadowingStore, type Foreshadowing } from "./novel/foreshadowing-tracker"

function item(partial: Partial<Foreshadowing> & { id: string; name: string }): Foreshadowing {
  return {
    description: "",
    status: "planted",
    plantedChapter: 1,
    advancedChapters: [],
    relatedCharacters: [],
    relatedEvents: [],
    notes: "",
    ...partial,
  }
}

function summary(partial: Partial<ForeshadowingSummary> & { id: string; name: string }): ForeshadowingSummary {
  return {
    description: "",
    status: "planted",
    plantedChapter: 1,
    advancedChapters: [],
    ...partial,
  }
}

describe("looksLikeNoise / looksLikeStale", () => {
  it("flags forecast-style names as noise", () => {
    expect(
      looksLikeNoise(
        summary({
          id: "F1",
          name: "美军地面部队规模需求升至三十万，预示大规模正规战争即将展开",
        }),
      ),
    ).toBe(true)
  })

  it("flags long-planted items without advances as stale", () => {
    expect(
      looksLikeStale(
        summary({ id: "F2", name: "灰门源头", plantedChapter: 4, status: "planted" }),
        30,
      ),
    ).toBe(true)
    expect(
      looksLikeStale(
        summary({
          id: "F3",
          name: "灰门源头",
          plantedChapter: 4,
          status: "planted",
          advancedChapters: [10],
        }),
        30,
      ),
    ).toBe(false)
  })
})

describe("ruleBasedCleanupIssues", () => {
  it("emits noise and stale and respects keep whitelist", () => {
    const issues = ruleBasedCleanupIssues(
      [
        summary({
          id: "F1",
          name: "敌意值上升预示非常规渗透事件即将触发",
          plantedChapter: 3,
        }),
        summary({ id: "F2", name: "莱拉真实身份", plantedChapter: 2 }),
      ],
      40,
      { keepKeys: [["F2"]] },
    )
    expect(issues.some((i) => i.kind === "noise" && i.ids[0] === "F1")).toBe(true)
    expect(issues.some((i) => i.ids[0] === "F2")).toBe(false)
  })
})

describe("applyCleanupIssue", () => {
  it("merges duplicates with earliest planted and union advanced", () => {
    const store = createEmptyForeshadowingStore()
    store.items = [
      item({
        id: "F001",
        name: "世界敌意值",
        description: "短",
        plantedChapter: 5,
        advancedChapters: [6],
      }),
      item({
        id: "F002",
        name: "世界敌意值上升",
        description: "更长的说明文本关于敌意值",
        plantedChapter: 2,
        status: "advanced",
        advancedChapters: [8],
      }),
    ]
    applyCleanupIssue(
      store,
      {
        kind: "duplicate",
        ids: ["F001", "F002"],
        canonicalId: "F001",
        reason: "同一线索",
        confidence: "high",
      },
      { canonicalId: "F001" },
    )
    expect(store.items).toHaveLength(1)
    expect(store.items[0].id).toBe("F001")
    expect(store.items[0].plantedChapter).toBe(2)
    expect(store.items[0].advancedChapters).toEqual([6, 8])
    expect(store.items[0].description).toContain("更长")
  })

  it("deletes noise", () => {
    const store = createEmptyForeshadowingStore()
    store.items = [
      item({ id: "F001", name: "噪声" }),
      item({ id: "F002", name: "保留" }),
    ]
    applyCleanupIssue(store, {
      kind: "noise",
      ids: ["F001"],
      reason: "噪声",
      confidence: "high",
    })
    expect(store.items.map((f) => f.id)).toEqual(["F002"])
  })

  it("deletes all ids in a duplicate group when action is delete", () => {
    const store = createEmptyForeshadowingStore()
    store.items = [
      item({ id: "F001", name: "a" }),
      item({ id: "F002", name: "b" }),
      item({ id: "F003", name: "keep" }),
    ]
    applyCleanupIssue(
      store,
      {
        kind: "duplicate",
        ids: ["F001", "F002"],
        canonicalId: "F001",
        reason: "都不要",
        confidence: "high",
      },
      { action: "delete" },
    )
    expect(store.items.map((f) => f.id)).toEqual(["F003"])
  })

  it("bulk deletes noise and abandons stale in one pass", () => {
    const store = createEmptyForeshadowingStore()
    store.items = [
      item({ id: "N1", name: "噪声1" }),
      item({ id: "N2", name: "噪声2" }),
      item({ id: "S1", name: "失效1", plantedChapter: 1 }),
      item({ id: "K1", name: "保留" }),
    ]
    const result = applyBulkDeleteAndAbandon(store, {
      deleteIds: ["N1", "N2"],
      abandonIds: ["S1"],
      chapter: 100,
    })
    expect(result).toEqual({ deleted: 2, abandoned: 1 })
    expect(store.items.map((f) => f.id).sort()).toEqual(["K1", "S1"])
    expect(store.items.find((f) => f.id === "S1")?.status).toBe("abandoned")
  })

  it("marks stale as abandoned with notes", () => {
    const store = createEmptyForeshadowingStore()
    store.items = [item({ id: "F001", name: "旧伏笔", plantedChapter: 1 })]
    applyCleanupIssue(
      store,
      {
        kind: "stale",
        ids: ["F001"],
        reason: "故事方向已变",
        confidence: "medium",
      },
      { chapter: 100 },
    )
    expect(store.items[0].status).toBe("abandoned")
    expect(store.items[0].notes).toContain("故事方向已变")
    expect(store.items[0].notes).toContain("第100章")
  })
})

describe("detectCleanupIssues", () => {
  it("parses LLM JSON and supplements with rules", async () => {
    const summaries = [
      summary({ id: "F001", name: "灰门", plantedChapter: 4 }),
      summary({ id: "F002", name: "灰门联络链", plantedChapter: 5 }),
      summary({
        id: "F003",
        name: "美军规模上升预示大规模正规战争即将展开",
        plantedChapter: 20,
      }),
    ]
    const llm = async () =>
      JSON.stringify({
        issues: [
          {
            kind: "duplicate",
            ids: ["F001", "F002"],
            canonicalId: "F001",
            reason: "同一灰门线索",
            confidence: "high",
          },
        ],
      })
    const issues = await detectCleanupIssues(summaries, 50, llm)
    expect(issues.some((i) => i.kind === "duplicate")).toBe(true)
    expect(issues.some((i) => i.kind === "noise" && i.ids[0] === "F003")).toBe(true)
  })
})
