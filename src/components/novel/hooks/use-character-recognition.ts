import { useCallback } from "react"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { saveRecognizedCharacters } from "@/lib/novel/book-analysis/recognized-character-store"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"
import type { ChapterSelectionData } from "./use-character-extraction"

export interface UseCharacterRecognitionParams {
  chapterSelectionData: ChapterSelectionData | null
  setChapterSelectionData: React.Dispatch<React.SetStateAction<ChapterSelectionData | null>>
  recognizedCharacters: RecognizedCharacter[]
  selectedCharacterIds: string[]
  setRecognitionStatus: (status: "idle" | "heuristic" | "llm_scoring" | "llm_recognizing" | "done" | "error") => void
  setRecognizedCharacters: (characters: RecognizedCharacter[]) => void
  setSelectedCharacterIds: (ids: string[]) => void
  clearRecognition: () => void
  setRecognitionError: (error?: string) => void
  llmConfig: ReturnType<typeof useWikiStore.getState>["llmConfig"]
}

/**
 * 角色识别钩子
 *
 * 从 BookAnalysisView 中提取的角色识别逻辑。
 * 负责在用户选择章节后，使用 LLM 从正文中识别角色，
 * 以及加载已提取的角色、切换勾选等交互。
 */
export function useCharacterRecognition({
  chapterSelectionData,
  setChapterSelectionData,
  recognizedCharacters,
  selectedCharacterIds,
  setRecognitionStatus,
  setRecognizedCharacters,
  setSelectedCharacterIds,
  clearRecognition,
  setRecognitionError,
  llmConfig,
}: UseCharacterRecognitionParams) {
  /**
   * 用户在章节选择面板中确认章节后，启动角色识别流程
   */
  const handleChapterSelectionConfirm = useCallback(async (selectedChapterIds: string[]) => {
    if (!chapterSelectionData) return

    const { taskId, bookPath, abortController } = chapterSelectionData

    setChapterSelectionData({
      ...chapterSelectionData,
      selectedChapterIds,
      depth: "standard",
    })

    clearRecognition()
    setRecognitionStatus("heuristic")
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    updateTaskProgress(taskId, {
      recognitionStatus: "heuristic",
      stageLabel: "读取章节中",
    })

    try {
      const selectedChapters = chapterSelectionData.chapters
        .filter((c) => selectedChapterIds.includes(c.id))
        .sort((a, b) => a.order - b.order)

      const chapterContents: { index: number; content: string }[] = []
      for (let i = 0; i < selectedChapters.length; i++) {
        const ch = selectedChapters[i]
        const chapterPath = joinPath(bookPath, "chapters", `${ch.id}.md`)
        const raw = await readFile(chapterPath)
        const body = raw.replace(/^---[\s\S]*?---\n/, "")
        chapterContents.push({ index: i, content: body.slice(0, 4000) })
        if (abortController.signal.aborted) {
          throw new Error("用户取消")
        }
      }

      if (!llmConfig) {
        throw new Error("未配置可用的模型，请先在设置中配置 LLM，再识别角色")
      }
      setRecognitionStatus("llm_recognizing")
      updateTaskProgress(taskId, {
        recognitionStatus: "llm_recognizing",
        stageLabel: "正在用 AI 识别角色",
      })

      const { llmRecognizeCharacters } = await import(
        "@/lib/novel/book-analysis/character-llm-recognizer"
      )
      const recognized = await llmRecognizeCharacters({
        chapters: chapterContents,
        llmConfig,
        sourceBook: bookPath,
        signal: abortController.signal,
      })

      if (abortController.signal.aborted) throw new Error("用户取消")
      if (recognized.length === 0) {
        throw new Error("AI 没有识别出角色，请确认所选章节包含人物，或更换模型后重试")
      }

      updateTaskProgress(taskId, {
        recognitionStatus: "done",
        recognizedCharactersCount: recognized.length,
        stageLabel: `识别出 ${recognized.length} 个角色（AI 识别）`,
        percentage: 100,
        completed: recognized.length,
        total: recognized.length,
      })
      await saveRecognizedCharacters(bookPath, recognized)
      setRecognizedCharacters(recognized)
      setRecognitionStatus("done")
      toast.success(`识别完成：共 ${recognized.length} 个角色`, {
        label: "现在处理",
        onClick: () => {
          useBookAnalysisStore.getState().requestReopenChapterSelection(taskId)
        },
      })
    } catch (err) {
      if (abortController.signal.aborted) return
      const rawMessage = err instanceof Error ? err.message : "识别失败"
      const isTimeout = /524|timeout|timed out|超时/i.test(rawMessage)
      const errorMessage = isTimeout
        ? `${rawMessage}（请求超时：可少选几章、或更换更快 / 更稳定的模型后重试）`
        : rawMessage
      console.error("[角色识别] 失败：", err)
      setRecognitionStatus("error")
      setRecognitionError(errorMessage)
      updateTaskProgress(taskId, {
        recognitionStatus: "error",
        stageLabel: `角色识别失败：${errorMessage}`,
      })
      toast.error(`角色识别失败：${errorMessage}`)
    }
  }, [chapterSelectionData, setChapterSelectionData, clearRecognition, setRecognitionStatus, setRecognizedCharacters, setRecognitionError, llmConfig])

  const handleToggleCharacter = useCallback((id: string) => {
    setSelectedCharacterIds(
      selectedCharacterIds.includes(id)
        ? selectedCharacterIds.filter((x) => x !== id)
        : [...selectedCharacterIds, id],
    )
  }, [selectedCharacterIds, setSelectedCharacterIds])

  const handleSelectAllMain = useCallback(() => {
    const ids = recognizedCharacters
      .filter((c) => c.category === "主角" || c.category === "配角")
      .map((c) => c.id)
    setSelectedCharacterIds(ids)
  }, [recognizedCharacters, setSelectedCharacterIds])

  const handleClearSelection = useCallback(() => {
    setSelectedCharacterIds([])
  }, [setSelectedCharacterIds])

  return {
    handleChapterSelectionConfirm,
    handleToggleCharacter,
    handleSelectAllMain,
    handleClearSelection,
  }
}
