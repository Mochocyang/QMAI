import { beforeEach, describe, expect, it } from "vitest"
import { useImportProgressStore } from "./import-progress-store"

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
})
