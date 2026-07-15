import { beforeEach, describe, expect, it } from "vitest"
import { selectProjectDeAiTasks, useDeAiTaskStore } from "./de-ai-task-store"

describe("de-ai task store project isolation", () => {
  beforeEach(() => {
    useDeAiTaskStore.setState({
      tasks: [],
      reviewByProject: {},
    })
  })

  it("selects only tasks that belong to the current project", () => {
    const firstId = useDeAiTaskStore.getState().startTask({
      projectPath: "C:/Novel-A",
      chapterPath: "C:/Novel-A/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: "skill-a",
      skillName: "自然叙事",
      skillContent: "保留角色语气",
      modelName: "model-a",
      sourceContent: "原文 A",
    })
    useDeAiTaskStore.getState().startTask({
      projectPath: "C:/Novel-B",
      chapterPath: "C:/Novel-B/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: "skill-b",
      skillName: "克制表达",
      skillContent: "减少解释",
      modelName: "model-b",
      sourceContent: "原文 B",
    })

    const selected = selectProjectDeAiTasks(useDeAiTaskStore.getState().tasks, "c:\\Novel-A\\")

    expect(selected.map((task) => task.id)).toEqual([firstId])
  })

  it("keeps case-sensitive project paths isolated on macOS and Linux", () => {
    const upperId = useDeAiTaskStore.getState().startTask({
      projectPath: "/Books/Novel",
      chapterPath: "/Books/Novel/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: null,
      skillName: "默认",
      skillContent: "",
      modelName: "model-a",
      sourceContent: "项目 A",
    })
    const lowerId = useDeAiTaskStore.getState().startTask({
      projectPath: "/Books/novel",
      chapterPath: "/Books/novel/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: null,
      skillName: "默认",
      skillContent: "",
      modelName: "model-b",
      sourceContent: "项目 B",
    })

    expect(selectProjectDeAiTasks(useDeAiTaskStore.getState().tasks, "/Books/Novel").map((task) => task.id)).toEqual([upperId])
    expect(selectProjectDeAiTasks(useDeAiTaskStore.getState().tasks, "/Books/novel").map((task) => task.id)).toEqual([lowerId])

    useDeAiTaskStore.getState().finishTask(upperId, "候选 A")
    useDeAiTaskStore.getState().finishTask(lowerId, "候选 B")
    expect(Object.keys(useDeAiTaskStore.getState().reviewByProject)).toEqual(
      expect.arrayContaining(["/Books/Novel", "/Books/novel"]),
    )
  })

  it("retains the selected skill content for regeneration", () => {
    const taskId = useDeAiTaskStore.getState().startTask({
      projectPath: "C:/Novel",
      chapterPath: "C:/Novel/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: "skill-a",
      skillName: "自然叙事",
      skillContent: "保留角色语气和叙事节奏",
      modelName: "model-a",
      sourceContent: "原文",
    })

    const task = useDeAiTaskStore.getState().tasks.find((item) => item.id === taskId)
    expect(task?.skillContent).toBe("保留角色语气和叙事节奏")
  })

  it("keeps review visibility and confirmed-task cleanup isolated by project", () => {
    const firstId = useDeAiTaskStore.getState().startTask({
      projectPath: "C:/Novel-A",
      chapterPath: "C:/Novel-A/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: "skill-a",
      skillName: "自然叙事",
      skillContent: "保留角色语气",
      modelName: "model-a",
      sourceContent: "原文 A",
    })
    const secondId = useDeAiTaskStore.getState().startTask({
      projectPath: "C:/Novel-B",
      chapterPath: "C:/Novel-B/wiki/chapters/1.md",
      chapterTitle: "第一章",
      skillId: "skill-b",
      skillName: "克制表达",
      skillContent: "减少解释",
      modelName: "model-b",
      sourceContent: "原文 B",
    })

    useDeAiTaskStore.getState().finishTask(firstId, "候选 A")
    useDeAiTaskStore.getState().finishTask(secondId, "候选 B")

    const reviewByProject = (useDeAiTaskStore.getState() as unknown as {
      reviewByProject?: Record<string, { open: boolean; chapterId: string | null }>
    }).reviewByProject
    expect(reviewByProject?.["c:/novel-a"]).toEqual({ open: true, chapterId: firstId })
    expect(reviewByProject?.["c:/novel-b"]).toEqual({ open: true, chapterId: secondId })

    useDeAiTaskStore.getState().confirmTask(firstId)
    useDeAiTaskStore.getState().confirmTask(secondId)
    useDeAiTaskStore.getState().closeReview("C:/Novel-A")

    const state = useDeAiTaskStore.getState()
    expect(state.tasks.some((task) => task.id === firstId)).toBe(false)
    expect(state.tasks.some((task) => task.id === secondId)).toBe(true)
    const reviews = (state as unknown as {
      reviewByProject?: Record<string, { open: boolean; chapterId: string | null }>
    }).reviewByProject
    expect(reviews?.["c:/novel-a"]?.open).toBe(false)
    expect(reviews?.["c:/novel-b"]?.open).toBe(true)
  })
})
