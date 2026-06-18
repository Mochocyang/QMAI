import { useRef, useEffect, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Plus, Trash2, MessageSquare, FileEdit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { ChatDockControls } from "./chat-dock-controls"
import { setLastQueryPages, useSourceFiles } from "./chat-shared"
import { ChatInput } from "./chat-input"
import { ChatModelSelector } from "./chat-model-selector"
import { useChatStore, chatMessagesToLLM, type DisplayMessage } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective } from "@/lib/novel/task-router"
import { readFile, writeFile, createDirectory, deleteFile } from "@/commands/fs"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { detectLastGeneratedChapterNumber, findChapterFileByNumber, getNextChapterNumber, readSelectedChapterNumberForFile, resolveTargetChapterNumberForChat } from "@/lib/novel/chapter-utils"
import { buildQmQuaiSystemPrompt, injectDeAiDirective } from "@/lib/novel/de-ai-adapter"
import { cleanGeneratedChapterContentForSave } from "@/lib/novel/chapter-content-cleanup"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget } from "@/lib/context-budget"
import { getConversationTabTitle, sortConversationsByUpdatedAt } from "@/lib/workspace-layout"
import { resolveUserVisibleReasoning } from "@/lib/user-visible-reasoning"
import { createDeepThinkingStreamRenderer } from "@/lib/deep-thinking-stream"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { saveAiChatModel } from "@/lib/project-store"
import {
  buildGoldenThreeChapterDirective,
  detectGoldenThreeChapterRequest,
} from "@/lib/novel/golden-three-chapters"
import { createStreamSessionGuard } from "./stream-session"
import {
  appendContinueUnfinishedDeepChapterContext,
  buildContinueUnfinishedDeepChapterPrompt,
  extractContinueUnfinishedDeepChapterContext,
  stripContinueUnfinishedDeepChapterContext,
} from "./chat-resume"
import { getCopyableAssistantContent } from "@/lib/chat-copy-content"
import { isChatEditRequest, resolveChatEditTarget, validateStructuredChapterEditResult } from "@/lib/novel/chat-edit-mode"
import { backupChapterFile } from "@/lib/novel/chapter-backup"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "@/lib/novel/chapter-save-strategy"
import { normalizeChapterEditFile } from "@/lib/novel/chapter-edit-file"

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export function getDeepChapterToggleButtonClass(enabled: boolean): string {
  return enabled
    ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
    : "text-muted-foreground hover:text-foreground"
}

function findPreviousUserRequest(messages: DisplayMessage[], assistantMessageId: string): string | undefined {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  const searchRange = assistantIndex >= 0 ? messages.slice(0, assistantIndex) : messages
  const userMessages = [...searchRange].reverse().filter((message) => message.role === "user")
  return userMessages.find((message) => message.content.trim() !== "继续未完成")?.content ?? userMessages[0]?.content
}

async function loadEnabledDismantlingDirective(projectPath: string): Promise<string> {
  void projectPath
  return ""
}

function ConversationTabs() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sorted = sortConversationsByUpdatedAt(conversations)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  return (
    <div className="shrink-0 border-b bg-muted/20 px-2 py-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2 rounded-full"
          onClick={() => createConversation()}
        >
          <Plus className="h-3.5 w-3.5" />
          {t(novelMode ? "novel.chat.newChat" : "chat.newChat")}
        </Button>

        {sorted.length === 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(novelMode ? "novel.chat.noConversationsYet" : "chat.noConversationsYet")}
          </span>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <button
                key={conv.id}
                type="button"
                className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "border-primary/40 bg-background text-foreground shadow-sm"
                    : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={conv.title}
              >
                <span className="max-w-[140px] truncate font-medium">
                  {getConversationTabTitle(conv.title, 10)}
                </span>
                <span className="text-[10px] opacity-70">{msgCount}</span>
                <span className="text-[10px] opacity-70">{formatDate(conv.updatedAt)}</span>
                {hoveredId === conv.id && (
                  <span
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                      const proj = useWikiStore.getState().project
                      if (proj) {
                        deleteFile(`${proj.path}/.qmai/chats/${conv.id}.json`).catch(() => {})
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const { t } = useTranslation()
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const setStreamingContent = useChatStore((s) => s.setStreamingContent)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId)
    : []

  const project = useWikiStore((s) => s.project)
  const novelMode = useWikiStore((s) => s.novelMode)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const setAiChatModel = useWikiStore((s) => s.setAiChatModel)
  const chatEditModeEnabled = useWikiStore((s) => s.chatEditModeEnabled)
  const setChatEditModeEnabled = useWikiStore((s) => s.setChatEditModeEnabled)
  const selectedFile = useWikiStore((s) => s.selectedFile)

  const abortRef = useRef<AbortController | null>(null)
  const streamSessionGuardRef = useRef(createStreamSessionGuard())
  const activeStreamSessionRef = useRef<number | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const soulDialogResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  const [chapterSaveStatus, setChapterSaveStatus] = useState<string>("")
  const [isSavingChapter, setIsSavingChapter] = useState(false)
  const [pendingSoulDialog, setPendingSoulDialog] = useState({ open: false, summary: "" })
  const [deepChapterEnabled, setDeepChapterEnabled] = useState(true)
  const closeSoulDialog = useCallback((confirmed: boolean) => {
    const resolver = soulDialogResolverRef.current
    soulDialogResolverRef.current = null
    setPendingSoulDialog({ open: false, summary: "" })
    resolver?.(confirmed)
  }, [])

  const requestSoulDialog = useCallback((summary: string) => {
    setPendingSoulDialog({ open: true, summary })
    return new Promise<boolean>((resolve) => {
      soulDialogResolverRef.current = resolve
    })
  }, [])

  const handleSaveAsChapter = useCallback(async (content: string) => {
    if (!project) return
    const pp = normalizePath(project.path)
    setIsSavingChapter(true)
    setChapterSaveStatus("")
    try {
      const cleanedContent = cleanGeneratedChapterContentForSave(getCopyableAssistantContent(content))
      const selectedChapterNumber = await readSelectedChapterNumberForFile(selectedFile)
      const generatedTargetChapterNumber = detectGeneratedTargetChapterNumber(cleanedContent)
      const explicitTargetPath = generatedTargetChapterNumber ? await findChapterFileByNumber(pp, generatedTargetChapterNumber) : null
      const strategy = decideChapterSaveStrategy({
        selectedChapterNumber: selectedChapterNumber ?? null,
        selectedChapterHasBody: false,
        generatedTargetChapterNumber,
        generatedTargetExists: Boolean(explicitTargetPath),
      })

      const buildDraftContent = (chapterNumber: number) => {
        const chapterTitle = `第${chapterNumber}章`
        const now = new Date().toISOString().slice(0, 10)
        const frontmatter = [
          "---",
          "type: chapter",
          `chapter_number: ${chapterNumber}`,
          "chapter_status: draft",
          `title: "${chapterTitle}"`,
          `created: ${now}`,
          "---",
          "",
        ].join("\n")
        return `${frontmatter}# ${chapterTitle}\n\n${cleanedContent}\n`
      }

      if (strategy.action === "direct_explicit_target_new") {
        const chapterDir = `${pp}/wiki/chapters`
        await createDirectory(chapterDir)
        const chapterPath = `${chapterDir}/chapter-${String(strategy.targetChapterNumber).padStart(3, "0")}.md`
        await writeFile(chapterPath, buildDraftContent(strategy.targetChapterNumber))
        setChapterSaveStatus(`已创建并保存到第${strategy.targetChapterNumber}章`)
        useWikiStore.getState().setSelectedFile(chapterPath)
      } else {
        const nextNum = await getNextChapterNumber(pp)
        const chapterDir = `${pp}/wiki/chapters`
        await createDirectory(chapterDir)
        const chapterPath = `${chapterDir}/chapter-${String(nextNum).padStart(3, "0")}.md`
        await writeFile(chapterPath, buildDraftContent(nextNum))
        setChapterSaveStatus(`已保存为第${nextNum}章草稿`)
        useWikiStore.getState().setSelectedFile(chapterPath)
      }

      await refreshProjectState(pp)
      useWikiStore.getState().setActiveView("wiki")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChapterSaveStatus(t("chat.saveFailed", { message }))
    } finally {
      setIsSavingChapter(false)
    }
  }, [project, selectedFile, t])

  // Auto-scroll to bottom when messages change or streaming content updates
  // But stop if user manually scrolled up
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!userScrolledUpRef.current) {
      container.scrollTop = container.scrollHeight
      lastScrollTopRef.current = container.scrollTop
    }
  }, [activeMessages, streamingContent])

  // Detect user scroll: if user scrolls up, stop auto-scroll; if at bottom, resume
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    lastScrollTopRef.current = container.scrollTop
    const handleScroll = () => {
      const threshold = 50
      const currentScrollTop = container.scrollTop
      const atBottom = container.scrollHeight - currentScrollTop - container.clientHeight < threshold
      if (currentScrollTop < lastScrollTopRef.current - 1) {
        userScrolledUpRef.current = true
      } else if (atBottom) {
        userScrolledUpRef.current = false
      }
      lastScrollTopRef.current = currentScrollTop
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  // Reset scroll lock when streaming ends or conversation changes
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false
    }
  }, [isStreaming])

  useEffect(() => {
    userScrolledUpRef.current = false
  }, [activeConversationId])

  const handleSend = useCallback(
    async (text: string) => {
      // Auto-create a conversation if none is active
      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      addMessage("user", text)
      setStreaming(true)
      const sessionId = streamSessionGuardRef.current.start()
      activeStreamSessionRef.current = sessionId

      // Build system prompt with wiki context using graph-enhanced retrieval
      const systemMessages: LLMMessage[] = []
      let queryRefs: { title: string; path: string }[] = []
      let langReminder: string | undefined
      const taskRoute = novelMode ? routeTask(text) : null
      const pp = project ? normalizePath(project.path) : ""
      // 会话内上次生成的章节号：未保存到章节库时也能正确推进“下一章”
      const lastGeneratedChapterNumber = novelMode && project
        ? detectLastGeneratedChapterNumber(
          useChatStore.getState().getActiveMessages()
            .filter((m) => m.role === "assistant" && !m.discarded)
            .map((m) => m.content),
        )
        : undefined
      const targetChapterNumber = novelMode && project && taskRoute
        ? await resolveTargetChapterNumberForChat({
          projectPath: pp,
          userRequest: text,
          routeIntent: taskRoute.intent,
          routeChapterNumber: taskRoute.chapterNumber,
          selectedFile,
          lastGeneratedChapterNumber,
        })
        : undefined
      const effectiveTaskRoute = taskRoute && targetChapterNumber
        ? {
          ...taskRoute,
          chapterNumber: targetChapterNumber,
          extractedParams: {
            ...taskRoute.extractedParams,
            chapterNumber: String(targetChapterNumber),
          },
        }
        : taskRoute
      // AI 会话选中的 model 名（如 "deepseek-v3"）需要找到它所属的 provider
      // 重新计算 baseUrl/apiKey/apiMode，否则会沿用 activePresetId 的配置
      // 导致跨 provider 调用失败
      let effectiveChatLlmConfig = llmConfig
      if (aiChatModel.trim()) {
        const targetModel = aiChatModel.trim()
        let matched = false
        for (const [providerId, override] of Object.entries(providerConfigs)) {
          if (override.savedModels?.some((m) => m.model === targetModel)) {
            const template =
              LLM_PRESETS.find((p) => p.id === providerId) ??
              LLM_PRESETS.find((p) => p.id === "custom")
            if (template) {
              effectiveChatLlmConfig = {
                ...resolveConfig(template, override, llmConfig),
                model: targetModel,
              }
            }
            matched = true
            break
          }
        }
        if (!matched) {
          effectiveChatLlmConfig = { ...llmConfig, model: targetModel }
        }
      }
      const shouldUseEditMode = novelMode && chatEditModeEnabled && isChatEditRequest(text)
      const goldenThreeChapter = novelMode
        ? detectGoldenThreeChapterRequest(text, effectiveTaskRoute?.chapterNumber)
        : undefined
      const dismantlingDirective = novelMode && project
        ? await loadEnabledDismantlingDirective(pp).catch(() => "")
        : ""
      if (shouldUseEditMode) {
        const resolvedTarget = resolveChatEditTarget({
          userRequest: text,
          selectedChapterNumber: await readSelectedChapterNumberForFile(selectedFile) ?? null,
        })
        if (!resolvedTarget.ok) {
          finalizeStream(resolvedTarget.message, [])
          setStreaming(false)
          activeStreamSessionRef.current = null
          return
        }

        const chapterPayloads = await Promise.all(
          resolvedTarget.target.chapterNumbers.map(async (chapterNumber) => {
            const chapterPath = await findChapterFileByNumber(pp, chapterNumber)
            if (!chapterPath) {
              return { chapterNumber, chapterPath: null, content: "" }
            }
            const original = await readFile(chapterPath).catch(() => "")
            return { chapterNumber, chapterPath, content: original }
          }),
        )

        if (chapterPayloads.some((item) => !item.chapterPath)) {
          const missing = chapterPayloads.filter((item) => !item.chapterPath).map((item) => item.chapterNumber).join("、")
          finalizeStream(`未找到以下章节，暂时无法执行修改：第${missing}章`, [])
          setStreaming(false)
          activeStreamSessionRef.current = null
          return
        }

        const editPrompt = [
          "你正在执行小说章节修改任务。",
          "请严格按照用户要求修改指定章节内容。",
          "如果是多章修改，必须逐章返回完整修改稿。",
          "输出格式必须严格如下：",
          "【第11章】",
          "修改后的完整正文",
          "",
          "【第12章】",
          "修改后的完整正文",
          "",
          "不要解释，不要补充说明。",
          "",
          `用户要求：${text}`,
          "",
          "待修改章节如下：",
          ...chapterPayloads.map((item) => `【第${item.chapterNumber}章原文】\n${item.content}`),
        ].join("\n")

        const controller = new AbortController()
        abortRef.current = controller
        let editResult = ""
        let editError: Error | null = null

        await streamChat(
          effectiveChatLlmConfig,
          [{ role: "user", content: editPrompt }],
          {
            onToken: (token) => {
              if (!streamSessionGuardRef.current.isActive(sessionId)) return
              editResult += token
              appendStreamToken(token)
            },
            onDone: () => {},
            onError: (error) => {
              editError = error
            },
          },
          controller.signal,
          { reasoning: resolveUserVisibleReasoning(effectiveChatLlmConfig.reasoning) },
        )

        if (editError) {
          const editErrorMessage = String(editError)
          finalizeStream(`修改失败：${editErrorMessage}`, [])
          setStreaming(false)
          activeStreamSessionRef.current = null
          return
        }

        const validatedEdits = resolvedTarget.target.mode === "single"
          ? {
            ok: true as const,
            files: [{
              chapterNumber: resolvedTarget.target.chapterNumbers[0],
              content: editResult,
            }],
          }
          : validateStructuredChapterEditResult({
            content: editResult,
            targetChapterNumbers: resolvedTarget.target.chapterNumbers,
          })

        if (!validatedEdits.ok) {
          finalizeStream(validatedEdits.message, [])
          setStreaming(false)
          activeStreamSessionRef.current = null
          return
        }

        for (const chapter of chapterPayloads) {
          if (!chapter.chapterPath) continue
          const rawResult = validatedEdits.files.find((item) => item.chapterNumber === chapter.chapterNumber)?.content
          if (!rawResult) {
            finalizeStream(`第${chapter.chapterNumber}章缺少修改结果，已停止写回。`, [])
            setStreaming(false)
            activeStreamSessionRef.current = null
            return
          }
          const normalizedResult = normalizeChapterEditFile({
            targetChapterNumber: chapter.chapterNumber,
            content: rawResult,
            originalContent: chapter.content,
          })
          if (!normalizedResult.ok) {
            finalizeStream(normalizedResult.message, [])
            setStreaming(false)
            activeStreamSessionRef.current = null
            return
          }
          await backupChapterFile({
            projectPath: pp,
            chapterPath: chapter.chapterPath,
            chapterNumber: chapter.chapterNumber,
            content: chapter.content,
          })
          await writeFile(chapter.chapterPath, normalizedResult.content)
        }

        await refreshProjectState(pp)
        if (chapterPayloads[0]?.chapterPath) {
          useWikiStore.getState().setSelectedFile(chapterPayloads[0].chapterPath)
        }
        finalizeStream(
          resolvedTarget.target.mode === "single"
            ? `已完成第${resolvedTarget.target.chapterNumbers[0]}章修改，并已自动备份原内容。`
            : `已完成 ${resolvedTarget.target.chapterNumbers.length} 个章节的批量修改，并已分别备份原内容。`,
          [],
        )
        setStreaming(false)
        activeStreamSessionRef.current = null
        return
      }
      if (novelMode && project && deepChapterEnabled) {
        const { runDeepChapterGeneration } = await import("@/lib/novel/deep-chapter-generation")
        const controller = new AbortController()
        abortRef.current = controller
        const deepStream = createDeepThinkingStreamRenderer()
        let accumulated = ""
        let latestCheckpoint: import("@/lib/novel/deep-chapter-generation").DeepChapterGenerationResumeCheckpoint | undefined
        const appendThinkingBlock = (content: string) => {
          if (!streamSessionGuardRef.current.isActive(sessionId)) return
          accumulated = deepStream.updateThinking(content)
          setStreamingContent(accumulated)
        }

        try {
          await runDeepChapterGeneration(
            {
              projectPath: pp,
              userRequest: text,
              chapterNumber: effectiveTaskRoute?.chapterNumber,
              goldenThreeChapter: goldenThreeChapter?.enabled ? goldenThreeChapter : undefined,
              dismantlingReferenceDirective: dismantlingDirective,
              llmConfig: effectiveChatLlmConfig,
            },
            {
              onThinking: appendThinkingBlock,
              onFinalContent: (content) => {
                if (!streamSessionGuardRef.current.isActive(sessionId)) return
                accumulated = deepStream.appendFinal(content)
                setStreamingContent(accumulated)
              },
              onCheckpoint: (checkpoint) => {
                latestCheckpoint = checkpoint
              },
            },
            undefined,
            controller.signal,
          )
          streamSessionGuardRef.current.finish(sessionId, () => {
            finalizeStream(accumulated, [])
            activeStreamSessionRef.current = null
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const existing = deepStream.getContent()
          if (controller.signal.aborted || message === "已停止生成") {
            streamSessionGuardRef.current.finish(sessionId, () => {
              finalizeStream(`${existing ? `${existing}\n\n` : ""}已停止生成。`, [])
              activeStreamSessionRef.current = null
            })
          } else {
            streamSessionGuardRef.current.finish(sessionId, () => {
              const visibleFailure = `${existing ? `${existing}\n\n` : ""}出错：深度生成章节失败：${message}`
              finalizeStream(
                appendContinueUnfinishedDeepChapterContext(visibleFailure, {
                  originalRequest: text,
                  resumeContext: visibleFailure,
                  rootResumeContext: visibleFailure,
                  checkpoint: latestCheckpoint,
                }),
                undefined,
              )
              activeStreamSessionRef.current = null
            })
          }
        } finally {
          if (activeStreamSessionRef.current === sessionId) {
            activeStreamSessionRef.current = null
          }
          if (abortRef.current === controller) {
            abortRef.current = null
          }
        }
        return
      }
      const shouldUseQmQuaiSkill = effectiveTaskRoute != null && (
        effectiveTaskRoute.intent === "write_chapter" ||
        effectiveTaskRoute.intent === "continue_chapter" ||
        effectiveTaskRoute.intent === "rewrite_chapter"
      )
      const qmQuaiSystemPrompt = shouldUseQmQuaiSkill ? buildQmQuaiSystemPrompt() : ""
      // Pure greetings ("hi", "你好", "嗨") don't warrant running the whole
      // retrieval pipeline — it's slow, costs context, and drags in random
      // wiki pages the user clearly didn't ask about. Short-circuit with a
      // minimal system prompt and let the model reply conversationally.
      const greetingOnly = isGreeting(text)
      if (project && greetingOnly) {
        const outLang = getOutputLanguage(text)
        systemMessages.push({
          role: "system",
          content: [
            `你是项目「${project.name}」的资料库问答助手。`,
            "用户只是打了一个招呼，请用一两句话自然简短地回应。",
            "不要编造资料库内容，也不要假装已经检索过页面。如果用户想查询资料，请引导用户提出一个具体问题。",
            "",
            `请使用 ${outLang} 回复。`,
          ].join("\n"),
        })
        // Skip retrieval; queryRefs stays empty so no "Sources" chip is shown.
      } else if (project) {
        const pp = normalizePath(project.path)
        const dataVersion = useWikiStore.getState().dataVersion

        // ── Budget allocation (see context-budget.ts) ─────────
        // Page budget scales with the LLM's context window; we now
        // also reserve ~15% as headroom for the response so the
        // model isn't truncated mid-sentence on a packed prompt.
        const {
          indexBudget: INDEX_BUDGET,
          pageBudget: PAGE_BUDGET,
          maxPageSize: MAX_PAGE_SIZE,
        } = computeContextBudget(llmConfig.maxContextSize)

        const [rawIndex, purpose] = await Promise.all([
          readFile(`${pp}/wiki/index.md`).catch(() => ""),
          readFile(`${pp}/purpose.md`).catch(() => ""),
        ])

        // ── Phase 1: Tokenized search → top 10 ────────────────
        const searchResults = await searchWiki(pp, text, {
          rerank: true,
          topK: 10,
          rerankPurpose: "用于聊天问答时挑选最值得注入上下文的知识页面。",
        })
        const topSearchResults = searchResults.slice(0, 10)

        // ── Trim index by relevance if over budget ─────────────
        let index = rawIndex
        if (rawIndex.length > INDEX_BUDGET) {
          const tokens = tokenizeQuery(text)
          const lines = rawIndex.split("\n")
          const keptLines: string[] = []
          let keptSize = 0

          for (const line of lines) {
            const isHeader = line.startsWith("##")
            const lower = line.toLowerCase()
            const isRelevant = tokens.some((t) => lower.includes(t))

            if (isHeader || isRelevant) {
              if (keptSize + line.length + 1 <= INDEX_BUDGET) {
                keptLines.push(line)
                keptSize += line.length + 1
              }
            }
          }
          index = keptLines.join("\n")
          if (index.length < rawIndex.length) {
            index += "\n\n[...index trimmed to relevant entries...]"
          }
        }

        // ── Phase 2: Graph 1-level expansion ───────────────────
        // Note: Vector search (if enabled) is already merged into searchResults
        // by searchWiki() in search.ts — no duplicate code needed here.
        const { buildRetrievalGraph, getRelatedNodes } = await import("@/lib/graph-relevance")
        const graph = await buildRetrievalGraph(pp, dataVersion)
        const expandedIds = new Set<string>()
        const searchHitPaths = new Set(topSearchResults.map((r) => r.path))
        const graphExpansions: { title: string; path: string; relevance: number }[] = []

        for (const result of topSearchResults) {
          const fileName = getFileName(result.path)
          const nodeId = fileName.replace(/\.md$/, "")
          const related = getRelatedNodes(nodeId, graph, 3)
          for (const { node, relevance } of related) {
            if (relevance < 2.0) continue
            if (searchHitPaths.has(node.path)) continue
            if (expandedIds.has(node.id)) continue
            expandedIds.add(node.id)
            graphExpansions.push({ title: node.title, path: node.path, relevance })
          }
        }
        graphExpansions.sort((a, b) => b.relevance - a.relevance)

        // ── Phase 3 & 4: Page budget control ───────────────────
        let usedChars = 0
        type PageEntry = { title: string; path: string; content: string; priority: number }
        const relevantPages: PageEntry[] = []

        const tryAddPage = async (title: string, filePath: string, priority: number): Promise<boolean> => {
          if (usedChars >= PAGE_BUDGET) return false
          try {
            const raw = await readFile(filePath)
            const relativePath = getRelativePath(filePath, pp)
            const truncated = raw.length > MAX_PAGE_SIZE
              ? raw.slice(0, MAX_PAGE_SIZE) + "\n\n[...truncated...]"
              : raw
            if (usedChars + truncated.length > PAGE_BUDGET) return false
            usedChars += truncated.length
            relevantPages.push({ title, path: relativePath, content: truncated, priority })
            return true
          } catch { return false }
        }

        // P0: Title matches
        for (const r of topSearchResults.filter((r) => r.titleMatch)) {
          await tryAddPage(r.title, r.path, 0)
        }
        // P1: Content matches
        for (const r of topSearchResults.filter((r) => !r.titleMatch)) {
          await tryAddPage(r.title, r.path, 1)
        }
        // P2: Graph expansions
        for (const exp of graphExpansions) {
          await tryAddPage(exp.title, exp.path, 2)
        }
        // P3: Overview fallback
        if (relevantPages.length === 0) {
          await tryAddPage("Overview", `${pp}/wiki/overview.md`, 3)
        }

        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p, i) =>
              `### [${i + 1}] ${p.title}\nPath: ${p.path}\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No wiki pages found)"

        const pageList = relevantPages.map((p, i) =>
          `[${i + 1}] ${p.title} (${p.path})`
        ).join("\n")

        const outLang = getOutputLanguage(text)

        let novelContextPreamble = ""
        if (novelMode && project && effectiveTaskRoute) {
          try {
            const taskDirective = buildTaskDirective(effectiveTaskRoute)
            const goldenDirective = buildGoldenThreeChapterDirective(goldenThreeChapter)
            const { buildContextPack, contextPackToPrompt } = await import("@/lib/novel/context-engine")
            const contextPack = await buildContextPack(pp, text, effectiveTaskRoute.chapterNumber).catch(() => ({
              task: text,
              chapterGoal: "",
              outline: "",
              recentSummaries: [],
              previousChapterEnding: "",
              characterStates: "",
              soulDoc: "",
              characterAuras: "",
              cognitionStates: "",
              foreshadowingStates: "",
              timeline: "",
              relatedSettings: "",
              canonRules: "",
              writingStyle: "",
              searchResults: "",
              graphSearchResults: "",
              mustDo: "",
              mustAvoid: "",
              nextChapterAdvice: "",
              revisionDirectives: "",
            }))
            if (contextPack.characterAuras.trim()) {
            const confirmed = await requestSoulDialog(contextPack.characterAuras)
            if (!confirmed) {
              streamSessionGuardRef.current.finish(sessionId, () => {
                finalizeStream("已取消本次生成，角色灵魂上下文未发送给模型。", undefined)
                activeStreamSessionRef.current = null
              })
              abortRef.current = null
              return
            }
            }
            const novelConfig = useWikiStore.getState().novelConfig
            const budget = novelConfig.contextTokenBudget > 0 ? novelConfig.contextTokenBudget : undefined
            novelContextPreamble = contextPackToPrompt(contextPack, budget)
            if (goldenDirective) {
              novelContextPreamble = goldenDirective + "\n" + novelContextPreamble
            }
            if (taskDirective) {
              novelContextPreamble = taskDirective + "\n" + novelContextPreamble
            }
          } catch {}
        }

        systemMessages.push({
          role: "system",
          content: [
            qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
            novelMode
              ? "你是一个专业的小说写作助手。请根据提供的小说上下文包和章节内容，协助用户进行小说创作。"
              : "你是一个专业的资料库问答助手。请基于下方提供的资料内容回答问题。",
            "",
            novelMode
              ? [
                  "## 小说章节输出规则",
                  "- 如果用户要求生成、续写或改写章节，只输出可直接放入章节库的小说正文。",
                  "- 不要输出资料说明、创作说明、免责声明、后续建议、引用列表或隐藏 cited 注释。",
                  "- 不要在小说正文里写 [[资料名]]、[1]、[2] 这类资料引用标记。",
                  "- 资料只作为内部参考，不能把资料库缺失、基于现有资料等元信息写进章节。",
                ].join("\n")
              : "",
            "",
            novelMode
              ? [
                  "## 规则",
                  "- 只能基于下方小说资料、上下文包和用户要求创作，不要编写解释性回答。",
                  "- 如果资料不足，也要根据已有小说上下文自然续写，不要把“资料不足”写进正文。",
                ].join("\n")
              : [
                  "## 规则",
                  "- 只能基于下方编号资料页面回答。",
                  "- 如果资料不足，请直接说明资料不足。",
                  "- 引用资料页面时使用 [[页面名]] 格式。",
                  "- 引用具体信息时使用页码标记，例如 [1]、[2]。",
                  "- 回复末尾必须添加隐藏注释，列出你使用过的资料页码：",
                  "  <!-- cited: 1, 3, 5 -->",
                ].join("\n"),
            "",
            "请使用清晰的 Markdown 格式。",
            "",
            purpose ? `## 资料库目标\n${purpose}` : "",
            index ? `## 资料库索引\n${index}` : "",
            relevantPages.length > 0 ? `## 页面列表\n${pageList}` : "",
            `## 资料页面\n\n${pagesContext}`,
            novelContextPreamble ? `\n${novelContextPreamble}` : "",
            dismantlingDirective ? `\n${dismantlingDirective}` : "",
            "",
            "---",
            "",
            `## ⚠️ 强制输出语言：${outLang}`,
            "",
            `你的整段回复必须使用 **${outLang}**。`,
            "即使上方资料内容使用其他语言，也不能影响你的回复语言。",
            `请忽略资料原文语言，只使用 ${outLang} 回复。`,
            `必要时，专有名词也应使用 ${outLang} 的常见译法或音译。`,
            "不要使用任何其他语言。本规则优先于其他所有指令。",
          ].filter(Boolean).join("\n"),
        })

        // Reminder injected later, right before the user's current message
        // (after history so it's the last system instruction the LLM sees).
        langReminder = buildLanguageReminder(text)

        // ── Agent mode: append file edit instructions if user has edit intent ──
        if (novelMode && systemMessages.length > 0) {
          const { detectEditIntent, buildAgentSystemSuffix } = await import("@/lib/novel/agent-parser")
          if (detectEditIntent(text)) {
            const lastSys = systemMessages[systemMessages.length - 1]
            if (lastSys && typeof lastSys.content === "string") {
              const { readScopeFileContents } = await import("@/lib/novel/agent-tools")
              const filesWithContent = await readScopeFileContents(pp, "chapters")
              const fileContentStr = filesWithContent.length > 0
                ? `\n\n## 当前章节文件内容（供修改定位）\n${filesWithContent.map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")}`
                : "\n\n## 当前章节文件列表\n(暂无章节文件)"
              lastSys.content += buildAgentSystemSuffix("chapters")
              lastSys.content += fileContentStr
            }
          }
        }

        const nextQueryPages = relevantPages.map((p) => ({ title: p.title, path: p.path }))
        setLastQueryPages(nextQueryPages)
        queryRefs = [...nextQueryPages]
      }

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = useChatStore.getState().getActiveMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      // Prepend the language reminder onto the final user turn rather than
      // inserting a second {role:"system"} between history and the final
      // user message. vLLM / llama.cpp / Ollama drive their chat templates
      // from HF Jinja, and Qwen3-family templates enforce "system only at
      // index 0" — a mid-conversation system message gets rejected with
      // "System message must be at the beginning." (HTTP 400). OpenAI and
      // Anthropic are more lenient, but keeping a single system at the top
      // is the safest shape across every OpenAI-compatible backend.
      const historyMessages = chatMessagesToLLM(activeConvMessages)
      let llmMessages: LLMMessage[] = [...systemMessages, ...historyMessages]
      if (langReminder && historyMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: `[${langReminder}]\n\n${last.content}` },
          ]
        }
      }

      const conversations = useChatStore.getState().conversations
      const activeConv = conversations.find(c => c.id === activeConversationId)
      const deAiMode = activeConv?.deAiMode ?? false
      if (deAiMode && llmMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user" && typeof last.content === "string") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: injectDeAiDirective(last.content, deAiMode) },
          ]
        }
      }

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""
      let thinkingOpen = false

      const appendReasoning = (token: string) => {
        if (!streamSessionGuardRef.current.isActive(sessionId)) return
        if (!token) return
        if (!thinkingOpen) {
          thinkingOpen = true
          accumulated += "<think>"
          appendStreamToken("<think>")
        }
        accumulated += token
        appendStreamToken(token)
      }

      const closeReasoning = () => {
        if (!streamSessionGuardRef.current.isActive(sessionId)) return
        if (!thinkingOpen) return
        thinkingOpen = false
        accumulated += "</think>"
        appendStreamToken("</think>")
      }

      await streamChat(
        effectiveChatLlmConfig,
        llmMessages,
        {
          onToken: (token) => {
            if (!streamSessionGuardRef.current.isActive(sessionId)) return
            closeReasoning()
            accumulated += token
            appendStreamToken(token)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            streamSessionGuardRef.current.finish(sessionId, () => {
              closeReasoning()
              finalizeStream(accumulated, queryRefs)
              activeStreamSessionRef.current = null
              abortRef.current = null
            })
            // save-worthy detection removed — user has direct "Save to Wiki" button on each message
          },
          onError: (err) => {
            streamSessionGuardRef.current.finish(sessionId, () => {
              finalizeStream(`出错：${err.message}`, undefined)
              activeStreamSessionRef.current = null
              abortRef.current = null
            })
          },
        },
        controller.signal,
        { reasoning: resolveUserVisibleReasoning(effectiveChatLlmConfig.reasoning) },
      )
    },
    [aiChatModel, llmConfig, providerConfigs, chatEditModeEnabled, addMessage, setStreaming, setStreamingContent, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, requestSoulDialog, deepChapterEnabled, project, novelMode, selectedFile],
  )

  const handleStop = useCallback(() => {
    const sessionId = activeStreamSessionRef.current
    const currentStreamingContent = useChatStore.getState().streamingContent
    abortRef.current?.abort()
    abortRef.current = null
    if (sessionId !== null) {
      streamSessionGuardRef.current.stop(sessionId, () => {
        finalizeStream(`${currentStreamingContent ? `${currentStreamingContent}\n\n` : ""}已停止生成。`, [])
        activeStreamSessionRef.current = null
      })
    }
  }, [finalizeStream])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = useChatStore.getState().getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Small delay to let state update
    await new Promise((r) => setTimeout(r, 50))
    // Trigger send with the same text (handleSend will add a new user message,
    // so also remove the original to avoid duplication)
    // Actually: just call handleSend — but it adds a user message. To avoid dupe,
    // we remove the last user message too and let handleSend re-add it.
    const store = useChatStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend])

  const handleContinueNextChapter = useCallback(() => {
    if (isStreaming) return
    // 按设置中的单章目标字数生成提示词（issue #8）
    const lengthSpec = resolveChapterLengthSpec(useWikiStore.getState().novelConfig?.chapterTargetChars)
    const target = lengthSpec.targetChars
    handleSend(`请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。只输出可直接保存到章节库的小说正文，不要解释，不要列提纲。正文必须是完整章节，目标约 ${target} 字，建议 ${target - 200}-${target + 300} 字，低于 ${target - 400} 字视为未完成。`)
  }, [handleSend, isStreaming])

  const handleContinueUnfinished = useCallback(async (assistantMessage: DisplayMessage) => {
    if (isStreaming) return

    let convId = useChatStore.getState().activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const active = useChatStore.getState().getActiveMessages()
    const persistedResume = extractContinueUnfinishedDeepChapterContext(assistantMessage.content)
    const visibleAssistantContent = stripContinueUnfinishedDeepChapterContext(assistantMessage.content)
    const originalRequest =
      persistedResume?.originalRequest ||
      findPreviousUserRequest(active, assistantMessage.id)
    const resumeContext = persistedResume?.resumeContext || visibleAssistantContent
    const rootResumeContext = persistedResume?.rootResumeContext || resumeContext
    const prompt = buildContinueUnfinishedDeepChapterPrompt({
      originalRequest,
      persistedOriginalRequest: persistedResume?.originalRequest,
      failedAssistantContent: visibleAssistantContent,
      resumeContext,
      rootResumeContext,
    })

    addMessage("user", "继续未完成")
    setStreaming(true)

    const sessionId = streamSessionGuardRef.current.start()
    activeStreamSessionRef.current = sessionId
    const controller = new AbortController()
    abortRef.current = controller

    const deepStream = createDeepThinkingStreamRenderer()
    let accumulated = deepStream.updateThinking("## 继续未完成\n正在基于上一轮已完成阶段继续生成，避免从头重新思考。")
    let resumeThinking = ""
    let latestCheckpoint = persistedResume?.checkpoint
    setStreamingContent(accumulated)

    try {
      const novelConfig = useWikiStore.getState().novelConfig
      const writingConfig = resolveNovelModel(llmConfig, novelConfig, "writing")

      if (project && originalRequest?.trim() && persistedResume?.checkpoint) {
        const pp = normalizePath(project.path)
        const resumeRoute = routeTask(originalRequest)
        const goldenResume = detectGoldenThreeChapterRequest(originalRequest, resumeRoute?.chapterNumber)
        const dismantlingDirective = await loadEnabledDismantlingDirective(pp).catch(() => "")
        const { runDeepChapterGeneration } = await import("@/lib/novel/deep-chapter-generation")

        await runDeepChapterGeneration(
          {
            projectPath: pp,
            userRequest: originalRequest,
            chapterNumber: resumeRoute?.chapterNumber,
            goldenThreeChapter: goldenResume?.enabled ? goldenResume : undefined,
            dismantlingReferenceDirective: dismantlingDirective,
            llmConfig,
            resumeCheckpoint: persistedResume.checkpoint,
          },
          {
            onThinking: (content) => {
              if (!streamSessionGuardRef.current.isActive(sessionId)) return
              accumulated = deepStream.updateThinking(content)
              setStreamingContent(accumulated)
            },
            onFinalContent: (content) => {
              if (!streamSessionGuardRef.current.isActive(sessionId)) return
              accumulated = deepStream.appendFinal(content)
              setStreamingContent(accumulated)
            },
            onCheckpoint: (checkpoint) => {
              latestCheckpoint = checkpoint
            },
          },
          undefined,
          controller.signal,
        )

        if (!streamSessionGuardRef.current.isActive(sessionId)) return
        streamSessionGuardRef.current.finish(sessionId, () => {
          finalizeStream(accumulated || "继续未完成失败：模型没有返回内容。", [])
          activeStreamSessionRef.current = null
          abortRef.current = null
        })
        return
      }

      let continuationSystemPrompt = [
        "你是专业小说写作助手。用户正在继续一次已中断的深度章节生成，请严格基于已有思考和阶段内容往后完成，不要从头重跑已完成阶段。",
        "如果上方恢复上下文里没有正文草稿，就从正文生成阶段继续；如果已经有正文草稿，就继续审查、返修、简单审查、去AI味或补全正文。",
        "不要把“继续未完成”当作原始章节需求；原始章节需求必须以恢复上下文中的原始用户请求为准。",
      ].join("\n")

      if (project && originalRequest?.trim()) {
        try {
          const pp = normalizePath(project.path)
          const resumeRoute = routeTask(originalRequest)
          const goldenResume = detectGoldenThreeChapterRequest(originalRequest, resumeRoute?.chapterNumber)
          const taskDirective = resumeRoute ? buildTaskDirective(resumeRoute) : ""
          const goldenDirective = buildGoldenThreeChapterDirective(goldenResume)
          const { buildContextPack, contextPackToPrompt } = await import("@/lib/novel/context-engine")
           const contextPack = await buildContextPack(pp, originalRequest, resumeRoute?.chapterNumber).catch(() => ({
             task: originalRequest,
             chapterGoal: "",
             outline: "",
             recentSummaries: [],
             previousChapterEnding: "",
             characterStates: "",
             soulDoc: "",
             characterAuras: "",
             cognitionStates: "",
             foreshadowingStates: "",
             timeline: "",
             relatedSettings: "",
             canonRules: "",
             writingStyle: "",
             searchResults: "",
             graphSearchResults: "",
             mustDo: "",
             mustAvoid: "",
             nextChapterAdvice: "",
             revisionDirectives: "",
           }))
           const budget = novelConfig.contextTokenBudget > 0 ? novelConfig.contextTokenBudget : undefined
           const dismantlingDirective = await loadEnabledDismantlingDirective(pp).catch(() => "")
           continuationSystemPrompt = [
             continuationSystemPrompt,
             "",
            "## QM-QUAI 技能",
            buildQmQuaiSystemPrompt(),
            "",
            taskDirective,
            goldenDirective,
             "",
             "## 原始深度章节上下文包",
             contextPackToPrompt(contextPack, budget),
             dismantlingDirective,
           ].filter(Boolean).join("\n")
        } catch (err) {
          console.warn("构建继续未完成上下文包失败:", err)
        }
      }

      let streamError: Error | null = null

      await streamChat(
        writingConfig,
        [
          {
            role: "system",
            content: continuationSystemPrompt,
          },
          { role: "user", content: prompt },
        ],
        {
          onToken: (token) => {
            if (!streamSessionGuardRef.current.isActive(sessionId)) return
            accumulated = deepStream.appendFinal(token)
            setStreamingContent(accumulated)
          },
          onReasoningToken: (token) => {
            if (!streamSessionGuardRef.current.isActive(sessionId)) return
            resumeThinking += token
            accumulated = deepStream.updateThinking(
              `## 继续未完成\n正在基于上一轮已完成阶段继续生成，避免从头重新思考。\n\n${resumeThinking}`,
            )
            setStreamingContent(accumulated)
          },
          onDone: () => {},
          onError: (err) => {
            streamError = err
          },
        },
        controller.signal,
        { reasoning: resolveUserVisibleReasoning(writingConfig.reasoning) },
      )

      if (!streamSessionGuardRef.current.isActive(sessionId)) return
      if (streamError) throw streamError

      streamSessionGuardRef.current.finish(sessionId, () => {
        finalizeStream(accumulated || "继续未完成失败：模型没有返回内容。", [])
        activeStreamSessionRef.current = null
        abortRef.current = null
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      streamSessionGuardRef.current.finish(sessionId, () => {
        const visibleFailure = `${accumulated ? `${accumulated}\n\n` : ""}出错：继续未完成失败：${message}`
        const inheritedResumeContext = [
          rootResumeContext,
          "",
          "## 最近一次继续未完成失败时的输出",
          stripContinueUnfinishedDeepChapterContext(visibleFailure),
        ].join("\n")
        finalizeStream(
          appendContinueUnfinishedDeepChapterContext(visibleFailure, {
            originalRequest,
            resumeContext: inheritedResumeContext,
            rootResumeContext,
            checkpoint: latestCheckpoint,
          }),
          undefined,
        )
        activeStreamSessionRef.current = null
        abortRef.current = null
      })
    } finally {
      if (activeStreamSessionRef.current === sessionId) {
        activeStreamSessionRef.current = null
      }
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [isStreaming, createConversation, addMessage, setStreaming, setStreamingContent, llmConfig, finalizeStream])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        await refreshProjectState(pp)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("写入 wiki 失败:", err)
    }
  }, [project, llmConfig])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ConversationTabs />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">{t(novelMode ? "novel.chat.startNewConversation" : "chat.startNewConversation")}</p>
              <p className="mt-1 text-xs opacity-60">{t(novelMode ? "novel.chat.clickNewChatToBegin" : "chat.clickNewChatToBegin")}</p>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-3 py-2"
            >
              {/* key 强制在切换会话时重新挂载消息列表，避免旧会话内容残留 */}
              <div key={activeConversationId} className="flex flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  // Check if this is the last assistant message
                  const isLastAssistant = msg.role === "assistant" &&
                    !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant && !isStreaming}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                      novelMode={novelMode}
                      projectPath={project?.path ?? null}
                      onSaveAsChapter={handleSaveAsChapter}
                      onContinueNextChapter={isLastAssistant ? handleContinueNextChapter : undefined}
                      onContinueUnfinished={isLastAssistant ? () => handleContinueUnfinished(msg) : undefined}
                      saveStatus={chapterSaveStatus}
                      isSaving={isSavingChapter}
                    />
                  )
                })}
                {isStreaming && <StreamingMessage content={streamingContent} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  {t(novelMode ? "novel.chat.writeToWiki" : "chat.writeToWiki")}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="shrink-0 border-t bg-background">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            footerControls={
              <TooltipProvider delay={200}>
                <div className="flex items-center justify-between gap-2 flex-nowrap overflow-x-auto">
                  <div className="flex items-center gap-2 flex-nowrap">
                    <ChatDockControls />
                    {novelMode ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-pressed={deepChapterEnabled}
                          className={getDeepChapterToggleButtonClass(deepChapterEnabled)}
                          onClick={() => setDeepChapterEnabled(!deepChapterEnabled)}
                          title={deepChapterEnabled ? "关闭深度模式" : "开启深度模式"}
                          aria-label={deepChapterEnabled ? "关闭深度模式" : "开启深度模式"}
                        >
                          <Brain className="h-4 w-4" />
                        </Button>
                        <Tooltip>
                          <TooltipTrigger
                            render={(
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-pressed={chatEditModeEnabled}
                                className={chatEditModeEnabled ? "border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100" : ""}
                                onClick={() => setChatEditModeEnabled(!chatEditModeEnabled)}
                                title="编辑章节"
                                aria-label="编辑章节"
                              />
                            )}
                          >
                            <FileEdit className="h-4 w-4" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs leading-5">
                            开启后，AI会话会读取当前章节或识别到的章节范围进行修改，并在写回前自动备份原内容。
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-nowrap">
                    <ChatModelSelector
                      value={aiChatModel}
                      onChange={(model) => {
                        setAiChatModel(model)
                        void saveAiChatModel(model)
                      }}
                    />
                  </div>
                </div>
              </TooltipProvider>
            }
            placeholder={
              mode === "ingest"
                ? t(novelMode ? "novel.chat.ingestPlaceholder" : "chat.ingestPlaceholder")
                : t(novelMode ? "novel.chat.typeAMessage" : "chat.typeAMessage")
            }
          />
        </div>
        <Dialog open={pendingSoulDialog.open} onOpenChange={(open) => { if (!open) closeSoulDialog(false) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>本次写作将注入角色灵魂上下文</DialogTitle>
              <DialogDescription>
                下列内容会进入本次写作上下文包。角色灵魂会增强人物气质、语言倾向和判断方式，但仍服从大纲、人物小传与当前剧情。
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground whitespace-pre-wrap">
              {pendingSoulDialog.summary}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => closeSoulDialog(false)}>取消本次生成</Button>
              <Button onClick={() => closeSoulDialog(true)}>继续生成</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
