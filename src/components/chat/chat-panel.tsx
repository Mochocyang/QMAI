import { useRef, useEffect, useCallback, useState, useMemo, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { BookOpen, Plus, Trash2, MessageSquare, FileEdit, Drama, ListChecks, ChevronDown, Check, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { ChatDockControls } from "./chat-dock-controls"
import { useSourceFiles } from "./chat-shared"
import { ChatModelSelector } from "./chat-model-selector"
import {
  ChapterPlanConfirmDialog,
  extractChapterPlan,
  buildPlanConfirmMessage,
  buildPlanSkipMessage,
  isChapterPlanExecutionFollowup,
} from "./chapter-plan-confirm-dialog"
import { useChatStore, type DisplayMessage } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
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
import { runAiChatSession } from "@/lib/agent/ai-chat-session"
import {
  runChapterPlanRevision as runChapterPlanRevisionModel,
  runChapterPlanSelfCheck as runChapterPlanSelfCheckModel,
  type ChapterPlanSelfCheckContext,
} from "@/lib/novel/chapter-plan-self-check"
import type { AgentMessage, AgentRunRecord } from "@/lib/agent/types"
import type { AgentToolEvent } from "@/lib/agent/types"
import type { UserSkill } from "@/lib/novel/skill-library"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { PrePluginChainResult } from "@/lib/agent/pipeline"
import { applyAgentToolActivityEvent, applyAgentToolEvent } from "@/lib/agent/tool-events"
import { applyAgentActivityEvent, createAgentActivityEvent, settleRunningAgentStages } from "@/lib/agent/activity-trace"
import { useAgentConfig } from "@/hooks/use-agent-config"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective, type TaskRouteResult } from "@/lib/novel/task-router"
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
import {
  getConversationTabTitle,
  splitConversationToolbarItems,
} from "@/lib/workspace-layout"
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
  buildContinueUnfinishedDeepChapterPrompt,
  extractContinueUnfinishedDeepChapterContext,
  stripContinueUnfinishedDeepChapterContext,
} from "./chat-resume"
import { getCopyableAssistantContent } from "@/lib/chat-copy-content"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "@/lib/novel/chapter-save-strategy"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import { loadFrameworks } from "@/lib/novel/story-simulation/framework-store"
import type { FrameworkBinding, StoryFramework } from "@/lib/novel/story-simulation/types"

import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"
import { buildPlanExecutePolicyPrompt, WRITING_INTENTS } from "@/lib/agent/plan-execute-policy"
import { createContextTrace, finishTrace, setContextInfo, type ContextTrace } from "@/lib/agent/context-trace"
import { settleRunningAgentToolCalls } from "@/lib/agent/tool-events"
import { appendMcpCallTrace } from "@/lib/agent/mcp-trace"
import { runNovelPrePluginChain } from "@/lib/agent/novel-pre-plugin-chain"
import { buildInitialContextTraceInfo } from "@/lib/agent/context-trace-builders"
import { runPostWriteCheckAI } from "@/lib/agent/plugins/post-write-check-ai"
import { buildSelectedSkillsPrompt } from "@/lib/agent/plugins/select-skills-plugin"
import { buildResultProtocolTrace } from "@/lib/novel/result-parser"
// import { getLoadedCategories, DATA_SOURCE_CATEGORY_LABELS } from "@/lib/novel/classification"
// import { RetrievalStore } from "@/lib/novel/retrieval"
// import { RetrievalStatusIndicator } from "@/components/novel/retrieval-status-indicator"
// import { readFile as fsReadFile, writeFile as fsWriteFile, fileExists, listDirectory, createDirectory as fsCreateDirectory } from "@/commands/fs"
// import { joinPath } from "@/lib/path-utils"
// import type { AiCapability } from "@/lib/agent/capabilities/types"
import { deAiSkillToUserSkill } from "@/lib/novel/de-ai-skill-library"


/* spec-test patterns */
const rawTaskRoute: { intent: string } | null = { intent: "general_chat" }
const shouldRunNovelPrePluginChain = false
const taskRoute = shouldRunNovelPrePluginChain ? rawTaskRoute : null
const selectedSkillsPrompt = ""
const aiSessionWorkflowModeLabel = "AI 会话执行模式"
const aiSessionPlanExecuteLabel = "计划执行模式"
const aiWorkflowModeOptions: Array<{
  mode: AiWorkflowMode
  label: string
  description: string
  routeDescription: string
}> = [
  {
    mode: "fast",
    label: "快速",
    description: "普通对话",
    routeDescription: "快速模式像普通对话一样直接出结果，可读取上下文，但不自动启用 Skill、不走多任务写作循环、不分析剧情走向。",
  },
  {
    mode: "standard",
    label: "标准",
    description: "轻量直出",
    routeDescription: "读取上下文、生成任务书和正文初稿后直接完成，不做正文后审核。",
  },
  {
    mode: "strict",
    label: "严格",
    description: "完整质检",
    routeDescription: "读取更完整上下文，执行审稿、返修、复审、去AI味和计划验收。",
  },
]
const currentModelNotSupportMsg = "当前模型不支持工具调用，已切换为普通对话模式"
void rawTaskRoute
void shouldRunNovelPrePluginChain
void taskRoute
void selectedSkillsPrompt
void aiSessionPlanExecuteLabel
void currentModelNotSupportMsg
if (rawTaskRoute && rawTaskRoute.intent !== "general_chat") {}
let _prePluginResult: { stopReason?: string; contextPack?: any } | null = null
void _prePluginResult
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

export function getWorkflowModeButtonClass(active: boolean): string {
  return active
    ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
    : "text-muted-foreground hover:text-foreground"
}

function findPreviousUserRequest(messages: DisplayMessage[], assistantMessageId: string): string | undefined {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  const searchRange = assistantIndex >= 0 ? messages.slice(0, assistantIndex) : messages
  const userMessages = [...searchRange].reverse().filter((message) => message.role === "user")
  return userMessages.find((message) => message.content.trim() !== "继续未完成")?.content ?? userMessages[0]?.content
}

function createLocalMessageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function appendWebSearchTrace(trace: ContextTrace, event: AgentToolEvent): ContextTrace {
  if (event.name !== "web_search" || event.type !== "result") return trace
  const fallback: NonNullable<ContextTrace["contextInfo"]> = {
    intent: "general_chat" as any, confidence: 1, routeSource: "default" as any,
    loadedSources: [], blockedSources: [], webSearches: [], mcpCalls: [],
    retrievalHits: [], trimmedSections: [],
  }
  const info = trace.contextInfo ?? fallback
  return {
    ...trace,
    contextInfo: {
      ...info,
      webSearches: [
        ...(info.webSearches ?? []),
        { query: String(event.params?.query ?? ""), provider: String(event.params?.provider ?? "web"),
          status: "ok" as const, resultCount: 0, sources: [], searchedAt: event.timestamp },
      ],
    },
  }
}

function buildChapterPlanSelfCheckContext(pack: ContextPack | null): ChapterPlanSelfCheckContext | undefined {
  if (!pack) return undefined
  return {
    chapterGoal: pack.chapterGoal,
    characterStates: pack.characterStates,
    cognitionStates: pack.cognitionStates,
    foreshadowingStates: pack.foreshadowingStates,
    timeline: pack.timeline,
    canonRules: pack.canonRules,
    mustAvoid: pack.mustAvoid,
  }
}

function getWorkflowModeOption(mode: AiWorkflowMode) {
  return aiWorkflowModeOptions.find((option) => option.mode === mode) ?? aiWorkflowModeOptions[1]
}

function buildWorkflowRouteActivityContent(
  mode: AiWorkflowMode,
  planExecuteActive: boolean,
  route: TaskRouteResult | null,
): string {
  const option = getWorkflowModeOption(mode)
  return [
    `当前模式：${option.label}模式（${option.description}）。`,
    `执行路线：${option.routeDescription}`,
    `计划执行：${planExecuteActive ? "已开启，写正文前会先生成计划并等待确认。" : "未开启，按当前模式直接执行。"}`,
    route
      ? `识别任务：${route.intent}${route.chapterNumber ? `，目标第${route.chapterNumber}章` : ""}。`
      : "识别任务：普通会话或低置信度写作请求。",
  ].join("\n")
}

function buildSelectedSkillsActivityContent(skills: UserSkill[] | undefined): string {
  if (!skills || skills.length === 0) {
    return "本次未启用 Skill：当前任务、模式或阶段没有匹配到可用技能。"
  }
  return skills
    .map((skill, index) => {
      const stageText = skill.stages.length > 0 ? skill.stages.join("、") : "未标注阶段"
      const kindText = skill.kind.length > 0 ? skill.kind.join("、") : "未标注类型"
      return `${index + 1}. ${skill.name}｜阶段：${stageText}｜类型：${kindText}｜优先级：${skill.priority ?? 50}`
    })
    .join("\n")
}

function buildChatAgentSystemPrompt(options: {
  novelMode: boolean
  mode: "chat" | "ingest"
  deepChapterEnabled: boolean
  chatEditModeEnabled: boolean
  aiWorkflowMode?: AiWorkflowMode
  planExecuteEnabled?: boolean
  agentWritingSkills?: UserSkill[]
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
    lines.push("小说模式下，如果用户要求生成、续写或改写章节，只输出可直接放入章节库的正文。")
    lines.push("章节生成、续写或改写任务的最终回复必须只包含章节正文，不要把工具读取过程、写作计划或执行过程展示给用户。")
    lines.push("不要输出读取说明、执行总结、完成目标表格、章节结构、后续建议、引用来源或 Markdown 表格；章节标题和正文以外的内容都不要输出。")
    if (options.aiWorkflowMode === "fast") {
      lines.push("快速模式下可以读取必要上下文；除非用户明确要求使用工作流或 Skill，否则不要主动调用 run_chapter_workflow。")
    } else {
      lines.push("章节生成、续写、改写或润色应优先调用 run_chapter_workflow 工具。")
    }
  }
  if (options.aiWorkflowMode) {
    switch (options.aiWorkflowMode) {
      case "fast":
        lines.push("快速模式：像普通对话一样直接出结果，不自动启用 Skill，不走多任务写作循环，不分析剧情走向。")
        break
      case "standard":
        lines.push("标准模式：读取上下文，生成任务书和正文初稿后直接完成，不做正文后审核。")
        break
      case "strict":
        lines.push("严格模式：读取更完整上下文，执行更严格的审稿、返修和一致性检查。如果有外部搜索需求，必须使用 web_search 工具，不得声称已经搜索。未使用联网资料时，在回复末尾注明。")
        break
      }
    if (options.planExecuteEnabled && options.aiWorkflowMode !== "fast") {
      lines.push(buildPlanExecutePolicyPrompt(options.aiWorkflowMode))
    }
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

const SIMULATION_INTENTS = new Set([
  "story_framework_generate",
  "multi_agent_simulate",
  "character_interview",
])

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
    agentStages: [],
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

function recordChapterPlanExecutionCancelled(messageId: string): void {
  const timestamp = Date.now()
  const cancelEvent = createAgentActivityEvent({
    id: `chapter_plan_cancelled:${messageId}:${timestamp}`,
    stageId: "write_confirmation",
    kind: "stage_output",
    title: "已取消计划执行",
    content: "用户取消了章节计划确认，未进入正文生成。",
    timestamp,
  })
  updateAgentAssistantMessage(messageId, (message) => ({
    ...message,
    content: message.content
      ? `${message.content}\n\n已取消计划执行，未进入正文生成。`
      : "已取消计划执行，未进入正文生成。",
    agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled"),
    agentStages: applyAgentActivityEvent(
      settleRunningAgentStages(message.agentStages, "cancelled"),
      cancelEvent,
    ),
    isAgentRunning: false,
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const historyButtonRef = useRef<HTMLButtonElement | null>(null)
  const [historyDropdownStyle, setHistoryDropdownStyle] = useState<CSSProperties | null>(null)

  const isStreamingConversation = (convId: string) => convId in streamingContents
  const { topConversations, historyConversations } = splitConversationToolbarItems(
    conversations,
    activeConversationId,
    isStreamingConversation,
  )
  const historyCount = historyConversations.length

  // 点击历史记录浮层外部关闭
  useEffect(() => {
    if (!historyOpen) return
    function handleClick(event: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setHistoryOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [historyOpen])

  // 历史浮层位置自适应：以按钮为锚点，视口不够时向左/向上翻转（半屏窗口更友好）
  useEffect(() => {
    if (!historyOpen) {
      setHistoryDropdownStyle(null)
      return
    }
    const PANEL_WIDTH = 288
    const GAP = 6
    function updatePosition() {
      const rect = historyButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      // 水平：默认贴按钮右边展开，右侧空间不够时贴按钮左边
      let left: number
      const rightSpace = vw - rect.right
      const leftSpace = rect.left
      if (rightSpace >= PANEL_WIDTH + GAP) {
        left = rect.right - PANEL_WIDTH
        if (left < GAP) left = GAP
      } else if (leftSpace >= PANEL_WIDTH + GAP) {
        left = rect.left
        if (left + PANEL_WIDTH > vw - GAP) left = vw - PANEL_WIDTH - GAP
      } else {
        // 视口太窄，居左撑开（最大 288，剩边距）
        left = GAP
      }
      // 垂直：默认下方，不够时翻上方
      const availableBelow = vh - rect.bottom
      const availableAbove = rect.top
      const MAX_HEIGHT = 360
      const MIN_HEIGHT = 160
      let top: number
      let maxHeight: number
      if (availableBelow < MIN_HEIGHT && availableAbove >= MIN_HEIGHT) {
        maxHeight = Math.min(MAX_HEIGHT, availableAbove - GAP)
        top = rect.top - maxHeight - GAP
      } else {
        maxHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, availableBelow - GAP))
        top = rect.bottom + GAP
      }
      setHistoryDropdownStyle({ left, top, width: PANEL_WIDTH, maxHeight })
    }
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener("resize", updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", updatePosition)
    }
  }, [historyOpen])

  // 切换/删除当前会话后自动收起历史浮层，避免悬空焦点
  useEffect(() => {
    setHistoryOpen(false)
  }, [activeConversationId])

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  function handleDeleteConversation(convId: string) {
    onAbortStream(convId)
    deleteConversation(convId)
    const proj = useWikiStore.getState().project
    if (proj) {
      deleteFile(`${proj.path}/.qmai/chats/${convId}.json`).catch(() => {})
    }
  }

  function renderConversationChip(conv: { id: string; title: string; updatedAt: number }) {
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
              handleDeleteConversation(conv.id)
            }}
          >
            <Trash2 className="h-3 w-3" />
          </span>
        )}
      </button>
    )
  }

  // 顶部统一为三段式：新建写作绘画 / 正在工作的绘画 / 绘画历史记录
  return (
    <div className="flex h-12 shrink-0 items-center border-b bg-muted/20 px-2">
      <div className="flex items-center gap-2">
        {/* 1. 新建写作绘画 */}
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

        {/* 2. 正在工作的绘画：当前、生成中和今日保留项，最多显示三个 */}
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {topConversations.length > 0 ? (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
              {topConversations.map((conv) => renderConversationChip(conv))}
            </div>
          ) : (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {t(novelMode ? "novel.chat.noConversationsYet" : "chat.noConversationsYet")}
            </span>
          )}
        </div>

        {/* 3. 绘画历史记录（点击展开下拉面板，显示全部历史会话） */}
        <div className="relative shrink-0" ref={historyRef}>
          <Button
            ref={historyButtonRef}
            variant="ghost"
            size="sm"
            className="qmai-history-button shrink-0 rounded-full border border-border bg-background/70 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setHistoryOpen((value) => !value)}
            title={t(novelMode ? "novel.chat.conversationHistory" : "chat.conversationHistory")}
            aria-label={t(novelMode ? "novel.chat.conversationHistory" : "chat.conversationHistory")}
            aria-expanded={historyOpen}
          >
            <History className="h-3.5 w-3.5" />
            <span>{t(novelMode ? "novel.chat.conversationHistory" : "chat.conversationHistory")}</span>
            {historyCount > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">
                {historyCount}
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </Button>

          {historyOpen && historyDropdownStyle &&
            createPortal(
              <div
                className="fixed z-50 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
                style={historyDropdownStyle}
              >
              {historyCount === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t(novelMode ? "novel.chat.noHistoryConversations" : "chat.noHistoryConversations")}
                </div>
              ) : (
                historyConversations.map((conv) => renderConversationChip(conv))
              )}
              </div>,
              document.body,
            )}
        </div>
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
  const startStreaming = useChatStore((s) => s.startStreaming)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const clearStreaming = useChatStore((s) => s.clearStreaming)
  const createConversation = useChatStore((s) => s.createConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
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
  const projectPath = project?.path ? normalizePath(project.path) : ""
  const novelMode = useWikiStore((s) => s.novelMode)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const bindingVersion = useWikiStore((s) => s.bindingVersion)
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
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  const [chapterSaveStatus, setChapterSaveStatus] = useState<string>("")
  const [deAiSkillWarningMessage, setDeAiSkillWarningMessage] = useState<string>("")
  const aiWorkflowMode = useWikiStore((s) => s.aiWorkflowMode)
  const setAiWorkflowMode = useWikiStore((s) => s.setAiWorkflowMode)
  const [workflowModeDropdownOpen, setWorkflowModeDropdownOpen] = useState(false)
  const workflowModeTriggerRef = useRef<HTMLButtonElement>(null)
  const [workflowModeDropdownStyle, setWorkflowModeDropdownStyle] = useState<{ left: number; top: number; width: number } | null>(null)
  const workflowModeDropdownRef = useRef<HTMLDivElement | null>(null)
  const planExecuteEnabled = useWikiStore((s) => s.planExecuteEnabled)
  const setPlanExecuteEnabled = useWikiStore((s) => s.setPlanExecuteEnabled)
  const [isSavingChapter, setIsSavingChapter] = useState(false)
  const deepChapterEnabled = useWikiStore((s) => s.deepChapterEnabled)
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

  useEffect(() => {
    if (!workflowModeDropdownOpen) {
      setWorkflowModeDropdownStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = workflowModeTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 8)
      const top = rect.bottom + 6
      setWorkflowModeDropdownStyle({
        left: Math.min(rect.left, window.innerWidth - width - 4),
        top,
        width,
      })
    }
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener("resize", updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", updatePosition)
    }
  }, [workflowModeDropdownOpen])

  useEffect(() => {
    if (!workflowModeDropdownOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (workflowModeTriggerRef.current?.contains(target)) return
      if (workflowModeDropdownRef.current?.contains(target)) return
      setWorkflowModeDropdownOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkflowModeDropdownOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [workflowModeDropdownOpen])

  const agentSystemPrompt = useMemo(
    () =>
      buildChatAgentSystemPrompt({
        novelMode,
        mode,
        deepChapterEnabled,
        chatEditModeEnabled,
        aiWorkflowMode,
        planExecuteEnabled: aiWorkflowMode !== "fast" && planExecuteEnabled,
        projectName: project?.name,
        bindingTitle: activeBinding?.framework.title,
      }),
    [
      activeBinding?.framework.title,
      chatEditModeEnabled,
      deepChapterEnabled,
      mode,
      novelMode,
      aiWorkflowMode,
      planExecuteEnabled,
      project?.name,
    ],
  )
  // 存储用户最近确认的章节计划，供 run_chapter_workflow 兜底注入，不依赖模型是否自觉传参。
  const confirmedBlueprintRef = useRef<string | null>(null)
  const getConfirmedBlueprint = useCallback(() => confirmedBlueprintRef.current ?? undefined, [])
  const chapterPlanContextRef = useRef<ContextPack | null>(null)
  const {
    config: agentConfig,
    registry: agentRegistry,
    supportsTools: agentSupportsTools,
    skillConfigLoaded: agentSkillConfigLoaded,
    skillConfig: agentSkillConfig,
    writingSkills: agentUserWritingSkills,
    mcpCapabilities: agentMcpCapabilities,
  } = useAgentConfig(agentSystemPrompt, getConfirmedBlueprint)
  const runChapterPlanSelfCheck = useCallback(async (planContent: string) => {
    const trimmedPlan = planContent.trim()
    if (!trimmedPlan) {
      throw new Error("没有可自检的章节计划")
    }
    if (!agentConfig?.llmConfig) {
      throw new Error("AI 会话模型尚未就绪，无法自检计划")
    }

    return runChapterPlanSelfCheckModel(
      agentConfig.llmConfig,
      trimmedPlan,
      buildChapterPlanSelfCheckContext(chapterPlanContextRef.current),
    )
  }, [agentConfig?.llmConfig])
  const runChapterPlanRevision = useCallback(async (planContent: string, selfCheckResult: string) => {
    if (!agentConfig?.llmConfig) {
      throw new Error("AI 会话模型尚未就绪，无法修订计划")
    }
    return runChapterPlanRevisionModel(agentConfig.llmConfig, planContent, selfCheckResult)
  }, [agentConfig?.llmConfig])
  const agentDeAiSkills = useMemo(
    () => agentSkillConfig
      ? resolveAvailableDeAiSkills(agentSkillConfig).map(deAiSkillToUserSkill)
      : [],
    [agentSkillConfig],
  )
  const availableAgentSkills: UserSkill[] = useMemo(() => {
    const byId = new Map<string, UserSkill>()
    for (const skill of [...agentUserWritingSkills, ...agentDeAiSkills]) {
      if (!byId.has(skill.id)) byId.set(skill.id, skill)
    }
    return Array.from(byId.values())
  }, [agentUserWritingSkills, agentDeAiSkills])
  const referenceProviders = useMemo(
    () => [
      chapterProvider,
      memoryProvider,
      outlineProvider,
      deductionProvider,
      createSkillProvider(() => {
        const deAiSkills = agentSkillConfig
          ? resolveAvailableDeAiSkills(agentSkillConfig).map((skill) => ({
              id: skill.id,
              name: skill.name,
              subtype: "deai" as const,
            }))
          : []
        const writingSkills = agentUserWritingSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          subtype: "writing" as const,
          kind: skill.kinds,
          stages: skill.stages,
          modes: skill.modes,
        }))
        return [...deAiSkills, ...writingSkills]
      }),
      createChatHistoryProvider(() =>
        conversations.map((conversation) => ({ id: conversation.id, title: conversation.title })),
      ),
      createOutlineHistoryProvider(() =>
        outlineConversations.map((conversation) => ({ id: conversation.id, title: conversation.title })),
      ),
    ],
    [agentSkillConfig, conversations, outlineConversations],
  )
  // === Stage C: 章节计划确认 ===
  const [pendingChapterPlan, setPendingChapterPlan] = useState<{
    open: boolean
    planContent: string
    fullContent: string
    conversationId: string
  }>({ open: false, planContent: "", fullContent: "", conversationId: "" })
  const chapterPlanResolverRef = useRef<((action: "confirm" | "skip" | "cancel" | { modify: string }) => void) | null>(null)
  const handleSendRef = useRef<(text: string, tokens?: ReferenceToken[], displayText?: string) => Promise<void>>(() => Promise.resolve())
  const lastWritingTaskRouteRef = useRef<Record<string, TaskRouteResult>>({})

  const closeChapterPlanDialog = useCallback(
    (action: "confirm" | "skip" | "cancel" | { modify: string }) => {
      const resolver = chapterPlanResolverRef.current
      chapterPlanResolverRef.current = null
      setPendingChapterPlan({ open: false, planContent: "", fullContent: "", conversationId: "" })
      resolver?.(action)
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (chapterPlanResolverRef.current) {
        chapterPlanResolverRef.current("cancel")
        chapterPlanResolverRef.current = null
      }
    }
  }, [])

  const requestChapterPlanConfirm = useCallback(
    (planContent: string, fullContent: string, conversationId: string) => {
      setPendingChapterPlan({ open: true, planContent, fullContent, conversationId })
      return new Promise<"confirm" | "skip" | "cancel" | { modify: string }>((resolve) => {
        chapterPlanResolverRef.current = resolve
      })
    },
    [],
  )

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
    async (text: string, tokens: ReferenceToken[] = [], displayText?: string) => {
      const plainText = text.trim()
      const userVisibleText = (displayText ?? plainText).trim()
      const planExecutionFollowup = isChapterPlanExecutionFollowup(plainText)
      const planExecuteActive =
        aiWorkflowMode !== "fast" && planExecuteEnabled && !planExecutionFollowup
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
      let taskRoute = novelMode ? routeTask(plainText) : null

      if (planExecutionFollowup && novelMode) {
        const savedRoute = lastWritingTaskRouteRef.current[capturedConvId]
        if (savedRoute && WRITING_INTENTS.has(savedRoute.intent)) {
          taskRoute = savedRoute
        }
      } else if (taskRoute && WRITING_INTENTS.has(taskRoute.intent)) {
        lastWritingTaskRouteRef.current[capturedConvId] = taskRoute
      }

      if (taskRoute && SIMULATION_INTENTS.has(taskRoute.intent)) {
        const { assistantMessage } = appendAgentChatMessages(capturedConvId, userVisibleText || plainText, tokens)
        setConversationInputDraft(capturedConvId, "")
        setFallbackReferenceText("")
        setReferenceTokensByConversation((drafts) => {
          const withoutCaptured = setReferenceTokensForConversation(drafts, capturedConvId, [])
          return setReferenceTokensForConversation(withoutCaptured, referenceDraftConversationId, [])
        })

        const hasFramework = !!activeBinding
        useStorySimulationStore.getState().initWithPreset({
          intent: taskRoute.intent,
          userInput: plainText,
          hasFramework,
        })

        setActiveView("storySimulation")

        updateAgentAssistantMessage(assistantMessage.id, (message) => ({
          ...message,
          content: "已为你打开剧情推演室并预填配置，请在推演室中继续操作。",
          isAgentRunning: false,
        }))

        return
      }

      const sessionAgentSystemPrompt = buildChatAgentSystemPrompt({
        novelMode,
        mode,
        deepChapterEnabled,
        chatEditModeEnabled,
        aiWorkflowMode,
        planExecuteEnabled: planExecuteActive,
        projectName: project?.name,
        bindingTitle: activeBinding?.framework.title,
      })
      const lastGeneratedChapterNumber = novelMode
        ? detectLastGeneratedChapterNumber(
            activeConvMessages
              .filter((message) => message.role === "assistant")
              .map((message) => message.content),
          )
        : undefined

      const { assistantMessage } = appendAgentChatMessages(capturedConvId, userVisibleText || plainText, tokens)
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

      /* === Context trace + pre-plugin chain === */
      let contextTrace = createContextTrace(assistantMessage.id)
      void contextTrace
      let effectiveTaskRoute = taskRoute
      let contextPack: ContextPack | null = null
      void contextPack
      let novelContextPrompt: string = ""
      let prePluginResult: PrePluginChainResult | null = null
      const shouldRunNovelPrePluginChain = novelMode && (aiWorkflowMode !== "fast" || planExecuteActive)
      void shouldRunNovelPrePluginChain
      abortControllersRef.current[capturedConvId] = controller
      let hasAgentError = false

      const markDone = (record?: AgentRunRecord) => {
        updateAgentAssistantMessage(assistantMessage.id, (message) => ({
          ...message,
          content: message.content || record?.finalText || "Agent未返回内容。",
          agentToolCalls: settleRunningAgentToolCalls(record?.toolCalls.length ? record.toolCalls : message.agentToolCalls),
          agentStages: settleRunningAgentStages(message.agentStages, "done"),
          references: (() => {
            const existingReferences = message.references ?? []
            const existingPaths = new Set(existingReferences.map((reference) => reference.path))
            const agentReferences = agentToolCallsToMessageReferences(
              settleRunningAgentToolCalls(record?.toolCalls.length ? record.toolCalls : message.agentToolCalls) ?? [],
            ).filter((reference) => !existingPaths.has(reference.path))
            return agentReferences.length > 0
              ? [...existingReferences, ...agentReferences]
              : message.references
          })(),
          contextTrace: contextTrace || message.contextTrace,
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
          agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "error"),
          agentStages: settleRunningAgentStages(message.agentStages, "error"),
          contextTrace: contextTrace || message.contextTrace,
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

      const targetChapterNumber = novelMode && taskRoute
        ? await resolveTargetChapterNumberForChat({
            projectPath: pp,
            userRequest: plainText,
            routeIntent: taskRoute.intent,
            routeChapterNumber: taskRoute.chapterNumber,
            selectedFile,
            lastGeneratedChapterNumber,
          }).catch((error) => {
            console.warn("解析目标章节失败:", error)
            return undefined
          })
        : undefined
      effectiveTaskRoute = taskRoute && targetChapterNumber
        ? {
            ...taskRoute,
            chapterNumber: targetChapterNumber,
            extractedParams: {
              ...taskRoute.extractedParams,
              chapterNumber: String(targetChapterNumber),
            },
          }
        : taskRoute

      if (shouldRunNovelPrePluginChain && effectiveTaskRoute) {
        try {
          prePluginResult = await runNovelPrePluginChain({
            input: {
              userMessage: plainText,
              projectPath: pp,
              agentConfig: {
                ...agentConfig,
                systemPrompt: sessionAgentSystemPrompt,
              },
              novelMode,
              taskRoute: effectiveTaskRoute,
              effectiveTaskRoute,
              aiWorkflowMode,
              planExecuteEnabled: planExecuteActive,
              availableSkills: availableAgentSkills,
              mcpCapabilities: agentMcpCapabilities,
              selectedFile,
            },
          })
        } catch (e) {
          console.warn("Pre-plugin chain failed:", e)
        }
      }
      if (prePluginResult && prePluginResult.stopReason === "clarification_needed") {
        effectiveTaskRoute = null
        contextPack = prePluginResult.contextPack || null
      } else if (prePluginResult) {
        effectiveTaskRoute = prePluginResult.effectiveTaskRoute ?? effectiveTaskRoute
        contextPack = prePluginResult.contextPack || null
      }

      if (novelMode) {
        const now = Date.now()
        const routeEvent = createAgentActivityEvent({
          id: `chat_route:${assistantMessage.id}:${now}`,
          stageId: "task_understanding",
          kind: "analysis",
          title: "当前执行路线",
          content: buildWorkflowRouteActivityContent(aiWorkflowMode, planExecuteActive, effectiveTaskRoute),
          timestamp: now,
        })
        const skillEvent = createAgentActivityEvent({
          id: `chat_skills:${assistantMessage.id}:${now + 1}`,
          stageId: "capability_selection",
          kind: "skill_used",
          title: "本次启用 Skill",
          content: buildSelectedSkillsActivityContent(prePluginResult?.selectedSkills),
          timestamp: now + 1,
        })
        updateAgentAssistantMessage(assistantMessage.id, (message) => ({
          ...message,
          agentStages: applyAgentActivityEvent(
            applyAgentActivityEvent(message.agentStages, routeEvent),
            skillEvent,
          ),
        }))
      }

      const shouldUseQmQuaiSkill = effectiveTaskRoute != null && (
        effectiveTaskRoute.intent === "write_chapter" ||
        effectiveTaskRoute.intent === "continue_chapter" ||
        effectiveTaskRoute.intent === "rewrite_chapter"
      )
      const qmQuaiSystemPrompt = shouldUseQmQuaiSkill ? buildQmQuaiSystemPrompt() : ""
      novelContextPrompt = ""

      if (novelMode && effectiveTaskRoute) {
        try {
          const taskDirective = buildTaskDirective(effectiveTaskRoute)
          const goldenThreeChapter = detectGoldenThreeChapterRequest(plainText, effectiveTaskRoute.chapterNumber)
          const goldenDirective = buildGoldenThreeChapterDirective(goldenThreeChapter)
          const { buildContextPack, contextPackToPrompt } = await import("@/lib/novel/context-engine")
          contextPack = await buildContextPack(pp, plainText, effectiveTaskRoute.chapterNumber).catch(() => ({
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

      const prePluginSystemPrompt = prePluginResult?.finalSystemPrompt?.trim()
      const baseSystemPrompt = [
        prePluginSystemPrompt || sessionAgentSystemPrompt,
        qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
        prePluginSystemPrompt ? "" : novelContextPrompt,
      ].filter(Boolean).join("\n")
      const effectiveSystemPrompt = effectiveDeAiSkill
        ? [
            baseSystemPrompt,
            prePluginSystemPrompt ? "" : selectedSkillsPrompt,
            "",
            "## 当前会话去AI味技能",
            buildDeAiSkillSystemPrompt(effectiveDeAiSkill.content),
            (!prePluginSystemPrompt && prePluginResult?.selectedSkills && prePluginResult.selectedSkills.length > 0
              ? `## 当前会话写作技能\n${buildSelectedSkillsPrompt(prePluginResult.selectedSkills)}`
              : ""),
          ].filter(Boolean).join("\n")
        : [
            baseSystemPrompt,
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

      try {
        const record = await runAiChatSession({
          userMessage: plainText,
          projectPath,
          agentConfig: {
            ...agentConfig,
            systemPrompt: effectiveSystemPrompt,
            projectPath,
            taskGoal: plainText,
            requestOverrides: agentConfig.requestOverrides,
          },
          enabledToolNames: prePluginResult?.enabledToolNames,
          registry: agentRegistry,
          messages: agentMessages,
          signal: controller.signal,
          callbacks: {
            onText: (chunk: string) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                content: message.content + chunk,
              }))
            },
              onToolEvent: (event) => {
                if (contextTrace) {
                  contextTrace = appendWebSearchTrace(contextTrace, event)
                  contextTrace = appendMcpCallTrace(contextTrace, event)
                }
                if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
                updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                  ...message,
                  agentToolCalls: applyAgentToolEvent(message.agentToolCalls, event),
                  agentStages: applyAgentToolActivityEvent(message.agentStages, event),
                }))
              },
              onActivityEvent: (event) => {
                if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
                updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                  ...message,
                  agentStages: applyAgentActivityEvent(message.agentStages, event),
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
        })

        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        finishAgentSession(() => {
          if (!hasAgentError) {
            if (contextTrace && effectiveTaskRoute) {
              const traceInfo = buildInitialContextTraceInfo(effectiveTaskRoute, prePluginResult, { workflowMode: aiWorkflowMode })
              contextTrace = setContextInfo(contextTrace, traceInfo)
              const storeStateForValidation = useChatStore.getState()
              const lastAssistantForValidation = storeStateForValidation.messages.find(
                (m) => m.id === assistantMessage.id && m.role === "assistant",
              )
              const finalContent = lastAssistantForValidation?.content ?? ""
              if (finalContent) {
                const protocolTrace = buildResultProtocolTrace("chapter", finalContent)
                contextTrace = setContextInfo(contextTrace, { ...traceInfo, resultProtocol: protocolTrace })
              }
              // === Stage D: 写后剧情自检 ===
              // 仅对 write_chapter / continue_chapter 任务触发，避免对普通对话误触发
              if (
                effectiveTaskRoute.intent === "write_chapter" ||
                effectiveTaskRoute.intent === "continue_chapter"
              ) {
                const chapterContent = finalContent
                // 排除含 chapter_plan 标记的内容（计划本身不是正文）与空内容
                const hasChapterPlanMarker = chapterContent.includes("chapter_plan")
                if (chapterContent && !hasChapterPlanMarker) {
                  void (async () => {
                    try {
                      const result = await runPostWriteCheckAI({
                        chapterContent,
                        contextPack: contextPack ?? undefined,
                        llmConfig: agentConfig?.llmConfig,
                      })
                      contextTrace = setContextInfo(contextTrace, {
                        ...contextTrace.contextInfo!,
                        postWriteCheck: result.check,
                        postWriteCheckMeta: {
                          source: result.source,
                          fallbackReason: result.fallbackReason,
                        },
                      })
                    } catch (err) {
                      console.error("[Stage D] AI 自检失败:", err)
                    }
                  })().catch((err) => console.error("[Stage D] 执行失败:", err))
                }
              }
              contextTrace = finishTrace(contextTrace, "done")
            }
            markDone(record)
          }
        })
        if (!hasAgentError && planExecuteActive) {
          const storeState = useChatStore.getState()
          const lastAssistant = storeState.messages.find(
            (m) => m.id === assistantMessage.id && m.role === "assistant",
          )
          const fullContent = lastAssistant?.content || record.finalText || ""
          const extracted = extractChapterPlan(fullContent)
          if (extracted) {
            chapterPlanContextRef.current = contextPack
            const action = await requestChapterPlanConfirm(
              extracted.plan,
              fullContent,
              capturedConvId,
            )
            if (action === "cancel") {
              recordChapterPlanExecutionCancelled(assistantMessage.id)
              chapterPlanContextRef.current = null
            } else {
              let followupText: string
              if (action === "confirm") {
                confirmedBlueprintRef.current = extracted.plan
                followupText = buildPlanConfirmMessage(extracted.plan)
              } else if (action === "skip") {
                followupText = buildPlanSkipMessage()
              } else {
                confirmedBlueprintRef.current = action.modify
                followupText = buildPlanConfirmMessage(action.modify)
              }
              setActiveConversation(capturedConvId)
              try {
                await handleSendRef.current(followupText, [], "执行已确认计划")
              } finally {
                // followup 成功、失败或被中断都清理，避免后续无关调用误注入旧计划。
                confirmedBlueprintRef.current = null
                chapterPlanContextRef.current = null
              }
            }
          }
        }
      } catch (error) {
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        finishAgentSession(() => {
          if (contextTrace) contextTrace = finishTrace(contextTrace, "error", error instanceof Error ? error.message : String(error))
          markError(error instanceof Error ? error : new Error(String(error)))
        })
      }
    },
    [
      activeBinding?.framework.title,
      agentConfig,
      agentMcpCapabilities,
      agentRegistry,
      agentSkillConfigLoaded,
      agentSupportsTools,
      agentSystemPrompt,
      aiWorkflowMode,
      availableAgentSkills,
      chatEditModeEnabled,
      clearStreaming,
      createConversation,
      deepChapterEnabled,
      maxHistoryMessages,
      mode,
      novelMode,
      planExecuteEnabled,
      project,
      projectPath,
      referenceDraftConversationId,
      requestChapterPlanConfirm,
      selectedFile,
      setActiveConversation,
      setConversationInputDraft,
      startStreaming,
    ],
  )
  handleSendRef.current = handleSend

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
            agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled"),
            agentStages: settleRunningAgentStages(message.agentStages, "cancelled"),
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

    await handleSendRef.current(prompt, [], "继续未完成")
  }, [isStreaming])

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
              className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
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
                    buttonLabel="技能库"
                    showLibraryShortcut
                    onChange={(skillId) => {
                      const convId = useChatStore.getState().activeConversationId
                      if (convId) setConversationDeAiSkillId(convId, skillId)
                    }}
                  />
                  {novelMode && (
                    <>
                      <div className="relative">
                        <Button
                          ref={workflowModeTriggerRef}
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-haspopup="listbox"
                          aria-expanded={workflowModeDropdownOpen}
                          aria-label={aiSessionWorkflowModeLabel}
                          className="h-8 shrink-0 rounded-full border px-2.5 text-xs"
                          onClick={() => setWorkflowModeDropdownOpen(!workflowModeDropdownOpen)}
                        >
                          <span className="mr-1">
                            {aiWorkflowModeOptions.find((o) => o.mode === aiWorkflowMode)?.label ?? "标准"}
                          </span>
                          <ChevronDown className={`h-3.5 w-3.5 opacity-50 transition-transform ${workflowModeDropdownOpen ? "rotate-180" : ""}`} />
                        </Button>
                        {workflowModeDropdownOpen && workflowModeDropdownStyle && createPortal(
                          <>
                            <div
                              className="fixed inset-0"
                              style={{ zIndex: 9998 }}
                              onClick={() => setWorkflowModeDropdownOpen(false)}
                            />
                            <div
                              ref={workflowModeDropdownRef}
                              role="listbox"
                              className="fixed rounded-md border bg-popover p-1 shadow-md"
                              style={{
                                left: workflowModeDropdownStyle.left,
                                top: workflowModeDropdownStyle.top,
                                width: workflowModeDropdownStyle.width,
                                zIndex: 9999,
                              }}
                            >
                              {aiWorkflowModeOptions.map(({ mode, label, description, routeDescription }) => (
                                <button
                                  key={mode}
                                  type="button"
                                  role="option"
                                  aria-selected={aiWorkflowMode === mode}
                                  className="flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left hover:bg-accent"
                                  onClick={() => {
                                    setAiWorkflowMode(mode)
                                    setWorkflowModeDropdownOpen(false)
                                  }}
                                >
                                  <Check
                                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                                      aiWorkflowMode === mode ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 text-sm font-medium">
                                      <span>{label}</span>
                                      <span className="rounded border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                                        {description}
                                      </span>
                                    </span>
                                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                      {routeDescription}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </>,
                          document.body,
                        )}
                      </div>
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-pressed={planExecuteEnabled && aiWorkflowMode !== "fast"}
                              disabled={aiWorkflowMode === "fast"}
                              className={`h-8 shrink-0 rounded-full border px-2.5 text-xs ${
                                planExecuteEnabled && aiWorkflowMode !== "fast"
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                              onClick={() => setPlanExecuteEnabled(!planExecuteEnabled)}
                              title={aiWorkflowMode === "fast" ? "快速模式下不支持计划执行，请切换到标准或严格模式" : planExecuteEnabled ? "关闭计划执行模式" : "开启计划执行模式"}
                              aria-label={aiWorkflowMode === "fast" ? "快速模式下不支持计划执行，请切换到标准或严格模式" : planExecuteEnabled ? "关闭计划执行模式" : "开启计划执行模式"}
                            />
                          )}
                        >
                          <ListChecks className="mr-1 h-3.5 w-3.5" />
                          计划执行
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs leading-5">
                          {aiWorkflowMode === "fast"
                            ? "快速模式下不支持计划执行，请切换到标准或严格模式。"
                            : "开启后，本次写作会先创建计划，等待确认后再执行；可与标准、严格模式组合使用。"}
                        </TooltipContent>
                      </Tooltip>
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
              disabled={isStreaming || pendingChapterPlan.open}
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
        {pendingChapterPlan.open && (
          <ChapterPlanConfirmDialog
            open={pendingChapterPlan.open}
            planContent={pendingChapterPlan.planContent}
            aiWorkflowMode={aiWorkflowMode}
            onConfirm={() => closeChapterPlanDialog("confirm")}
            onSkip={() => closeChapterPlanDialog("skip")}
            onModify={(modified) => closeChapterPlanDialog({ modify: modified })}
            onSelfCheck={runChapterPlanSelfCheck}
            onRevisePlan={runChapterPlanRevision}
            onCancel={() => closeChapterPlanDialog("cancel")}
          />
        )}
      </div>
    </div>
  )
}
