import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChapterSnapshot } from "./chapter-ingest"
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

vi.mock("./chapter-ingest", () => ({
  listSnapshots: vi.fn(),
  loadSnapshot: vi.fn(),
}))

import { readFile } from "@/commands/fs"
import {
  buildMemoryCenterSnapshotCards,
  buildMemoryCenterStats,
  loadMemoryCenterData,
  parseMemoryMarkdownPreview,
} from "./memory-center"
import { listSnapshots, loadSnapshot } from "./chapter-ingest"

const mockReadFile = vi.mocked(readFile)
const mockListSnapshots = vi.mocked(listSnapshots)
const mockLoadSnapshot = vi.mocked(loadSnapshot)

function makeSnapshot(partial: Partial<ChapterSnapshot>): ChapterSnapshot {
  return {
    chapterId: partial.chapterId ?? `chapter-${partial.chapterNumber ?? 1}`,
    chapterNumber: partial.chapterNumber ?? 1,
    summary: partial.summary ?? "",
    characters: partial.characters ?? [],
    locations: partial.locations ?? [],
    organizations: partial.organizations ?? [],
    items: partial.items ?? [],
    events: partial.events ?? [],
    characterStateChanges: partial.characterStateChanges ?? [],
    relationshipChanges: partial.relationshipChanges ?? [],
    knowledgeChanges: partial.knowledgeChanges ?? [],
    foreshadowingChanges: partial.foreshadowingChanges ?? [],
    newCanonFacts: partial.newCanonFacts ?? [],
    timelineEvents: partial.timelineEvents ?? [],
    conflicts: partial.conflicts ?? [],
    endingHook: partial.endingHook ?? "",
    graphNodes: partial.graphNodes ?? [],
    graphEdges: partial.graphEdges ?? [],
    memorySyncedAt: partial.memorySyncedAt,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockReadFile.mockReset()
  mockListSnapshots.mockReset()
  mockLoadSnapshot.mockReset()
})

describe("memory-center", () => {
  it("builds newest-first snapshot cards and trims long change lists", () => {
    const cards = buildMemoryCenterSnapshotCards([
      makeSnapshot({
        chapterNumber: 2,
        summary: "楚白外出试炼，第一次见到雷池残阵。",
        characterStateChanges: ["楚白：离宗历练", "楚白：开始勤加修炼", "楚白：摸到雷法门槛"],
        knowledgeChanges: ["楚白知道宗门大比提前三年开始选拔"],
        foreshadowingChanges: ["新增伏笔：雷池钥匙"],
        timelineEvents: ["第2章：楚白离开宗门"],
      }),
      makeSnapshot({
        chapterNumber: 5,
        summary: "楚白在雷池机缘中突破，开始为宗门大比蓄势。",
        characterStateChanges: ["楚白：炼气七层", "楚白：获得雷池淬体机会", "楚白：心态更稳"],
        knowledgeChanges: ["楚白知道外门长老暗中观察自己"],
        foreshadowingChanges: ["推进伏笔：雷池钥匙", "新增伏笔：外门长老真实目的"],
        timelineEvents: ["第5章：楚白完成雷池试炼"],
        endingHook: "三个月后宗门大比名册将定。",
        memorySyncedAt: "2026-05-27T00:00:00.000Z",
      }),
    ], 6, 2)

    expect(cards).toHaveLength(2)
    expect(cards[0].chapterNumber).toBe(5)
    expect(cards[0].characterStateChanges).toEqual(["楚白：炼气七层", "楚白：获得雷池淬体机会"])
    expect(cards[0].hasMoreCharacterStateChanges).toBe(true)
    expect(cards[0].memorySynced).toBe(true)
  })

  it("parses headed memory markdown into preview sections", () => {
    const preview = parseMemoryMarkdownPreview(`
# 人物状态记忆

## 当前正式状态

### 楚白
- 当前状态：炼气七层
- 最近更新：第5章

### 苏青雨
- 当前状态：闭关准备宗门大比

## 候选区

- 楚白似乎已经察觉外门长老另有图谋
`, 3, 2, 2)

    expect(preview).toHaveLength(2)
    expect(preview[0].title).toBe("当前正式状态")
    expect(preview[0].groups[0]).toEqual({
      title: "楚白",
      items: ["当前状态：炼气七层", "最近更新：第5章"],
    })
    expect(preview[1].items).toEqual(["楚白似乎已经察觉外门长老另有图谋"])
  })

  it("builds memory center stats from snapshots and memory previews", () => {
    const stats = buildMemoryCenterStats(
      buildMemoryCenterSnapshotCards([
        makeSnapshot({ chapterNumber: 4, memorySyncedAt: "2026-05-27T00:00:00.000Z" }),
        makeSnapshot({ chapterNumber: 5 }),
      ]),
      [
        {
          key: "character-states",
          title: "人物状态记忆",
          path: "/project/wiki/memory/character-states.md",
          sections: [
            {
              title: "当前正式状态",
              groups: [
                { title: "楚白", items: ["当前状态：炼气七层"] },
                { title: "苏青雨", items: ["当前状态：闭关"] },
              ],
              items: [],
            },
          ],
        },
        {
          key: "foreshadowing-tracker",
          title: "伏笔追踪记忆",
          path: "/project/wiki/memory/foreshadowing-tracker.md",
          sections: [
            {
              title: "进行中",
              groups: [{ title: "雷池钥匙", items: ["状态：推进中"] }],
              items: [],
            },
            {
              title: "已完成",
              groups: [{ title: "黑玉令来历", items: ["状态：已完成"] }],
              items: [],
            },
          ],
        },
      ],
    )

    expect(stats.snapshotCount).toBe(2)
    expect(stats.syncedSnapshotCount).toBe(1)
    expect(stats.characterCount).toBe(2)
    expect(stats.activeForeshadowingCount).toBe(1)
    expect(stats.memoryFileCount).toBe(2)
  })

  it("loadMemoryCenterData 保留最近 10 条章节快照，不会被意外裁成 6 条", async () => {
    mockListSnapshots.mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    mockLoadSnapshot.mockImplementation(async (_projectPath: string, chapterNumber: number) => (
      makeSnapshot({
        chapterNumber,
        summary: `第 ${chapterNumber} 章摘要`,
      })
    ))
    mockReadFile.mockRejectedValue(new Error("memory file missing"))

    const data = await loadMemoryCenterData("E:/Novel")

    expect(data.stats.snapshotCount).toBe(10)
    expect(data.snapshots).toHaveLength(10)
    expect(data.snapshots[0]?.chapterNumber).toBe(10)
    expect(data.snapshots[9]?.chapterNumber).toBe(1)
  })
})
