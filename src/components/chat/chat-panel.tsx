import { useRef, useEffect, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Plus, Trash2, MessageSquare, FileEdit, Drama } from "lucide-react"
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
import { DeAiSkillPicker } from "@/components/skill-library/de-ai-skill-picker"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective } from "@/lib/novel/task-router"
import { readFile, writeFile, createDirectory, deleteFile } from "@/commands/fs"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { detectLastGeneratedChapterNumber, findChapterFileByNumber, getNextChapterNumber, readSelectedChapterNumberForFile, resolveTargetChapterNumberForChat } from "@/lib/novel/chapter-utils"
import { buildDeAiSkillSystemPrompt, buildQmQuaiSystemPrompt, injectDeAiDirective } from "@/lib/novel/de-ai-adapter"
import { loadEffectiveDeAiSkillSafely } from "@/lib/novel/de-ai-skill-library"
import { cleanGeneratedChapterContentWithTitle } from "@/lib/novel/chapter-content-cleanup"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget, computeNovelContextTokenBudget } from "@/lib/context-budget"
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
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import { loadFrameworks } from "@/lib/novel/story-simulation/framework-store"
import type { FrameworkBinding, StoryFramework } from "@/lib/novel/story-simulation/types"

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

function ConversationTabs({ onAbortStream }: { onAbortStream: (convId: string) => void }) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const streamingContents = useChatStore((s) => s.streamingContents)
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
          variant="ghost"
          size="icon-sm"
          className="qmai-new-conversation-button shrink-0 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
          onClick={() => createConversation()}
          title={t(novelMode ? "novel.chat.newChat" : "chat.newChat")}
          aria-label={t(novelMode ? "novel.chat.newChat" : "chat.newChat")}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        {sorted.length === 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(novelMode ? "novel.chat.noConversationsYet" : "chat.noConversationsYet")}
          </span>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const isThisStreaming = conv.id in streamingContents
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
                {isThisStreaming && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}
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
                      // 先 abort 该会话的流式请求，防止后台继续运行
                      onAbortStream(conv.id)
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
  const streamingContents = useChatStore((s) => s.streamingContents)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const startStreaming = useChatStore((s) => s.startStreaming)
  const setStreamingContent = useChatStore((s) => s.setStreamingContent)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const isConversationStreaming = useChatStore((s) => s.isConversationStreaming)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationDeAiSkillId = useChatStore((s) => s.setConversationDeAiSkillId)
  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId)
    : []
  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId) ?? null
    : null

  // 当前活跃会话的流式内容
  const streamingContent = activeConversationId ? streamingContents[activeConversationId] ?? "" : ""
  // 当前活跃会话是否正在流式生成
  const isStreaming = activeConversationId ? isConversationStreaming(activeConversationId) : false

  const project = useWikiStore((s) => s.project)
  const novelMode = useWikiStore((s) => s.novelMode)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const bindingVersion = useWikiStore((s) => s.bindingVersion)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const setAiChatModel = useWikiStore((s) => s.setAiChatModel)
  const chatEditModeEnabled = useWikiStore((s) => s.chatEditModeEnabled)
  const setChatEditModeEnabled = useWikiStore((s) => s.setChatEditModeEnabled)
  const selectedFile = useWikiStore((s) => s.selectedFile)

  const abortControllersRef = useRef<Record<string, AbortController>>({})
  const streamSessionGuardRef = useRef(createStreamSessionGuard())
  const activeStreamSessionsRef = useRef<Record<string, number>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const soulDialogResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  const [chapterSaveStatus, setChapterSaveStatus] = useState<string>("")
  const [deAiSkillWarningMessage, setDeAiSkillWarningMessage] = useState<string>("")
  const [isSavingChapter, setIsSavingChapter] = useState(false)
  const [pendingSoulDialog, setPendingSoulDialog] = useState({ open: false, summary: "" })
  const deepChapterEnabled = useWikiStore((s) => s.deepChapterEnabled)
  const setDeepChapterEnabled = useWikiStore((s) => s.setDeepChapterEnabled)
  // 故事框架绑定状态
  const [activeBinding, setActiveBinding] = useState<{ binding: FrameworkBinding; framework: StoryFramework } | null>(null)
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
      // 使用带标题提取的清理函数
      const { content: cleanedContent, title: extractedTitle } = cleanGeneratedChapterContentWithTitle(
        getCopyableAssistantContent(content),
      )
      const selectedChapterNumber = await readSelectedChapterNumberForFile(selectedFile)
      const generatedTargetChapterNumber = detectGeneratedTargetChapterNumber(cleanedContent)
      const explicitTargetPath = generatedTargetChapterNumber ? await findChapterFileByNumber(pp, generatedTargetChapterNumber) : null
      const strategy = decideChapterSaveStrategy({
        selectedChapterNumber: selectedChapterNumber ?? null,
        selectedChapterHasBody: false,
        generatedTargetChapterNumber,
        generatedTargetExists: Boolean(explicitTargetPath),
      })

      // 确定目标章节号
      const targetChapterNumber = strategy.action === "direct_explicit_target_new"
        ? strategy.targetChapterNumber
        : await getNextChapterNumber(pp)

      // 使用 AI 生成的标题，如果没有则回退到默认标题
      const chapterTitle = extractedTitle || `第${targetChapterNumber}章`

      const buildDraftContent = (chapterNumber: number, title: string, bodyContent: string) => {
        const now = new Date().toISOString().slice(0, 10)
        const frontmatter = [
          "---",
          "type: chapter",
          `chapter_number: ${chapterNumber}`,
          "chapter_status: draft",
          `title: "${title}"`,
          `created: ${now}`,
          "---",
          "",
        ].join("\n")
        // 正文内容已经包含标题行，直接拼接即可
        return `${frontmatter}${bodyContent}\n`
      }

      const chapterDir = `${pp}/wiki/chapters`
      await createDirectory(chapterDir)
      const chapterPath = `${chapterDir}/chapter-${String(targetChapterNumber).padStart(3, "0")}.md`
      const chapterMarkdown = buildDraftContent(targetChapterNumber, chapterTitle, cleanedContent)
      await writeFile(chapterPath, chapterMarkdown)
      setChapterSaveStatus(`已保存为${chapterTitle}`)
      useWikiStore.getState().setSelectedFile(chapterPath)
      useWikiStore.getState().setFileContent(chapterMarkdown)

      await refreshProjectState(pp)
      useWikiStore.getState().setActiveView("wiki")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChapterSaveStatus(t("chat.saveFailed", { message }))
    } finally {
      setIsSavingChapter(false)
    }
  }, [project, selectedFile, t])

  // 注意：组件卸载时不 abort 流式请求，允许 AI 在后台继续生成
  // 聊天数据存在全局 Zustand store 中，切回来时仍可看到生成结果
  // 删除会话时会单独 abort 该会话的请求（见 abortConversationStream）

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
  }, [activeConversationId])

  // Reset scroll lock when streaming ends or conversation changes
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false
    }
  }, [isStreaming])

  useEffect(() => {
    userScrolledUpRef.current = false
    // 切换会话时清空上一会话的章节保存状态，避免「已保存为第X章」残留
    setChapterSaveStatus("")
  }, [activeConversationId])

  // 加载故事框架绑定状态
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!novelMode || !project) {
        setActiveBinding(null)
        return
      }
      try {
        const binding = await loadBinding(normalizePath(project.path))
        if (cancelled || !binding) {
          setActiveBinding(null)
          return
        }
        const frameworks = await loadFrameworks(normalizePath(project.path))
        if (cancelled) return
        const framework = frameworks.find((f) => f.id === binding.frameworkId)
        if (framework) {
          setActiveBinding({ binding, framework })
        } else {
          setActiveBinding(null)
        }
      } catch {
        if (!cancelled) setActiveBinding(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [novelMode, project, bindingVersion])

  // 切换会话时不再中断后台生成——每个会话独立运行

  const handleSend = useCallback(
    async (text: string) => {
      // Auto-create a conversation if none is active
      setDeAiSkillWarningMessage("")
      // 新一轮对话清空上一轮的章节保存提示，避免「已保存为第X章」残留在新消息下方
      setChapterSaveStatus("")
      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }
      // 捕获当前会话 ID，确保 finalizeStream 保存到正确的会话
      const capturedConvId = convId

      addMessage("user", text)
      startStreaming(capturedConvId)
      const sessionId = streamSessionGuardRef.current.start(capturedConvId)
      activeStreamSessionsRef.current[capturedConvId] = sessionId

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
        // 优先按 "providerId/modelId" 格式精确匹配
        const slashIdx = targetModel.indexOf("/")
        if (slashIdx > 0) {
          const providerId = targetModel.slice(0, slashIdx)
          const modelId = targetModel.slice(slashIdx + 1)
          const override = providerConfigs[providerId]
          if (override?.savedModels?.some((m) => m.model === modelId)) {
            const template =
              LLM_PRESETS.find((p) => p.id === providerId) ??
              LLM_PRESETS.find((p) => p.id === "custom")
            if (template) {
              effectiveChatLlmConfig = {
                ...resolveConfig(template, override, llmConfig),
                model: modelId,
              }
            }
          } else {
            effectiveChatLlmConfig = { ...llmConfig, model: modelId }
          }
        } else {
          // 回退：按纯模型名匹配（兼容旧数据）
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
          finalizeStream(resolvedTarget.message, [], capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
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
          finalizeStream(`未找到以下章节，暂时无法执行修改：第${missing}章`, [], capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
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
        abortControllersRef.current[capturedConvId] = controller
        let editResult = ""
        let editError: Error | null = null

        await streamChat(
          effectiveChatLlmConfig,
          [{ role: "user", content: editPrompt }],
          {
            onToken: (token) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              editResult += token
              appendStreamToken(token, capturedConvId)
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
          finalizeStream(`修改失败：${editErrorMessage}`, [], capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
          delete abortControllersRef.current[capturedConvId]
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
          finalizeStream(validatedEdits.message, [], capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
          delete abortControllersRef.current[capturedConvId]
          return
        }

        for (const chapter of chapterPayloads) {
          if (!chapter.chapterPath) continue
          const rawResult = validatedEdits.files.find((item) => item.chapterNumber === chapter.chapterNumber)?.content
          if (!rawResult) {
            finalizeStream(`第${chapter.chapterNumber}章缺少修改结果，已停止写回。`, [], capturedConvId)
            delete activeStreamSessionsRef.current[capturedConvId]
            delete abortControllersRef.current[capturedConvId]
            return
          }
          const normalizedResult = normalizeChapterEditFile({
            targetChapterNumber: chapter.chapterNumber,
            content: rawResult,
            originalContent: chapter.content,
          })
          if (!normalizedResult.ok) {
            finalizeStream(normalizedResult.message, [], capturedConvId)
            delete activeStreamSessionsRef.current[capturedConvId]
            delete abortControllersRef.current[capturedConvId]
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
          capturedConvId,
        )
        delete activeStreamSessionsRef.current[capturedConvId]
        delete abortControllersRef.current[capturedConvId]
        return
      }
      if (novelMode && project && deepChapterEnabled) {
        const { runDeepChapterGeneration } = await import("@/lib/novel/deep-chapter-generation")
        const controller = new AbortController()
        abortControllersRef.current[capturedConvId] = controller
        const deepStream = createDeepThinkingStreamRenderer()
        let accumulated = ""
        let latestCheckpoint: import("@/lib/novel/deep-chapter-generation").DeepChapterGenerationResumeCheckpoint | undefined
        const appendThinkingBlock = (content: string) => {
          if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
          accumulated = deepStream.updateThinking(content)
          setStreamingContent(accumulated, capturedConvId)
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
                if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
                accumulated = deepStream.appendFinal(content)
                setStreamingContent(accumulated, capturedConvId)
              },
              onCheckpoint: (checkpoint) => {
                latestCheckpoint = checkpoint
              },
            },
            undefined,
            controller.signal,
          )
          streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
            finalizeStream(accumulated, [], capturedConvId)
            delete activeStreamSessionsRef.current[capturedConvId]
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const existing = deepStream.getContent()
          if (controller.signal.aborted || message === "已停止生成") {
            streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
              finalizeStream(`${existing ? `${existing}\n\n` : ""}已停止生成。`, [], capturedConvId)
              delete activeStreamSessionsRef.current[capturedConvId]
            })
          } else {
            streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
              const visibleFailure = `${existing ? `${existing}\n\n` : ""}出错：深度生成章节失败：${message}`
              finalizeStream(
                appendContinueUnfinishedDeepChapterContext(visibleFailure, {
                  originalRequest: text,
                  resumeContext: visibleFailure,
                  rootResumeContext: visibleFailure,
                  checkpoint: latestCheckpoint,
                }),
                undefined,
                capturedConvId,
              )
              delete activeStreamSessionsRef.current[capturedConvId]
            })
          }
        } finally {
          if (activeStreamSessionsRef.current[capturedConvId] === sessionId) {
            delete activeStreamSessionsRef.current[capturedConvId]
          }
          if (abortControllersRef.current[capturedConvId] === controller) {
            delete abortControllersRef.current[capturedConvId]
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
              streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
                finalizeStream("已取消本次生成，角色灵魂上下文未发送给模型。", undefined, capturedConvId)
                delete activeStreamSessionsRef.current[capturedConvId]
              })
              delete abortControllersRef.current[capturedConvId]
              return
            }
            }
            const novelConfig = useWikiStore.getState().novelConfig
            const budget = computeNovelContextTokenBudget(llmConfig.maxContextSize, novelConfig.contextTokenBudget)
            novelContextPreamble = contextPackToPrompt(contextPack, budget)
            if (goldenDirective) {
              novelContextPreamble = goldenDirective + "\n" + novelContextPreamble
            }
            if (taskDirective) {
              novelContextPreamble = taskDirective + "\n" + novelContextPreamble
            }
          } catch {}
        }

        // 固定前缀：技能、角色定位、章节输出规则、规则、Markdown 格式要求。
        // 这部分在一次会话/配置下稳定，打 cacheControl 让 Anthropic 跨会话命中
        // prompt cache；OpenAI/Google 等其他 provider 会自动折叠成字符串，不受影响。
        const stablePrefixParts = [
          qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
          novelMode
            ? "你是一个专业的小说写作助手。请根据提供的小说上下文包和章节内容，协助用户进行小说创作。"
            : "你是一个专业的资料库问答助手。请基于下方提供的资料内容回答问题。",
          "",
          novelMode
            ? [
                "## 小说章节输出规则",
                "- 如果用户要求生成、续写或改写章节，只输出可直接放入章节库的小说正文。",
                "- 正文第一行必须是章节标题，格式为：# 第X章 标题名（标题4-12字，概括本章核心内容）。",
                "- 不要输出资料说明、创作说明、免责声明、后续建议、引用列表或隐藏 cited 注释。",
                "- 不要在小说正文里写 [[资料名]]、[1]、[2] 这类资料引用标记。",
                "- 资料只作为内部参考，不能把资料库缺失、基于现有资料等元信息写进章节。",
              ].filter(Boolean).join("\n")
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
        ].filter(Boolean)

        // 动态部分：资料库目标、索引、页面、上下文包、语言规则。
        // 每次检索结果不同，不缓存。
        const dynamicParts = [
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
        ].filter(Boolean)

        const systemBlocks: { type: "text"; text: string; cacheControl?: boolean }[] = []
        if (stablePrefixParts.length > 0) {
          systemBlocks.push({ type: "text", text: stablePrefixParts.join("\n"), cacheControl: true })
        }
        if (dynamicParts.length > 0) {
          systemBlocks.push({ type: "text", text: dynamicParts.join("\n") })
        }

        systemMessages.push({
          role: "system",
          content: systemBlocks,
        })

        // Reminder injected later, right before the user's current message
        // (after history so it's the last system instruction the LLM sees).
        langReminder = buildLanguageReminder(text)

        // ── Agent mode: append file edit instructions if user has edit intent ──
        if (novelMode && systemMessages.length > 0) {
          const { detectEditIntent, buildAgentSystemSuffix } = await import("@/lib/novel/agent-parser")
          if (detectEditIntent(text)) {
            const lastSys = systemMessages[systemMessages.length - 1]
            if (lastSys) {
              const { readScopeFileContents } = await import("@/lib/novel/agent-tools")
              const filesWithContent = await readScopeFileContents(pp, "chapters")
              const fileContentStr = filesWithContent.length > 0
                ? `\n\n## 当前章节文件内容（供修改定位）\n${filesWithContent.map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")}`
                : "\n\n## 当前章节文件列表\n(暂无章节文件)"
              const suffix = buildAgentSystemSuffix("chapters") + fileContentStr
              if (typeof lastSys.content === "string") {
                lastSys.content += suffix
              } else if (Array.isArray(lastSys.content)) {
                // content 为 ContentBlock[] 时，追加为新的 text block（不缓存，
                // 因为文件内容动态），避免破坏前面的 cacheControl 断点。
                lastSys.content.push({ type: "text", text: suffix })
              }
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
      const conversations = useChatStore.getState().conversations
      // 使用 capturedConvId 而非闭包中的 activeConversationId，防止切换会话后取错会话
      const activeConv = conversations.find(c => c.id === capturedConvId)
      const {
        skill: effectiveDeAiSkill,
        warning: deAiSkillWarning,
      } = await loadEffectiveDeAiSkillSafely(project?.path ?? null, activeConv?.selectedDeAiSkillId)
      if (deAiSkillWarning) {
        setDeAiSkillWarningMessage(deAiSkillWarning)
      }
      if (effectiveDeAiSkill) {
        systemMessages.push({
          role: "system",
          content: buildDeAiSkillSystemPrompt(effectiveDeAiSkill.content),
        })
      }

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

      const deAiMode = activeConv?.deAiMode ?? false
      if (!effectiveDeAiSkill && deAiMode && llmMessages.length > 0) {
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
      abortControllersRef.current[capturedConvId] = controller

      let accumulated = ""
      let thinkingOpen = false

      const appendReasoning = (token: string) => {
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        if (!token) return
        if (!thinkingOpen) {
          thinkingOpen = true
          accumulated += "<think>"
          appendStreamToken("<think>", capturedConvId)
        }
        accumulated += token
        appendStreamToken(token, capturedConvId)
      }

      const closeReasoning = () => {
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        if (!thinkingOpen) return
        thinkingOpen = false
        accumulated += "</think>"
        appendStreamToken("</think>", capturedConvId)
      }

      await streamChat(
        effectiveChatLlmConfig,
        llmMessages,
        {
          onToken: (token) => {
            if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
            closeReasoning()
            accumulated += token
            appendStreamToken(token, capturedConvId)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
              closeReasoning()
              finalizeStream(accumulated, queryRefs, capturedConvId)
              delete activeStreamSessionsRef.current[capturedConvId]
              delete abortControllersRef.current[capturedConvId]
            })
          },
          onError: (err) => {
            streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
              finalizeStream(`出错：${err.message}`, undefined, capturedConvId)
              delete activeStreamSessionsRef.current[capturedConvId]
              delete abortControllersRef.current[capturedConvId]
            })
          },
        },
        controller.signal,
        { reasoning: resolveUserVisibleReasoning(effectiveChatLlmConfig.reasoning) },
      )
    },
    [aiChatModel, llmConfig, providerConfigs, chatEditModeEnabled, addMessage, startStreaming, setStreamingContent, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, requestSoulDialog, deepChapterEnabled, project, novelMode, selectedFile],
  )

  const handleStop = useCallback(() => {
    const convId = useChatStore.getState().activeConversationId
    if (!convId) return
    const sessionId = activeStreamSessionsRef.current[convId]
    const currentStreamingContent = useChatStore.getState().getStreamingContent(convId)
    abortControllersRef.current[convId]?.abort()
    delete abortControllersRef.current[convId]
    const finalizeStopped = () => {
      finalizeStream(`${currentStreamingContent ? `${currentStreamingContent}\n\n` : ""}已停止生成。`, [], convId)
      delete activeStreamSessionsRef.current[convId]
    }
    if (sessionId !== undefined) {
      streamSessionGuardRef.current.stop(convId, sessionId, finalizeStopped)
    } else if (currentStreamingContent !== undefined) {
      finalizeStopped()
    }
  }, [finalizeStream])

  const handleRegenerate = useCallback(async () => {
    // 直接从 store 获取最新状态，避免闭包旧值
    const storeState = useChatStore.getState()
    if (storeState.streamingContents[storeState.activeConversationId ?? ""] !== undefined) return
    // Find the last user message in active conversation
    const active = storeState.getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Zustand set 是同步的，无需延迟，直接读取最新状态
    const store = useChatStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [removeLastAssistantMessage, handleSend])

  const handleContinueNextChapter = useCallback(() => {
    if (isStreaming) return
    // 按设置中的单章目标字数生成提示词（issue #8）
    const lengthSpec = resolveChapterLengthSpec(useWikiStore.getState().novelConfig?.chapterTargetChars)
    const target = lengthSpec.targetChars
    handleSend(`请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。只输出可直接保存到章节库的小说正文，不要解释，不要列提纲。正文必须是完整章节，目标约 ${target} 字，建议 ${target - 200}-${target + 300} 字，低于 ${target - 400} 字视为未完成。`)
  }, [handleSend, isStreaming])

  const handleContinueUnfinished = useCallback(async (assistantMessage: DisplayMessage) => {
    if (isStreaming) return

    // AI 会话选中的 model 名（如 "deepseek-v3"）需要找到它所属的 provider
    // 重新计算 baseUrl/apiKey/apiMode，否则会沿用 activePresetId 的配置
    // 导致跨 provider 调用失败
    let effectiveChatLlmConfig = llmConfig
    if (aiChatModel.trim()) {
      const targetModel = aiChatModel.trim()
      // 优先按 "providerId/modelId" 格式精确匹配
      const slashIdx = targetModel.indexOf("/")
      if (slashIdx > 0) {
        const providerId = targetModel.slice(0, slashIdx)
        const modelId = targetModel.slice(slashIdx + 1)
        const override = providerConfigs[providerId]
        if (override?.savedModels?.some((m) => m.model === modelId)) {
          const template =
            LLM_PRESETS.find((p) => p.id === providerId) ??
            LLM_PRESETS.find((p) => p.id === "custom")
          if (template) {
            effectiveChatLlmConfig = {
              ...resolveConfig(template, override, llmConfig),
              model: modelId,
            }
          }
        } else {
          effectiveChatLlmConfig = { ...llmConfig, model: modelId }
        }
      } else {
        // 回退：按纯模型名匹配（兼容旧数据）
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
    }

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
    startStreaming(convId)

    const sessionId = streamSessionGuardRef.current.start(convId)
    activeStreamSessionsRef.current[convId] = sessionId
    const controller = new AbortController()
    abortControllersRef.current[convId] = controller

    const deepStream = createDeepThinkingStreamRenderer()
    let accumulated = deepStream.updateThinking("## 继续未完成\n正在基于上一轮已完成阶段继续生成，避免从头重新思考。")
    let resumeThinking = ""
    let latestCheckpoint = persistedResume?.checkpoint
    setStreamingContent(accumulated, convId)

    try {
      const novelConfig = useWikiStore.getState().novelConfig
      const writingConfig = resolveNovelModel(effectiveChatLlmConfig, novelConfig, "writing")

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
            llmConfig: effectiveChatLlmConfig,
            resumeCheckpoint: persistedResume.checkpoint,
          },
          {
            onThinking: (content) => {
              if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
              accumulated = deepStream.updateThinking(content)
              setStreamingContent(accumulated, convId)
            },
            onFinalContent: (content) => {
              if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
              accumulated = deepStream.appendFinal(content)
              setStreamingContent(accumulated, convId)
            },
            onCheckpoint: (checkpoint) => {
              latestCheckpoint = checkpoint
            },
          },
          undefined,
          controller.signal,
        )

        if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
        streamSessionGuardRef.current.finish(convId, sessionId, () => {
          finalizeStream(accumulated || "继续未完成失败：模型没有返回内容。", [], convId)
          delete activeStreamSessionsRef.current[convId]
          delete abortControllersRef.current[convId]
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
           const budget = computeNovelContextTokenBudget(llmConfig.maxContextSize, novelConfig.contextTokenBudget)
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
            if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
            accumulated = deepStream.appendFinal(token)
            setStreamingContent(accumulated, convId)
          },
          onReasoningToken: (token) => {
            if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
            resumeThinking += token
            accumulated = deepStream.updateThinking(
              `## 继续未完成\n正在基于上一轮已完成阶段继续生成，避免从头重新思考。\n\n${resumeThinking}`,
            )
            setStreamingContent(accumulated, convId)
          },
          onDone: () => {},
          onError: (err) => {
            streamError = err
          },
        },
        controller.signal,
        { reasoning: resolveUserVisibleReasoning(writingConfig.reasoning) },
      )

      if (!streamSessionGuardRef.current.isActive(convId, sessionId)) return
      if (streamError) throw streamError

      streamSessionGuardRef.current.finish(convId, sessionId, () => {
        finalizeStream(accumulated || "继续未完成失败：模型没有返回内容。", [], convId)
        delete activeStreamSessionsRef.current[convId]
        delete abortControllersRef.current[convId]
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      streamSessionGuardRef.current.finish(convId, sessionId, () => {
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
          convId,
        )
        delete activeStreamSessionsRef.current[convId]
        delete abortControllersRef.current[convId]
      })
    } finally {
      if (activeStreamSessionsRef.current[convId] === sessionId) {
        delete activeStreamSessionsRef.current[convId]
      }
      if (abortControllersRef.current[convId] === controller) {
        delete abortControllersRef.current[convId]
      }
    }
  }, [isStreaming, createConversation, addMessage, startStreaming, setStreamingContent, llmConfig, aiChatModel, providerConfigs, finalizeStream])

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

  // 删除会话时 abort 该会话的流式请求
  const abortConversationStream = useCallback((convId: string) => {
    abortControllersRef.current[convId]?.abort()
    delete abortControllersRef.current[convId]
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ConversationTabs onAbortStream={abortConversationStream} />

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
                      saveStatus={isLastAssistant ? chapterSaveStatus : undefined}
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

        <div className="shrink-0 bg-background">
          {deAiSkillWarningMessage ? (
            <div className="border-t border-amber-500/20 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {deAiSkillWarningMessage}
            </div>
          ) : null}
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            leftControls={
              <TooltipProvider delay={200}>
                <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
                  <ChatDockControls />
                  <DeAiSkillPicker
                    value={activeConversation?.selectedDeAiSkillId}
                    iconOnly
                    onChange={(skillId) => {
                      const convId = useChatStore.getState().activeConversationId
                      if (convId) setConversationDeAiSkillId(convId, skillId)
                    }}
                  />
                  {novelMode && (
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
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <button
                              type="button"
                              onClick={() => setActiveView("storySimulation")}
                              className={`flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors ${
                                activeBinding
                                  ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                            >
                              <Drama className="h-3.5 w-3.5" />
                              <span className="max-w-[100px] truncate">
                                {activeBinding
                                  ? activeBinding.framework.shortTitle || activeBinding.framework.title
                                  : "故事框架"}
                              </span>
                            </button>
                          )}
                        />
                        <TooltipContent side="top" className="max-w-xs leading-5">
                          {activeBinding ? (
                            <>
                              <div className="font-medium">已绑定故事框架</div>
                              <div className="mt-1 text-xs opacity-80">
                                {activeBinding.framework.title}
                              </div>
                              <div className="mt-1 text-xs opacity-70">
                                目标章节数：{activeBinding.binding.targetChapterCount}章
                              </div>
                              <div className="mt-1 text-xs opacity-70">
                                点击可进入剧情推演室管理
                              </div>
                            </>
                          ) : (
                            <>未绑定故事框架，点击进入剧情推演室创建</>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>
              </TooltipProvider>
            }
            rightControls={
              <ChatModelSelector
                value={aiChatModel}
                onChange={(model) => {
                  setAiChatModel(model)
                  void saveAiChatModel(model)
                }}
              />
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
