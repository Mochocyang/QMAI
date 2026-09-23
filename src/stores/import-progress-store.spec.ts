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
