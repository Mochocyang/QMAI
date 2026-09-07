import { describe, it, expect } from "vitest"
import { runFactCheck } from "./fact-snapshot"
import type { ChapterSnapshot } from "./chapter-ingest"

describe("fact-snapshot", () => {
  it("returns empty results for empty snapshot list", async () => {
    const report = await runFactCheck([])
    expect(report.results).toEqual([])
    expect(report.checkedChapterCount).toBe(0)
  })

  it("returns empty results for single snapshot", async () => {
    const snapshot: ChapterSnapshot = {
      chapterId: "chapter-1",
      chapterNumber: 1,
      summary: "测试章节",
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
    }
    const report = await runFactCheck([snapshot])
    expect(report.results).toEqual([])
    expect(report.checkedChapterCount).toBe(1)
  })

  it("returns empty results for two consistent snapshots", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: ["杨妙菲"], locations: ["北京"],
      organizations: [], items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: ["第1天：到达北京"],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: ["杨妙菲"], locations: ["北京"],
      organizations: [], items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: ["第2天：在北京修炼"],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    expect(report.results).toEqual([])
  })

  it("detects character state jump across 2+ levels", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["杨妙菲：健康"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["杨妙菲：重伤"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    expect(report.results.length).toBeGreaterThan(0)
    const jump = report.results.find(r => r.type === "character_jump")
    expect(jump).toBeDefined()
    expect(jump!.severity).toBe("blocking")
    expect(jump!.message).toContain("杨妙菲")
    expect(jump!.chapters).toEqual([1, 2])
  })

  it("does not flag gradual state change", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["杨妙菲：健康"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["杨妙菲：轻伤"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    const jumps = report.results.filter(r => r.type === "character_jump")
    expect(jumps.length).toBe(0)
  })

  it("handles non-standard state labels", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["张三：开心"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: ["张三：悲伤"],
      relationshipChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    const jumps = report.results.filter(r => r.type === "character_jump")
    expect(jumps.length).toBe(1)
    expect(jumps[0].severity).toBe("medium")
    expect(jumps[0].confidence).toBe(0.7)
  })

  it("does not flag location changes as conflicts when chapters switch places", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: ["杨妙菲"], locations: ["北京"],
      organizations: [], items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      characterDetails: { "杨妙菲": { identity: "修士", faction: "散修", goals: "修炼", arcChange: "无" } },
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: ["杨妙菲"], locations: ["上海"],
      organizations: [], items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      characterDetails: { "杨妙菲": { identity: "修士", faction: "散修", goals: "修炼", arcChange: "无" } },
    }
    const report = await runFactCheck([snap1, snap2])
    const conflicts = report.results.filter(r => r.type === "location_conflict")
    expect(conflicts.length).toBe(0)
  })

  it("detects item holder change without transfer event", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: ["神剑"], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      itemDetails: { "神剑": { holder: "张三", previousHolders: "", abilities: "锋利", limitations: "", origin: "" } },
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: ["神剑"], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      itemDetails: { "神剑": { holder: "李四", previousHolders: "张三", abilities: "锋利", limitations: "", origin: "" } },
    }
    const report = await runFactCheck([snap1, snap2])
    const changes = report.results.filter(r => r.type === "item_holder_change")
    expect(changes.length).toBeGreaterThan(0)
  })

  it("detects organization leader flip without power change event", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: ["天剑宗"],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      organizationDetails: { "天剑宗": { leader: "王掌门", members: "", goals: "", resources: "" } },
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: ["天剑宗"],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
      organizationDetails: { "天剑宗": { leader: "李掌门", members: "", goals: "", resources: "" } },
    }
    const report = await runFactCheck([snap1, snap2])
    const flips = report.results.filter(r => r.type === "org_flip")
    expect(flips.length).toBeGreaterThan(0)
  })

  it("detects setting conflict with contradictory facts", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: ["神剑：是上古神器"],
      timelineEvents: [], conflicts: [], endingHook: "",
      graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: ["神剑：不是上古神器"],
      timelineEvents: [], conflicts: [], endingHook: "",
      graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    const conflicts = report.results.filter(r => r.type === "setting_conflict")
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it("detects timeline conflict with exclusive events", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: ["第一天：从北京出发"],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: ["第一天：到达北京"],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    const conflicts = report.results.filter(r => r.type === "timeline_conflict")
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it("returns rule engine time in report", async () => {
    const snap1: ChapterSnapshot = {
      chapterId: "chapter-1", chapterNumber: 1,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const snap2: ChapterSnapshot = {
      chapterId: "chapter-2", chapterNumber: 2,
      summary: "", characters: [], locations: [], organizations: [],
      items: [], events: [],
      characterStateChanges: [], relationshipChanges: [],
      knowledgeChanges: [], foreshadowingChanges: [],
      newCanonFacts: [], timelineEvents: [],
      conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
    }
    const report = await runFactCheck([snap1, snap2])
    expect(report.ruleEngineTime).toBeGreaterThanOrEqual(0)
  })
})
