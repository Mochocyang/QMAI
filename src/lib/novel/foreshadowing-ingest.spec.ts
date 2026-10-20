import { describe, expect, it } from "vitest"
import { applyForeshadowingChangesToStore } from "./chapter-ingest"
import { createEmptyForeshadowingStore, retractChapterFromForeshadowingStore, type Foreshadowing } from "./foreshadowing-tracker"
import type { ChapterSnapshot } from "./chapter-ingest"

function snap(
  chapterNumber: number,
  foreshadowingChanges: string[],
): ChapterSnapshot {
  return {
    chapterId: `ch-${chapterNumber}`,
    chapterNumber,
    summary: "",
    characters: [],
    locations: [],
    organizations: [],
    items: [],
    events: [],
    characterStateChanges: [],
    relationshipChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges,
    newCanonFacts: [],
    timelineEvents: [],
    conflicts: [],
    endingHook: "",
    graphNodes: [],
    graphEdges: [],
  }
}

describe("applyForeshadowingChangesToStore", () => {
  it("plants with full-width colon and normalized name", () => {
    const store = createEmptyForeshadowingStore()
    applyForeshadowingChangesToStore(
      store,
      snap(2, ["新增：苏式来源疑云成为美苏双方追查的核心伏笔。"]),
    )
    expect(store.items).toHaveLength(1)
    expect(store.items[0].status).toBe("planted")
    expect(store.items[0].name.length).toBeLessThanOrEqual(18)
    expect(store.items[0].id).toMatch(/^F\d+$/)
    expect(store.items[0].description).toBeTruthy()
  })

  it("advances and resolves by normalized name match", () => {
    const store = createEmptyForeshadowingStore()
    applyForeshadowingChangesToStore(
      store,
      snap(1, ["新增伏笔：灰门与旧网联络链浮出水面但未追至源头"]),
    )
    const name = store.items[0].name
    applyForeshadowingChangesToStore(
      store,
      snap(5, [`推进伏笔：${name}仍未断`]),
    )
    expect(store.items).toHaveLength(1)
    expect(store.items[0].status).toBe("advanced")
    expect(store.items[0].advancedChapters).toContain(5)

    applyForeshadowingChangesToStore(store, snap(10, [`回收：${name}`]))
    expect(store.items[0].status).toBe("resolved")
    expect(store.items[0].resolvedChapter).toBe(10)
  })

  it("turns duplicate plant into advance (ingest-side dedup)", () => {
    const store = createEmptyForeshadowingStore()
    applyForeshadowingChangesToStore(
      store,
      snap(1, ["新增伏笔：世界敌意值上升预示危机"]),
    )
    applyForeshadowingChangesToStore(
      store,
      snap(3, ["新增伏笔：世界敌意值上升预示危机加剧"]),
    )
    // Same normalized name prefix → should not create second item
    expect(store.items.length).toBe(1)
    expect(store.items[0].status).toBe("advanced")
    expect(store.items[0].advancedChapters).toContain(3)
  })

  it("does not drop no-prefix advance lines", () => {
    const store = createEmptyForeshadowingStore()
    applyForeshadowingChangesToStore(
      store,
      snap(1, ["新增伏笔：底格里斯神经一期建设"]),
    )
    applyForeshadowingChangesToStore(
      store,
      snap(12, ["底格里斯神经一期建设启动，为后续战场指挥融合埋下伏笔。"]),
    )
    expect(store.items[0].advancedChapters).toContain(12)
  })

  it("records unmatched resolve as a resolved entry", () => {
    const store = createEmptyForeshadowingStore()
    applyForeshadowingChangesToStore(
      store,
      snap(14, ["回收：灰门内奸伏笔，阿德南·哈利勒被清除"]),
    )
    expect(store.items).toHaveLength(1)
    expect(store.items[0].status).toBe("resolved")
    expect(store.items[0].resolvedChapter).toBe(14)
  })
})

function foreshadowing(partial: Partial<Foreshadowing> & Pick<Foreshadowing, "id" | "plantedChapter">): Foreshadowing {
  return {
    name: partial.id,
    description: "",
    status: "planted",
    advancedChapters: [],
    relatedCharacters: [],
    relatedEvents: [],
    notes: "",
    ...partial,
  }
}

describe("retractChapterFromForeshadowingStore", () => {
  it("drops an item that only the removed chapter planted", () => {
    const store = {
      items: [
        foreshadowing({ id: "F001", plantedChapter: -5, name: "大纲伏笔" }),
        foreshadowing({ id: "F008", plantedChapter: 2, name: "手改伏笔" }),
      ],
      lastUpdated: "keep",
    }

    const retracted = retractChapterFromForeshadowingStore(store, -5)

    expect(retracted.changed).toBe(true)
    expect(retracted.store.items).toEqual([store.items[1]])
    expect(retracted.store.lastUpdated).toBe("keep")
  })

  it("strips the chapter from later references and keeps the original id", () => {
    const kept = foreshadowing({
      id: "F003",
      plantedChapter: 1,
      advancedChapters: [-5, 4],
      status: "advanced",
      name: "章节伏笔",
    })
    const store = { items: [kept], lastUpdated: "keep" }

    const retracted = retractChapterFromForeshadowingStore(store, -5)

    expect(retracted.store.items).toEqual([{
      ...kept,
      advancedChapters: [4],
    }])
  })

  it("moves the plant onto the earliest remaining chapter", () => {
    const store = {
      items: [foreshadowing({
        id: "F004",
        plantedChapter: -5,
        advancedChapters: [6, 3],
        status: "advanced",
      })],
      lastUpdated: "keep",
    }

    const retracted = retractChapterFromForeshadowingStore(store, -5)

    expect(retracted.store.items[0]).toMatchObject({
      id: "F004",
      plantedChapter: 3,
      advancedChapters: [6, 3],
      status: "advanced",
    })
  })

  it("clears a resolution that came from the removed chapter", () => {
    const store = {
      items: [foreshadowing({
        id: "F005",
        plantedChapter: 2,
        advancedChapters: [4],
        resolvedChapter: -5,
        status: "resolved",
      })],
      lastUpdated: "keep",
    }

    const retracted = retractChapterFromForeshadowingStore(store, -5)

    expect(retracted.store.items[0].resolvedChapter).toBeUndefined()
    expect(retracted.store.items[0].status).toBe("advanced")
    expect(retracted.store.items[0].plantedChapter).toBe(2)
  })

  it("returns the same store when nothing references the chapter", () => {
    const store = {
      items: [foreshadowing({ id: "F008", plantedChapter: 2 })],
      lastUpdated: "keep",
    }

    const retracted = retractChapterFromForeshadowingStore(store, -5)

    expect(retracted.changed).toBe(false)
    expect(retracted.store).toBe(store)
  })
})
