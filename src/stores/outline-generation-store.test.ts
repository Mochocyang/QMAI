import { beforeEach, describe, expect, it } from "vitest"
import { useOutlineGenerationStore } from "./outline-generation-store"

beforeEach(() => {
  useOutlineGenerationStore.setState({ tasks: [], panelOpen: false })
})

describe("outline-generation-store", () => {
  it("keeps ingest tasks after the panel closes", () => {
    const store = useOutlineGenerationStore.getState()
    const id = store.createTask({
      projectPath: "/project",
      outlinePath: "/project/wiki/outlines/story-outline.md",
    })

    store.setPanelOpen(false)

    const task = useOutlineGenerationStore.getState().tasks.find((item: { id: string }) => item.id === id)
    expect(task).toBeTruthy()
    expect(task?.kind).toBe("ingest")
    expect(task?.status).toBe("ingesting")
    expect(task?.outlinePath).toBe("/project/wiki/outlines/story-outline.md")
  })

  it("updates ingest tasks with the result message", () => {
    const store = useOutlineGenerationStore.getState()
    const id = store.createTask({
      projectPath: "/project",
      outlinePath: "/project/wiki/outlines/story-outline.md",
    })

    store.updateTask(id, {
      status: "done",
      message: "大纲记忆提取完成。",
    })

    const task = useOutlineGenerationStore.getState().tasks.find((item: { id: string }) => item.id === id)
    expect(task?.status).toBe("done")
    expect(task?.outlinePath).toBe("/project/wiki/outlines/story-outline.md")
    expect(task?.message).toBe("大纲记忆提取完成。")
  })

  it("removes completed tasks", () => {
    const store = useOutlineGenerationStore.getState()
    const id = store.createTask({
      projectPath: "/project",
      outlinePath: "/project/wiki/outlines/story-outline.md",
    })

    store.removeTask(id)

    const task = useOutlineGenerationStore.getState().tasks.find((item: { id: string }) => item.id === id)
    expect(task).toBeUndefined()
  })

  it("stores ingest tasks with the outline path and initial status", () => {
    const store = useOutlineGenerationStore.getState()
    const id = store.createTask({
      projectPath: "/project",
      kind: "ingest",
      outlinePath: "/project/wiki/outlines/story-outline.md",
      status: "ingesting",
      message: "Extracting initial project memory...",
    })

    const task = useOutlineGenerationStore.getState().tasks.find((item: { id: string }) => item.id === id)
    expect(task?.kind).toBe("ingest")
    expect(task?.outlinePath).toBe("/project/wiki/outlines/story-outline.md")
    expect(task?.status).toBe("ingesting")
    expect(task?.message).toBe("Extracting initial project memory...")
  })
})
