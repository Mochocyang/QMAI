import { useState, useCallback } from "react"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import type {
  AnalysisDepth,
  ExtractedCharacter,
  RecognizedCharacter,
} from "@/lib/novel/book-analysis/types"
import type { BookAnalysisMetadata } from "@/lib/novel/book-analysis/types"

export interface ChapterSelectionData {
  taskId: string
  bookPath: string
  chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }>
  metadata: BookAnalysisMetadata
  abortController: AbortController
  selectedChapterIds: string[]
  depth: AnalysisDepth
  extractionPhase?: "deep" | "simple" | null
}

export interface UseCharacterExtractionParams {
  chapterSelectionData: ChapterSelectionData | null
  setChapterSelectionData: React.Dispatch<React.SetStateAction<ChapterSelectionData | null>>
  recognizedCharacters: RecognizedCharacter[]
  selectedCharacterIds: string[]
  reloadLibraryState: () => Promise<void>
}

/**
 * 角色特征提取钩子
 *
 * 从 BookAnalysisView 中提取的角色深度提取、简单提取和失败重试逻辑。
 * 这三类操作共享相同的 LLM 配置解析和任务进度更新模式。
 */
export function useCharacterExtraction({
  chapterSelectionData,
  setChapterSelectionData,
  recognizedCharacters,
  selectedCharacterIds,
  reloadLibraryState,
}: UseCharacterExtractionParams) {
  const [extracting, setExtracting] = useState(false)

  const resolveLlmConfig = useCallback(() => {
    const storeState = useWikiStore.getState()
    return resolveDefaultModel(storeState.llmConfig)
  }, [])

  /**
   * 6 维度深度提取：跑原 6 维流程，提取后过滤到用户勾选的角色
   */
  const handleDeepExtract = useCallback(async () => {
    if (!chapterSelectionData) return
    const { taskId, bookPath, metadata, abortController, selectedChapterIds, depth } = chapterSelectionData
    const userPicked = recognizedCharacters.filter((c) => selectedCharacterIds.includes(c.id))
    if (userPicked.length === 0) return

    setExtracting(true)
    setChapterSelectionData({
      ...chapterSelectionData,
      extractionPhase: "deep",
    })

    const llmConfig = resolveLlmConfig()
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters
    const updateTaskSkills = useBookAnalysisStore.getState().updateTaskSkills
    const completeTask = useBookAnalysisStore.getState().completeTask
    const errorTaskFn = useBookAnalysisStore.getState().errorTask

    try {
      const { extractCharactersFromChapters } = await import(
        "@/lib/novel/book-analysis/character-extraction-engine"
      )

      const extractionResult = await extractCharactersFromChapters({
        bookPath,
        selectedChapterIds,
        llmConfig,
        depth,
        bookTitle: metadata.title,
        bookAuthor: metadata.author,
        onProgress: (progress) => {
          updateTaskProgress(taskId, {
            stage: progress.stage as any,
            stageLabel: progress.stageLabel,
            completed: progress.completed,
            total: progress.total,
            percentage: progress.percentage,
            currentItem: progress.currentItem,
            currentCharacter: (progress as any).currentCharacter,
            currentDimension: (progress as any).currentDimension,
            dimensions: (progress as any).dimensions,
          })
        },
        signal: abortController.signal,
      })

      if (!extractionResult.success) {
        errorTaskFn(taskId, "6 维度提取失败")
        return
      }

      const pickedNames = new Set(userPicked.map((c) => c.name))
      const filteredCharacters: ExtractedCharacter[] = extractionResult.characters.filter((c) =>
        pickedNames.has(c.name),
      )
      updateTaskCharacters(taskId, filteredCharacters)

      // 持久化角色到磁盘，确保 loadCharacters 能读到（6 维度分析可能只保存了部分角色）
      const { persistCharacterToDisk } = await import(
        "@/lib/novel/book-analysis/character-disk-store"
      )
      for (const character of filteredCharacters) {
        try {
          await persistCharacterToDisk(bookPath, character)
        } catch (err) {
          console.warn(`[深度提取] 持久化角色 ${character.name} 失败:`, err)
        }
      }

      const { generateSkillsForCharacters } = await import(
        "@/lib/novel/book-analysis/skill-generator"
      )
      const skills = await generateSkillsForCharacters(
        filteredCharacters,
        metadata,
        bookPath,
        llmConfig,
        (progress) => {
          updateTaskProgress(taskId, {
            stage: progress.stage as any,
            stageLabel: progress.stageLabel,
            completed: progress.completed,
            total: progress.total,
            percentage: progress.percentage,
            currentItem: progress.currentItem,
          })
        },
        abortController.signal,
      )
      updateTaskSkills(taskId, skills)
      completeTask(taskId)
      await reloadLibraryState()
      useBookAnalysisStore.getState().triggerSidebarRefresh()
      toast.success("深度提取完成")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
        toast.error(`深度提取失败：${errorMessage}`)
      }
    } finally {
      setExtracting(false)
    }
  }, [chapterSelectionData, recognizedCharacters, selectedCharacterIds, setChapterSelectionData, resolveLlmConfig, reloadLibraryState])

  /**
   * 简单提取：跑新 4 字段流程
   */
  const handleSimpleExtract = useCallback(async () => {
    if (!chapterSelectionData) return
    const { taskId, bookPath, metadata, abortController, selectedChapterIds } = chapterSelectionData
    const userPicked = recognizedCharacters.filter((c) => selectedCharacterIds.includes(c.id))
    if (userPicked.length === 0) return

    setExtracting(true)
    setChapterSelectionData({
      ...chapterSelectionData,
      extractionPhase: "simple",
    })

    const llmConfig = resolveLlmConfig()
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters
    const updateTaskSkills = useBookAnalysisStore.getState().updateTaskSkills
    const completeTask = useBookAnalysisStore.getState().completeTask
    const errorTaskFn = useBookAnalysisStore.getState().errorTask

    try {
      const selectedChapters = chapterSelectionData.chapters
        .filter((c) => selectedChapterIds.includes(c.id))
        .sort((a, b) => a.order - b.order)

      const samples: string[] = []
      for (let i = 0; i < selectedChapters.length; i++) {
        const ch = selectedChapters[i]
        const chapterPath = joinPath(bookPath, "chapters", `${ch.id}.md`)
        const raw = await readFile(chapterPath)
        const body = raw.replace(/^---[\s\S]*?---\n/, "")
        samples.push(`【第 ${i + 1} 章】\n${body.slice(0, 1500)}`)
        if (abortController.signal.aborted) throw new Error("用户取消")
      }
      const chapterSamples = samples.join("\n\n")

      updateTaskProgress(taskId, {
        stage: "extracting_characters",
        stageLabel: "简单提取角色特征中",
        simpleExtractionStatus: "running",
        simpleExtractionCompleted: 0,
        simpleExtractionTotal: userPicked.length,
      })

      if (!llmConfig) {
        throw new Error("未配置 LLM，请先在设置中配置 LLM 后再提取")
      }
      const { streamChat } = await import("@/lib/llm-client")
      const realLlmCall = async (prompt: string): Promise<string> => {
        let response = ""
        await streamChat(
          llmConfig,
          [{ role: "user", content: prompt }],
          {
            onToken: (text) => { response += text },
            onDone: () => {},
            onError: (err) => { console.error("[simple-extract] LLM error:", err) },
          },
          abortController.signal,
        )
        return response.trim()
      }

      const { extractSingleProfile } = await import(
        "@/lib/novel/book-analysis/simple-extraction-engine"
      )
      const completedProfiles: Array<{
        name: string
        profile: { personality: string; motivation: string; speechStyle: string; behaviorPatterns: string; quotes: string[] }
        error?: string
        errorKind?: string
      }> = []
      const failedNames: string[] = []
      let networkFailure = false

      for (let i = 0; i < userPicked.length; i++) {
        if (abortController.signal.aborted) throw new Error("用户取消")
        const character = userPicked[i]
        updateTaskProgress(taskId, {
          stage: "extracting_characters",
          stageLabel: `简单提取 ${i + 1}/${userPicked.length}：${character.name}`,
          simpleExtractionStatus: "running",
          simpleExtractionCompleted: i,
          simpleExtractionTotal: userPicked.length,
        })
        const singleResult = await extractSingleProfile({
          character,
          chapterSamples,
          llmConfig,
          signal: abortController.signal,
          _llmCall: realLlmCall,
        })
        completedProfiles.push({
          name: singleResult.name,
          profile: singleResult.profile,
          error: singleResult.error,
          errorKind: singleResult.errorKind,
        })
        if (singleResult.error) {
          failedNames.push(character.name)
          if (singleResult.errorKind === "network") networkFailure = true
        }
        updateTaskProgress(taskId, {
          simpleExtractionCompleted: i + 1,
          simpleExtractionTotal: userPicked.length,
        })
      }

      const succeeded = completedProfiles.length - failedNames.length
      const errorSummary = failedNames.length > 0
        ? `（失败 ${failedNames.length} 个：${failedNames.slice(0, 3).join("、")}${failedNames.length > 3 ? "..." : ""}）`
        : ""
      const errorKindLabel = networkFailure
        ? "网络中断"
        : (failedNames.length > 0 ? "提取出错" : "")
      const resumeHint = failedNames.length > 0
        ? "，点击任务卡上的『继续生成』按钮可重试失败的角色"
        : ""
      updateTaskProgress(taskId, {
        stageLabel: `${errorKindLabel ? errorKindLabel + "：" : ""}成功 ${succeeded}/${userPicked.length}${errorSummary}${resumeHint}`,
        simpleExtractionStatus: failedNames.length > 0 ? "partial" : "done",
      })

      const currentTask = useBookAnalysisStore.getState().tasks.find((t) => t.id === taskId)
      if (currentTask) {
        updateTaskProgress(taskId, {})
        useBookAnalysisStore.setState((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  metadata: {
                    ...(t.metadata ?? {}),
                    failedCharacterNames: failedNames,
                    networkFailure,
                  } as any,
                }
              : t,
          ),
        }))
      }

      const result = {
        profiles: completedProfiles.map((p) => ({ name: p.name, profile: p.profile })),
        error: failedNames.length > 0
          ? `${errorKindLabel}：${failedNames.length} 个角色失败`
          : undefined,
      }

      const characters: ExtractedCharacter[] = userPicked.map((picked) => {
        const profile = result.profiles.find((p) => p.name === picked.name)?.profile
        return {
          id: picked.id,
          name: picked.name,
          aliases: picked.aliases,
          importance: picked.importanceScore,
          category:
            picked.category === "主角"
              ? "protagonist"
              : picked.category === "配角"
              ? "supporting"
              : "minor",
          firstAppearance: (picked.chapterIndices[0] ?? 0) + 1,
          lastAppearance: (picked.chapterIndices[picked.chapterIndices.length - 1] ?? 0) + 1,
          appearanceCount: picked.appearances,
          description: "",
          personality: profile?.personality ?? "",
          speechStyle: profile?.speechStyle ?? "",
          relationships: [],
          keyEvents: [],
          personalityProfile: profile,
          simpleExtractionMeta: {
            generatedAt: Date.now(),
            schemaVersion: 1,
          },
        }
      })
      updateTaskCharacters(taskId, characters)

      const { persistCharacterToDisk } = await import(
        "@/lib/novel/book-analysis/character-disk-store"
      )
      for (const character of characters) {
        try {
          await persistCharacterToDisk(bookPath, character)
        } catch (err) {
          console.warn(`[简单提取] 持久化角色 ${character.name} 失败:`, err)
        }
      }

      const { generateSkillsForCharacters } = await import(
        "@/lib/novel/book-analysis/skill-generator"
      )
      const skills = await generateSkillsForCharacters(
        characters,
        metadata,
        bookPath,
        llmConfig,
        (progress) => {
          updateTaskProgress(taskId, {
            stage: progress.stage as any,
            stageLabel: progress.stageLabel,
            completed: progress.completed,
            total: progress.total,
            percentage: progress.percentage,
            currentItem: progress.currentItem,
          })
        },
        abortController.signal,
      )
      updateTaskSkills(taskId, skills)
      updateTaskProgress(taskId, {
        simpleExtractionStatus: "done",
      })
      completeTask(taskId)
      await reloadLibraryState()
      useBookAnalysisStore.getState().triggerSidebarRefresh()
      toast.success("简单提取完成")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
        toast.error(`简单提取失败：${errorMessage}`)
      }
    } finally {
      setExtracting(false)
    }
  }, [chapterSelectionData, recognizedCharacters, selectedCharacterIds, setChapterSelectionData, resolveLlmConfig, reloadLibraryState])

  /**
   * 继续生成失败的角色（feature/network-error-resume）
   */
  const handleResumeFailedExtraction = useCallback(async (taskId: string) => {
    const task = useBookAnalysisStore.getState().tasks.find((t) => t.id === taskId)
    if (!task) return
    const failedNames = (task.metadata as any)?.failedCharacterNames as string[] | undefined
    if (!failedNames || failedNames.length === 0) return

    const failedCharacters = (task.characters ?? []).filter((c) => failedNames.includes(c.name))
    if (failedCharacters.length === 0) return

    const abortController = new AbortController()
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters

    const resumeStoreState = useWikiStore.getState()
    const llmConfig = resolveDefaultModel(resumeStoreState.llmConfig)
    if (!llmConfig) {
      alert("未配置 LLM，请先在设置中配置")
      return
    }
    const { streamChat } = await import("@/lib/llm-client")
    const realLlmCall = async (prompt: string): Promise<string> => {
      let response = ""
      await streamChat(
        llmConfig,
        [{ role: "user", content: prompt }],
        {
          onToken: (text) => { response += text },
          onDone: () => {},
          onError: (err) => { console.error("[resume] LLM error:", err) },
        },
        abortController.signal,
      )
      return response.trim()
    }

    const sourceBook = (task.metadata as any)?.sourceBook
    if (!sourceBook) {
      alert("找不到原始作品路径，无法继续生成")
      return
    }
    const samples: string[] = []
    try {
      const raw = await readFile(joinPath(sourceBook, "chapters", "1.md"))
      samples.push(`【第 1 章】\n${raw.replace(/^---[\s\S]*?---\n/, "").slice(0, 1500)}`)
    } catch {
      alert("无法读取原始章节内容，请重新发起提取")
      return
    }
    const chapterSamples = samples.join("\n\n")

    const { extractSingleProfile } = await import(
      "@/lib/novel/book-analysis/simple-extraction-engine"
    )

    updateTaskProgress(taskId, {
      stageLabel: `继续生成 ${failedCharacters.length} 个失败角色中...`,
      simpleExtractionStatus: "running",
      simpleExtractionCompleted: 0,
      simpleExtractionTotal: failedCharacters.length,
    })

    const updated = [...(task.characters ?? [])]
    let succeeded = 0
    const stillFailed: string[] = []
    for (let i = 0; i < failedCharacters.length; i++) {
      const ch = failedCharacters[i]
      const singleResult = await extractSingleProfile({
        character: {
          id: ch.id,
          name: ch.name,
          aliases: ch.aliases ?? [],
          appearances: ch.appearanceCount,
          chapterIndices: [ch.firstAppearance - 1],
          importanceScore: ch.importance,
          category: ch.category === "protagonist" ? "主角" : ch.category === "supporting" ? "配角" : "次要",
          sourceBook: sourceBook,
        },
        chapterSamples,
        llmConfig,
        signal: abortController.signal,
        _llmCall: realLlmCall,
      })
      const targetIdx = updated.findIndex((u) => u.id === ch.id)
      if (targetIdx >= 0 && !singleResult.error) {
        updated[targetIdx] = {
          ...updated[targetIdx],
          personality: singleResult.profile.personality,
          speechStyle: singleResult.profile.speechStyle,
          personalityProfile: singleResult.profile,
        }
        succeeded++
      } else if (singleResult.error) {
        stillFailed.push(ch.name)
      }
    }
    updateTaskCharacters(taskId, updated)

    useBookAnalysisStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, metadata: { ...(t.metadata ?? {}), failedCharacterNames: stillFailed } as any }
          : t,
      ),
    }))

    updateTaskProgress(taskId, {
      stageLabel: stillFailed.length > 0
        ? `继续生成完成：成功 ${succeeded}，仍失败 ${stillFailed.length}（${stillFailed.slice(0, 3).join("、")}${stillFailed.length > 3 ? "..." : ""}）`
        : `继续生成完成：成功 ${succeeded}，全部完成`,
      simpleExtractionStatus: stillFailed.length > 0 ? "partial" : "done",
    })

    if (succeeded > 0) {
      try {
        const { generateSkillsForCharacters } = await import(
          "@/lib/novel/book-analysis/skill-generator"
        )
        const skills = await generateSkillsForCharacters(
          updated,
          task.metadata as any,
          sourceBook,
          llmConfig,
        )
        useBookAnalysisStore.getState().updateTaskSkills(taskId, skills)
      } catch (e) {
        console.error("[resume] regenerate skills failed:", e)
      }
    }
  }, [])

  return {
    extracting,
    handleDeepExtract,
    handleSimpleExtract,
    handleResumeFailedExtraction,
  }
}
