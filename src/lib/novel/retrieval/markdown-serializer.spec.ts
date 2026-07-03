import { describe, expect, it } from "vitest"
import {
  serializeEntryToMarkdown,
  deserializeEntryFromMarkdown,
  parseVolumeEntries,
  serializeVolumeEntries,
} from "./markdown-serializer"
import type { RetrievalEntry } from "./types"

function createMockEntry(overrides: Partial<RetrievalEntry> = {}): RetrievalEntry {
  return {
    chapterNumber: 1,
    chapterTitle: "初入江湖",
    filePath: "wiki/chapters/volume-1/chapter-001.md",
    volumeName: "第一卷",
    summary: "主角李明远初入江湖...",
    characterStates: "李明远：身份-江湖菜鸟；林雨晴：身份-青云宗弟子",
    foreshadowingChanges: "新埋伏笔：林雨晴弟弟；新埋伏笔：李明远身世",
    timelineEvents: "三月初三-初入江湖；三月初五-山贼袭击",
    sourceHash: "abc123",
    indexStatus: "valid",
    manualNotes: "这里埋的伏笔要在第三卷回收",
    manualReminders: "别忘了李明远的玉佩",
    ...overrides,
  }
}

describe("serializeEntryToMarkdown", () => {
  it("serializes entry to markdown with correct structure", () => {
    const entry = createMockEntry()
    const markdown = serializeEntryToMarkdown(entry)

    expect(markdown).toContain("## 第1章 - 初入江湖")
    expect(markdown).toContain("<!-- qmai:auto:start -->")
    expect(markdown).toContain("<!-- qmai:auto:end -->")
    expect(markdown).toContain("<!-- qmai:manual:start -->")
    expect(markdown).toContain("<!-- qmai:manual:end -->")
    expect(markdown).toContain("- 文件路径：wiki/chapters/volume-1/chapter-001.md")
    expect(markdown).toContain("- 章节号：1")
    expect(markdown).toContain("- 所属卷：第一卷")
    expect(markdown).toContain("- 摘要：主角李明远初入江湖...")
    expect(markdown).toContain("- 人物状态变化：李明远")
    expect(markdown).toContain("- 伏笔变化：新埋伏笔")
    expect(markdown).toContain("- 时间线事件：三月初三")
    expect(markdown).toContain("- sourceHash：abc123")
    expect(markdown).toContain("- 索引状态：有效")
    expect(markdown).toContain("- 人工备注：这里埋的伏笔要在第三卷回收")
    expect(markdown).toContain("- 后续提醒：别忘了李明远的玉佩")
  })

  it("puts auto section before manual section", () => {
    const entry = createMockEntry()
    const markdown = serializeEntryToMarkdown(entry)

    const autoStart = markdown.indexOf("<!-- qmai:auto:start -->")
    const manualStart = markdown.indexOf("<!-- qmai:manual:start -->")
    expect(autoStart).toBeLessThan(manualStart)
  })
})

describe("deserializeEntryFromMarkdown", () => {
  it("deserializes markdown back to entry", () => {
    const entry = createMockEntry()
    const markdown = serializeEntryToMarkdown(entry)
    const deserialized = deserializeEntryFromMarkdown(markdown)

    expect(deserialized).not.toBeNull()
    expect(deserialized!.chapterNumber).toBe(1)
    expect(deserialized!.chapterTitle).toBe("初入江湖")
    expect(deserialized!.filePath).toBe("wiki/chapters/volume-1/chapter-001.md")
    expect(deserialized!.volumeName).toBe("第一卷")
    expect(deserialized!.summary).toBe("主角李明远初入江湖...")
    expect(deserialized!.sourceHash).toBe("abc123")
    expect(deserialized!.indexStatus).toBe("valid")
    expect(deserialized!.manualNotes).toBe("这里埋的伏笔要在第三卷回收")
    expect(deserialized!.manualReminders).toBe("别忘了李明远的玉佩")
  })

  it("round-trip preserves data", () => {
    const original = createMockEntry()
    const markdown = serializeEntryToMarkdown(original)
    const deserialized = deserializeEntryFromMarkdown(markdown)
    expect(deserialized!.characterStates).toBe(original.characterStates)
    expect(deserialized!.foreshadowingChanges).toBe(original.foreshadowingChanges)
    expect(deserialized!.timelineEvents).toBe(original.timelineEvents)
  })

  it("returns null for invalid markdown", () => {
    const result = deserializeEntryFromMarkdown("# 不是有效的条目\n随便写点什么")
    expect(result).toBeNull()
  })

  it("handles empty manual section", () => {
    const entry = createMockEntry({ manualNotes: "", manualReminders: "" })
    const markdown = serializeEntryToMarkdown(entry)
    const deserialized = deserializeEntryFromMarkdown(markdown)

    expect(deserialized).not.toBeNull()
    expect(deserialized!.manualNotes).toBe("")
    expect(deserialized!.manualReminders).toBe("")
  })

  it("parses different index statuses", () => {
    const validEntry = createMockEntry({ indexStatus: "valid" })
    const validMd = serializeEntryToMarkdown(validEntry)
    expect(deserializeEntryFromMarkdown(validMd)!.indexStatus).toBe("valid")

    const outdatedEntry = createMockEntry({ indexStatus: "maybe_outdated" })
    const outdatedMd = serializeEntryToMarkdown(outdatedEntry)
    expect(deserializeEntryFromMarkdown(outdatedMd)!.indexStatus).toBe("maybe_outdated")

    const conflictEntry = createMockEntry({ indexStatus: "conflict" })
    const conflictMd = serializeEntryToMarkdown(conflictEntry)
    expect(deserializeEntryFromMarkdown(conflictMd)!.indexStatus).toBe("conflict")
  })
})

describe("parseVolumeEntries / serializeVolumeEntries", () => {
  it("serializes and parses multiple entries", () => {
    const entries: RetrievalEntry[] = [
      createMockEntry({ chapterNumber: 1, chapterTitle: "第一章" }),
      createMockEntry({ chapterNumber: 2, chapterTitle: "第二章" }),
      createMockEntry({ chapterNumber: 3, chapterTitle: "第三章" }),
    ]

    const markdown = serializeVolumeEntries(entries, "第一卷")
    expect(markdown).toContain("# 第一卷")
    expect(markdown).toContain("## 第1章")
    expect(markdown).toContain("## 第2章")
    expect(markdown).toContain("## 第3章")

    const parsed = parseVolumeEntries(markdown)
    expect(parsed).toHaveLength(3)
    expect(parsed[0].chapterNumber).toBe(1)
    expect(parsed[1].chapterNumber).toBe(2)
    expect(parsed[2].chapterNumber).toBe(3)
  })

  it("sorts entries by chapter number when serializing", () => {
    const entries: RetrievalEntry[] = [
      createMockEntry({ chapterNumber: 3 }),
      createMockEntry({ chapterNumber: 1 }),
      createMockEntry({ chapterNumber: 2 }),
    ]

    const markdown = serializeVolumeEntries(entries, "测试卷")
    const parsed = parseVolumeEntries(markdown)

    expect(parsed[0].chapterNumber).toBe(1)
    expect(parsed[1].chapterNumber).toBe(2)
    expect(parsed[2].chapterNumber).toBe(3)
  })

  it("preserves manual notes through round-trip", () => {
    const entries: RetrievalEntry[] = [
      createMockEntry({
        chapterNumber: 1,
        manualNotes: "重要的人工备注",
        manualReminders: "不能忘记的提醒",
      }),
    ]

    const markdown = serializeVolumeEntries(entries, "第一卷")
    const parsed = parseVolumeEntries(markdown)

    expect(parsed[0].manualNotes).toBe("重要的人工备注")
    expect(parsed[0].manualReminders).toBe("不能忘记的提醒")
  })

  it("returns empty array for empty volume", () => {
    const parsed = parseVolumeEntries("# 空卷\n\n没有章节")
    expect(parsed).toHaveLength(0)
  })
})
