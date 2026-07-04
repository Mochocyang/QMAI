import { useState, useCallback } from "react"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { analyzeWritingStyle } from "@/lib/novel/book-analysis/style-extraction-engine"
import { importBookAnalysisSkillsAsAuras } from "@/lib/novel/book-analysis/aura-adapter"
import { deleteOrphanAurasForBook } from "@/lib/novel/book-analysis/aura-cleanup"
import {
  loadBookAnalysisLibraryState,
  type BookAnalysisLibraryState,
  type BookAnalysisLibraryBook,
} from "@/lib/novel/book-analysis/library-state"
import { bindCharacterAura, listBindableNovelCharacters } from "@/lib/novel/character-aura"
import { setEnabledWritingStyle, upsertWritingStylePreset } from "@/lib/novel/writing-style-store"
import { refreshProjectState } from "@/lib/project-refresh"
import { readFile, listDirectory, deleteFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import type { AnalysisDepth } from "@/lib/novel/book-analysis/types"
import type { ChapterSelectionData } from "./use-character-extraction"

export interface UseLibraryOperationsParams {
  currentProjectPath: string | null
  selectedLibraryBook: BookAnalysisLibraryBook | null
  libraryState: BookAnalysisLibraryState
  setLibraryState: React.Dispatch<React.SetStateAction<BookAnalysisLibraryState>>
  setSelectedBookId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedCharacterId: React.Dispatch<React.SetStateAction<string | null>>
  setChapterSelectionData: React.Dispatch<React.SetStateAction<ChapterSelectionData | null>>
  llmConfig: ReturnType<typeof useWikiStore.getState>["llmConfig"]
  providerConfigs: ReturnType<typeof useWikiStore.getState>["providerConfigs"]
  startTask: (projectPath: string, config: any, abortController?: AbortController) => string
}

/**
 * 作品库操作钩子
 *
 * 从 BookAnalysisView 中提取的作品库管理逻辑。
 * 负责文风提取/切换、角色 Skill 加入灵魂库、角色绑定、
 * 作品删除、重新提取角色等操作。
 */
export function useLibraryOperations({
  currentProjectPath,
  selectedLibraryBook,
  libraryState,
  setLibraryState,
  setSelectedBookId,
  setSelectedCharacterId,
  setChapterSelectionData,
  llmConfig,
  providerConfigs,
  startTask,
}: UseLibraryOperationsParams) {
  const [styleExtracting, setStyleExtracting] = useState(false)
  const [addingToSoul, setAddingToSoul] = useState(false)

  const reloadLibraryState = useCallback(async () => {
    if (!currentProjectPath) {
      setLibraryState({ books: [], enabledStyle: null, bindings: [] })
      setSelectedBookId(null)
      return
    }
    const next = await loadBookAnalysisLibraryState(currentProjectPath)
    setLibraryState(next)
    setSelectedBookId((current) =>
      current && next.books.some((book) => book.id === current)
        ? current
        : next.books[0]?.id ?? null,
    )
  }, [currentProjectPath, setLibraryState, setSelectedBookId])

  const handleLibraryExtractStyle = useCallback(async () => {
    if (!currentProjectPath || !selectedLibraryBook || styleExtracting) return
    if (!hasUsableLlm(llmConfig, providerConfigs)) {
      toast.error("未配置可用模型，请先在设置中配置 LLM。")
      return
    }
    setStyleExtracting(true)

    const abortController = new AbortController()
    const taskId = useBookAnalysisStore.getState().startTask(currentProjectPath, {
      sourceType: "file",
      sourcePath: selectedLibraryBook.path,
      selectedChapters: [],
    }, abortController)
    useBookAnalysisStore.getState().updateTaskBookData(taskId, selectedLibraryBook.id, [])
    useBookAnalysisStore.getState().updateTaskProgress(taskId, {
      stage: "extracting_style",
      stageLabel: "提取文风",
      percentage: 0,
    })

    try {
      const progressMap: Record<string, number> = {
        "读取章节列表…": 10,
        "读取": 25,
        "正在分析作品文风…": 50,
        "保存文风画像…": 90,
      }
      const profile = await analyzeWritingStyle(selectedLibraryBook.path, llmConfig, {
        signal: abortController.signal,
        onProgress: (msg) => {
          const pct = Object.entries(progressMap).find(([k]) => msg.includes(k))?.[1]
          if (pct !== undefined) {
            useBookAnalysisStore.getState().updateTaskProgress(taskId, {
              stage: "extracting_style",
              stageLabel: "提取文风",
              percentage: pct,
              currentItem: msg,
            })
          }
        },
      })
      useBookAnalysisStore.getState().updateTaskStyleProfile(taskId, profile)
      useBookAnalysisStore.getState().updateTaskProgress(taskId, {
        stage: "extracting_style",
        stageLabel: "提取文风",
        percentage: 100,
        currentItem: "完成",
      })
      useBookAnalysisStore.getState().completeTask(taskId)
      toast.success("已提取作品文风。")
      await reloadLibraryState()
      useBookAnalysisStore.getState().triggerSidebarRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[文风提取失败]", msg)
      useBookAnalysisStore.getState().errorTask(taskId, msg)
      toast.error(`提取文风失败：${msg}`)
    } finally {
      setStyleExtracting(false)
    }
  }, [currentProjectPath, selectedLibraryBook, styleExtracting, llmConfig, reloadLibraryState])

  const handleLibraryToggleStyle = useCallback(async () => {
    if (!currentProjectPath || !selectedLibraryBook?.styleProfile) return
    const enabled = libraryState.enabledStyle?.sourceBook === selectedLibraryBook.metadata.title
    try {
      if (enabled) {
        await setEnabledWritingStyle(currentProjectPath, null)
        toast.success("已取消启用该文风。")
      } else {
        if (libraryState.enabledStyle && libraryState.enabledStyle.sourceBook !== selectedLibraryBook.metadata.title) {
          const confirmed = window.confirm(
            `当前已启用《${libraryState.enabledStyle.sourceBook}》的文风。启用《${selectedLibraryBook.metadata.title}》的文风后，AI 会话将改用新的文风约束。是否继续？`,
          )
          if (!confirmed) return
        }
        const preset = await upsertWritingStylePreset(currentProjectPath, {
          name: `${selectedLibraryBook.metadata.title} · 文风`,
          sourceBook: selectedLibraryBook.metadata.title,
          profile: selectedLibraryBook.styleProfile,
        })
        await setEnabledWritingStyle(currentProjectPath, preset.id)
        toast.success("已启用该文风，生成时会按此文风写作。")
      }
      await reloadLibraryState()
    } catch (err) {
      toast.error(`操作失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [currentProjectPath, selectedLibraryBook, libraryState.enabledStyle, reloadLibraryState])

  const handleLibraryAddSkillsToSoul = useCallback(async (skillId: string) => {
    if (!currentProjectPath || !selectedLibraryBook || addingToSoul) return
    const selectedSkill = selectedLibraryBook.skills.find((skill) => skill.id === skillId)
    const selectedCharacter = selectedSkill
      ? selectedLibraryBook.characters.find((item) => item.id === selectedSkill.characterId || item.name === selectedSkill.characterName)
      : null
    if (!selectedSkill || !selectedCharacter) {
      toast.info("未找到当前角色的 Skill，请重新提取角色。")
      return
    }
    if (selectedLibraryBook.addedAuraCharacterIds.includes(selectedCharacter.id)) {
      toast.info(`「${selectedCharacter.name}」已加入自定义灵魂库，无需重复加入。`)
      return
    }
    if (selectedLibraryBook.skills.length === 0) {
      toast.info("当前作品还没有可加入的角色 Skill，请先提取角色。")
      return
    }
    if (selectedLibraryBook.characters.length === 0) {
      toast.info("当前作品没有角色数据，请先提取角色。")
      return
    }
    setAddingToSoul(true)
    try {
      const imported = await importBookAnalysisSkillsAsAuras(
        currentProjectPath,
        selectedLibraryBook.metadata,
        selectedLibraryBook.characters,
        selectedLibraryBook.skills,
        [skillId],
      )
      if (imported.length === 0) {
        toast.info(`「${selectedCharacter.name}」已加入自定义灵魂库，无需重复加入。`)
      } else {
        await refreshProjectState(currentProjectPath)
        toast.success(`已将「${imported[0]?.characterName ?? selectedCharacter.name}」加入自定义灵魂库。`)
      }
      await reloadLibraryState()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[加入灵魂库失败]", msg)
      toast.error(`添加失败：${msg}`)
    } finally {
      setAddingToSoul(false)
    }
  }, [currentProjectPath, selectedLibraryBook, addingToSoul, reloadLibraryState])

  const handleLibraryBindCharacter = useCallback(async (characterId: string) => {
    if (!currentProjectPath || !selectedLibraryBook) return
    const character = selectedLibraryBook.characters.find((item) => item.id === characterId)
    if (!character) return
    const bindableCharacters = await listBindableNovelCharacters(currentProjectPath)
    if (bindableCharacters.length === 0) {
      toast.info("请先在大纲中添加人物小传或人物设定，再绑定角色 Skill。")
      return
    }
    const aura = libraryState.bindings.find((binding) => binding.auraName === character.name)
    if (!aura) {
      toast.info("请先将该角色 Skill 加入自定义灵魂库，再绑定到小说人物。")
      return
    }
    const targetName = bindableCharacters[0]
    await bindCharacterAura(currentProjectPath, { characterName: targetName, auraId: aura.auraId })
    await refreshProjectState(currentProjectPath)
    toast.success(`已将「${character.name}」绑定到小说人物「${targetName}」。`)
    await reloadLibraryState()
  }, [currentProjectPath, selectedLibraryBook, libraryState.bindings, reloadLibraryState])

  const handleLibraryDeleteBook = useCallback(async (bookId: string, selectedBookId: string | null) => {
    if (!currentProjectPath) return
    const book = libraryState.books.find((item) => item.id === bookId)
    if (!book) return
    const confirmed = window.confirm(
      `确认删除作品"${book.metadata.title}"吗？\n\n这将删除：\n- 所有角色信息\n- 所有生成的 Skills\n- 分析元数据\n\n此操作无法撤销。`,
    )
    if (!confirmed) return

    try {
      await deleteFile(book.path)
      const cleaned = await deleteOrphanAurasForBook(currentProjectPath, book.metadata.title).catch(() => 0)
      if (selectedBookId === bookId) {
        setSelectedBookId(null)
        setSelectedCharacterId(null)
      }
      if (cleaned > 0) {
        toast.success(`已删除作品「${book.metadata.title}」，并清理了 ${cleaned} 个孤儿灵魂`)
      } else {
        toast.success(`已删除作品「${book.metadata.title}」`)
      }
      await reloadLibraryState()
    } catch (err) {
      console.error("Failed to delete book:", err)
      toast.error("删除作品失败，请稍后重试")
    }
  }, [currentProjectPath, libraryState.books, setSelectedBookId, setSelectedCharacterId, reloadLibraryState])

  const handleLibraryReextractCharacters = useCallback(async () => {
    if (!currentProjectPath || !selectedLibraryBook) return
    if (!hasUsableLlm(llmConfig, providerConfigs)) {
      toast.error("未配置可用模型，请先在设置中配置 LLM。")
      return
    }

    const chaptersDir = joinPath(selectedLibraryBook.path, "chapters")
    const chapterFiles = await listDirectory(chaptersDir)
    const chapters = (
      await Promise.all(
        chapterFiles
          .filter((f) => !f.is_dir && f.name.endsWith(".md"))
          .map(async (f, i) => {
            const id = f.name.replace(/\.md$/, "")
            let title = id
            let order = i
            let wordCount = 0
            try {
              const content = await readFile(f.path)
              const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
              if (fmMatch) {
                const fm = fmMatch[1]
                const body = fmMatch[2]
                const titleMatch = fm.match(/title:\s*(.+)/)
                const orderMatch = fm.match(/order:\s*(\d+)/)
                const wordCountMatch = fm.match(/wordCount:\s*(\d+)/)
                if (titleMatch) title = titleMatch[1].trim()
                if (orderMatch) order = parseInt(orderMatch[1], 10)
                if (wordCountMatch) wordCount = parseInt(wordCountMatch[1], 10)
                else wordCount = body.length
              }
            } catch {
              // 解析失败，使用默认值
            }
            return { id, title, order, wordCount, path: f.path }
          }),
      )
    ).sort((a, b) => a.id.localeCompare(b.id))

    if (chapters.length === 0) {
      toast.error("未找到章节文件，无法重新提取。")
      return
    }

    const abortController = new AbortController()
    const taskId = startTask(currentProjectPath, {
      sourceType: "file",
      sourcePath: selectedLibraryBook.path,
      selectedChapters: [],
    }, abortController)

    useBookAnalysisStore.getState().updateTaskMetadata(taskId, selectedLibraryBook.metadata)
    useBookAnalysisStore.getState().updateTaskBookData(taskId, selectedLibraryBook.id, chapters)

    setChapterSelectionData({
      taskId,
      bookPath: selectedLibraryBook.path,
      chapters,
      metadata: selectedLibraryBook.metadata,
      abortController,
      selectedChapterIds: [],
      depth: "standard" as AnalysisDepth,
    })
  }, [currentProjectPath, selectedLibraryBook, llmConfig, startTask, setChapterSelectionData])

  return {
    styleExtracting,
    addingToSoul,
    reloadLibraryState,
    handleLibraryExtractStyle,
    handleLibraryToggleStyle,
    handleLibraryAddSkillsToSoul,
    handleLibraryBindCharacter,
    handleLibraryDeleteBook,
    handleLibraryReextractCharacters,
  }
}
