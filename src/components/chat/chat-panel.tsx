import { useRef, useEffect, useCallback, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Brain, Plus, Trash2, MessageSquare, FileEdit, Drama } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { ChatDockControls } from "./chat-dock-controls"
import { useSourceFiles } from "./chat-shared"
import { ChatModelSelector } from "./chat-model-selector"
import { useChatStore, type DisplayMessage } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { DeAiSkillPicker } from "@/components/skill-library/de-ai-skill-picker"
import { ReferenceInput, type InsertReferenceTokens } from "@/components/reference/ReferenceInput"
import { ReferencePickerDialog } from "@/components/reference/ReferencePickerDialog"
import {
  chapterProvider,
  createChatHistoryProvider,
  createOutlineHistoryProvider,
  createSkillProvider,
  deductionProvider,
  memoryProvider,
  outlineProvider,
} from "@/lib/reference/providers"
import type { ReferenceToken } from "@/lib/reference/types"
import { AgentRunner } from "@/lib/agent/runner"
import type { AgentMessage, AgentRunRecord, ToolCall } from "@/lib/agent/types"
import { useAgentConfig } from "@/hooks/use-agent-config"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { streamChat } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective } from "@/lib/novel/task-router"
import { writeFile, createDirectory, deleteFile } from "@/commands/fs"
import {
  detectLastGeneratedChapterNumber,
  findChapterFileByNumber,
  getNextChapterNumber,
  readSelectedChapterNumberForFile,
  resolveTargetChapterNumberForChat,
} from "@/lib/novel/chapter-utils"
import { buildDeAiSkillSystemPrompt, buildQmQuaiSystemPrompt, injectDeAiDirective } from "@/lib/novel/de-ai-adapter"
import { loadEffectiveDeAiSkillSafely, resolveAvailableDeAiSkills } from "@/lib/novel/de-ai-skill-library"
import { cleanGeneratedChapterContentWithTitle } from "@/lib/novel/chapter-content-cleanup"
import { normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
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
  agentToolCallsToMessageReferences,
  getReferenceTokensForConversation,
  setReferenceTokensForConversation,
  type ReferenceTokensByConversation,
} from "./agent-message-metadata"
import {
  appendContinueUnfinishedDeepChapterContext,
  buildContinueUnfinishedDeepChapterPrompt,
  extractContinueUnfinishedDeepChapterContext,
  stripContinueUnfinishedDeepChapterContext,
} from "./chat-resume"
import { getCopyableAssistantContent } from "@/lib/chat-copy-content"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "@/lib/novel/chapter-save-strategy"
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

function createLocalMessageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildChatAgentSystemPrompt(options: {
  novelMode: boolean
  mode: "chat" | "ingest"
  deepChapterEnabled: boolean
  chatEditModeEnabled: boolean
  projectName?: string
  bindingTitle?: string
}): string {
  const lines = [
    options.novelMode
      ? "你是专业小说写作助手。请通过可用工具读取项目资料、章节、记忆、大纲、推演结果和历史对话，再完成用户要求。"
      : "你是专业资料库问答助手。请通过可用工具读取项目资料、记忆、大纲、推演结果和历史对话，再回答用户问题。",
    "不要假设 @ 引用内容已经注入上下文；用户提供引用时，必须优先使用对应工具读取具体内容。",
    "如果需要修改或写入项目内容，先确认目标文件和用户意图，再使用写入类工具。",
    "所有面向用户的回复必须使用中文，除非用户明确要求其他语言。",
  ]

  if (options.projectName) {
    lines.push(`当前项目：${options.projectName}`)
  }
  if (options.mode === "ingest") {
    lines.push("当前处于资料写入模式，用户可能希望把对话内容整理写入资料库。")
  }
  if (options.novelMode) {
    lines.push("小说模式下，如果用户要求生成、续写或改写章节，只输出可直接放入章节库的正文或明确的执行结果。")
  }
  if (options.deepChapterEnabled) {
    lines.push("用户已开启深度模式，请在必要时进行更完整的章节规划和资料读取。")
  }
  if (options.chatEditModeEnabled) {
    lines.push("用户已开启编辑章节模式，如涉及章节修改，请优先定位目标章节并使用章节读写工具。")
  }
  if (options.bindingTitle) {
    lines.push(`当前绑定故事框架：${options.bindingTitle}`)
  }

  return lines.join("\n")
}

function describeReferenceForAgent(token: ReferenceToken, index: number): string {
  const parts = [
    `${index + 1}. 类型：${token.category}`,
    `标题：${token.title}`,
  ]
  if (token.path) parts.push(`路径：${token.path}`)
  if (token.skillId) parts.push(`技能ID：${token.skillId}`)
  if (token.conversationId) parts.push(`会话ID：${token.conversationId}`)
  return parts.join("；")
}

function buildAgentUserContent(text: string, tokens: ReferenceToken[]): string {
  if (tokens.length === 0) return text
  return [
    text,
    "",
    "## 本条消息附带的 @ 引用",
    "用户希望你参考下列内容。请不要臆测引用正文；如需具体内容，请使用可用工具按路径、标题、技能ID或会话ID读取。",
    ...tokens.map(describeReferenceForAgent),
  ].join("\n")
}

function appendAgentChatMessages(conversationId: string, content: string, tokens: ReferenceToken[]) {
  const now = Date.now()
  const userMessage: DisplayMessage = {
    id: createLocalMessageId("user"),
    role: "user",
    content,
    timestamp: now,
    conversationId,
    attachedReferences: tokens,
  }
  const assistantMessage: DisplayMessage = {
    id: createLocalMessageId("assistant"),
    role: "assistant",
    content: "",
    timestamp: now,
    conversationId,
    agentToolCalls: [],
    isAgentRunning: true,
  }

  useChatStore.setState((state) => {
    const existingUserCount = state.messages.filter(
      (message) => message.conversationId === conversationId && message.role === "user",
    ).length
    return {
      messages: [...state.messages, userMessage, assistantMessage],
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title: existingUserCount === 0 ? content.slice(0, 50) : conversation.title,
              updatedAt: now,
            }
          : conversation,
      ),
    }
  })

  return { userMessage, assistantMessage }
}

function updateAgentAssistantMessage(
  messageId: string,
  updater: (message: DisplayMessage) => DisplayMessage,
): void {
  useChatStore.setState((state) => ({
    messages: state.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    ),
  }))
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
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const clearStreaming = useChatStore((s) => s.clearStreaming)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const isConversationStreaming = useChatStore((s) => s.isConversationStreaming)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationInputDraft = useChatStore((s) => s.setConversationInputDraft)
  const setConversationDeAiSkillId = useChatStore((s) => s.setConversationDeAiSkillId)
  const pendingReferenceTokens = useChatStore((s) => s.pendingReferenceTokens)
  const consumePendingReferenceTokens = useChatStore((s) => s.consumePendingReferenceTokens)
  const outlineConversations = useOutlineChatStore((s) => s.conversations)
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
  const [fallbackReferenceText, setFallbackReferenceText] = useState("")
  const [referenceTokensByConversation, setReferenceTokensByConversation] = useState<ReferenceTokensByConversation>({})
  const [referencePickerOpen, setReferencePickerOpen] = useState(false)
  const insertReferenceTokensRef = useRef<InsertReferenceTokens>(null)
  const referenceDraftConversationId = activeConversationId ?? "__new_conversation__"
  const referenceText = activeConversationId ? activeConversation?.inputDraft ?? "" : fallbackReferenceText
  const currentTokens = getReferenceTokensForConversation(referenceTokensByConversation, referenceDraftConversationId)
  const updateCurrentTokens = useCallback(
    (tokens: ReferenceToken[]) => {
      setReferenceTokensByConversation((drafts) =>
        setReferenceTokensForConversation(drafts, referenceDraftConversationId, tokens),
      )
    },
    [referenceDraftConversationId],
  )
  const updateReferenceDraft = useCallback(
    (plainText: string, tokens: ReferenceToken[]) => {
      if (activeConversationId) {
        setConversationInputDraft(activeConversationId, plainText)
      } else {
        setFallbackReferenceText(plainText)
      }
      updateCurrentTokens(tokens)
    },
    [activeConversationId, setConversationInputDraft, updateCurrentTokens],
  )

  useEffect(() => {
    if (pendingReferenceTokens.length === 0) return
    const tokens = consumePendingReferenceTokens()
    if (tokens.length === 0) return

    let targetConversationId = useChatStore.getState().activeConversationId
    if (!targetConversationId) {
      targetConversationId = createConversation()
    }

    setReferenceTokensByConversation((drafts) => {
      const existingTokens = getReferenceTokensForConversation(drafts, targetConversationId)
      return setReferenceTokensForConversation(drafts, targetConversationId, [
        ...existingTokens,
        ...tokens,
      ])
    })
  }, [consumePendingReferenceTokens, createConversation, pendingReferenceTokens])

  const agentSystemPrompt = useMemo(
    () =>
      buildChatAgentSystemPrompt({
        novelMode,
        mode,
        deepChapterEnabled,
        chatEditModeEnabled,
        projectName: project?.name,
        bindingTitle: activeBinding?.framework.title,
      }),
    [
      activeBinding?.framework.title,
      chatEditModeEnabled,
      deepChapterEnabled,
      mode,
      novelMode,
      project?.name,
    ],
  )
  const {
    config: agentConfig,
    registry: agentRegistry,
    supportsTools: agentSupportsTools,
    skillConfigLoaded: agentSkillConfigLoaded,
    skillConfig: agentSkillConfig,
  } = useAgentConfig(agentSystemPrompt)
  const referenceProviders = useMemo(
    () => [
      chapterProvider,
      memoryProvider,
      outlineProvider,
      deductionProvider,
      createSkillProvider(() =>
        agentSkillConfig
          ? resolveAvailableDeAiSkills(agentSkillConfig).map((skill) => ({ id: skill.id, name: skill.name }))
          : [],
      ),
      createChatHistoryProvider(() =>
        conversations.map((conversation) => ({ id: conversation.id, title: conversation.title })),
      ),
      createOutlineHistoryProvider(() =>
        outlineConversations.map((conversation) => ({ id: conversation.id, title: conversation.title })),
      ),
    ],
    [agentSkillConfig, conversations, outlineConversations],
  )
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
      await writeFile(chapterPath, buildDraftContent(targetChapterNumber, chapterTitle, cleanedContent))
      setChapterSaveStatus(`已保存为${chapterTitle}`)
      useWikiStore.getState().setSelectedFile(chapterPath)

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
    async (text: string, tokens: ReferenceToken[] = []) => {
      const plainText = text.trim()
      setDeAiSkillWarningMessage("")

      if (!plainText) {
        setDeAiSkillWarningMessage("请输入提示词")
        return
      }
      if (!project) {
        setDeAiSkillWarningMessage("请先打开一个项目")
        return
      }
      if (!agentSupportsTools) {
        setDeAiSkillWarningMessage("当前模型不支持Agent功能，请更换模型")
        return
      }
      if (!agentSkillConfigLoaded || !agentConfig) {
        setDeAiSkillWarningMessage("Agent配置仍在加载，请稍后重试")
        return
      }

      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }
      const capturedConvId = convId
      const storeState = useChatStore.getState()
      const activeConv = storeState.conversations.find((conversation) => conversation.id === capturedConvId)
      const activeConvMessages = storeState.messages
        .filter((message) => (
          message.conversationId === capturedConvId &&
          (message.role === "user" || message.role === "assistant") &&
          !message.discarded &&
          !message.isAgentRunning
        ))
        .slice(-maxHistoryMessages)
      const pp = normalizePath(project.path)
      const taskRoute = novelMode ? routeTask(plainText) : null
      const lastGeneratedChapterNumber = novelMode
        ? detectLastGeneratedChapterNumber(
            activeConvMessages
              .filter((message) => message.role === "assistant")
              .map((message) => message.content),
          )
        : undefined
      const targetChapterNumber = novelMode && taskRoute
        ? await resolveTargetChapterNumberForChat({
            projectPath: pp,
            userRequest: plainText,
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
      const shouldUseQmQuaiSkill = effectiveTaskRoute != null && (
        effectiveTaskRoute.intent === "write_chapter" ||
        effectiveTaskRoute.intent === "continue_chapter" ||
        effectiveTaskRoute.intent === "rewrite_chapter"
      )
      const qmQuaiSystemPrompt = shouldUseQmQuaiSkill ? buildQmQuaiSystemPrompt() : ""
      let novelContextPrompt = ""

      if (novelMode && effectiveTaskRoute) {
        try {
          const taskDirective = buildTaskDirective(effectiveTaskRoute)
          const goldenThreeChapter = detectGoldenThreeChapterRequest(plainText, effectiveTaskRoute.chapterNumber)
          const goldenDirective = buildGoldenThreeChapterDirective(goldenThreeChapter)
          const { buildContextPack, contextPackToPrompt } = await import("@/lib/novel/context-engine")
          const contextPack = await buildContextPack(pp, plainText, effectiveTaskRoute.chapterNumber).catch(() => ({
            task: plainText,
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
              const { assistantMessage } = appendAgentChatMessages(capturedConvId, plainText, tokens)
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                content: "已取消本次生成，角色灵魂上下文未发送给模型。",
                isAgentRunning: false,
              }))
              return
            }
          }
          const novelConfig = useWikiStore.getState().novelConfig
          const budget = novelConfig.contextTokenBudget > 0 ? novelConfig.contextTokenBudget : undefined
          novelContextPrompt = [
            taskDirective,
            goldenDirective,
            "## 小说上下文包",
            contextPackToPrompt(contextPack, budget),
          ].filter(Boolean).join("\n\n")
        } catch (error) {
          console.warn("构建Agent小说上下文失败:", error)
        }
      }

      const {
        skill: effectiveDeAiSkill,
        warning: deAiSkillWarning,
      } = await loadEffectiveDeAiSkillSafely(project.path, activeConv?.selectedDeAiSkillId)
      if (deAiSkillWarning) {
        setDeAiSkillWarningMessage(deAiSkillWarning)
      }

      const effectiveSystemPrompt = effectiveDeAiSkill
        ? [
            agentSystemPrompt,
            qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
            novelContextPrompt,
            "",
            "## 当前会话去AI味技能",
            buildDeAiSkillSystemPrompt(effectiveDeAiSkill.content),
          ].filter(Boolean).join("\n")
        : [
            agentSystemPrompt,
            qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
            novelContextPrompt,
          ].filter(Boolean).join("\n")

      const deAiMode = activeConv?.deAiMode ?? false
      const rawUserContent = buildAgentUserContent(plainText, tokens)
      const userContent = !effectiveDeAiSkill && deAiMode
        ? injectDeAiDirective(rawUserContent, deAiMode)
        : rawUserContent
      const agentMessages: AgentMessage[] = [
        { role: "system", content: effectiveSystemPrompt },
        ...activeConvMessages.map((message) => ({
          role: message.role,
          content: message.content,
        } satisfies AgentMessage)),
        { role: "user", content: userContent },
      ]

      const { assistantMessage } = appendAgentChatMessages(capturedConvId, plainText, tokens)
      setConversationInputDraft(capturedConvId, "")
      setFallbackReferenceText("")
      setReferenceTokensByConversation((drafts) => {
        const withoutCaptured = setReferenceTokensForConversation(drafts, capturedConvId, [])
        return setReferenceTokensForConversation(withoutCaptured, referenceDraftConversationId, [])
      })
      startStreaming(capturedConvId)
      const sessionId = streamSessionGuardRef.current.start(capturedConvId)
      activeStreamSessionsRef.current[capturedConvId] = sessionId

      const controller = new AbortController()
      abortControllersRef.current[capturedConvId] = controller
      let hasAgentError = false

      const markDone = (record?: AgentRunRecord) => {
        updateAgentAssistantMessage(assistantMessage.id, (message) => ({
          ...message,
          content: message.content || record?.finalText || "Agent未返回内容。",
          agentToolCalls: record?.toolCalls.length ? record.toolCalls : message.agentToolCalls,
          references: (() => {
            const existingReferences = message.references ?? []
            const existingPaths = new Set(existingReferences.map((reference) => reference.path))
            const agentReferences = agentToolCallsToMessageReferences(
              record?.toolCalls.length ? record.toolCalls : message.agentToolCalls,
            ).filter((reference) => !existingPaths.has(reference.path))
            return agentReferences.length > 0
              ? [...existingReferences, ...agentReferences]
              : message.references
          })(),
          isAgentRunning: false,
        }))
      }

      const markError = (error: Error) => {
        hasAgentError = true
        updateAgentAssistantMessage(assistantMessage.id, (message) => ({
          ...message,
          content: message.content
            ? `${message.content}\n\n出错：${error.message}`
            : `出错：${error.message}`,
          isAgentRunning: false,
        }))
      }

      const finishAgentSession = (callback?: () => void) => {
        streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
          callback?.()
          clearStreaming(capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
          delete abortControllersRef.current[capturedConvId]
        })
      }

      try {
        const record = await new AgentRunner().run(
          {
            ...agentConfig,
            systemPrompt: effectiveSystemPrompt,
          },
          agentRegistry,
          agentMessages,
          {
            onText: (chunk: string) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                content: message.content + chunk,
              }))
            },
            onToolCall: (call: ToolCall) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => {
                const existing = message.agentToolCalls ?? []
                if (existing.some((item) => item.id === call.id)) return message
                return {
                  ...message,
                  agentToolCalls: [
                    ...existing,
                    {
                      id: call.id,
                      name: call.name,
                      params: call.arguments,
                      result: "",
                      status: "done",
                      startedAt: Date.now(),
                      finishedAt: 0,
                    },
                  ],
                }
              })
            },
            onToolResult: (callId: string, result: string) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                agentToolCalls: (message.agentToolCalls ?? []).map((item) =>
                  item.id === callId
                    ? { ...item, result, status: "done", finishedAt: Date.now() }
                    : item,
                ),
              }))
            },
            onToolError: (callId: string, error: string) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                agentToolCalls: (message.agentToolCalls ?? []).map((item) =>
                  item.id === callId
                    ? { ...item, result: error, status: "error", finishedAt: Date.now() }
                    : item,
                ),
              }))
            },
            onDone: () => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                isAgentRunning: false,
              }))
            },
            onError: markError,
          },
          controller.signal,
        )

        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        finishAgentSession(() => {
          if (!hasAgentError) markDone(record)
        })
      } catch (error) {
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        finishAgentSession(() => {
          markError(error instanceof Error ? error : new Error(String(error)))
        })
      }
    },
    [
      agentConfig,
      agentRegistry,
      agentSkillConfigLoaded,
      agentSupportsTools,
      agentSystemPrompt,
      clearStreaming,
      createConversation,
      maxHistoryMessages,
      novelMode,
      project,
      referenceDraftConversationId,
      requestSoulDialog,
      selectedFile,
      setConversationInputDraft,
      startStreaming,
    ],
  )

  const handleStop = useCallback(() => {
    const convId = useChatStore.getState().activeConversationId
    if (!convId) return
    const sessionId = activeStreamSessionsRef.current[convId]
    const currentStreamingContent = useChatStore.getState().getStreamingContent(convId)
    const runningAssistant = [...useChatStore.getState().messages]
      .reverse()
      .find((message) => (
        message.conversationId === convId &&
        message.role === "assistant" &&
        message.isAgentRunning
      ))
    abortControllersRef.current[convId]?.abort()
    delete abortControllersRef.current[convId]
    if (sessionId !== undefined) {
      streamSessionGuardRef.current.stop(convId, sessionId, () => {
        if (runningAssistant) {
          updateAgentAssistantMessage(runningAssistant.id, (message) => ({
            ...message,
            content: message.content ? `${message.content}\n\n已停止生成。` : "已停止生成。",
            isAgentRunning: false,
          }))
          clearStreaming(convId)
        } else {
          finalizeStream(`${currentStreamingContent ? `${currentStreamingContent}\n\n` : ""}已停止生成。`, [], convId)
        }
        delete activeStreamSessionsRef.current[convId]
      })
    }
  }, [clearStreaming, finalizeStream])

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
    handleSend(lastUserMsg.content, lastUserMsg.attachedReferences ?? [])
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
                      saveStatus={chapterSaveStatus}
                      isSaving={isSavingChapter}
                    />
                  )
                })}
                {isStreaming && streamingContent && <StreamingMessage content={streamingContent} />}
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
          <div className="border-t px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <TooltipProvider delay={200}>
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
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
            </div>
            <ReferenceInput
              value={referenceText}
              tokens={currentTokens}
              disabled={isStreaming}
              isStreaming={isStreaming}
              onStop={handleStop}
              rightControls={
                <ChatModelSelector
                  value={aiChatModel}
                  onChange={(model) => {
                    setAiChatModel(model)
                    void saveAiChatModel(model)
                  }}
                />
              }
              insertTokensRef={insertReferenceTokensRef}
              onChange={updateReferenceDraft}
              onTokensChange={updateCurrentTokens}
              onSubmit={handleSend}
              onAtTrigger={() => setReferencePickerOpen(true)}
              placeholder={
                mode === "ingest"
                  ? t(novelMode ? "novel.chat.ingestPlaceholder" : "chat.ingestPlaceholder")
                  : t(novelMode ? "novel.chat.typeAMessage" : "chat.typeAMessage")
              }
            />
          </div>
          <ReferencePickerDialog
            open={referencePickerOpen}
            providers={referenceProviders}
            projectPath={project?.path ? normalizePath(project.path) : ""}
            onConfirm={(tokens) => {
              insertReferenceTokensRef.current?.(tokens)
              setReferencePickerOpen(false)
            }}
            onClose={() => setReferencePickerOpen(false)}
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
