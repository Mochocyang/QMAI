import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadWorkbenchRevisions } from "./workbench-storage"

/**
 * 只 mock 文件系统与章节列表：本 spec 只钉 loadWorkbenchRevisions 的清洗与既有校验，
 * 不触碰发布路径（那在 workbench-publish.spec.ts 里）。
 */
const io = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error("文件缺失")
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, text: string) => { io.files.set(path, text) },
  createDirectory: async () => {},
  fileExists: async (path: string) => [...io.files.keys()].some((key) => key.startsWith(path)),
  listDirectory: async (path: string) => [...io.files.keys()]
    .filter((key) => key.startsWith(`${path}/`))
    .map((key) => ({ name: key.slice(path.length + 1), path: key, is_dir: false })),
}))
vi.mock("./analysis-engine", () => ({ loadChapterList: async () => [] }))

const bookPath = "/project/book-analysis/book-1"
const revisionsRoot = `${bookPath}/analysis/revisions`

function validRevision(id: string, createdAt: number) {
  return {
    workbenchVersion: 2, id, taskId: id, bookId: "book-1", bookTitle: "测试作品", skill: "characters",
    requirements: "", selectedChapterIds: [], createdAt, evidence: [], coverage: [], items: [],
  }
}
function revisionFile(id: string, body: unknown) {
  io.files.set(`${revisionsRoot}/${id}.json`, JSON.stringify(body))
}

beforeEach(() => { io.files.clear() })

describe("拆书结果读取：removedSubjects 清洗与向后兼容", () => {
  it("缺 removedSubjects 的旧数据照常读出，并为调用方补齐空数组", async () => {
    revisionFile("r-old", validRevision("r-old", 1))
    const [revision] = await loadWorkbenchRevisions(bookPath)
    // 组件渲染时用 revision.removedSubjects.includes(...) 过滤卡片：
    // 缺字段时若留 undefined，组件会直接抛错，所以读取后必须补成 []。
    expect(revision.removedSubjects).toEqual([])
    expect(revision.id).toBe("r-old")
  })

  it("脏 removedSubjects 读出时被清洗成合法列表", async () => {
    revisionFile("r-dirty", { ...validRevision("r-dirty", 2), removedSubjects: ["甲", 7, "", "   ", null, "乙", "甲"] })
    const [revision] = await loadWorkbenchRevisions(bookPath)
    expect(revision.removedSubjects).toEqual(["甲", "乙"])
  })

  it("removedSubjects 完全不是数组时也能读出来，不抛错", async () => {
    revisionFile("r-broken", { ...validRevision("r-broken", 3), removedSubjects: "甲、乙" })
    const [revision] = await loadWorkbenchRevisions(bookPath)
    expect(revision.removedSubjects).toEqual([])
  })

  it("既有严格校验不能放松：版本号、items、evidence 不合法仍然抛错", async () => {
    revisionFile("r-version", { ...validRevision("r-version", 1), workbenchVersion: 1 })
    await expect(loadWorkbenchRevisions(bookPath)).rejects.toThrow("拆书结果版本损坏")

    io.files.clear()
    revisionFile("r-items", { ...validRevision("r-items", 1), items: undefined })
    await expect(loadWorkbenchRevisions(bookPath)).rejects.toThrow("拆书结果版本损坏")

    io.files.clear()
    revisionFile("r-evidence", { ...validRevision("r-evidence", 1), evidence: {} })
    await expect(loadWorkbenchRevisions(bookPath)).rejects.toThrow("拆书结果版本损坏")
  })
})
