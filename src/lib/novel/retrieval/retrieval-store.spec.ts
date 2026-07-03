import { describe, expect, it, beforeEach } from "vitest"
import { RetrievalStore, type FsAdapter } from "./retrieval-store"
import type { ChapterSnapshot } from "../chapter-ingest"

function createMockFs(): { fs: FsAdapter; files: Map<string, string> } {
  const files = new Map<string, string>()

  const fs: FsAdapter = {
    readFile: async (path: string) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      return content
    },
    writeFile: async (path: string, content: string) => {
      files.set(path, content)
    },
    fileExists: async (path: string) => files.has(path),
    listDirectory: async (dirPath: string) => {
      const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/"
      const result: string[] = []
      for (const fullPath of files.keys()) {
        if (fullPath.startsWith(prefix)) {
          const rest = fullPath.slice(prefix.length)
          if (rest && !rest.includes("/")) {
            result.push(rest)
          }
        }
      }
      return result
    },
    createDirectory: async (_path: string) => {},
    joinPath: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
  }

  return { fs, files }
}

function createMockSnapshot(overrides: Partial<ChapterSnapshot> = {}): ChapterSnapshot {
  return {
    chapterId: `ch-${String(overrides.chapterNumber || 1).padStart(3, "0")}`,
    chapterNumber: 1,
    chapterTitle: "测试章节",
    summary: "这是测试章节的摘要内容，描述了故事的发展。",
    characters: ["角色A", "角色B"],
    locations: ["地点A"],
    organizations: [],
    items: [],
    events: [],
    characterStateChanges: [
      "角色A：身份-主角，位置-地点A，情绪-平静"
    ],
    relationshipChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges: ["新埋伏笔：测试伏笔"],
    newCanonFacts: [],
    timelineEvents: ["时间点A-事件A"],
    conflicts: [],
    endingHook: "",
    graphNodes: [],
    graphEdges: [],
    ...overrides,
  }
}

describe("RetrievalStore", () => {
  let store: RetrievalStore
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    store = new RetrievalStore("/test-project", mockFs.fs, { chaptersPerVolume: 10 })
  })

  it("initially has no index", async () => {
    expect(await store.hasIndex()).toBe(false)
  })

  it("builds index from snapshots", async () => {
    const snapshots = Array.from({ length: 15 }, (_, i) =>
      createMockSnapshot({
        chapterNumber: i + 1,
        chapterTitle: `第${i + 1}章标题`,
      })
    )

    await store.buildFromSnapshots(
      snapshots,
      (s) => `wiki/chapters/chapter-${String(s.chapterNumber).padStart(3, "0")}.md`,
      (_s) => "hash-abc"
    )

    expect(await store.hasIndex()).toBe(true)

    const entries = await store.getAllEntries()
    expect(entries).toHaveLength(15)
    expect(entries[0].chapterNumber).toBe(1)
    expect(entries[14].chapterNumber).toBe(15)
  })

  it("splits into volumes correctly", async () => {
    const snapshots = Array.from({ length: 25 }, (_, i) =>
      createMockSnapshot({ chapterNumber: i + 1 })
    )

    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash"
    )

    const volumes = await store.getVolumes()
    expect(volumes).toHaveLength(3)
    expect(volumes[0].name).toBe("第1卷")
    expect(volumes[0].chapterStart).toBe(1)
    expect(volumes[0].chapterEnd).toBe(10)
    expect(volumes[1].name).toBe("第2卷")
    expect(volumes[1].chapterStart).toBe(11)
    expect(volumes[1].chapterEnd).toBe(20)
    expect(volumes[2].name).toBe("第3卷")
    expect(volumes[2].chapterStart).toBe(21)
    expect(volumes[2].chapterEnd).toBe(25)
  })

  it("chapterToVolumeName maps correctly", () => {
    expect(store.chapterToVolumeName(1)).toBe("第1卷")
    expect(store.chapterToVolumeName(10)).toBe("第1卷")
    expect(store.chapterToVolumeName(11)).toBe("第2卷")
    expect(store.chapterToVolumeName(20)).toBe("第2卷")
    expect(store.chapterToVolumeName(21)).toBe("第3卷")
  })

  it("updates single chapter entry", async () => {
    const snapshots = Array.from({ length: 5 }, (_, i) =>
      createMockSnapshot({ chapterNumber: i + 1 })
    )

    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash-old"
    )

    const newSnapshot = createMockSnapshot({
      chapterNumber: 3,
      chapterTitle: "更新后的第三章",
      summary: "新的摘要内容",
    })

    await store.updateChapterEntry(3, newSnapshot, {
      filePath: "ch-003.md",
      sourceHash: "hash-new",
    })

    const entry = await store.getEntry(3)
    expect(entry).not.toBeNull()
    expect(entry!.chapterTitle).toBe("更新后的第三章")
    expect(entry!.sourceHash).toBe("hash-new")
  })

  it("adds new chapter via updateChapterEntry", async () => {
    const snapshots = [createMockSnapshot({ chapterNumber: 1 })]
    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash"
    )

    const newSnapshot = createMockSnapshot({ chapterNumber: 100, chapterTitle: "第100章" })
    await store.updateChapterEntry(100, newSnapshot, {
      filePath: "ch-100.md",
      sourceHash: "hash-100",
    })

    const entry = await store.getEntry(100)
    expect(entry).not.toBeNull()
    expect(entry!.chapterTitle).toBe("第100章")
    expect(entry!.volumeName).toBe("第10卷")
  })

  it("validates entry hash", async () => {
    const snapshots = [createMockSnapshot({ chapterNumber: 1 })]
    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "correct-hash"
    )

    const validResult = await store.validateEntry(1, "correct-hash")
    expect(validResult.valid).toBe(true)
    expect(validResult.status).toBe("valid")

    const invalidResult = await store.validateEntry(1, "wrong-hash")
    expect(invalidResult.valid).toBe(false)
    expect(invalidResult.status).toBe("maybe_outdated")
  })

  it("returns null for non-existent entry", async () => {
    const snapshots = [createMockSnapshot({ chapterNumber: 1 })]
    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash"
    )

    const entry = await store.getEntry(999)
    expect(entry).toBeNull()
  })

  it("builds inverted index", async () => {
    const snapshots = [
      createMockSnapshot({
        chapterNumber: 1,
        foreshadowingChanges: ["新埋伏笔：伏笔A", "新埋伏笔：伏笔B"],
      }),
      createMockSnapshot({
        chapterNumber: 2,
        foreshadowingChanges: ["回收伏笔：伏笔A"],
      }),
    ]

    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash"
    )

    const inverted = await store.getInvertedIndex()
    expect(inverted.foreshadowing).toBeDefined()
  })

  it("caches results after first load", async () => {
    const snapshots = [createMockSnapshot({ chapterNumber: 1 })]
    await store.buildFromSnapshots(
      snapshots,
      (s) => `ch-${s.chapterNumber}.md`,
      () => "hash"
    )

    store.invalidateCache()

    const first = await store.getAllEntries()
    const second = await store.getAllEntries()
    expect(first).toBe(second)
  })

  it("volumeNameToFileName maps correctly", () => {
    expect(store.volumeNameToFileName("第1卷")).toBe("volume-1.md")
    expect(store.volumeNameToFileName("第12卷")).toBe("volume-12.md")
  })
})
