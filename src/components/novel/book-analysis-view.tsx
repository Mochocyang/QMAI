import { useState } from "react"
import { Button } from "@/components/ui/button"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { BookAnalysisResultViewer } from "./book-analysis-result-viewer"
import { ChapterSelectionPanel } from "./chapter-selection-panel"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { BookOpen, Check, Loader2, Plus, X } from "lucide-react"
import type {
  AnalysisDepth,
  SixDimensionProgressItem,
  SixDimensionStatus,
  ExtractedCharacter,
} from "@/lib/novel/book-analysis/types"

/** 6 维度状态图标的视觉映射 */
function DimensionStatusIcon({ status }: { status: SixDimensionStatus }) {
  if (status === "done") {
    return <Check className="h-3.5 w-3.5 text-emerald-500" />
  }
  if (status === "failed") {
    return <X className="h-3.5 w-3.5 text-destructive" />
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
  }
  return <span className="h-3.5 w-3.5 inline-block rounded-full border border-muted-foreground/40" />
}

/** 6 维度状态文字颜色 */
function dimensionTextClass(
  status: SixDimensionStatus,
  isCurrent: boolean
): string {
  if (status === "running" || isCurrent) return "text-foreground font-medium"
  if (status === "done") return "text-muted-foreground"
  if (status === "failed") return "text-destructive"
  return "text-muted-foreground/60"
}

export function BookAnalysisView() {
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [viewingResultPath, setViewingResultPath] = useState<string | null>(null)
  const [chapterSelectionData, setChapterSelectionData] = useState<{
    taskId: string
    bookPath: string
    chapters: Array<{
      id: string
      title: string
      order: number
      wordCount: number
      path: string
    }>
    metadata: any
    abortController: AbortController
    selectedChapterIds: string[]  // 用户在章节选择面板中勾选的 id
    depth: AnalysisDepth           // 选章节时确定的深度档（fast/standard）
  } | null>(null)
  const currentProject = useWikiStore((s) => s.project)
  const startTask = useBookAnalysisStore((s) => s.startTask)
  const cancelTask = useBookAnalysisStore((s) => s.cancelTask)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const currentResult = useBookAnalysisStore((s) => s.currentResult)
  const showResultViewer = useBookAnalysisStore((s) => s.showResultViewer)
  const setShowResultViewer = useBookAnalysisStore((s) => s.setShowResultViewer)
  // 角色识别 LLM 配置（feature/llm-character-recognizer）
  const llmConfig = useWikiStore((s) => s.llmConfig)
  // 角色识别 store 状态与 actions（feature/character-recognition-and-simple-mode）
  const recognitionStatus = useBookAnalysisStore((s) => s.recognitionStatus)
  const recognizedCharacters = useBookAnalysisStore((s) => s.recognizedCharacters)
  const selectedCharacterIds = useBookAnalysisStore((s) => s.selectedCharacterIds)
  const setRecognitionStatus = useBookAnalysisStore((s) => s.setRecognitionStatus)
  const setRecognizedCharacters = useBookAnalysisStore((s) => s.setRecognizedCharacters)
  const setSelectedCharacterIds = useBookAnalysisStore((s) => s.setSelectedCharacterIds)
  const clearRecognition = useBookAnalysisStore((s) => s.clearRecognition)
  const recognitionError = useBookAnalysisStore((s) => s.recognitionError)

  const handleStartAnalysis = async (config: {
    sourceType: "file"
    sourcePath: string
  }) => {
    if (!currentProject?.path) {
      console.error("没有打开的项目")
      return
    }

    // 创建 AbortController
    const abortController = new AbortController()

    // 启动分析任务
    const taskId = startTask(currentProject.path, {
      sourceType: config.sourceType,
      sourcePath: config.sourcePath,
      selectedChapters: [], // 初始为空，稍后用户选择章节
    }, abortController)

    setInputDialogOpen(false)

    // 启动后台分析
    try {
      const { splitNovelIntoChapters } = await import("@/lib/novel/book-analysis/analysis-engine")
      const { useWikiStore } = await import("@/stores/wiki-store")
      const llmConfig = useWikiStore.getState().llmConfig
      const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
      const updateTaskMetadata = useBookAnalysisStore.getState().updateTaskMetadata

      // 第一步：拆分章节
      const splitResult = await splitNovelIntoChapters(
        config.sourcePath,
        currentProject.path,
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
        abortController.signal
      )

      if (splitResult.success) {
        updateTaskMetadata(taskId, splitResult.metadata)

        useBookAnalysisStore.getState().updateTaskBookData(taskId, splitResult.bookId, splitResult.chapters)

        // 显示章节选择界面
        setChapterSelectionData({
          taskId,
          bookPath: splitResult.bookPath,
          chapters: splitResult.chapters,
          metadata: splitResult.metadata,
          abortController,
          selectedChapterIds: [],  // 稍后由用户在章节选择面板中勾选
          depth: "standard",         // 默认 standard，章节面板可改
        })
      }
    } catch (error) {
      const errorTaskFn = useBookAnalysisStore.getState().errorTask
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      // 如果是用户取消，不重复设置错误（cancelTask已处理）
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
      }
    }
  }

  const handleChapterSelectionConfirm = async (selectedChapterIds: string[], depth: AnalysisDepth) => {
    console.log('[handleChapterSelectionConfirm] 开始执行', { selectedChapterIds, depth })

    if (!chapterSelectionData) {
      console.error('[handleChapterSelectionConfirm] chapterSelectionData 为空')
      return
    }

    const { taskId, bookPath, abortController } = chapterSelectionData
    console.log('[handleChapterSelectionConfirm] taskId:', taskId, 'bookPath:', bookPath)

    // 不关闭章节面板，识别完成后会在面板上叠加"角色选择"弹窗
    // 把 selectedChapterIds + depth 暂存到 state，识别 / 提取阶段要用
    setChapterSelectionData({
      ...chapterSelectionData,
      selectedChapterIds,
      depth,
    })

    // 阶段 0：清空旧的识别状态
    clearRecognition()

    // 阶段 1：启发式（提示用户已开始分析）
    setRecognitionStatus("heuristic")
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    updateTaskProgress(taskId, {
      recognitionStatus: "heuristic",
      stageLabel: "读取章节中",
    })

    try {
      console.log('[handleChapterSelectionConfirm] 开始识别角色')

      // 读取章节内容（feature/character-recognition-and-simple-mode）
      const { recognizeCharacters } = await import(
        "@/lib/novel/book-analysis/character-recognition-engine"
      )

      const selectedChapters = chapterSelectionData.chapters
        .filter((c) => selectedChapterIds.includes(c.id))
        .sort((a, b) => a.order - b.order)

      console.log('[handleChapterSelectionConfirm] 已选择章节数:', selectedChapters.length)

      const chapterContents: { index: number; content: string }[] = []
      for (let i = 0; i < selectedChapters.length; i++) {
        const ch = selectedChapters[i]
        const chapterPath = joinPath(bookPath, "chapters", `${ch.id}.md`)
        const raw = await readFile(chapterPath)
        // 去除 frontmatter
        const body = raw.replace(/^---[\s\S]*?---\n/, "")
        // 限长避免一次读太多（截取前 4000 字足够启发式 / LLM）
        chapterContents.push({ index: i, content: body.slice(0, 4000) })
        if (abortController.signal.aborted) {
          throw new Error("用户取消")
        }
      }

      console.log('[handleChapterSelectionConfirm] 章节内容读取完成')

      // 阶段 2：AI 识别（feature/llm-character-recognizer）
      // 先 LLM 识别（精准），失败时回退到启发式
      const heuristicMinChapters = Math.min(2, selectedChapterIds.length)

      // 状态切到"AI 识别中"
      if (llmConfig) {
        setRecognitionStatus("llm_recognizing")
        updateTaskProgress(taskId, {
          recognitionStatus: "llm_recognizing",
          stageLabel: "正在用 AI 识别角色",
        })
      }

      const result = await recognizeCharacters({
        chapters: chapterContents,
        minChapters: heuristicMinChapters,
        sourceBook: bookPath,
        llmConfig: llmConfig ?? undefined,
        signal: abortController.signal,
      })

      if (abortController.signal.aborted) throw new Error("用户取消")

      // 阶段 3：写入 store（弹窗自动打开）
      const sourceLabel = result.source === "llm" ? "AI 识别" : "启发式识别（AI 失败兜底）"
      console.log('[handleChapterSelectionConfirm] 角色识别完成', {
        count: result.characters.length,
        source: result.source
      })
      updateTaskProgress(taskId, {
        recognitionStatus: "done",
        recognizedCharactersCount: result.characters.length,
        stageLabel:
          result.source === "heuristic" && result.error
            ? `识别出 ${result.characters.length} 个角色（AI 失败已回退：${result.error}）`
            : `识别出 ${result.characters.length} 个角色（${sourceLabel}）`,
      })
      setRecognizedCharacters(result.characters)
      setRecognitionStatus("done")
      console.log('[handleChapterSelectionConfirm] 状态已更新为 done')
    } catch (err) {
      if (abortController.signal.aborted) {
        console.log('[handleChapterSelectionConfirm] 用户取消')
        return
      }
      const errorMessage = err instanceof Error ? err.message : "识别失败"
      const setRecognitionError = useBookAnalysisStore.getState().setRecognitionError
      console.error("[角色识别] 失败：", err)
      setRecognitionStatus("error")
      setRecognitionError(errorMessage)
      updateTaskProgress(taskId, {
        recognitionStatus: "error",
        stageLabel: `角色识别失败：${errorMessage}`,
      })
      // 导入并使用 toast
      const { toast } = await import("@/lib/toast")
      toast.error(`角色识别失败：${errorMessage}`)
    }
  }

  /**
   * 用户在"角色选择"弹窗中切换某个角色的勾选
   */
  const handleToggleCharacter = (id: string) => {
    setSelectedCharacterIds(
      selectedCharacterIds.includes(id)
        ? selectedCharacterIds.filter((x) => x !== id)
        : [...selectedCharacterIds, id]
    )
  }

  /**
   * 一键全选"主角 + 配角"（不勾选次要）
   */
  const handleSelectAllMain = () => {
    const ids = recognizedCharacters
      .filter((c) => c.category === "主角" || c.category === "配角")
      .map((c) => c.id)
    setSelectedCharacterIds(ids)
  }

  /**
   * 清空选择
   */
  const handleClearSelection = () => {
    setSelectedCharacterIds([])
  }

  /**
   * 关闭章节选择面板（不取消任务，用于提取阶段）
   */
  const closeChapterPanel = () => {
    setChapterSelectionData(null)
  }

  /**
   * 6 维度深度提取：跑原 6 维流程，提取后过滤到用户勾选的角色
   */
  const handleDeepExtract = async () => {
    if (!chapterSelectionData) return
    const { taskId, bookPath, metadata, abortController, selectedChapterIds, depth } = chapterSelectionData
    const userPicked = recognizedCharacters.filter((c) => selectedCharacterIds.includes(c.id))
    closeChapterPanel()
    if (userPicked.length === 0) return

    const { useWikiStore } = await import("@/stores/wiki-store")
    const llmConfig = useWikiStore.getState().llmConfig
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters
    const updateTaskSkills = useBookAnalysisStore.getState().updateTaskSkills
    const completeTask = useBookAnalysisStore.getState().completeTask
    const errorTaskFn = useBookAnalysisStore.getState().errorTask

    try {
      const { extractCharactersFromChapters } = await import(
        "@/lib/novel/book-analysis/character-extraction-engine"
      )

      // 跑原 6 维度流程（保留 6 维能力）
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

      // 过滤到用户勾选的角色（feature/character-recognition-and-simple-mode）
      const pickedNames = new Set(userPicked.map((c) => c.name))
      const filteredCharacters: ExtractedCharacter[] = extractionResult.characters.filter((c) =>
        pickedNames.has(c.name)
      )
      // 6 维模式下没有 personalityProfile，但走 6 维 skill 模板，所以即使未勾选也无所谓
      // 这里我们用 pickedNames 过滤：如果 6 维流程没识别出用户勾选的角色，会被过滤掉
      updateTaskCharacters(taskId, filteredCharacters)

      // 生成 Skills
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
        abortController.signal
      )
      updateTaskSkills(taskId, skills)
      completeTask(taskId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
      }
    }
  }

  /**
   * 简单提取：跑新 4 字段流程（feature/character-recognition-and-simple-mode）
   */
  const handleSimpleExtract = async () => {
    if (!chapterSelectionData) return
    const { taskId, bookPath, metadata, abortController, selectedChapterIds } = chapterSelectionData
    const userPicked = recognizedCharacters.filter((c) => selectedCharacterIds.includes(c.id))
    closeChapterPanel()
    if (userPicked.length === 0) return

    const { useWikiStore } = await import("@/stores/wiki-store")
    const llmConfig = useWikiStore.getState().llmConfig
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters
    const updateTaskSkills = useBookAnalysisStore.getState().updateTaskSkills
    const completeTask = useBookAnalysisStore.getState().completeTask
    const errorTaskFn = useBookAnalysisStore.getState().errorTask

    try {
      // 读取章节内容拼成 chapterSamples
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

      // 跑简单提取（feature/network-error-resume：循环逐个提取，单个失败不影响其他）
      updateTaskProgress(taskId, {
        stage: "extracting_characters",
        stageLabel: "简单提取角色特征中",
        simpleExtractionStatus: "running",
        simpleExtractionCompleted: 0,
        simpleExtractionTotal: userPicked.length,
      })

      // 注入真实 LLM 调用（feature/llm-character-recognizer — 复用 LLM 调用模式）
      // 引擎内部 _llmCall ?? defaultLlmCall，没注入就走 defaultLlmCall 抛错
      const currentLlmConfig = useWikiStore.getState().llmConfig
      if (!currentLlmConfig) {
        throw new Error("未配置 LLM，请先在设置中配置 LLM 后再提取")
      }
      const { streamChat } = await import("@/lib/llm-client")
      const realLlmCall = async (prompt: string): Promise<string> => {
        let response = ""
        await streamChat(
          currentLlmConfig,
          [{ role: "user", content: prompt }],
          {
            onToken: (text) => { response += text },
            onDone: () => {},
            onError: (err) => { console.error("[simple-extract] LLM error:", err) },
          },
          abortController.signal
        )
        return response.trim()
      }

      // 循环逐个提取（feature/network-error-resume：单角色失败不影响其他）
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
          llmConfig: currentLlmConfig,
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

      // 阶段结果：成功 N，失败 K
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

      // 把失败列表存到 task.metadata，任务卡渲染"继续生成"按钮用
      const currentTask = useBookAnalysisStore.getState().tasks.find((t) => t.id === taskId)
      if (currentTask) {
        updateTaskProgress(taskId, {})  // 触发一次刷新占位
        useBookAnalysisStore.setState((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  metadata: {
                    ...(t.metadata ?? {}),
                    // feature/network-error-resume：失败的角色名列表
                    failedCharacterNames: failedNames,
                    networkFailure,
                  } as any,
                }
              : t
          ),
        }))
      }

      // 组装 result（用一次性的 extractSimpleProfiles 走兼容路径：仅用于 result 包装）
      // 这里直接用 completedProfiles 构造
      const result = {
        profiles: completedProfiles.map((p) => ({ name: p.name, profile: p.profile })),
        error: failedNames.length > 0
          ? `${errorKindLabel}：${failedNames.length} 个角色失败`
          : undefined,
      }

      // 组装 ExtractedCharacter 列表
      const characters: ExtractedCharacter[] = userPicked.map((picked) => {
        const profile = result.profiles.find((p) => p.name === picked.name)?.profile
        return {
          id: picked.id,
          name: picked.name,
          aliases: picked.aliases,
          importance: picked.importanceScore,
          // 6 维度用 'protagonist' | 'supporting' | 'minor'，映射中文 category
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

      // 生成 Skills（直接调简单提取模板，跳过 LLM）
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
        abortController.signal
      )
      updateTaskSkills(taskId, skills)
      updateTaskProgress(taskId, {
        simpleExtractionStatus: "done",
      })
      completeTask(taskId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
      }
    }
  }

  // 继续生成失败的角色（feature/network-error-resume）
  const handleResumeFailedExtraction = async (taskId: string) => {
    const task = useBookAnalysisStore.getState().tasks.find((t) => t.id === taskId)
    if (!task) return
    const failedNames = (task.metadata as any)?.failedCharacterNames as string[] | undefined
    if (!failedNames || failedNames.length === 0) return

    // 从 task.characters 中按名字匹配失败的 character
    const failedCharacters = (task.characters ?? []).filter((c) => failedNames.includes(c.name))
    if (failedCharacters.length === 0) return

    const abortController = new AbortController()
    const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
    const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters

    const llmConfig = useWikiStore.getState().llmConfig
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
        abortController.signal
      )
      return response.trim()
    }

    const sourceBook = (task.metadata as any)?.sourceBook
    if (!sourceBook) {
      alert("找不到原始作品路径，无法继续生成")
      return
    }
    const { joinPath } = await import("@/lib/path-utils")
    const { readFile } = await import("@/commands/fs")
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

    // 更新 failedCharacterNames
    useBookAnalysisStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, metadata: { ...(t.metadata ?? {}), failedCharacterNames: stillFailed } as any }
          : t
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
  }

  const handleChapterSelectionCancel = () => {
    if (chapterSelectionData) {
      cancelTask(chapterSelectionData.taskId)
      setChapterSelectionData(null)
    }
  }

  // 修复（fix/character-reextract-and-loading-state）：
  // 后台运行：只关闭面板、不取消任务，让识别/提取继续在后台跑
  const handleChapterSelectionBackground = () => {
    if (!chapterSelectionData) return
    console.log('[后台运行] 关闭面板，任务继续后台执行', chapterSelectionData.taskId)
    setChapterSelectionData(null)
  }

  // 如果没有任务，显示欢迎页（feature/fix-viewer-from-sidebar：欢迎页下也允许打开 viewer）
  if (tasks.length === 0) {
    return (
      <>
        <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-6">
              <BookOpen className="h-12 w-12 text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold">拆书作品</h2>
            <p className="text-muted-foreground">
              从小说中提取角色信息，生成可复用的角色 Skill，添加到自定义灵魂库
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground space-y-2">
              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">1</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">上传小说文件</div>
                  <div>支持TXT格式，自动识别章节（可能包含500-1000章）</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">2</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">选择分析范围</div>
                  <div>勾选需要分析的章节，支持全选或选择特定范围</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">3</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">提取角色与生成Skill</div>
                  <div>全面分析角色信息，生成可复用技能，添加到自定义灵魂</div>
                </div>
              </div>
            </div>
          </div>

          <Button onClick={() => setInputDialogOpen(true)} size="lg" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            选择小说并拆书
          </Button>

          <div className="text-xs text-muted-foreground">
            支持本地TXT文件，自动识别章节结构
          </div>
        </div>
        </div>

        <BookAnalysisInputDialog
          open={inputDialogOpen}
          onOpenChange={setInputDialogOpen}
          onSubmit={handleStartAnalysis}
        />

        {/* feature/fix-viewer-from-sidebar：欢迎页下也允许从侧边栏打开历史结果 viewer */}
        {(viewingResultPath || showResultViewer) && (
          <BookAnalysisResultViewer
            projectPath={viewingResultPath ?? currentProject?.path ?? ""}
            result={currentResult}
            onClose={() => {
              setViewingResultPath(null)
              setShowResultViewer(false)
            }}
          />
        )}
      </>
    )
  }

  // 如果有任务，显示任务列表和进度
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">拆书作品</h2>
        <Button onClick={() => setInputDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          拆书作品
        </Button>
      </div>

      <div className="space-y-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="border rounded-lg p-4 space-y-3 cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            role="button"
            tabIndex={0}
            onClick={() => setViewingResultPath(task.projectPath)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setViewingResultPath(task.projectPath)
              }
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">
                  {task.metadata?.title || "未命名作品"}
                </div>
                <div className="text-sm text-muted-foreground">
                  角色提取与Skill生成
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {task.status === "running" && "进行中"}
                {task.status === "paused" && "已暂停"}
                {task.status === "completed" && "已完成"}
                {task.status === "error" && "出错"}
              </div>
            </div>

            {task.status === "running" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{task.progress.stageLabel}</span>
                  <span className="font-medium">{task.progress.percentage}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${task.progress.percentage}%` }}
                  />
                </div>
                {task.progress.currentItem && (
                  <div className="text-xs text-muted-foreground">
                    {task.progress.currentItem}
                  </div>
                )}
                {/* 6 维度细粒度进度清单（feature/book-analysis-6d-skill） */}
                {task.progress.dimensions && task.progress.dimensions.length > 0 && (
                  <div className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {task.progress.currentCharacter
                        ? `角色「${task.progress.currentCharacter}」的 6 维度`
                        : "6 维度进度"}
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                      {task.progress.dimensions.map((d: SixDimensionProgressItem) => (
                        <li
                          key={d.key}
                          className={`flex items-center gap-1.5 text-xs ${dimensionTextClass(
                            d.status,
                            d.key === task.progress.currentDimension
                          )}`}
                        >
                          <DimensionStatusIcon status={d.status} />
                          <span className="truncate">{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* 角色识别阶段状态（feature/character-recognition-and-simple-mode） */}
                {task.progress.recognitionStatus === "heuristic" && (
                  <p className="text-sm text-muted-foreground">正在启发式识别角色...</p>
                )}
                {task.progress.recognitionStatus === "llm_scoring" && (
                  <p className="text-sm text-muted-foreground">正在用 LLM 评分角色重要度...</p>
                )}
                {task.progress.recognitionStatus === "done" && (
                  <p className="text-sm text-muted-foreground">
                    识别出 {task.progress.recognizedCharactersCount ?? 0} 个角色
                  </p>
                )}
                {/* 停止按钮 */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => cancelTask(task.id)}
                    className="flex-1 px-3 py-1.5 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 transition-colors text-sm font-medium"
                  >
                    停止分析
                  </button>
                </div>
              </div>
            )}

            {task.status === "error" && task.error && (
              <div className="text-sm text-destructive">
                {task.error}
              </div>
            )}

            {task.status === "completed" && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium pointer-events-none"
                >
                  查看分析结果
                </button>
                {/* feature/network-error-resume：失败角色时显示"继续生成"按钮 */}
                {(() => {
                  const failedNames = (task.metadata as any)?.failedCharacterNames as string[] | undefined
                  if (!failedNames || failedNames.length === 0) return null
                  return (
                    <button
                      onClick={() => handleResumeFailedExtraction(task.id)}
                      className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors text-sm font-medium"
                    >
                      继续生成（{failedNames.length}）
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      <BookAnalysisInputDialog
        open={inputDialogOpen}
        onOpenChange={setInputDialogOpen}
        onSubmit={handleStartAnalysis}
      />

      {(viewingResultPath || showResultViewer) && (
        <BookAnalysisResultViewer
          projectPath={viewingResultPath ?? currentProject?.path ?? ""}
          result={currentResult}
          onClose={() => {
            setViewingResultPath(null)
            setShowResultViewer(false)
          }}
        />
      )}

      {chapterSelectionData && (
        <ChapterSelectionPanel
          chapters={chapterSelectionData.chapters}
          onConfirm={handleChapterSelectionConfirm}
          onCancel={handleChapterSelectionCancel}
          // 修复（fix/character-reextract-and-loading-state）：后台运行
          onBackground={handleChapterSelectionBackground}
          onAnalyzingChange={(analyzing) => {
            // 这里可以加 toast 提示（保持轻量，不修改其他逻辑）
            if (analyzing) {
              console.log('[book-analysis-view] 进入分析中状态')
            } else {
              console.log('[book-analysis-view] 退出分析中状态')
            }
          }}
          // 角色识别 + 角色选择（feature/character-recognition-and-simple-mode）
          recognitionStatus={recognitionStatus}
          recognizedCharacters={recognizedCharacters}
          selectedCharacterIds={selectedCharacterIds}
          recognitionError={recognitionError}
          onToggleCharacter={handleToggleCharacter}
          onSelectAllMain={handleSelectAllMain}
          onClearSelection={handleClearSelection}
          onDeepExtract={handleDeepExtract}
          onSimpleExtract={handleSimpleExtract}
        />
      )}
    </div>
  )
}
