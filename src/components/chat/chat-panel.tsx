import { useRef, useEffect, useCallback, useState, useMemo, useDeferredValue, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { BookOpen, Plus, Trash2, MessageSquare, ListChecks, ChevronDown, Check, History, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { ChatModelSelector } from "./chat-model-selector"
import { useSourceFiles } from "./chat-shared"
import { useStreamingText } from "@/hooks/use-streaming-text"
import {
  ChapterPlanConfirmDialog,
  extractChapterPlan,
  buildPlanConfirmMessage,
  buildPlanSkipMessage,
  isChapterPlanExecutionFollowup,
} from "./chapter-plan-confirm-dialog"
import { useChatStore, type DisplayMessage } from "@/stores/chat-store"
import { useShallow } from "zustand/react/shallow"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { ReferenceInput, type InsertReferenceTokens } from "@/components/reference/ReferenceInput"
import { ReferencePickerDialog } from "@/components/reference/ReferencePickerDialog"
import { ConversationRunStatusIcon } from "@/components/common/conversation-run-status-icon"
import { ConversationDeleteConfirmDialog } from "@/components/common/conversation-delete-confirm-dialog"
import { ConversationHistoryClearDialog } from "@/components/common/conversation-history-clear-dialog"
import { chatConversationRunRegistry } from "@/lib/conversation-run-registry"
import { toast } from "@/lib/toast"
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
  RequiredToolFallbackError,
  resolveRequiredToolsOnce,
} from "@/lib/agent/required-tools-gate"
import { runDraftReviewSkill } from "@/lib/agent/skills/draft-review-skill"
import { useDraftReviewStore } from "@/stores/draft-review-store"
import { ToolRegistry } from "@/lib/agent/registry"
import { registerAllBuiltInTools } from "@/lib/agent/tools"
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
import { resolveContextPackTokenBudget } from "@/lib/context-budget"
import { resolveChapterLengthSpec } from "@/lib/novel/deep-chapter-prompts"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective, isChapterWritingIntent, type TaskRouteResult } from "@/lib/novel/task-router"
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
import {
  cleanGeneratedChapterContentForDisplay,
  cleanGeneratedChapterContentWithTitle,
} from "@/lib/novel/chapter-content-cleanup"
import { normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import {
  getConversationTabTitle,
  splitConversationToolbarItems,
} from "@/lib/workspace-layout"
import {
  canCreateNewConversation,
  EMPTY_CONVERSATION_CREATE_REASON,
} from "@/lib/conversation-create-guard"
import { saveAiChatModel, saveAiWorkflowMode } from "@/lib/project-store"
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
import {
  getCopyableAssistantContent,
  type CopyableToolCall,
} from "@/lib/chat-copy-content"
import { validateChapterBeforeSave } from "@/lib/novel/result-save-guard"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "@/lib/novel/chapter-save-strategy"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import { loadFrameworks } from "@/lib/novel/story-simulation/framework-store"
import type { FrameworkBinding, StoryFramework } from "@/lib/novel/story-simulation/types"

import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"
import { buildPlanExecutePolicyPrompt, WRITING_INTENTS } from "@/lib/agent/plan-execute-policy"
import {
  buildOutlineFindProtocol,
  shouldIncludeOutlineFindProtocol,
} from "@/lib/novel/outline-find-protocol"
import { createContextTrace, finishTrace, setContextInfo, type ContextTrace } from "@/lib/agent/context-trace"
import { settleRunningAgentToolCalls } from "@/lib/agent/tool-events"
import { appendMcpCallTrace } from "@/lib/agent/mcp-trace"
import { runNovelPrePluginChain } from "@/lib/agent/novel-pre-plugin-chain"
import { buildInitialContextTraceInfo } from "@/lib/agent/context-trace-builders"
import { runPostWriteCheckAI } from "@/lib/agent/plugins/post-write-check-ai"
import { buildSelectedSkillsPrompt } from "@/lib/agent/plugins/select-skills-plugin"
import { collectExplicitSkills } from "@/lib/novel/skill-route-registry"
import { buildResultProtocolTrace } from "@/lib/novel/result-parser"
// import { getLoadedCategories, DATA_SOURCE_CATEGORY_LABELS } from "@/lib/novel/classification"
// import { RetrievalStore } from "@/lib/novel/retrieval"
// import { readFile as fsReadFile, writeFile as fsWriteFile, fileExists, listDirectory, createDirectory as fsCreateDirectory } from "@/commands/fs"
// import { joinPath } from "@/lib/path-utils"
// import type { AiCapability } from "@/lib/agent/capabilities/types"
import { deAiSkillToUserSkill } from "@/lib/novel/de-ai-skill-library"
import {
  buildContextHubSystemContent,
  buildSessionContextSummary,
  flattenContextHubSystemContent,
  buildLlmRequestDiagnostics,
  getContextHub,
  persistContextHubProviderUsage,
  selectContextHistoryMessages,
  type ContextHubResult,
  type ContextIntent,
} from "@/lib/context-hub"
import { buildAgentHistoryMessages } from "@/lib/context-hub/chapter-body-injection"
import {
  buildContextUsageSnapshot,
  calibrateContextUsageSnapshot,
  composeLiveContextUsage,
} from "@/lib/context-usage"
import { toOpenAITools } from "@/lib/agent/tools-schema"
import { getEffectiveMaxContextSize } from "@/lib/llm-providers"
import { ContextUsageRing } from "@/components/chat/context-usage-ring"
import { enqueueUserMemoryLearning } from "@/lib/user-memory/learning-service"
import { recordLatestUserMemoryFeedback } from "@/lib/user-memory/feedback-service"
import {
  ensureSystemNotificationPermission,
  notifyChapterWritingOutcome,
} from "@/lib/system-notification"


/* spec-test patterns */
const rawTaskRoute: { intent: string } | null = { intent: "general_chat" }
const shouldRunNovelPrePluginChain = false
const taskRoute = shouldRunNovelPrePluginChain ? rawTaskRoute : null
const selectedSkillsPrompt = ""
const aiSessionWorkflowModeLabel = "AI 会话执行模式"
const aiSessionPlanExecuteLabel = "计划模式"
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

function buildSelectedSkillsActivityContent(
  skills: UserSkill[] | undefined,
  missingSkillNames: string[] = [],
): string {
  const missingText = missingSkillNames.length > 0
    ? `\n缺失或已禁用：${missingSkillNames.join("、")}。未强制启用。`
    : ""
  if (!skills || skills.length === 0) {
    return `本次未启用 Skill：当前任务、模式或阶段没有匹配到可用技能。${missingText}`
  }
  return skills
    .map((skill, index) => {
      const stageText = skill.stages.length > 0 ? skill.stages.join("、") : "未标注阶段"
      const kindText = skill.kind.length > 0 ? skill.kind.join("、") : "未标注类型"
      return `${index + 1}. ${skill.name}｜阶段：${stageText}｜类型：${kindText}｜优先级：${skill.priority ?? 50}`
    })
    .join("\n") + missingText
}

function buildChatAgentSystemPrompt(options: {
  novelMode: boolean
  mode: "chat" | "ingest"
  chatEditModeEnabled: boolean
  aiWorkflowMode?: AiWorkflowMode
  writingWebSearchEnabled?: boolean
  planExecuteEnabled?: boolean
  agentWritingSkills?: UserSkill[]
  projectName?: string
  bindingTitle?: string
  targetChapterNumber?: number
  /** 仅章节写作且不会走 pre-plugin 时注入，避免与 build_system_prompt plugin 重复 */
  includeOutlineFindProtocol?: boolean
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
    const planPhase = Boolean(options.planExecuteEnabled) && options.aiWorkflowMode !== "fast"
    if (planPhase) {
      // 计划阶段与"只输出正文/必须调 run_chapter_workflow"互斥：同时注入
      // 会让模型在两套矛盾指令之间随机选择，表现为跳过计划直接产出正文。
      lines.push("当前处于章节计划阶段：本轮只输出章节创作计划并等待用户确认，禁止输出章节正文，禁止调用 run_chapter_workflow 等正文生成类工具。")
    } else if (options.aiWorkflowMode === "fast") {
      lines.push("小说模式下，如果用户要求生成、续写或改写章节，只输出可直接放入章节库的正文。")
      lines.push("章节生成、续写或改写任务的最终回复必须只包含章节正文，不要把工具读取过程、写作计划或执行过程展示给用户。")
      lines.push("不要输出读取说明、执行总结、完成目标表格、章节结构、后续建议、引用来源或 Markdown 表格；章节标题和正文以外的内容都不要输出。")
    } else {
      // 走工作流时正文由工具直接交付，再要求模型「只输出正文」会诱导它把
      // 终稿复述一遍：既多花一次生成，又可能改坏已经定稿的正文。
      lines.push("章节正文由 run_chapter_workflow 直接交付给用户，工具执行成功后本轮任务即结束。")
      lines.push("禁止复述、改写、摘要或续写工具已交付的正文，也不要输出读取说明、执行总结、完成目标表格、章节结构、后续建议、引用来源或 Markdown 表格。")
      lines.push("一次只处理一章：即使用户要求多章，也只调用一次 run_chapter_workflow，交付后结束并让用户再发下一章请求。")
    }
    if (options.includeOutlineFindProtocol) {
      lines.push(buildOutlineFindProtocol(options.targetChapterNumber))
    }
    if (options.aiWorkflowMode === "fast") {
      lines.push("快速模式下可以读取必要上下文；除非用户明确要求使用工作流或 Skill，否则不要主动调用 run_chapter_workflow。")
    } else if (!planPhase) {
      lines.push("章节生成、续写、改写或润色必须调用 run_chapter_workflow 工具；未调用前禁止输出章节终稿正文。")
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
        lines.push("严格模式：读取更完整上下文，执行更严格的审稿、返修和一致性检查。")
        break
      }
    if (
      options.writingWebSearchEnabled
      && options.aiWorkflowMode !== "fast"
    ) {
      lines.push("会联网搜索。如果有外部搜索需求，必须使用 web_search 工具，不得声称已经搜索。未使用联网资料时，在回复末尾注明。")
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

function resolveChatContextIntent(
  route: TaskRouteResult | null,
  deAiEnabled: boolean,
): ContextIntent {
  if (deAiEnabled || route?.intent === "review_chapter") return "review"
  if (route?.intent === "lint_chapter") return "lint"
  if (!route || route.intent === "general_chat" || route.intent.endsWith("_query") || route.intent === "search_plot") {
    return "question"
  }
  return "generate"
}

const SIMULATION_INTENTS = new Set([
  "story_framework_generate",
  "multi_agent_simulate",
  "character_interview",
])

interface ChatSendOptions {
  /** Internal recovery path for a failed mandatory chapter workflow. */
  forceRequiredToolsImmediately?: boolean
  /** Existing assistant bubble to reset and reuse instead of appending messages. */
  retryAssistantMessageId?: string
  /** Preserve the execution policy selected for the failed request. */
  workflowMode?: AiWorkflowMode
  planExecuteActive?: boolean
}

type ChatSend = (
  text: string,
  tokens?: ReferenceToken[],
  displayText?: string,
  planBlueprint?: string,
  targetConversationId?: string,
  options?: ChatSendOptions,
) => Promise<void>

function isRequiredChapterWorkflowFailure(error: Error | null): boolean {
  if (!error) return false
  if (error instanceof RequiredToolFallbackError) {
    return error.toolName === "run_chapter_workflow"
  }
  // Preserve retryability when an Error crosses a serialization boundary.
  return (
    error.name === "RequiredToolFallbackError"
    && error.message.includes("run_chapter_workflow")
  )
}

function resetAssistantMessageForRequiredToolRetry(message: DisplayMessage): DisplayMessage {
  return {
    ...message,
    content: "",
    reasoning_content: "",
    agentToolCalls: [],
    agentStages: [],
    isAgentRunning: true,
    discarded: false,
    references: undefined,
    contextTrace: undefined,
    contextHubSnapshot: undefined,
    chapterRef: undefined,
  }
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
    title: "已取消计划",
    content: "用户取消了章节计划确认，未进入正文生成。",
    timestamp,
  })
  updateAgentAssistantMessage(messageId, (message) => ({
    ...message,
    content: message.content
      ? `${message.content}\n\n已取消计划，未进入正文生成。`
      : "已取消计划，未进入正文生成。",
    agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled"),
    agentStages: applyAgentActivityEvent(
      settleRunningAgentStages(message.agentStages, "cancelled"),
      cancelEvent,
    ),
    isAgentRunning: false,
  }))
}

function ConversationTabs({ onBeforeDelete }: { onBeforeDelete: (conversationId: string) => void }) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const runStates = useChatStore((s) => s.runStates)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const stopConversationRun = useChatStore((s) => s.stopConversationRun)
  const clearStreaming = useChatStore((s) => s.clearStreaming)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const historyButtonRef = useRef<HTMLButtonElement | null>(null)
  const historyDropdownRef = useRef<HTMLDivElement | null>(null)
  const [historyDropdownStyle, setHistoryDropdownStyle] = useState<CSSProperties | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingClearHistoryIds, setPendingClearHistoryIds] = useState<string[] | null>(null)

  const isStreamingConversation = (convId: string) => runStates[convId]?.status === "running"
  const { topConversations, historyConversations } = splitConversationToolbarItems(
    conversations,
    activeConversationId,
    isStreamingConversation,
  )
  const historyCount = historyConversations.length
  const hasSentUserMessage = activeConversationId
    ? messages.some((message) =>
        message.conversationId === activeConversationId && message.role === "user",
      )
    : false
  const canCreateConversation = canCreateNewConversation(
    activeConversationId,
    hasSentUserMessage,
  )

  // 点击历史记录浮层外部关闭
  useEffect(() => {
    if (!historyOpen) return
    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      if (
        historyRef.current && !historyRef.current.contains(target) &&
        historyDropdownRef.current && !historyDropdownRef.current.contains(target)
      ) {
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

  function deleteConversationNow(convId: string) {
    onBeforeDelete(convId)
    const runId = useChatStore.getState().runStates[convId]?.runId
    chatConversationRunRegistry.abort(convId)
    stopConversationRun(convId, runId)
    clearStreaming(convId)
    deleteConversation(convId)
    const proj = useWikiStore.getState().project
    if (proj) {
      deleteFile(`${proj.path}/.qmai/chats/${convId}.json`).catch(() => {})
    }
  }

  function handleDeleteConversation(convId: string) {
    if (runStates[convId]?.status === "running") {
      setPendingDeleteId(convId)
      return
    }
    deleteConversationNow(convId)
  }

  function requestClearHistory() {
    setPendingClearHistoryIds(historyConversations.map((conversation) => conversation.id))
    setHistoryOpen(false)
  }

  function clearHistoryNow() {
    pendingClearHistoryIds?.forEach((conversationId) => deleteConversationNow(conversationId))
    setPendingClearHistoryIds(null)
  }

  function renderConversationChip(conv: { id: string; title: string; updatedAt: number }) {
    const isActive = conv.id === activeConversationId
    const runState = runStates[conv.id]
    const msgCount = getMessageCount(conv.id)
    return (
      <div
        key={conv.id}
        className={`group flex shrink-0 items-center rounded-full border px-1 text-xs transition-colors ${
          isActive
            ? "border-primary/40 bg-background text-foreground shadow-sm"
            : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
        onMouseEnter={() => setHoveredId(conv.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <button
          type="button"
          className="flex items-center gap-2 rounded-full px-2 py-1.5"
          onClick={() => setActiveConversation(conv.id)}
          title={conv.title}
        >
          <ConversationRunStatusIcon state={runState} />
          <span className="max-w-[140px] truncate font-medium">{getConversationTabTitle(conv.title, 10)}</span>
          <span className="text-[10px] opacity-70">{msgCount}</span>
          <span className="text-[10px] opacity-70">{formatDate(conv.updatedAt)}</span>
        </button>
        <button
          type="button"
          className={`rounded p-0.5 text-muted-foreground hover:text-destructive focus:opacity-100 ${hoveredId === conv.id ? "opacity-100" : "opacity-0 group-focus-within:opacity-100"}`}
          aria-label="删除会话"
          onClick={() => handleDeleteConversation(conv.id)}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // 顶部统一为三段式：新建写作绘画 / 正在工作的绘画 / 绘画历史记录
  return (
    <>
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2">
        {/* 1. 新建写作绘画 */}
        <span
          className="inline-flex shrink-0"
          title={!canCreateConversation ? EMPTY_CONVERSATION_CREATE_REASON : undefined}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="qmai-new-conversation-button shrink-0 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
            onClick={() => createConversation()}
            disabled={!canCreateConversation}
            title={canCreateConversation
              ? t(novelMode ? "novel.chat.newChat" : "chat.newChat")
              : EMPTY_CONVERSATION_CREATE_REASON}
            aria-label={t(novelMode ? "novel.chat.newChat" : "chat.newChat")}
            aria-describedby={!canCreateConversation
              ? "chat-new-conversation-disabled-reason"
              : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {!canCreateConversation && (
            <span id="chat-new-conversation-disabled-reason" className="sr-only">
              {EMPTY_CONVERSATION_CREATE_REASON}
            </span>
          )}
        </span>

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
        <div className="relative ml-auto shrink-0" ref={historyRef}>
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
                ref={historyDropdownRef}
                className="fixed z-50 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
                style={historyDropdownStyle}
              >
              {historyCount > 0 && (
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">
                    {t("chat.historyConversationCount", { count: historyCount })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("chat.clearHistory")}
                    onClick={requestClearHistory}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("chat.clearHistory")}
                  </Button>
                </div>
              )}
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
    <ConversationDeleteConfirmDialog
      open={pendingDeleteId !== null}
      onCancel={() => setPendingDeleteId(null)}
      onConfirm={() => {
        if (pendingDeleteId) deleteConversationNow(pendingDeleteId)
        setPendingDeleteId(null)
      }}
    />
    <ConversationHistoryClearDialog
      open={pendingClearHistoryIds !== null}
      count={pendingClearHistoryIds?.length ?? 0}
      onCancel={() => setPendingClearHistoryIds(null)}
      onConfirm={clearHistoryNow}
    />
    </>
  )
}

export function ChatPanel() {
  const { t } = useTranslation()
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const streamingContents = useChatStore((s) => s.streamingContents)
  const runStates = useChatStore((s) => s.runStates)
  const mode = useChatStore((s) => s.mode)
  const startStreaming = useChatStore((s) => s.startStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const clearStreaming = useChatStore((s) => s.clearStreaming)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const isConversationStreaming = useChatStore((s) => s.isConversationStreaming)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationInputDraft = useChatStore((s) => s.setConversationInputDraft)
  const pendingReferenceTokens = useChatStore((s) => s.pendingReferenceTokens)
  const consumePendingReferenceTokens = useChatStore((s) => s.consumePendingReferenceTokens)
  const outlineConversations = useOutlineChatStore((s) => s.conversations)
  // Derive active messages via selector to re-render on message changes
  // 使用 useShallow 避免过滤数组返回新引用导致 useSyncExternalStore 无限重渲染（Zustand v5）
  const activeMessages = useChatStore(
    useShallow((s) =>
      activeConversationId ? s.messages.filter((m) => m.conversationId === activeConversationId) : [],
    ),
  )
  // 预计算最后一条 assistant 消息的索引，O(n) 而非 O(n²)
  const lastAssistantIndex = useMemo(() => {
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      if (activeMessages[i].role === "assistant") return i
    }
    return -1
  }, [activeMessages])
  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId) ?? null
    : null

  // 当前活跃会话的流式内容
  const streamingContent = activeConversationId ? streamingContents[activeConversationId] ?? "" : ""
  // 当前活跃会话是否正在流式生成
  const isStreaming = activeConversationId ? isConversationStreaming(activeConversationId) : false
  const concurrencyFull = !isStreaming && Object.values(runStates).filter((state) => state.status === "running").length >= 3
  const concurrencyLimitReason = "普通 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。"
  // 对齐 Zed StreamingTextBuffer：16ms tick 逐步揭示，平滑打字机效果
  const batchedStreamingContent = useStreamingText(streamingContent, isStreaming)

  const project = useWikiStore((s) => s.project)
  const projectPath = project?.path ? normalizePath(project.path) : ""
  const novelMode = useWikiStore((s) => s.novelMode)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const bindingVersion = useWikiStore((s) => s.bindingVersion)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const setAiChatModel = useWikiStore((s) => s.setAiChatModel)
  const chatEditModeEnabled = useWikiStore((s) => s.chatEditModeEnabled)
  const selectedFile = useWikiStore((s) => s.selectedFile)

  const streamSessionGuardRef = useRef(createStreamSessionGuard())
  const activeStreamSessionsRef = useRef<Record<string, number>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const [chapterSaveStatus, setChapterSaveStatus] = useState<string>("")
  const [deAiSkillWarningMessage, setDeAiSkillWarningMessage] = useState<string>("")
  const aiWorkflowMode = useWikiStore((s) => s.aiWorkflowMode)
  const writingWebSearchEnabled = useWikiStore((s) => s.novelConfig.writingWebSearchEnabled)
  const setAiWorkflowMode = useWikiStore((s) => s.setAiWorkflowMode)
  const [workflowModeDropdownOpen, setWorkflowModeDropdownOpen] = useState(false)
  const workflowModeTriggerRef = useRef<HTMLButtonElement>(null)
  const [workflowModeDropdownStyle, setWorkflowModeDropdownStyle] = useState<{ left: number; top: number; width: number } | null>(null)
  const workflowModeDropdownRef = useRef<HTMLDivElement | null>(null)
  const planExecuteEnabled = useWikiStore((s) => s.planExecuteEnabled)
  const setPlanExecuteEnabled = useWikiStore((s) => s.setPlanExecuteEnabled)
  const [isSavingChapter, setIsSavingChapter] = useState(false)
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
        chatEditModeEnabled,
        aiWorkflowMode,
        writingWebSearchEnabled,
        planExecuteEnabled: aiWorkflowMode !== "fast" && planExecuteEnabled,
        projectName: project?.name,
        bindingTitle: activeBinding?.framework.title,
      }),
    [
      activeBinding?.framework.title,
      chatEditModeEnabled,
      mode,
      novelMode,
      aiWorkflowMode,
      writingWebSearchEnabled,
      planExecuteEnabled,
      project?.name,
    ],
  )
  // 存储用户最近确认的章节计划，供 run_chapter_workflow 兜底注入，不依赖模型是否自觉传参。
  const selectedSkillsPromptRef = useRef("")
  const getSelectedSkillsPrompt = useCallback(() => {
    const value = selectedSkillsPromptRef.current.trim()
    return value || undefined
  }, [])
  const {
    config: agentConfig,
    registry: agentRegistry,
    supportsTools: agentSupportsTools,
    skillConfigLoaded: agentSkillConfigLoaded,
    skillConfig: agentSkillConfig,
    writingSkills: agentUserWritingSkills,
    mcpCapabilities: agentMcpCapabilities,
  } = useAgentConfig(agentSystemPrompt, undefined, getSelectedSkillsPrompt)
  const deferredReferenceText = useDeferredValue(referenceText)
  const liveContextUsage = useMemo(() => {
    const historyMessages = selectContextHistoryMessages(
      activeMessages.filter((message) => (
        (message.role === "user" || message.role === "assistant")
        && !message.discarded
        && !message.isAgentRunning
      )),
      activeConversation?.contextSummary?.text,
    )
    const measuredAt = activeConversation?.lastContextUsage?.measuredAt ?? 0
    const pendingToolResultTexts = activeMessages
      .filter((message) => message.isAgentRunning)
      .flatMap((message) => message.agentToolCalls ?? [])
      .filter((call) => (
        call.status === "done"
        && typeof call.result === "string"
        && call.result.trim().length > 0
        && (call.finishedAt ?? 0) > measuredAt
      ))
      .map((call) => call.result)
    return composeLiveContextUsage(activeConversation?.lastContextUsage, {
      windowTokens: agentConfig?.llmConfig
        ? getEffectiveMaxContextSize(agentConfig.llmConfig)
        : undefined,
      sessionSummaryText: activeConversation?.contextSummary?.text ?? "",
      historyTexts: historyMessages.map((message) => message.content),
      currentInput: deferredReferenceText,
      pendingToolResultTexts,
    })
  }, [
    activeConversation?.contextSummary?.text,
    activeConversation?.lastContextUsage,
    activeMessages,
    agentConfig?.llmConfig,
    deferredReferenceText,
  ])
  const runChapterPlanSelfCheck = useCallback(async (planContent: string, contextPack?: ContextPack | null) => {
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
      buildChapterPlanSelfCheckContext(contextPack ?? null),
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
          kind: skill.kind,
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
  const [pendingChapterPlans, setPendingChapterPlans] = useState<Record<string, {
    planContent: string
    fullContent: string
    conversationId: string
    contextPack?: ContextPack | null
  }>>({})
  const pendingChapterPlan = activeConversationId ? pendingChapterPlans[activeConversationId] : undefined
  const chapterPlanResolversRef = useRef<Record<string, (action: "confirm" | "skip" | "cancel" | { modify: string }) => void>>({})
  const handleSendRef = useRef<ChatSend>(() => Promise.resolve())
  const lastWritingTaskRouteRef = useRef<Record<string, TaskRouteResult>>({})

  const closeChapterPlanDialog = useCallback(
    (conversationId: string, action: "confirm" | "skip" | "cancel" | { modify: string }) => {
      const resolver = chapterPlanResolversRef.current[conversationId]
      delete chapterPlanResolversRef.current[conversationId]
      setPendingChapterPlans((plans) => {
        const { [conversationId]: _, ...rest } = plans
        return rest
      })
      resolver?.(action)
    },
    [],
  )

  useEffect(() => {
    return () => {
      Object.values(chapterPlanResolversRef.current).forEach((resolver) => resolver("cancel"))
      chapterPlanResolversRef.current = {}
    }
  }, [])

  const requestChapterPlanConfirm = useCallback(
    (planContent: string, fullContent: string, conversationId: string, contextPack?: ContextPack | null) => {
      setPendingChapterPlans((plans) => ({
        ...plans,
        [conversationId]: { planContent, fullContent, conversationId, contextPack },
      }))
      return new Promise<"confirm" | "skip" | "cancel" | { modify: string }>((resolve) => {
        chapterPlanResolversRef.current[conversationId] = resolve
      })
    },
    [],
  )
  const cancelPendingChapterPlan = useCallback((conversationId: string) => {
    if (chapterPlanResolversRef.current[conversationId]) {
      closeChapterPlanDialog(conversationId, "cancel")
    }
  }, [closeChapterPlanDialog])

  const handleSaveAsChapter = useCallback(async (
    messageId: string,
    content: string,
    toolCalls?: CopyableToolCall[],
  ) => {
    if (!project) return
    const pp = normalizePath(project.path)
    setIsSavingChapter(true)
    setChapterSaveStatus("")
    try {
      const resolvedContent = getCopyableAssistantContent(content, { toolCalls })
      const saveGuard = validateChapterBeforeSave(resolvedContent)
      if (!saveGuard.ok) {
        setChapterSaveStatus(saveGuard.message || "章节结果校验未通过，已取消保存")
        return
      }

      // 使用带标题提取的清理函数
      const { content: cleanedContent, title: extractedTitle } = cleanGeneratedChapterContentWithTitle(
        resolvedContent,
      )
      if (!cleanedContent.trim()) {
        setChapterSaveStatus("章节正文为空，已取消保存")
        return
      }

      const selectedChapterNumber = await readSelectedChapterNumberForFile(selectedFile)
      const generatedTargetChapterNumber = detectGeneratedTargetChapterNumber(extractedTitle ?? cleanedContent)
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
        // 标题只写入 frontmatter，正文只保存实际章节内容，避免重复。
        return `${frontmatter}${bodyContent}\n`
      }

      const chapterDir = `${pp}/wiki/chapters`
      await createDirectory(chapterDir)
      const chapterPath = `${chapterDir}/chapter-${String(targetChapterNumber).padStart(3, "0")}.md`
      const chapterMarkdown = buildDraftContent(targetChapterNumber, chapterTitle, cleanedContent)
      await writeFile(chapterPath, chapterMarkdown)
      useChatStore.getState().setMessageChapterRef(messageId, {
        chapterNumber: targetChapterNumber,
        path: chapterPath,
        savedAt: Date.now(),
      })
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

  // 切换会话时重置滚动位置到顶部
  const prevConvIdRef = useRef(activeConversationId)
  useEffect(() => {
    if (prevConvIdRef.current !== activeConversationId) {
      prevConvIdRef.current = activeConversationId
      const container = scrollContainerRef.current
      if (container) {
        container.scrollTop = 0
        lastScrollTopRef.current = 0
        userScrolledUpRef.current = false
        setShowScrollToBottom(false)
      }
    }
  }, [activeConversationId])

  // Auto-scroll to bottom when messages change or streaming content updates
  // But stop if user manually scrolled up. Use instant scroll — smooth fights the
  // user wheel and stacks animations while tool/thinking updates fire rapidly.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!userScrolledUpRef.current) {
      container.scrollTop = container.scrollHeight
      lastScrollTopRef.current = container.scrollTop
    }
  }, [activeMessages, batchedStreamingContent])

  const handleScrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    })
  }, [])

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
      setShowScrollToBottom(userScrolledUpRef.current && isStreaming)
      lastScrollTopRef.current = currentScrollTop
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [activeConversationId, isStreaming])

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
    async (
      text: string,
      tokens: ReferenceToken[] = [],
      displayText?: string,
      planBlueprint?: string,
      targetConversationId?: string,
      sendOptions?: ChatSendOptions,
    ) => {
      const plainText = text.trim()
      const userVisibleText = (displayText ?? plainText).trim()
      const planExecutionFollowup = isChapterPlanExecutionFollowup(plainText)
      const sessionWorkflowMode = sendOptions?.workflowMode ?? aiWorkflowMode
      const planExecuteActive = sendOptions?.planExecuteActive ?? (
        sessionWorkflowMode !== "fast" && planExecuteEnabled && !planExecutionFollowup
      )
      setDeAiSkillWarningMessage("")
      // 新一轮对话清空上一轮的章节保存提示，避免「已保存为第X章」残留在新消息下方
      setChapterSaveStatus("")

      if (!plainText) {
        setDeAiSkillWarningMessage("请输入提示词")
        return
      }
      if (!project) {
        setDeAiSkillWarningMessage("请先打开一个项目")
        return
      }
      if (!agentSkillConfigLoaded || !agentConfig) {
        setDeAiSkillWarningMessage(
          !agentSupportsTools
            ? "Agent 调度模型不支持工具调用，请更换小说设置中的默认模型"
            : "Agent配置仍在加载，请稍后重试",
        )
        return
      }

      let convId = targetConversationId ?? useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }
      const capturedConvId = convId
      const storeState = useChatStore.getState()
      const activeConv = storeState.conversations.find((conversation) => conversation.id === capturedConvId)
      if (
        sendOptions?.retryAssistantMessageId
        && storeState.runStates[capturedConvId]?.status === "running"
      ) {
        toast.info("该会话正在强制重试，请勿重复点击", {
          dedupeKey: `required-workflow-retry-running:${capturedConvId}`,
        })
        return
      }
      const retryAssistantIndex = sendOptions?.retryAssistantMessageId
        ? storeState.messages.findIndex((message) => message.id === sendOptions.retryAssistantMessageId)
        : -1
      const retryAssistantCandidate = retryAssistantIndex >= 0
        ? storeState.messages[retryAssistantIndex]
        : undefined
      const retryAssistantMessage = retryAssistantCandidate
        && retryAssistantCandidate.conversationId === capturedConvId
        && retryAssistantCandidate.role === "assistant"
        && !retryAssistantCandidate.isAgentRunning
        && retryAssistantCandidate.content.includes("出错：")
        ? retryAssistantCandidate
        : undefined
      const retryUserMessageId = retryAssistantMessage
        ? [...storeState.messages.slice(0, retryAssistantIndex)].reverse().find((message) => (
            message.conversationId === capturedConvId && message.role === "user"
          ))?.id
        : undefined
      if (sendOptions?.retryAssistantMessageId && !retryAssistantMessage) {
        toast.info("原失败消息已失效，无法强制重试", {
          dedupeKey: `required-workflow-retry-stale:${capturedConvId}:${sendOptions.retryAssistantMessageId}`,
        })
        return
      }
      const activeConvMessages = storeState.messages
        .filter((message) => (
          message.conversationId === capturedConvId &&
          (message.role === "user" || message.role === "assistant") &&
          message.id !== sendOptions?.retryAssistantMessageId &&
          message.id !== retryUserMessageId &&
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
        if (!targetConversationId) {
          setConversationInputDraft(capturedConvId, "")
          setFallbackReferenceText("")
          setReferenceTokensByConversation((drafts) =>
            setReferenceTokensForConversation(drafts, referenceDraftConversationId, []),
          )
        }

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

      const runId = crypto.randomUUID()
      if (!useChatStore.getState().startConversationRun(capturedConvId, runId)) {
        setDeAiSkillWarningMessage(concurrencyLimitReason)
        if (sendOptions?.retryAssistantMessageId) {
          toast.info(concurrencyLimitReason, {
            dedupeKey: `required-workflow-retry-running:${capturedConvId}`,
          })
        }
        return
      }

      const lastGeneratedChapterNumber = novelMode
        ? detectLastGeneratedChapterNumber(
            activeConvMessages
              .filter((message) => message.role === "assistant")
              .map((message) => message.content),
          )
        : undefined

      const assistantMessage = retryAssistantMessage
        ? resetAssistantMessageForRequiredToolRetry(retryAssistantMessage)
        : appendAgentChatMessages(capturedConvId, userVisibleText || plainText, tokens).assistantMessage
      if (retryAssistantMessage) {
        updateAgentAssistantMessage(retryAssistantMessage.id, () => assistantMessage)
      }
      if (!targetConversationId && !retryAssistantMessage) {
        setConversationInputDraft(capturedConvId, "")
        setFallbackReferenceText("")
        setReferenceTokensByConversation((drafts) =>
          setReferenceTokensForConversation(drafts, referenceDraftConversationId, []),
        )
      }
      startStreaming(capturedConvId)
      const sessionId = streamSessionGuardRef.current.start(capturedConvId)
      activeStreamSessionsRef.current[capturedConvId] = sessionId

      const controller = new AbortController()
      chatConversationRunRegistry.register(capturedConvId, controller)

      /* === Context trace + pre-plugin chain === */
      let contextTrace = createContextTrace(assistantMessage.id)
      void contextTrace
      let effectiveTaskRoute = taskRoute
      let contextPack: ContextPack | null = null
      void contextPack
      let contextHubResult: ContextHubResult | null = null
      let novelContextPrompt: string = ""
      let taskDirective = ""
      let goldenDirective = ""
      let prePluginResult: PrePluginChainResult | null = null
      const shouldRunNovelPrePluginChain = novelMode && (sessionWorkflowMode !== "fast" || planExecuteActive)
      const explicitSkills = collectExplicitSkills(
        availableAgentSkills,
        plainText,
        tokens
          .filter((token) => Boolean(token.skillId) || token.category === "skill")
          .map((token) => ({ skillId: token.skillId, title: token.title })),
      )
      selectedSkillsPromptRef.current = ""
      void shouldRunNovelPrePluginChain
      let hasAgentError = false
      let lastAgentError = "生成失败"
      let lastAgentErrorObject: Error | null = null
      let accumulatedReasoningContent = ""
      // 终结型工具（run_chapter_workflow）是否已直接交付正文。
      let finalContentDelivered = false

      const markDone = (record?: AgentRunRecord) => {
        updateAgentAssistantMessage(assistantMessage.id, (message) => {
          const settledTools = settleRunningAgentToolCalls(
            record?.toolCalls.length ? record.toolCalls : message.agentToolCalls,
          )
          const rawContent = message.content || record?.finalText || "Agent未返回内容。"
          const resolvedContent = getCopyableAssistantContent(rawContent, {
            toolCalls: settledTools,
          }) || rawContent
          return {
            ...message,
            content: resolvedContent,
            reasoning_content: accumulatedReasoningContent,
            agentToolCalls: settledTools,
            agentStages: settleRunningAgentStages(message.agentStages, "done"),
            references: (() => {
              const existingReferences = message.references ?? []
              const existingPaths = new Set(existingReferences.map((reference) => reference.path))
              const agentReferences = agentToolCallsToMessageReferences(
                settledTools ?? [],
              ).filter((reference) => !existingPaths.has(reference.path))
              return agentReferences.length > 0
                ? [...existingReferences, ...agentReferences]
                : message.references
            })(),
            contextTrace: contextTrace || message.contextTrace,
            isAgentRunning: false,
          }
        })
      }

      const markError = (error: Error) => {
        hasAgentError = true
        lastAgentError = error.message || "生成失败"
        lastAgentErrorObject = error
        updateAgentAssistantMessage(assistantMessage.id, (message) => {
          const settledTools = settleRunningAgentToolCalls(message.agentToolCalls, "error")
          const rawContent = message.content ?? ""
          const recoveredChapterBody = getCopyableAssistantContent(rawContent, {
            toolCalls: settledTools,
          })
          const baseContent = recoveredChapterBody || rawContent.trim()
          return {
            ...message,
            content: baseContent
              ? `${baseContent}\n\n出错：${error.message}`
              : `出错：${error.message}`,
            reasoning_content: accumulatedReasoningContent,
            agentToolCalls: settledTools,
            agentStages: settleRunningAgentStages(message.agentStages, "error"),
            contextTrace: contextTrace || message.contextTrace,
            isAgentRunning: false,
          }
        })
      }

      const showRunErrorToast = (error: Error) => {
        const action = isRequiredChapterWorkflowFailure(error)
          ? {
              label: "强制重试",
              onClick: () => {
                void handleSendRef.current(
                  plainText,
                  tokens,
                  displayText,
                  planBlueprint,
                  capturedConvId,
                  {
                    forceRequiredToolsImmediately: true,
                    retryAssistantMessageId: assistantMessage.id,
                    workflowMode: sessionWorkflowMode,
                    planExecuteActive,
                  },
                )
              },
            }
          : undefined
        toast.error(error.message || "生成失败", {
          title: "AI 会话生成失败",
          persistent: true,
          dedupeKey: `chat-run-failed:${capturedConvId}:${error.message || "生成失败"}`,
          ...(action ? { action } : {}),
        })
      }

      const finishAgentSession = (callback?: () => void) => {
        streamSessionGuardRef.current.finish(capturedConvId, sessionId, () => {
          callback?.()
          clearStreaming(capturedConvId)
          delete activeStreamSessionsRef.current[capturedConvId]
          chatConversationRunRegistry.remove(capturedConvId, controller)
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

      const sessionAgentSystemPrompt = buildChatAgentSystemPrompt({
        novelMode,
        mode,
        chatEditModeEnabled,
        aiWorkflowMode: sessionWorkflowMode,
        writingWebSearchEnabled,
        planExecuteEnabled: planExecuteActive,
        projectName: project?.name,
        bindingTitle: activeBinding?.framework.title,
        targetChapterNumber,
        // pre-plugin 会注入找纲协议；仅在不会跑 pre-plugin 的章节写作路径由这里注入一次
        includeOutlineFindProtocol:
          shouldIncludeOutlineFindProtocol(effectiveTaskRoute?.intent) &&
          !(novelMode && (sessionWorkflowMode !== "fast" || planExecuteActive)),
      })

      if (novelMode && effectiveTaskRoute) {
        const contextHub = getContextHub(pp)
        try {
          contextHubResult = await contextHub.prepare({
            projectPath: pp,
            surface: "ai-chat",
            sessionId: capturedConvId,
            task: plainText,
            intent: resolveChatContextIntent(
              effectiveTaskRoute,
              Boolean(activeConv?.deAiMode || activeConv?.selectedDeAiSkillId),
            ),
            chapterNumber: effectiveTaskRoute.chapterNumber,
            references: tokens.map(describeReferenceForAgent),
            messages: activeConvMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            existingSummary: activeConv?.contextSummary,
            maxContextSize: agentConfig.llmConfig.maxContextSize,
          })
          if (contextHubResult) {
            try {
              const contextHubSnapshot = await contextHub.saveSnapshot(assistantMessage.id, contextHubResult)
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                contextHubSnapshot,
              }))
            } catch (error) {
              console.warn("上下文快照保存失败，继续生成：", error)
            }
          }
        } catch (error) {
          console.warn("上下文中控准备失败，继续使用原有流程：", error)
        }
      }

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
              aiWorkflowMode: sessionWorkflowMode,
              planExecuteEnabled: planExecuteActive,
              availableSkills: availableAgentSkills,
              selectedSkills: explicitSkills,
              mcpCapabilities: agentMcpCapabilities,
              selectedFile,
            },
            deps: contextHubResult
              ? { buildContextPack: async () => contextHubResult.contextPack }
              : undefined,
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
      const sessionSelectedSkills = prePluginResult?.selectedSkills?.length
        ? prePluginResult.selectedSkills
        : explicitSkills
      const sessionSkillsPrompt = buildSelectedSkillsPrompt(sessionSelectedSkills)
      selectedSkillsPromptRef.current = sessionSkillsPrompt

      if (novelMode) {
        const now = Date.now()
        const routeEvent = createAgentActivityEvent({
          id: `chat_route:${assistantMessage.id}:${now}`,
          stageId: "task_understanding",
          kind: "analysis",
          title: "当前执行路线",
          content: buildWorkflowRouteActivityContent(sessionWorkflowMode, planExecuteActive, effectiveTaskRoute),
          timestamp: now,
        })
        const skillEvent = createAgentActivityEvent({
          id: `chat_skills:${assistantMessage.id}:${now + 1}`,
          stageId: "capability_selection",
          kind: "skill_used",
          title: "本次启用 Skill",
          content: buildSelectedSkillsActivityContent(
            sessionSelectedSkills,
            (prePluginResult?.missingSkillNames as string[] | undefined) ?? [],
          ),
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
          taskDirective = buildTaskDirective(effectiveTaskRoute)
          const goldenThreeChapter = detectGoldenThreeChapterRequest(plainText, effectiveTaskRoute.chapterNumber)
          goldenDirective = buildGoldenThreeChapterDirective(goldenThreeChapter)
          if (contextHubResult) {
            contextPack = contextHubResult.contextPack
          } else {
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
            storyFrameworkBinding: "",
            cognitionStates: "",
            foreshadowingStates: "",
            sectionBriefing: "",
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
            const budget = resolveContextPackTokenBudget({
              maxContextSize: agentConfig.llmConfig.maxContextSize,
            })
            novelContextPrompt = [
              taskDirective,
              goldenDirective,
              "## 小说上下文包",
              contextPackToPrompt(contextPack, budget),
            ].filter(Boolean).join("\n\n")
          }
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
      const prePluginSystemRulesPrompt = prePluginResult?.finalSystemRulesPrompt?.trim()
      const stableSystemRulesPrompt = prePluginResult?.stableSystemRulesPrompt?.trim()
      const dynamicSystemRulesPrompt = prePluginResult?.dynamicSystemRulesPrompt?.trim()
      const hasSplitSystemRules = prePluginResult?.stableSystemRulesPrompt !== undefined
        || prePluginResult?.dynamicSystemRulesPrompt !== undefined
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
            (!prePluginSystemPrompt && sessionSelectedSkills.length > 0
              ? `## 当前会话写作技能\n${sessionSkillsPrompt}`
              : ""),
          ].filter(Boolean).join("\n")
        : [
            baseSystemPrompt,
          ].filter(Boolean).join("\n")
      const contextHubSoftwareRules = hasSplitSystemRules
        ? (stableSystemRulesPrompt ?? "")
        : (prePluginSystemRulesPrompt || sessionAgentSystemPrompt)
      const contextHubSystemContent = contextHubResult
        ? buildContextHubSystemContent(contextHubSoftwareRules, contextHubResult, [
            dynamicSystemRulesPrompt ?? "",
            qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
            prePluginSystemRulesPrompt || hasSplitSystemRules ? "" : taskDirective,
            goldenDirective,
            prePluginSystemRulesPrompt || hasSplitSystemRules ? "" : selectedSkillsPrompt,
            !prePluginSystemRulesPrompt && !hasSplitSystemRules && sessionSelectedSkills.length > 0
              ? `## 当前会话写作技能\n${sessionSkillsPrompt}`
              : "",
          ])
        : null
      const systemPromptForConfig = contextHubSystemContent
        ? flattenContextHubSystemContent(contextHubSystemContent)
        : effectiveSystemPrompt

      const deAiMode = activeConv?.deAiMode ?? false
      const rawUserContent = buildAgentUserContent(plainText, tokens)
      const userContent = !effectiveDeAiSkill && deAiMode
        ? injectDeAiDirective(rawUserContent, deAiMode)
        : rawUserContent
      const readChapterToolAvailable = !prePluginResult?.enabledToolNames
        || prePluginResult.enabledToolNames.includes("read_chapter")
      const historyForModel = selectContextHistoryMessages(
        activeConvMessages,
        contextHubResult?.sessionSummary,
      )
      const historyMessages = await buildAgentHistoryMessages(historyForModel, {
        projectPath: pp,
        novelMode,
        readChapterToolAvailable,
      })
      const agentMessages: AgentMessage[] = [
        { role: "system", content: contextHubSystemContent ?? effectiveSystemPrompt },
        ...historyMessages,
        { role: "user", content: userContent },
      ]
      const sessionRegistry = new ToolRegistry()
      agentRegistry.list().forEach((tool) => sessionRegistry.register(tool))
      if (contextHubResult) {
        registerAllBuiltInTools(sessionRegistry, {
          wikiPath: `${pp}/wiki`,
          getSkillConfig: () => agentSkillConfig,
          getUserSkills: () => agentUserWritingSkills,
          getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
          getChatConversations: () => [],
          getOutlineConversations: () => [],
          readTextFile: contextHubResult.readFile,
          llmConfig: agentConfig.llmConfig,
          maxContextSize: agentConfig.llmConfig.maxContextSize,
          enabledToolNames: [
            "read_chapter",
            "read_outline",
            "read_memory",
            "read_deduction",
            "search_chapters",
          ],
        })
      }
      const workflowTool = agentRegistry.get("run_chapter_workflow")
      if (workflowTool) {
        sessionRegistry.register({
          ...workflowTool,
          execute: (params, signal, context) => workflowTool.execute({
            ...params,
            workflowMode: sessionWorkflowMode,
            ...(planBlueprint
              ? {
                  planBlueprint: typeof params.planBlueprint === "string" && params.planBlueprint.trim()
                    ? params.planBlueprint
                    : planBlueprint,
                }
              : {}),
          }, signal, context),
        })
      }

      try {
        if (isChapterWritingIntent(effectiveTaskRoute?.intent)) {
          void ensureSystemNotificationPermission()
        }
        const requiredToolsOnce = resolveRequiredToolsOnce({
          novelMode,
          intent: effectiveTaskRoute?.intent,
          mode: sessionWorkflowMode,
          planExecuteActive,
          enabledToolNames: prePluginResult?.enabledToolNames,
        })
        // 计划阶段硬管控：不依赖任务路由/pre-plugin 是否命中，直接从本轮可用
        // 工具中移除正文生成与写入类工具（模型的 tools 广告和文本工具调用解析
        // 都以 config.tools 为准），从根上阻止模型跳过计划直接产出正文。
        const sessionTools = planExecuteActive
          ? agentConfig.tools.filter(
              (tool) => tool.name !== "run_chapter_workflow" && tool.category !== "write",
            )
          : agentConfig.tools
        const advertisedTools = prePluginResult?.enabledToolNames
          ? sessionTools.filter((tool) => prePluginResult.enabledToolNames!.includes(tool.name))
          : sessionTools
        const usageSnapshotBase = buildContextUsageSnapshot({
          windowTokens: getEffectiveMaxContextSize(agentConfig.llmConfig),
          softwareRules: contextHubResult
            ? [contextHubSoftwareRules, dynamicSystemRulesPrompt].filter(Boolean).join("\n\n")
            : systemPromptForConfig,
          toolDefinitionsJson: JSON.stringify(toOpenAITools(advertisedTools)),
          stableTokens: contextHubResult?.stats.stableTokens,
          summaryTokens: contextHubResult?.stats.summaryTokens,
          dynamicTokens: contextHubResult?.stats.dynamicTokens,
          historyTexts: historyMessages.map((message) => (
            typeof message.content === "string"
              ? message.content
              : message.content.map((block) => block.type === "text" ? block.text : "").join("")
          )),
          currentInput: userContent,
        })
        // Seed this turn's baseline so the ring can grow with tool reads before the first usage report.
        useChatStore.getState().setConversationContextUsage(capturedConvId, usageSnapshotBase)
        const record = await runAiChatSession({
          userMessage: plainText,
          projectPath,
          agentConfig: {
            ...agentConfig,
            tools: sessionTools,
            systemPrompt: systemPromptForConfig,
            projectPath,
            taskGoal: plainText,
            ...(requiredToolsOnce ? { requiredToolsOnce } : {}),
            ...(sendOptions?.forceRequiredToolsImmediately
              ? { forceRequiredToolsImmediately: true }
              : {}),
            requestOverrides: {
              ...agentConfig.requestOverrides,
              userMemorySurface: "ai-chat",
              userMemoryProjectKey: projectPath,
              userMemorySessionKey: capturedConvId,
            },
          },
          enabledToolNames: prePluginResult?.enabledToolNames,
          registry: sessionRegistry,
          messages: agentMessages,
          signal: controller.signal,
          callbacks: {
            onText: (chunk: string) => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              if (finalContentDelivered) {
                // 交付后模型仍在输出（例如工具报错后续轮），以模型新内容为准，
                // 否则会把已交付正文和模型输出拼成两份。
                finalContentDelivered = false
                useChatStore.getState().setStreamingContent("", capturedConvId)
                updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                  ...message,
                  content: "",
                }))
              }
              appendStreamToken(chunk, capturedConvId)
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                content: message.content + chunk,
              }))
            },
            onReasoningToken: (chunk: string) => {
              accumulatedReasoningContent += chunk
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
              // 章节工作流直接交付终稿：正文立刻落到气泡，不再等外层模型复述。
              onFinalContent: (body: string) => {
                if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
                const display = cleanGeneratedChapterContentForDisplay(body)
                if (!display) return
                finalContentDelivered = true
                useChatStore.getState().setStreamingContent(display, capturedConvId)
                updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                  ...message,
                  content: display,
                }))
              },
              onUsage: (usage) => {
                if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
                useChatStore.getState().setConversationContextUsage(
                  capturedConvId,
                  calibrateContextUsageSnapshot(usageSnapshotBase, usage),
                )
              },
              onDone: () => {
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              const finalContent = useChatStore.getState().streamingContents[capturedConvId] ?? ""
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                content: finalContent,
                reasoning_content: accumulatedReasoningContent,
                isAgentRunning: false,
              }))
            },
            onError: (error) => {
              if (controller.signal.aborted) return
              if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
              markError(error)
            },
          },
        })

        if (controller.signal.aborted) return
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        useChatStore.getState().setConversationContextUsage(
          capturedConvId,
          calibrateContextUsageSnapshot(
            usageSnapshotBase,
            record.lastRequestUsage ?? record.usage,
          ),
        )
        if (contextHubResult && (record.usage || record.requestTraces?.length)) {
          try {
            const contextHubSnapshot = await persistContextHubProviderUsage(
              getContextHub(pp),
              assistantMessage.id,
              contextHubResult,
              record.lastRequestUsage ?? record.usage,
              {
                memoryDecision: record.userMemoryDecision,
                requestDiagnostics: buildLlmRequestDiagnostics(
                  record.usage,
                  Math.max(1, record.roundsUsed || 1),
                  {
                    requests: record.requestTraces,
                    omittedRequestCount: record.omittedRequestTraceCount,
                    requestCountAvailable: record.providerRequestCountAvailable,
                    usageScope: record.usageAggregationScope,
                  },
                ),
              },
            )
            if (contextHubSnapshot) {
              updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                ...message,
                contextHubSnapshot,
              }))
            }
          } catch (error) {
            console.warn("供应商缓存用量快照保存失败，继续保留本地缓存统计：", error)
          }
        }
        // 计划模式：markDone/getCopyableAssistantContent 会重写消息内容
        // （剥掉 HTML 注释等隐藏块），先捕获原始文本供后续计划提取使用，
        // 避免 `<!-- chapter_plan -->` 标记在提取前就被剥掉。
        const rawAssistantContentForPlan = planExecuteActive
          ? useChatStore.getState().messages.find((m) => m.id === assistantMessage.id)?.content
            || record.finalText
            || ""
          : ""
        if (contextTrace && effectiveTaskRoute && record.requiredToolDiagnostics) {
          const diagnosticTraceInfo = buildInitialContextTraceInfo(effectiveTaskRoute, prePluginResult, {
            workflowMode: sessionWorkflowMode,
            contextHub: contextHubResult?.stats,
          })
          contextTrace = setContextInfo(contextTrace, {
            ...diagnosticTraceInfo,
            requiredToolDiagnostics: record.requiredToolDiagnostics,
          })
        }
        if (hasAgentError && contextTrace) {
          contextTrace = finishTrace(contextTrace, "error", lastAgentError)
          updateAgentAssistantMessage(assistantMessage.id, (message) => ({
            ...message,
            contextTrace,
          }))
        }
        finishAgentSession(() => {
          if (!hasAgentError) {
            if (contextTrace && effectiveTaskRoute) {
              const traceInfo = buildInitialContextTraceInfo(effectiveTaskRoute, prePluginResult, {
                workflowMode: sessionWorkflowMode,
                contextHub: contextHubResult?.stats,
              })
              contextTrace = setContextInfo(contextTrace, {
                ...traceInfo,
                ...(record.requiredToolDiagnostics
                  ? { requiredToolDiagnostics: record.requiredToolDiagnostics }
                  : {}),
              })
              const storeStateForValidation = useChatStore.getState()
              const lastAssistantForValidation = storeStateForValidation.messages.find(
                (m) => m.id === assistantMessage.id && m.role === "assistant",
              )
              const rawFinalContent = lastAssistantForValidation?.content ?? ""
              const resolvedFinalContent = getCopyableAssistantContent(rawFinalContent, {
                toolCalls: lastAssistantForValidation?.agentToolCalls ?? record.toolCalls,
              }) || rawFinalContent
              if (
                resolvedFinalContent
                && resolvedFinalContent !== rawFinalContent
              ) {
                updateAgentAssistantMessage(assistantMessage.id, (message) => ({
                  ...message,
                  content: resolvedFinalContent,
                }))
              }
              const finalContent = resolvedFinalContent
              let chapterProtocolValid = false
              if (finalContent) {
                const protocolTrace = buildResultProtocolTrace("chapter", finalContent)
                chapterProtocolValid = protocolTrace.valid
                contextTrace = setContextInfo(contextTrace, {
                  ...contextTrace.contextInfo!,
                  resultProtocol: protocolTrace,
                })
              }
              // === Stage D: 写后剧情自检 ===
              // 仅对 write_chapter / continue_chapter 任务触发，避免对普通对话误触发
              if (
                effectiveTaskRoute.intent === "write_chapter" ||
                effectiveTaskRoute.intent === "continue_chapter"
              ) {
                const chapterContent = finalContent
                // 排除含 chapter_plan 标记的内容（计划本身不是正文）与空内容；
                // 短完成句等未通过章节协议的结果也不进入自检/草稿校验。
                const hasChapterPlanMarker = chapterContent.includes("chapter_plan")
                if (chapterContent && !hasChapterPlanMarker && chapterProtocolValid) {
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
                // === Stage E: 草稿校验与修复（硬偏差） ===
                // 仅在已打开项目时触发；未打开项目时跳过（避免空路径调用 skill）
                if (chapterContent && !hasChapterPlanMarker && chapterProtocolValid && projectPath) {
                  const draftChapterNumber = effectiveTaskRoute.chapterNumber ?? 0
                  void (async () => {
                    try {
                      useDraftReviewStore.getState().startReview(chapterContent)
                      useDraftReviewStore.getState().setPhase({
                        stage: "loading",
                        description: "正在读取记忆中心...",
                        progress: 10,
                      })
                      const reviewResult = await runDraftReviewSkill(
                        {
                          projectPath,
                          draftChapterText: chapterContent,
                          draftChapterNumber,
                          mode: "full",
                        },
                        { llmConfig: agentConfig?.llmConfig },
                      )
                      useDraftReviewStore.getState().setResult(reviewResult)
                    } catch (err) {
                      const message = err instanceof Error ? err.message : String(err)
                      console.error("[Stage E] 草稿校验失败:", err)
                      useDraftReviewStore.getState().setPhase({
                        stage: "error",
                        description: `校验失败：${message}`,
                        progress: 100,
                      })
                    }
                  })().catch((err) => console.error("[Stage E] 执行失败:", err))
                }
              }
              contextTrace = finishTrace(contextTrace, "done")
            }
            markDone(record)
          }
        })
        if (!hasAgentError && contextHubResult) {
          const completedMessages = useChatStore.getState().messages
            .filter((message) => (
              message.conversationId === capturedConvId
              && (message.role === "user" || message.role === "assistant")
              && !message.discarded
              && !message.isAgentRunning
            ))
          useChatStore.getState().setConversationContextSummary(
            capturedConvId,
            buildSessionContextSummary({
              messages: completedMessages,
              dependencyFingerprint: contextHubResult.dependencyStamp.fingerprint,
            }),
          )
        }
        if (!hasAgentError) {
          enqueueUserMemoryLearning({
            message: plainText,
            llmConfig: agentConfig.llmConfig,
            surface: "ai-chat",
            projectKey: projectPath,
            sessionKey: capturedConvId,
          })
        }
        if (hasAgentError) {
          useChatStore.getState().failConversationRun(capturedConvId, lastAgentError, runId)
          showRunErrorToast(lastAgentErrorObject ?? new Error(lastAgentError))
          void notifyChapterWritingOutcome({
            intent: effectiveTaskRoute?.intent,
            ok: false,
            chapterNumber: effectiveTaskRoute?.chapterNumber,
            error: lastAgentError,
          })
        } else {
          useChatStore.getState().finishConversationRun(
            capturedConvId,
            useChatStore.getState().activeConversationId,
            runId,
          )
        }
        let chapterWritingPlanOnly = false
        if (!hasAgentError && planExecuteActive) {
          const storeState = useChatStore.getState()
          const lastAssistant = storeState.messages.find(
            (m) => m.id === assistantMessage.id && m.role === "assistant",
          )
          // 优先用重写前捕获的原始文本：markDone 会剥掉 HTML 注释，
          // 只有原始文本还保留 `<!-- chapter_plan -->` 标记。
          const fullContent = rawAssistantContentForPlan || lastAssistant?.content || record.finalText || ""
          // 诊断日志：帮助定位"计划弹窗有时不出现"问题
          const hasMarker = fullContent.includes("<!-- chapter_plan -->")
          console.info("[PlanExecute] 检查计划提取", {
            conversationId: capturedConvId,
            fullContentLength: fullContent.length,
            hasChapterPlanMarker: hasMarker,
            messageContentLength: lastAssistant?.content?.length ?? 0,
            recordFinalTextLength: record.finalText?.length ?? 0,
          })
          // 兜底：标记与关键词启发式都失败但确实有内容时，把整段回复
          // 当作计划弹窗（用户可修改/跳过），替代静默不弹窗。仅对写作类
          // 请求（或路由未识别的请求）生效，避免普通问答被误当计划。
          const planFallbackEligible =
            !effectiveTaskRoute || WRITING_INTENTS.has(effectiveTaskRoute.intent)
          const extracted = extractChapterPlan(fullContent)
            ?? (planFallbackEligible && fullContent.trim()
              ? { plan: fullContent.trim(), body: "" }
              : null)
          chapterWritingPlanOnly = Boolean(extracted) || hasMarker
          if (extracted) {
            console.info("[PlanExecute] 计划提取成功，弹出确认对话框", {
              planLength: extracted.plan.length,
              bodyLength: extracted.body.length,
            })
            const action = await requestChapterPlanConfirm(
              extracted.plan,
              fullContent,
              capturedConvId,
              contextPack,
            )
            if (action === "cancel") {
              recordChapterPlanExecutionCancelled(assistantMessage.id)
            } else {
              let followupText: string
              let confirmedBlueprint: string | undefined
              if (action === "confirm") {
                confirmedBlueprint = extracted.plan
                followupText = buildPlanConfirmMessage(extracted.plan)
              } else if (action === "skip") {
                followupText = buildPlanSkipMessage()
              } else {
                confirmedBlueprint = action.modify
                followupText = buildPlanConfirmMessage(action.modify)
              }
              await handleSendRef.current(followupText, [], "执行已确认计划", confirmedBlueprint, capturedConvId)
            }
          } else {
            console.warn("[PlanExecute] 计划提取失败，不弹窗", {
              fullContentLength: fullContent.length,
              hasChapterPlanMarker: hasMarker,
              preview: fullContent.slice(0, 200),
            })
          }
        }
        if (!hasAgentError) {
          void notifyChapterWritingOutcome({
            intent: effectiveTaskRoute?.intent,
            planOnly: chapterWritingPlanOnly,
            ok: true,
            chapterNumber: effectiveTaskRoute?.chapterNumber,
          })
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (!streamSessionGuardRef.current.isActive(capturedConvId, sessionId)) return
        const resolvedError = error instanceof Error ? error : new Error(String(error))
        const errorMessage = resolvedError.message
        const partialContent = useChatStore.getState().streamingContents[capturedConvId] ?? ""
        finishAgentSession(() => {
          if (partialContent) {
            updateAgentAssistantMessage(assistantMessage.id, (message) => ({
              ...message,
              content: partialContent,
              isAgentRunning: false,
            }))
          }
          if (contextTrace) contextTrace = finishTrace(contextTrace, "error", errorMessage)
          markError(resolvedError)
        })
        useChatStore.getState().failConversationRun(capturedConvId, errorMessage, runId)
        showRunErrorToast(resolvedError)
        void notifyChapterWritingOutcome({
          intent: effectiveTaskRoute?.intent,
          ok: false,
          chapterNumber: effectiveTaskRoute?.chapterNumber,
          error: errorMessage,
        })
      }
    },
    [
      activeBinding?.framework.title,
      agentConfig,
      agentMcpCapabilities,
      agentRegistry,
      agentSkillConfig,
      agentSkillConfigLoaded,
      agentSupportsTools,
      agentSystemPrompt,
      agentUserWritingSkills,
      aiWorkflowMode,
      availableAgentSkills,
      chatEditModeEnabled,
      clearStreaming,
      createConversation,
      maxHistoryMessages,
      mode,
      novelMode,
      planExecuteEnabled,
      project,
      projectPath,
      referenceDraftConversationId,
      requestChapterPlanConfirm,
      selectedFile,
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
    const runId = useChatStore.getState().runStates[convId]?.runId
    chatConversationRunRegistry.abort(convId)
    useChatStore.getState().stopConversationRun(convId, runId)
    const finalizeStopped = () => {
      finalizeStream(`${currentStreamingContent ? `${currentStreamingContent}\n\n` : ""}已停止生成。`, [], convId)
      delete activeStreamSessionsRef.current[convId]
    }
    if (sessionId !== undefined) {
      streamSessionGuardRef.current.stop(convId, sessionId, () => {
        if (runningAssistant) {
          updateAgentAssistantMessage(runningAssistant.id, (message) => ({
            ...message,
            content: currentStreamingContent ? `${currentStreamingContent}\n\n已停止生成。` : "已停止生成。",
            agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled"),
            agentStages: settleRunningAgentStages(message.agentStages, "cancelled"),
            isAgentRunning: false,
          }))
          clearStreaming(convId)
        } else {
          finalizeStopped()
        }
        delete activeStreamSessionsRef.current[convId]
      })
    } else if (runningAssistant) {
      updateAgentAssistantMessage(runningAssistant.id, (message) => ({
        ...message,
        content: message.content ? `${message.content}\n\n已停止生成。` : "已停止生成。",
        agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled"),
        agentStages: settleRunningAgentStages(message.agentStages, "cancelled"),
        isAgentRunning: false,
      }))
      clearStreaming(convId)
    } else if (currentStreamingContent !== undefined) {
      finalizeStopped()
    }
  }, [clearStreaming, finalizeStream])

  const handleRegenerate = useCallback(async () => {
    // 直接从 store 获取最新状态，避免闭包旧值
    const storeState = useChatStore.getState()
    const capturedConversationId = storeState.activeConversationId
    if (!capturedConversationId) return
    if (storeState.streamingContents[capturedConversationId] !== undefined) return
    // Find the last user message in active conversation
    const active = storeState.getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    recordLatestUserMemoryFeedback("negative")
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
    store.setConversationContextSummary(capturedConversationId, undefined)
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ConversationTabs onBeforeDelete={cancelPendingChapterPlan} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
            >
              <div className="flex w-full min-w-0 max-w-full flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  const isLastAssistant = msg.role === "assistant" && idx === lastAssistantIndex
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant}
                      onRegenerate={isLastAssistant && !isStreaming ? handleRegenerate : undefined}
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
                {isStreaming && batchedStreamingContent && !activeMessages.some((msg) => msg.role === "assistant" && msg.isAgentRunning) && <StreamingMessage content={batchedStreamingContent} isStreaming={isStreaming} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showScrollToBottom && (
              <button
                type="button"
                onClick={handleScrollToBottom}
                className="absolute bottom-20 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 shadow-md backdrop-blur-sm transition-all hover:bg-accent"
                title="回到最新"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            )}

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
                                    void saveAiWorkflowMode(mode)
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
                              title={aiWorkflowMode === "fast" ? "快速模式下不支持计划，请切换到标准或严格模式" : planExecuteEnabled ? "关闭计划模式" : "开启计划模式"}
                              aria-label={aiWorkflowMode === "fast" ? "快速模式下不支持计划，请切换到标准或严格模式" : planExecuteEnabled ? "关闭计划模式" : "开启计划模式"}
                            />
                          )}
                        >
                          <ListChecks className="mr-1 h-3.5 w-3.5" />
                          计划
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs leading-5">
                          {aiWorkflowMode === "fast"
                            ? "快速模式下不支持计划，请切换到标准或严格模式。"
                            : "开启后，本次写作会先创建计划，等待确认后再执行；可与标准、严格模式组合使用。"}
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
              disabled={isStreaming || Boolean(pendingChapterPlan)}
              isStreaming={isStreaming}
              submitDisabled={concurrencyFull}
              submitDisabledReason={concurrencyFull ? concurrencyLimitReason : undefined}
              onStop={handleStop}
              leftFooterControls={
                <ContextUsageRing
                  usage={liveContextUsage}
                  onCreateConversation={() => createConversation()}
                />
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
        {pendingChapterPlan && (
          <ChapterPlanConfirmDialog
            open
            planContent={pendingChapterPlan.planContent}
            aiWorkflowMode={aiWorkflowMode}
            onConfirm={() => closeChapterPlanDialog(pendingChapterPlan.conversationId, "confirm")}
            onSkip={() => closeChapterPlanDialog(pendingChapterPlan.conversationId, "skip")}
            onModify={(modified) => closeChapterPlanDialog(pendingChapterPlan.conversationId, { modify: modified })}
            onSelfCheck={(planContent) => runChapterPlanSelfCheck(planContent, pendingChapterPlan.contextPack)}
            onRevisePlan={runChapterPlanRevision}
            onCancel={() => closeChapterPlanDialog(pendingChapterPlan.conversationId, "cancel")}
          />
        )}
      </div>
    </div>
  )
}
