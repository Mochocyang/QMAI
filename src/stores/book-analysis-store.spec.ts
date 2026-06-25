import { beforeEach, describe, expect, it } from "vitest"
import { useBookAnalysisStore } from "./book-analysis-store"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"

describe("book analysis store", () => {
  beforeEach(() => {
    useBookAnalysisStore.setState({
      tasks: [],
      currentTaskId: null,
      selectedResultPath: null,
      currentResult: null,
      showResultViewer: false,
      // 角色识别状态也重置（feature/character-recognition-and-simple-mode）
      recognitionStatus: "idle",
      recognizedCharacters: [],
      selectedCharacterIds: [],
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

describe("book analysis store 角色识别 actions (feature/character-recognition-and-simple-mode)", () => {
  const sampleCharacters: RecognizedCharacter[] = [
    { id: "1", name: "许七安", aliases: [], appearances: 3, chapterIndices: [0, 1, 2], importanceScore: 95, category: "主角", sourceBook: "长夜书" },
    { id: "2", name: "临安公主", aliases: [], appearances: 2, chapterIndices: [0, 1], importanceScore: 60, category: "配角", sourceBook: "长夜书" },
  ]

  beforeEach(() => {
    useBookAnalysisStore.setState({
      recognitionStatus: "idle",
      recognizedCharacters: [],
      selectedCharacterIds: [],
    })
  })

  it("setRecognitionStatus 改 status", () => {
    const { setRecognitionStatus } = useBookAnalysisStore.getState()
    setRecognitionStatus("heuristic")
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("heuristic")
    setRecognitionStatus("llm_scoring")
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("llm_scoring")
    setRecognitionStatus("error")
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("error")
  })

  it("setRecognizedCharacters 同时改 status 为 done + 写入列表", () => {
    const { setRecognizedCharacters, setRecognitionStatus } = useBookAnalysisStore.getState()
    setRecognitionStatus("llm_scoring")  // 先改成 llm_scoring
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("llm_scoring")
    setRecognizedCharacters(sampleCharacters)
    expect(useBookAnalysisStore.getState().recognizedCharacters).toEqual(sampleCharacters)
    // 关键：写入时自动切到 done
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("done")
  })

  it("setSelectedCharacterIds 改 ids", () => {
    const { setSelectedCharacterIds } = useBookAnalysisStore.getState()
    setSelectedCharacterIds(["1", "2"])
    expect(useBookAnalysisStore.getState().selectedCharacterIds).toEqual(["1", "2"])
    setSelectedCharacterIds([])
    expect(useBookAnalysisStore.getState().selectedCharacterIds).toEqual([])
  })

  it("clearRecognition 重置所有识别状态", () => {
    const { setRecognitionStatus, setRecognizedCharacters, setSelectedCharacterIds, clearRecognition } = useBookAnalysisStore.getState()
    setRecognitionStatus("done")
    setRecognizedCharacters(sampleCharacters)
    setSelectedCharacterIds(["1"])
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("done")
    expect(useBookAnalysisStore.getState().recognizedCharacters).toHaveLength(2)
    expect(useBookAnalysisStore.getState().selectedCharacterIds).toHaveLength(1)

    clearRecognition()
    expect(useBookAnalysisStore.getState().recognitionStatus).toBe("idle")
    expect(useBookAnalysisStore.getState().recognizedCharacters).toEqual([])
    expect(useBookAnalysisStore.getState().selectedCharacterIds).toEqual([])
  })
})
