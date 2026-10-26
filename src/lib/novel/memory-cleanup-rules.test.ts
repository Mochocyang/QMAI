import { describe, expect, it } from "vitest"
import { collectMemoryRecords } from "./memory-cleanup"
import { planMemoryCleanupRules, RECOMMENDED_MEMORY_CLEANUP_RULES } from "./memory-cleanup-rules"
import type { ChapterSnapshot } from "./chapter-ingest"

const snapshot = (n: number, patch: Partial<ChapterSnapshot> = {}): ChapterSnapshot => ({
  chapterId: `chapter-${n}`, chapterNumber: n, summary: "", characters: [], locations: [], organizations: [], items: [], events: [],
  characterStateChanges: [], relationshipChanges: [], knowledgeChanges: [], foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [], conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
  ...patch,
})

const textOf = (records: ReturnType<typeof collectMemoryRecords>, ids: string[]) => ids.map((id) => records.find((record) => record.id === id)?.text).sort()

describe("规则清理", () => {
  const records = collectMemoryRecords([
    snapshot(-1, { knowledgeChanges: ["林默知道：大纲里的设定"], timelineEvents: ["大纲时间"] }),
    snapshot(1, { characterStateChanges: ["路人：登场后吓了一跳"], knowledgeChanges: ["路人知道门在左边"], timelineEvents: ["路人推门"] }),
    snapshot(2, { characterStateChanges: ["林默：受伤"], knowledgeChanges: ["林默知道密室位置"] }),
    snapshot(200, { characterStateChanges: ["林默：伤愈"], knowledgeChanges: ["林默知道钥匙藏处"], timelineEvents: ["近期事件"] }),
  ])

  it("推荐规则同时命中大纲快照、出场后未更新的人物，以及落后 150 章的来源", () => {
    const plan = planMemoryCleanupRules(records, RECOMMENDED_MEMORY_CLEANUP_RULES)
    expect(plan.counts).toEqual({ nonPositive: 2, unupdated: 2, stale: 3, total: 7 })
    const removed = plan.issues.flatMap((issue) => issue.removeIds)
    expect(textOf(records, removed)).toEqual(["大纲时间", "林默知道：大纲里的设定", "林默知道密室位置", "林默：受伤", "路人推门", "路人知道门在左边", "路人：登场后吓了一跳"].sort())
    expect(textOf(records, records.map((record) => record.id).filter((id) => !removed.includes(id)))).toEqual(["林默知道钥匙藏处", "林默：伤愈", "近期事件"].sort())
  })

  it("出场后再隔满指定章数仍未更新才删除，只出场一章但间隔未到的人物保留", () => {
    const rows = collectMemoryRecords([
      snapshot(-1, { characterStateChanges: ["路人：大纲外形"], knowledgeChanges: ["路人知道：大纲里的门"] }),
      snapshot(1, { characterStateChanges: ["路人：登场后吓了一跳", "阿福：第一次出场", "推进：不要当成人物"], knowledgeChanges: ["路人知道门在左边", "旁白觉得气氛不对"] }),
      snapshot(2, { characterStateChanges: ["阿福：又写了一句状态"] }),
      snapshot(206, { characterStateChanges: ["边界：刚好落后三十章"] }),
      snapshot(207, { characterStateChanges: ["边缘：还差一章"] }),
      snapshot(236, { characterStateChanges: ["新人：刚刚登场", "林默：仍在场"], knowledgeChanges: ["林默知道钥匙藏处"] }),
    ])
    const plan = planMemoryCleanupRules(rows, { dropNonPositiveChapters: false, staleChapterGap: 0, unupdatedChapterGap: 30 })
    const removed = plan.issues.flatMap((issue) => issue.removeIds)
    expect(plan.counts).toEqual({ nonPositive: 0, unupdated: removed.length, stale: 0, total: removed.length })
    expect(textOf(rows, removed)).toEqual(["阿福：又写了一句状态", "阿福：第一次出场", "边界：刚好落后三十章", "路人知道：大纲里的门", "路人知道门在左边", "路人：大纲外形", "路人：登场后吓了一跳"].sort())
    expect(textOf(rows, rows.map((record) => record.id).filter((id) => !removed.includes(id)))).toEqual(["边缘：还差一章", "林默知道钥匙藏处", "林默：仍在场", "新人：刚刚登场", "旁白觉得气氛不对", "推进：不要当成人物"].sort())
    expect(planMemoryCleanupRules(rows, { dropNonPositiveChapters: false, staleChapterGap: 0, unupdatedChapterGap: 0 }).counts).toEqual({ nonPositive: 0, unupdated: 0, stale: 0, total: 0 })
  })

  it("拒绝不是整数的落后章数", () => {
    expect(() => planMemoryCleanupRules(records, { ...RECOMMENDED_MEMORY_CLEANUP_RULES, staleChapterGap: 1.5 })).toThrow("落后章数")
    expect(() => planMemoryCleanupRules(records, { ...RECOMMENDED_MEMORY_CLEANUP_RULES, unupdatedChapterGap: 1.5 })).toThrow("未更新章数")
  })
})
