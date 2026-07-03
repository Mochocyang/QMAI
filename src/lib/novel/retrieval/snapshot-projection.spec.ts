import { describe, expect, it } from "vitest"
import { projectSnapshotToEntry, updateEntryFromSnapshot, validateEntryConsistency } from "./snapshot-projection"
import type { ChapterSnapshot } from "../chapter-ingest"

function createMockSnapshot(overrides: Partial<ChapterSnapshot> = {}): ChapterSnapshot {
  return {
    chapterId: "ch-001",
    chapterNumber: 1,
    chapterTitle: "初入江湖",
    summary: "主角李明远初入江湖，在青石镇遇到了神秘少女林雨晴。两人因一场误会相识，随后结伴前往青云宗参加入门考核。途中遭遇山贼袭击，李明远展现出惊人的武学天赋，击退了山贼。林雨晴透露自己是青云宗弟子，此次下山是为了寻找失散多年的弟弟。",
    characters: ["李明远", "林雨晴"],
    locations: ["青石镇", "青云宗"],
    organizations: ["青云宗"],
    items: ["青锋剑"],
    events: ["初入江湖", "山贼袭击"],
    characterStateChanges: [
      "李明远：身份-江湖菜鸟，位置-青石镇，情绪-兴奋",
      "林雨晴：身份-青云宗弟子，位置-青石镇，情绪-警惕"
    ],
    relationshipChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges: [
      "新埋伏笔：林雨晴弟弟的下落",
      "新埋伏笔：李明远的身世之谜"
    ],
    newCanonFacts: [],
    timelineEvents: [
      "三月初三-李明远初入江湖",
      "三月初五-遭遇山贼袭击"
    ],
    conflicts: [],
    endingHook: "林雨晴的弟弟到底是谁？",
    graphNodes: [],
    graphEdges: [],
    ...overrides,
  }
}

describe("projectSnapshotToEntry", () => {
  it("projects snapshot to retrieval entry", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "wiki/chapters/volume-1/chapter-001.md",
      volumeName: "第一卷",
      sourceHash: "abc123",
    })

    expect(entry.chapterNumber).toBe(1)
    expect(entry.chapterTitle).toBe("初入江湖")
    expect(entry.filePath).toBe("wiki/chapters/volume-1/chapter-001.md")
    expect(entry.volumeName).toBe("第一卷")
    expect(entry.sourceHash).toBe("abc123")
    expect(entry.indexStatus).toBe("valid")
    expect(entry.summary).toContain("李明远")
    expect(entry.summary).toContain("林雨晴")
    expect(entry.characterStates).toContain("李明远")
    expect(entry.foreshadowingChanges).toContain("新埋伏笔")
    expect(entry.timelineEvents).toContain("三月初三")
    expect(entry.manualNotes).toBe("")
    expect(entry.manualReminders).toBe("")
  })

  it("truncates summary to ~300 words", () => {
    const longSummary = Array(500).fill("测试").join(" ")
    const snapshot = createMockSnapshot({ summary: longSummary })
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })

    const wordCount = entry.summary.split(/\s+/).length
    expect(wordCount).toBeLessThanOrEqual(301)
  })

  it("sets maybe_outdated when no sourceHash", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })

    expect(entry.indexStatus).toBe("maybe_outdated")
    expect(entry.sourceHash).toBe("")
  })

  it("handles empty snapshot fields gracefully", () => {
    const snapshot = createMockSnapshot({
      characterStateChanges: [],
      foreshadowingChanges: [],
      timelineEvents: [],
    })
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })

    expect(entry.characterStates).toBe("无明显变化")
    expect(entry.foreshadowingChanges).toBe("无")
    expect(entry.timelineEvents).toBe("无")
  })
})

describe("updateEntryFromSnapshot", () => {
  it("updates entry fields from new snapshot", () => {
    const oldSnapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(oldSnapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
      sourceHash: "old-hash",
    })

    const newSnapshot = createMockSnapshot({
      chapterTitle: "新标题",
      summary: "新的摘要内容",
    })

    const updated = updateEntryFromSnapshot(entry, newSnapshot, { sourceHash: "new-hash" })

    expect(updated.chapterTitle).toBe("新标题")
    expect(updated.summary).toBe("新的摘要内容")
    expect(updated.sourceHash).toBe("new-hash")
    expect(updated.indexStatus).toBe("valid")
  })

  it("preserves manual notes and reminders", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })
    entry.manualNotes = "人工备注内容"
    entry.manualReminders = "后续提醒内容"

    const updated = updateEntryFromSnapshot(entry, snapshot)

    expect(updated.manualNotes).toBe("人工备注内容")
    expect(updated.manualReminders).toBe("后续提醒内容")
  })

  it("preserves existing sourceHash when not provided", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
      sourceHash: "keep-me",
    })

    const updated = updateEntryFromSnapshot(entry, snapshot)

    expect(updated.sourceHash).toBe("keep-me")
  })
})

describe("validateEntryConsistency", () => {
  it("validates a good entry", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })

    const result = validateEntryConsistency(entry)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it("detects missing chapter number", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })
    entry.chapterNumber = 0

    const result = validateEntryConsistency(entry)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain("章节号无效")
  })

  it("detects missing file path", () => {
    const snapshot = createMockSnapshot()
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "",
      volumeName: "第一卷",
    })

    const result = validateEntryConsistency(entry)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain("文件路径缺失")
  })

  it("detects empty summary", () => {
    const snapshot = createMockSnapshot({ summary: "" })
    const entry = projectSnapshotToEntry(snapshot, {
      filePath: "test.md",
      volumeName: "第一卷",
    })

    const result = validateEntryConsistency(entry)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain("摘要为空")
  })
})
