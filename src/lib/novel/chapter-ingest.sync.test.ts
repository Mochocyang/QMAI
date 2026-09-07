import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import type { ChapterSnapshot } from "./chapter-ingest"
import { clearGraphCache, buildRetrievalGraph } from "@/lib/graph-relevance"
import { deleteChapterSnapshots, listSnapshotHistory, syncSnapshotToMemory } from "./chapter-ingest"

const files = new Map<string, string>()
const dirs = new Set<string>()

function normalizePathForTest(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "")
}

function parentDir(path: string): string {
  const normalized = normalizePathForTest(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

function ensureDir(path: string): void {
  const normalized = normalizePathForTest(path)
  if (!normalized) return
  const parts = normalized.split("/")
  for (let i = 1; i <= parts.length; i += 1) {
    dirs.add(parts.slice(0, i).join("/"))
  }
}

function writeTestFile(path: string, content: string): void {
  const normalized = normalizePathForTest(path)
  ensureDir(parentDir(normalized))
  files.set(normalized, content)
}

function listDirRecursive(path: string): FileNode[] {
  const normalized = normalizePathForTest(path)
  const childDirs = new Set<string>()
  const childFiles: FileNode[] = []

  for (const filePath of files.keys()) {
    if (!filePath.startsWith(`${normalized}/`)) continue
    const rest = filePath.slice(normalized.length + 1)
    const [first] = rest.split("/")
    if (!first) continue
    if (rest.includes("/")) {
      childDirs.add(first)
    } else {
      childFiles.push({ name: first, path: filePath, is_dir: false })
    }
  }

  return [
    ...Array.from(childDirs).sort().map((name) => {
      const dirPath = `${normalized}/${name}`
      return { name, path: dirPath, is_dir: true, children: listDirRecursive(dirPath) }
    }),
    ...childFiles.sort((a, b) => a.name.localeCompare(b.name)),
  ]
}

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    const normalized = normalizePathForTest(path)
    const content = files.get(normalized)
    if (content === undefined) throw new Error(`missing file: ${normalized}`)
    return content
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    writeTestFile(path, content)
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    writeTestFile(path, content)
  }),
  listDirectory: vi.fn(async (path: string) => {
    const normalized = normalizePathForTest(path)
    if (!dirs.has(normalized)) throw new Error(`missing dir: ${normalized}`)
    return listDirRecursive(normalized)
  }),
  fileExists: vi.fn(async (path: string) => {
    const normalized = normalizePathForTest(path)
    return files.has(normalized) || dirs.has(normalized)
  }),
  createDirectory: vi.fn(async (path: string) => {
    ensureDir(path)
  }),
  deleteFile: vi.fn(async (path: string) => {
    const normalized = normalizePathForTest(path)
    files.delete(normalized)
    dirs.delete(normalized)
  }),
}))

const syncedSnapshot: ChapterSnapshot = {
  chapterId: "chapter-1",
  chapterNumber: 1,
  summary: "新的设定已经改成灵石。",
  characters: [],
  locations: [],
  organizations: [],
  items: ["灵石"],
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

const syncedOutlineSnapshot: ChapterSnapshot = {
  ...syncedSnapshot,
  chapterId: "outline-main",
  chapterNumber: -1,
  chapterTitle: "总大纲",
}

describe("syncSnapshotToMemory", () => {
  beforeEach(() => {
    files.clear()
    dirs.clear()
    clearGraphCache()
    ensureDir("/project/wiki/entities")
    ensureDir("/project/wiki/chapters")
    ensureDir("/project/.novel/snapshots")
    writeTestFile("/project/wiki/chapters/chapter-001.md", [
      "---",
      "type: chapter",
      "chapter_number: 1",
      "chapter_status: final",
      "---",
      "",
      "# 第一章",
    ].join("\n"))
    writeTestFile("/project/wiki/entities/手机.md", [
      "---",
      "type: entity",
      'title: "手机"',
      "tags: [item]",
      'sources: ["001.snapshot.json"]',
      "---",
      "",
      "# 手机",
      "",
      "旧的手机设定。",
    ].join("\n"))
  })

  it("刷新同步后的图谱缓存，避免章节生成继续读取旧实体", async () => {
    const beforeSync = await buildRetrievalGraph("/project")
    expect(Array.from(beforeSync.nodes.values()).map((node) => node.title)).toContain("手机")

    await syncSnapshotToMemory("/project", syncedSnapshot)

    const afterSync = await buildRetrievalGraph("/project")
    const titles = Array.from(afterSync.nodes.values()).map((node) => node.title)
    expect(titles).not.toContain("手机")
    expect(titles).toContain("灵石")
  })

  it("同步大纲快照时清理旧格式来源名留下的旧实体", async () => {
    clearGraphCache()
    files.delete(normalizePathForTest("/project/wiki/entities/手机.md"))
    writeTestFile("/project/wiki/entities/手机.md", [
      "---",
      "type: entity",
      'title: "手机"',
      "tags: [item]",
      'sources: ["0-1.snapshot.json"]',
      "---",
      "",
      "# 手机",
      "",
      "旧的大纲手机设定。",
    ].join("\n"))

    await syncSnapshotToMemory("/project", syncedOutlineSnapshot)

    const afterSync = await buildRetrievalGraph("/project")
    const titles = Array.from(afterSync.nodes.values()).map((node) => node.title)
    expect(titles).not.toContain("手机")
    expect(titles).toContain("灵石")
  })

  it("鍚屾澶х翰蹇収鏃朵細鐢熸垚鍙洖鐪嬬殑鍘嗗彶蹇収", async () => {
    writeTestFile("/project/.novel/snapshots/outline-001.snapshot.json", JSON.stringify({
      ...syncedOutlineSnapshot,
      summary: "鍚屾鍓嶇殑澶х翰蹇収",
    }, null, 2))

    await syncSnapshotToMemory("/project", syncedOutlineSnapshot)

    const history = await listSnapshotHistory("/project", syncedOutlineSnapshot.chapterNumber)
    expect(history).toHaveLength(1)
    const backupContent = files.get(normalizePathForTest(history[0].path))
    expect(backupContent).toContain("鍚屾鍓嶇殑澶х翰蹇収")
    expect(backupContent).not.toContain("memorySyncedAt")
  })
  it("writes revision metadata to the current snapshot and archives the superseded snapshot as history", async () => {
    writeTestFile("/project/.novel/snapshots/001.snapshot.json", JSON.stringify({
      ...syncedSnapshot,
      summary: "old synced snapshot",
      sourceType: "chapter",
      sourceSequence: 1,
      revision: 1,
      snapshotId: "chapter-1-r1",
      isHistorical: false,
    }, null, 2))

    await syncSnapshotToMemory("/project", syncedSnapshot)

    const current = JSON.parse(files.get("/project/.novel/snapshots/001.snapshot.json") ?? "{}")
    expect(current.sourceType).toBe("chapter")
    expect(current.sourceSequence).toBe(1)
    expect(current.revision).toBe(2)
    expect(current.snapshotId).toBe("chapter-1-r2")
    expect(current.supersedes).toBe("chapter-1-r1")
    expect(current.isHistorical).toBe(false)
    expect(current.memorySyncedAt).toEqual(expect.any(String))

    const history = await listSnapshotHistory("/project", 1)
    expect(history).toHaveLength(1)
    const archived = JSON.parse(files.get(normalizePathForTest(history[0].path)) ?? "{}")
    expect(archived.revision).toBe(1)
    expect(archived.snapshotId).toBe("chapter-1-r1")
    expect(archived.isHistorical).toBe(true)
  })

  it("removes stale projection pages that only belong to the superseded snapshot id", async () => {
    writeTestFile("/project/.novel/snapshots/001.snapshot.json", JSON.stringify({
      ...syncedSnapshot,
      summary: "old synced snapshot",
      sourceType: "chapter",
      sourceSequence: 1,
      revision: 1,
      snapshotId: "chapter-1-r1",
      isHistorical: false,
    }, null, 2))
    writeTestFile("/project/wiki/entities/mobile-phone.md", [
      "---",
      "type: entity",
      'title: "手机"',
      'snapshot_id: "chapter-1-r1"',
      'source_type: "chapter"',
      "source_sequence: 1",
      "source_revision: 1",
      "is_historical: false",
      "sources: []",
      "---",
      "",
      "# 手机",
      "",
      "旧的手机设定。",
    ].join("\n"))

    await syncSnapshotToMemory("/project", syncedSnapshot)

    expect(files.has("/project/wiki/entities/mobile-phone.md")).toBe(false)
  })

  it("clears derived memory files when deleting the last snapshot", async () => {
    const snapshotWithMemory: ChapterSnapshot = {
      ...syncedSnapshot,
      knowledgeChanges: ["主角: 误以为手机仍在手里"],
      characterStateChanges: ["主角: 正在追查旧手机"],
      foreshadowingChanges: ["新增伏笔: 旧手机 - 屏幕仍会亮"],
    }
    writeTestFile("/project/.novel/snapshots/001.snapshot.json", JSON.stringify(snapshotWithMemory, null, 2))
    await syncSnapshotToMemory("/project", snapshotWithMemory)

    expect(files.get("/project/wiki/memory/chapter-snapshots.md")).toContain("新的设定")

    await deleteChapterSnapshots("/project", 1)

    expect(files.has("/project/.novel/snapshots/001.snapshot.json")).toBe(false)
    expect(files.get("/project/wiki/memory/chapter-snapshots.md")).not.toContain("新的设定")
    expect(files.get("/project/wiki/memory/character-cognition.md")).not.toContain("误以为手机")
    expect(files.get("/project/wiki/memory/character-states.md")).not.toContain("正在追查")
    expect(files.get("/project/wiki/memory/foreshadowing-tracker.md")).not.toContain("旧手机")
  })
})
