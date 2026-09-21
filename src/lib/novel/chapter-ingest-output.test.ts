import { describe, expect, it } from "vitest"
import type { ChapterSnapshot } from "./chapter-ingest"
import { buildChapterIngestOutput } from "./chapter-ingest-output"

const snapshot: ChapterSnapshot = {
  chapterId: "chapter-12",
  chapterNumber: 12,
  summary: "林烬在黑塔发现太子隐藏的旧案线索。",
  characters: ["林烬", "太子"],
  locations: ["黑塔"],
  organizations: ["巡夜司"],
  items: ["黑玉令"],
  events: ["黑塔密谈"],
  characterStateChanges: ["林烬：确认太子与旧案有关"],
  relationshipChanges: ["林烬->SUSPECTS->太子"],
  knowledgeChanges: ["林烬知道太子与旧案有关", "太子不知道林烬已进入黑塔"],
  foreshadowingChanges: ["推进伏笔：黑玉令来源"],
  newCanonFacts: ["黑塔只允许巡夜司进入"],
  timelineEvents: ["子夜：林烬潜入黑塔"],
  conflicts: ["林烬与太子的暗线冲突升级"],
  endingHook: "黑玉令在墙中发出回响。",
  graphNodes: ["secret:黑玉令真相"],
  graphEdges: ["event:黑塔密谈->REVEALS->secret:黑玉令真相"],
  characterDetails: {
    "林烬": {
      identity: "巡夜司暗探",
      faction: "巡夜司",
      goals: "追查旧案真相",
      arcChange: "从怀疑转向确认太子涉案",
    },
    "太子": {
      identity: "皇朝太子",
      faction: "太子党",
      goals: "掩盖旧案",
      arcChange: "对林烬的警惕加深",
    },
  },
  locationDetails: {
    "黑塔": {
      region: "皇城北区",
      type: "密牢",
      controller: "巡夜司",
      hiddenInfo: "塔中藏有旧案证物",
    },
  },
  organizationDetails: {
    "巡夜司": {
      leader: "未知",
      members: "林烬等暗探",
      goals: "维护皇城秩序",
      resources: "黑塔控制权、旧案档案",
    },
  },
  itemDetails: {
    "黑玉令": {
      holder: "太子",
      previousHolders: "原黑玉令持有者",
      abilities: "未揭示",
      limitations: "未揭示",
      origin: "不明",
    },
  },
  eventDetails: {
    "黑塔密谈": {
      cause: "林烬潜入黑塔调查旧案",
      process: "林烬在塔中发现黑玉令回响，确认太子涉案",
      relatedForeshadowing: "黑玉令来源",
      relatedConflicts: "林烬与太子暗线冲突",
      followUpItems: "追查黑玉令铸造记录",
    },
  },
}

describe("chapter ingest output contracts", () => {
  it("builds chapter wiki fields used by shared Wiki ingestion", () => {
    const output = buildChapterIngestOutput(snapshot, {
      title: "黑塔回响",
      volume: "第二卷",
      chapterGoal: "揭示太子与旧案的关联",
      outlineNodeIds: ["outline:第二卷:旧案"],
      sourceQuotes: ["太子抚过黑玉令，低声说旧案不可再提。"],
      now: "2026-05-22T08:00:00.000Z",
    })

    expect(output.snapshotWikiFields).toMatchObject({
      chapterNumber: 12,
      title: "黑塔回响",
      volume: "第二卷",
      chapterGoal: "揭示太子与旧案的关联",
      summary: snapshot.summary,
      keyPlots: snapshot.events,
      endingHook: snapshot.endingHook,
      outlineNodeIds: ["outline:第二卷:旧案"],
      canonStatus: "confirmed",
      createdAt: "2026-05-22T08:00:00.000Z",
      updatedAt: "2026-05-22T08:00:00.000Z",
    })
    expect(output.snapshotWikiFields.sourceQuotes).toEqual(["太子抚过黑玉令，低声说旧案不可再提。"])
  })

  it("keeps chapter ending state separate from the ending hook", () => {
    const output = buildChapterIngestOutput(snapshot, {
      endingState: "林烬确认太子与旧案有关，太子尚未察觉林烬进入黑塔。",
      now: "2026-05-22T08:00:00.000Z",
    })

    expect(output.snapshotWikiFields.endingState).toBe("林烬确认太子与旧案有关，太子尚未察觉林烬进入黑塔。")
    expect(output.snapshotWikiFields.endingHook).toBe("黑玉令在墙中发出回响。")
  })

  it("builds traceable shared Wiki update patch entries", () => {
    const output = buildChapterIngestOutput(snapshot, { now: "2026-05-22T08:00:00.000Z" })

    expect(output.wikiUpdatePatch.sharedWiki).toBe(true)
    expect(output.wikiUpdatePatch.entries.map((entry) => entry.entryType)).toEqual(
      expect.arrayContaining(["chapter", "character", "location", "organization", "item", "event", "foreshadowing", "secret", "timeline", "canon-rule", "conflict"]),
    )
    expect(output.wikiUpdatePatch.entries).toContainEqual(
      expect.objectContaining({
        entryId: "chapter:12",
        entryType: "chapter",
        title: "第12章",
        mergeStrategy: "merge-by-entry-id",
        sources: [expect.objectContaining({ chapterNumber: 12, snapshotId: "chapter-12" })],
      }),
    )
    expect(output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "character:林烬")?.fields).toMatchObject({
      appearanceChapters: [12],
      currentState: "确认太子与旧案有关",
      cognition: {
        knows: ["太子与旧案有关"],
      },
      latestChangeSource: "chapter-12",
    })
    expect(output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "conflict:林烬与太子的暗线冲突升级")?.fields).toMatchObject({
      name: "林烬与太子的暗线冲突升级",
      chapterNumber: 12,
      participants: ["林烬", "太子"],
      relatedEvents: ["黑塔密谈"],
      latestChangeSource: "chapter-12",
    })
  })

  it("将 snapshot 的 Details 字段编入对应的 Wiki 条目 fields 中", () => {
    const output = buildChapterIngestOutput(snapshot, { now: "2026-05-22T08:00:00.000Z" })

    const linJin = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "character:林烬")
    expect(linJin?.fields).toMatchObject({
      identity: "巡夜司暗探",
      faction: "巡夜司",
      goals: "追查旧案真相",
      arcChange: "从怀疑转向确认太子涉案",
    })

    const crownPrince = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "character:太子")
    expect(crownPrince?.fields).toMatchObject({
      identity: "皇朝太子",
      faction: "太子党",
      goals: "掩盖旧案",
      arcChange: "对林烬的警惕加深",
    })

    const blackTower = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "location:黑塔")
    expect(blackTower?.fields).toMatchObject({
      region: "皇城北区",
      type: "密牢",
      controller: "巡夜司",
      hiddenInfo: "塔中藏有旧案证物",
    })

    const patrol = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "organization:巡夜司")
    expect(patrol?.fields).toMatchObject({
      leader: "未知",
      members: "林烬等暗探",
      goals: "维护皇城秩序",
      resources: "黑塔控制权、旧案档案",
    })

    const token = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "item:黑玉令")
    expect(token?.fields).toMatchObject({
      holder: "太子",
      previousHolders: "原黑玉令持有者",
      abilities: "未揭示",
      limitations: "未揭示",
      origin: "不明",
    })

    const event = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "event:黑塔密谈")
    expect(event?.fields).toMatchObject({
      cause: "林烬潜入黑塔调查旧案",
      process: "林烬在塔中发现黑玉令回响，确认太子涉案",
      relatedForeshadowing: "黑玉令来源",
      relatedConflicts: "林烬与太子暗线冲突",
      followUpItems: "追查黑玉令铸造记录",
    })
  })

  it("不包含 Details 字段的旧快照仍可正常构建输出（向后兼容）", () => {
    const oldSnapshot: ChapterSnapshot = {
      chapterId: "chapter-5",
      chapterNumber: 5,
      summary: "一场普通的早朝。",
      characters: ["林烬"],
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
    const output = buildChapterIngestOutput(oldSnapshot, { now: "2026-05-22T08:00:00.000Z" })
    expect(output.wikiUpdatePatch.sharedWiki).toBe(true)
    expect(output.wikiUpdatePatch.entries).toHaveLength(2)
    const character = output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "character:林烬")
    expect(character?.fields?.identity).toBeUndefined()
  })

  it("builds graph derivation candidates with source-backed nodes and edges", () => {
    const output = buildChapterIngestOutput(snapshot, { now: "2026-05-22T08:00:00.000Z" })

    expect(output.graphDerivation.nodes).toContainEqual(
      expect.objectContaining({ id: "character:林烬", type: "character", source: expect.objectContaining({ snapshotId: "chapter-12" }) }),
    )
    expect(output.graphDerivation.nodes).toContainEqual(
      expect.objectContaining({ id: "secret:黑玉令真相", type: "secret" }),
    )
    expect(output.graphDerivation.edges).toContainEqual(
      expect.objectContaining({ source: "character:林烬", target: "chapter:12", relation: "APPEARS_IN" }),
    )
    expect(output.graphDerivation.edges).toContainEqual(
      expect.objectContaining({ source: "event:黑塔密谈", target: "secret:黑玉令真相", relation: "REVEALS" }),
    )
  })

  it("merges character aliases into one canonical character before building memory output", () => {
    const aliasSnapshot: ChapterSnapshot = {
      chapterId: "chapter-1",
      chapterNumber: 1,
      summary: "楚念念在村口出现，叶有芝认出她就是二丫。",
      characters: ["念念", "楚念念", "二丫", "叶有芝"],
      characterAliases: {
        "楚念念": ["念念", "二丫"],
      },
      locations: [],
      organizations: [],
      items: [],
      events: [],
      characterStateChanges: ["念念：被叶有芝认出旧名二丫"],
      relationshipChanges: ["二丫->ALLY_OF->叶有芝"],
      knowledgeChanges: [],
      foreshadowingChanges: [],
      newCanonFacts: [],
      timelineEvents: [],
      conflicts: [],
      endingHook: "",
      graphNodes: ["character:念念", "character:二丫", "character:叶有芝"],
      graphEdges: ["念念->ALLY_OF->叶有芝"],
      characterDetails: {
        "念念": {
          identity: "小女孩",
          faction: "村里",
          goals: "回家",
          arcChange: "被重新认出",
        },
      },
    }

    const output = buildChapterIngestOutput(aliasSnapshot, { now: "2026-05-22T08:00:00.000Z" })
    const characterEntryIds = output.wikiUpdatePatch.entries
      .filter((entry) => entry.entryType === "character")
      .map((entry) => entry.entryId)

    expect(characterEntryIds).toEqual(["character:楚念念", "character:叶有芝"])
    expect(output.wikiUpdatePatch.entries.find((entry) => entry.entryId === "character:楚念念")?.fields).toMatchObject({
      name: "楚念念",
      aliases: ["念念", "二丫"],
      currentState: "被叶有芝认出旧名二丫",
      identity: "小女孩",
    })
    expect(output.graphDerivation.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "character:楚念念",
      "character:叶有芝",
    ]))
    expect(output.graphDerivation.nodes.map((node) => node.id)).not.toContain("character:念念")
    expect(output.graphDerivation.nodes.map((node) => node.id)).not.toContain("character:二丫")
    expect(output.graphDerivation.edges).toContainEqual(
      expect.objectContaining({ source: "character:楚念念", target: "character:叶有芝", relation: "ALLY_OF" }),
    )
  })

  it("builds separated keyword search and vector index text", () => {
    const output = buildChapterIngestOutput(snapshot, { now: "2026-05-22T08:00:00.000Z" })

    expect(output.searchIndexText.documentId).toBe("chapter:12")
    expect(output.searchIndexText.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "摘要", content: snapshot.summary, weight: 3 }),
        expect.objectContaining({ name: "人物", content: "林烬\n太子", weight: 2 }),
        expect.objectContaining({ name: "伏笔", content: "推进伏笔：黑玉令来源", weight: 3 }),
        expect.objectContaining({ name: "冲突", content: "林烬与太子的暗线冲突升级", weight: 3 }),
      ]),
    )
    expect(output.vectorIndexText.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "summary", text: snapshot.summary }),
        expect.objectContaining({ kind: "conflict", text: "林烬与太子的暗线冲突升级" }),
        expect.objectContaining({ kind: "canon", text: "黑塔只允许巡夜司进入" }),
        expect.objectContaining({ kind: "timeline", text: "子夜：林烬潜入黑塔" }),
      ]),
    )
  })
})
