import { beforeEach, describe, expect, it } from "vitest"
import { useBookAnalysisStore } from "./book-analysis-store"

describe("book analysis store", () => {
  beforeEach(() => {
    useBookAnalysisStore.setState({
      tasks: [],
      currentTaskId: null,
      selectedResultPath: null,
      currentResult: null,
      showResultViewer: false,
    })
  })

  it("updates book id and chapters without mutating a task object outside zustand", () => {
    const taskId = useBookAnalysisStore.getState().startTask("E:/Novel", {
      sourceType: "file",
      sourcePath: "E:/Books/long.txt",
      selectedChapters: [],
    })

    useBookAnalysisStore.getState().updateTaskBookData(taskId, "book-123", [
      {
        id: "ch-0001",
        title: "第一章 风起",
        order: 1,
        wordCount: 3200,
        path: "E:/Novel/book-analysis/book-123/chapters/ch-0001.md",
      },
    ])

    const task = useBookAnalysisStore.getState().getTask(taskId)
    expect(task?.bookId).toBe("book-123")
    expect(task?.chapters).toHaveLength(1)
    expect(task?.chapters?.[0].title).toBe("第一章 风起")
  })
})
