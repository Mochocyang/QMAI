import { beforeEach, describe, expect, it } from "vitest"
import {
  MAX_SETTLED_IMPORT_TASKS,
  retainRecentImportProgressTasks,
  useImportProgressStore,
  type ImportProgressTask,
} from "./import-progress-store"

function settledTask(id: string, updatedAt: number): ImportProgressTask {
  return {
    id,
    projectPath: "E:/Novel",
    kind: "chapter",
    status: "done",
    completed: 1,
    total: 1,
    currentTitle: "",
    cancelling: false,
    createdAt: updatedAt,
    updatedAt,
  }
}

describe("import progress store", () => {
  beforeEach(() => {
    useImportProgressStore.setState({ tasks: [] })
  })

  it("keeps chapter memory extraction progress outside the sidebar component", () => {
    const id = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 6,
      currentTitle: "第1章",
    })

    useImportProgressStore.getState().updateTask(id, {
      completed: 2,
      currentTitle: "第3章",
    })

    const task = useImportProgressStore.getState().getLatestTask("E:/Novel")
    expect(task?.kind).toBe("chapter")
    expect(task?.status).toBe("running")
    expect(task?.completed).toBe(2)
    expect(task?.total).toBe(6)
    expect(task?.currentTitle).toBe("第3章")
  })

  /**
   * 「哪一章正在提取」必须按**路径**记，不能靠 currentTitle：
   * 同一本书里两章重名（「第3章 无名」这类）时，按标题匹配会让两行同时亮起
   * 「提取中」，而实际只提取了一章。
   */
  it("records which chapters are being extracted by path", () => {
    const id = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 2,
      currentTitle: "第1章",
      activeChapterPaths: ["E:/Novel/wiki/chapters/第1章.md"],
    })

    expect(useImportProgressStore.getState().tasks[0]?.activeChapterPaths)
      .toEqual(["E:/Novel/wiki/chapters/第1章.md"])

    useImportProgressStore.getState().updateTask(id, {
      activeChapterPaths: ["E:/Novel/wiki/chapters/第2章.md"],
    })
    expect(useImportProgressStore.getState().tasks[0]?.activeChapterPaths)
      .toEqual(["E:/Novel/wiki/chapters/第2章.md"])
  })

  it("defaults active chapter paths to empty rather than undefined", () => {
    useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 1,
      currentTitle: "第1章",
    })
    expect(useImportProgressStore.getState().tasks[0]?.activeChapterPaths).toEqual([])
  })

  /**
   * 结束即清空，且由 store 自己保证 —— 不依赖每个调用点都记得清。
   * 漏清一次，那一行就会永远显示「提取中」，而它其实早就提取完了。
   */
  it("clears active chapter paths when the task finishes, even if the caller forgets", () => {
    const id = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 1,
      currentTitle: "第1章",
      activeChapterPaths: ["E:/Novel/wiki/chapters/第1章.md"],
    })
    useImportProgressStore.getState().finishTask(id, "done", { completed: 1, currentTitle: "" })
    expect(useImportProgressStore.getState().tasks[0]?.activeChapterPaths).toEqual([])
  })

  it("clears active chapter paths when the task is cancelled", () => {
    const id = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 1,
      currentTitle: "第1章",
      activeChapterPaths: ["E:/Novel/wiki/chapters/第1章.md"],
    })
    useImportProgressStore.getState().cancelTask(id)
    expect(useImportProgressStore.getState().tasks[0]?.activeChapterPaths).toEqual([])
  })

  it("keeps the newest settled tasks and drops older ones", () => {
    const kept = retainRecentImportProgressTasks([
      settledTask("old-1", 1),
      settledTask("old-2", 2),
      settledTask("old-3", 3),
      settledTask("old-4", 4),
      {
        ...settledTask("running", 5),
        status: "running",
        completed: 0,
      },
    ])

    expect(kept.filter((task) => task.status === "running").map((task) => task.id)).toEqual(["running"])
    expect(kept.filter((task) => task.status === "done").map((task) => task.id)).toEqual([
      "old-4",
      "old-3",
      "old-2",
    ])
    expect(MAX_SETTLED_IMPORT_TASKS).toBe(3)
  })

  it("keeps the latest finished task after a new extraction starts", () => {
    const doneId = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 1,
      currentTitle: "第1章",
    })
    useImportProgressStore.getState().finishTask(doneId, "done")

    const runningId = useImportProgressStore.getState().startTask({
      projectPath: "E:/Novel",
      kind: "chapter",
      total: 1,
      currentTitle: "第2章",
    })

    const tasks = useImportProgressStore.getState().tasks
    expect(tasks.map((task) => task.id)).toEqual([runningId, doneId])
    expect(tasks[0]?.status).toBe("running")
    expect(tasks[1]?.status).toBe("done")
  })

  it("prunes settled history down to the latest three", () => {
    useImportProgressStore.setState({
      tasks: [
        settledTask("old-1", 1),
        settledTask("old-2", 2),
        settledTask("old-3", 3),
        settledTask("old-4", 4),
      ],
    })

    useImportProgressStore.getState().pruneSettledTasks()
    expect(useImportProgressStore.getState().tasks.map((task) => task.id)).toEqual([
      "old-4",
      "old-3",
      "old-2",
    ])
  })
})
