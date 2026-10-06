import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AnalysisOutcome } from "@/lib/novel/book-analysis/analysis-activity"
import type { BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
const mock = vi.hoisted(() => ({
  files: new Map<string, string>(), success: vi.fn(), error: vi.fn(), info: vi.fn(), select: vi.fn(), view: vi.fn(),
  project: "/project",
}))
vi.mock("@/commands/fs", () => ({
  fileExists: async (p: string) => mock.files.has(p), readFile: async (p: string) => mock.files.get(p)!,
  createDirectory: async () => {}, writeFileAtomic: async (p: string, s: string) => { mock.files.set(p, s) },
}))
vi.mock("@/lib/toast", () => ({ toast: { success: mock.success, error: mock.error, info: mock.info } }))
vi.mock("./wiki-store", () => ({ useWikiStore: { getState: () => ({ project: { path: mock.project }, setActiveView: mock.view }) } }))
vi.mock("./book-analysis-store", () => ({ useBookAnalysisStore: { getState: () => ({ setSelectedLibraryBookId: mock.select }) } }))
import { openBookAnalysisOutcome, syncBookAnalysisActivities, useBookAnalysisActivityStore as store } from "./book-analysis-activity-store"
const file = "/project/.qmai/book-analysis-notifications.json"
const event = (id: string): AnalysisOutcome => ({ id, projectPath: "/project", taskId: "task", bookId: "book", skill: "style", title: "文风完成", status: "completed", message: "结果待确认", createdAt: 1 })
beforeEach(() => { mock.files.clear(); vi.clearAllMocks(); mock.project = "/project"; store.setState({ projectPath: null, outcomes: [], error: null }) })
describe("拆书通知持久化", () => {
  it("并发结果不相互覆盖，重新打开后仍保留通知", async () => {
    await store.getState().initializeProject("/project")
    await Promise.all([store.getState().record(event("one")), store.getState().record(event("two"))])
    expect(JSON.parse(mock.files.get(file)!)).toHaveLength(2)
    store.setState({ projectPath: null, outcomes: [] })
    await store.getState().initializeProject("/project")
    expect(store.getState().outcomes).toHaveLength(2)
    expect(mock.success).not.toHaveBeenCalled()
  })
  it("只在新终态转换弹出，恢复和相同状态不重复弹窗", async () => {
    const before = { workbenchVersion: 2, id: "task", projectPath: "/project", bookId: "book", bookTitle: "书",
      selectedSkills: ["style"], status: "running", modules: { style: { status: "running", completedChunkIds: [], chunkIds: ["c1"], updatedAt: 1 } },
    } as unknown as BookAnalysisPipelineTask
    const after = structuredClone(before); after.status = "completed"; after.modules.style.status = "completed"
    await store.getState().initializeProject("/project")
    syncBookAnalysisActivities({ projectPath: "/project", tasks: [before] }, { projectPath: "/project", tasks: [] })
    syncBookAnalysisActivities({ projectPath: "/project", tasks: [after] }, { projectPath: "/project", tasks: [before] })
    syncBookAnalysisActivities({ projectPath: "/project", tasks: [after] }, { projectPath: "/project", tasks: [after] })
    await vi.waitFor(() => expect(mock.files.has(file)).toBe(true))
    expect(mock.success).toHaveBeenCalledOnce()
    expect(store.getState().outcomes[0].message).toBe(mock.success.mock.calls[0][0])
    expect(JSON.parse(mock.files.get(file)!)).toHaveLength(1)
  })
  it("损坏的通知文件不被新结果覆盖", async () => {
    mock.files.set(file, "不是JSON")
    await store.getState().initializeProject("/project")
    expect(store.getState().error).toBeTruthy()
    await expect(store.getState().record(event("one"))).rejects.toThrow()
    expect(mock.files.get(file)).toBe("不是JSON")
  })
  it("查看结果定位作品，跨项目不误切当前作品", () => {
    openBookAnalysisOutcome(event("one"))
    expect(mock.select).toHaveBeenCalledWith("book")
    expect(mock.view).toHaveBeenCalledWith("bookAnalysis")
    expect(store.getState().navigation).toMatchObject({ bookId: "book", skill: "style", taskId: "task" })
    vi.clearAllMocks(); mock.project = "/other"
    openBookAnalysisOutcome(event("one"))
    expect(mock.select).not.toHaveBeenCalled()
    expect(mock.info).toHaveBeenCalled()
  })
})
