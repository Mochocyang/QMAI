import { runAiChatSession } from "@/lib/agent/ai-chat-session"
import { buildAgentConfig } from "@/lib/agent/config"
import { runNovelPrePluginChain } from "@/lib/agent/novel-pre-plugin-chain"
import { resolveRequiredToolsOnce } from "@/lib/agent/required-tools-gate"
import { ToolRegistry } from "@/lib/agent/registry"
import { runDeepChapterGeneration } from "@/lib/novel/deep-chapter-generation"
import { routeTask } from "@/lib/novel/task-router"
import { loadDeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import { loadAllLinkedSkillsContent, loadUserSkillConfig, resolveEnabledWritingSkills } from "@/lib/novel/user-skill-store"
import { deriveConversationTitle } from "@/lib/conversation-title"
import { loadChatHistory, saveChatHistory } from "@/lib/persist"
import { normalizePath } from "@/lib/path-utils"
import { useChatStore, type Conversation, type DisplayMessage } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { ConversationRunStates } from "@/lib/conversation-run-state"
import { isWritingStopped, STOPPED_GENERATION_TEXT, writingRunRegistry } from "./stop-writing"
import { resolveWritingParameters, type ResolvedWritingParameters } from "./writing-parameters"

export interface WritingSessionContext extends ResolvedWritingParameters {
  projectPath: string
  conversationId: string
  message: string
  history: Array<{ role: string; content: string }>
  signal?: AbortSignal
}

interface ChatSnapshot {
  conversations: Conversation[]
  messages: DisplayMessage[]
  runStates: ConversationRunStates
}

export interface WritingConversationDeps {
  runSession?: (ctx: WritingSessionContext) => Promise<string>
  loadHistory?: (projectPath: string) => Promise<ChatSnapshot>
  saveHistory?: (
    projectPath: string,
    conversations: Conversation[],
    messages: DisplayMessage[],
    runStates: ConversationRunStates,
  ) => Promise<void>
  readLive?: () => { projectPath: string | null } & ChatSnapshot | null
  writeLive?: (data: { conversations: Conversation[]; messages: DisplayMessage[]; activeConversationId: string }) => void
}

const activeProjects = new Set<string>()

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function defaultReadLive(): { projectPath: string | null } & ChatSnapshot | null {
  const projectPath = useWikiStore.getState().project?.path ?? null
  if (!projectPath) return null
  const chat = useChatStore.getState()
  return {
    projectPath,
    conversations: chat.conversations,
    messages: chat.messages,
    runStates: chat.runStates,
  }
}

async function runDefaultSession(ctx: WritingSessionContext): Promise<string> {
  if (ctx.signal?.aborted) throw new Error("操作已取消")
  const projectPath = ctx.projectPath
  const [skillConfig, writingSkills] = await Promise.all([
    loadDeAiSkillConfig(projectPath).catch(() => null),
    loadUserSkillConfig(projectPath)
      .then((config) => loadAllLinkedSkillsContent(config))
      .then(resolveEnabledWritingSkills)
      .catch(() => []),
  ])
  const registry = new ToolRegistry()
  const novelMode = useWikiStore.getState().novelMode
  const taskRoute = routeTask(ctx.message)
  const agentConfig = buildAgentConfig(ctx.agentLlm.model, "你是青幕写作的写作对话助手。", registry, {
    wikiPath: `${normalizePath(projectPath)}/wiki`,
    projectPath: normalizePath(projectPath),
    llmConfig: ctx.agentLlm,
    chapterWritingLlmConfig: ctx.chapterWritingLlm,
    aiWorkflowMode: ctx.workflowMode,
    draftMode: novelMode,
    maxContextSize: ctx.agentLlm.maxContextSize,
    getSkillConfig: () => skillConfig,
    getUserSkills: () => writingSkills,
    getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
    getChatConversations: () => [],
    getOutlineConversations: () => [],
    disabledTools: ["write_chapter", "write_outline_node", "write_memory"],
    runDeepChapterGeneration,
  })
  const prePlugin = await runNovelPrePluginChain({
    input: {
      userMessage: ctx.message,
      projectPath,
      agentConfig,
      novelMode,
      taskRoute,
      effectiveTaskRoute: taskRoute,
      aiWorkflowMode: ctx.workflowMode,
      availableSkills: writingSkills,
    },
  }).catch(() => null)
  if (ctx.signal?.aborted) throw new Error("操作已取消")
  if (prePlugin?.shouldStop) {
    return prePlugin.finalSystemPrompt?.trim() || "需要补充信息后才能继续这次写作对话。"
  }
  const requiredToolsOnce = resolveRequiredToolsOnce({
    novelMode,
    intent: taskRoute.intent,
    mode: ctx.workflowMode,
    planExecuteActive: false,
    enabledToolNames: prePlugin?.enabledToolNames,
  })
  const systemPrompt = prePlugin?.finalSystemPrompt?.trim() || agentConfig.systemPrompt
  let reply = ""
  const record = await runAiChatSession({
    userMessage: ctx.message,
    projectPath,
    agentConfig: {
      ...agentConfig,
      systemPrompt,
      projectPath,
      taskGoal: ctx.message,
      ...(requiredToolsOnce ? { requiredToolsOnce } : {}),
    },
    enabledToolNames: prePlugin?.enabledToolNames,
    registry,
    messages: [
      { role: "system", content: systemPrompt },
      ...ctx.history.map((message) => ({ role: message.role as "user" | "assistant" | "system", content: message.content })),
      { role: "user", content: ctx.message },
    ],
    callbacks: {
      onText: (chunk) => {
        reply += chunk
      },
      onDone: () => {},
      onError: (error) => {
        throw error
      },
    },
    signal: ctx.signal,
  })
  return (record.finalText || reply).trim() || "写作对话已完成，但没有返回正文。"
}

export async function runWritingConversation(input: {
  projectPath: string
  message: string
  conversationId?: string
  workflowMode?: unknown
  model?: unknown
  reasoningDepth?: unknown
}, deps: WritingConversationDeps = {}): Promise<string> {
  const message = input.message.trim()
  if (!message) throw new Error("写作对话内容不能为空")
  const projectPath = normalizePath(input.projectPath)
  if (activeProjects.has(projectPath)) throw new Error("当前项目已有进行中的写作对话")
  activeProjects.add(projectPath)
  const controller = new AbortController()
  writingRunRegistry.register(projectPath, controller)
  try {
    const parameters = resolveWritingParameters(input)
    const live = (deps.readLive ?? defaultReadLive)()
    const useLive = Boolean(live?.projectPath && normalizePath(live.projectPath) === projectPath)
    const loaded = useLive && live
      ? live
      : await (deps.loadHistory ?? loadChatHistory)(projectPath)
    if (Object.values(loaded.runStates).some((state) => state.status === "running")) {
      throw new Error("当前项目已有进行中的写作对话")
    }
    const conversations = loaded.conversations.map((conversation) => ({ ...conversation }))
    const messages = loaded.messages.map((item) => ({ ...item }))
    let conversation = input.conversationId
      ? conversations.find((item) => item.id === input.conversationId)
      : undefined
    if (input.conversationId && !conversation) throw new Error("找不到该写作对话")
    const now = Date.now()
    if (!conversation) {
      conversation = {
        id: createId(),
        title: deriveConversationTitle(message) || "写作对话",
        createdAt: now,
        updatedAt: now,
        deAiMode: false,
      }
      conversations.unshift(conversation)
    }
    const history = messages
      .filter((item) => item.conversationId === conversation.id && !item.discarded)
      .map((item) => ({ role: item.role, content: item.content }))
    const runSession = deps.runSession ?? runDefaultSession
    let reply: string
    try {
      reply = await runSession({
        ...parameters,
        projectPath,
        conversationId: conversation.id,
        message,
        history,
        signal: controller.signal,
      })
    } catch (error) {
      if (!isWritingStopped(error, controller.signal)) throw error
      reply = STOPPED_GENERATION_TEXT
    }
    if (controller.signal.aborted) reply = STOPPED_GENERATION_TEXT
    messages.push({
      id: createId(),
      role: "user",
      content: message,
      timestamp: now,
      conversationId: conversation.id,
    })
    messages.push({
      id: createId(),
      role: "assistant",
      content: reply,
      timestamp: Date.now(),
      conversationId: conversation.id,
    })
    conversation.updatedAt = Date.now()
    const saveHistory = deps.saveHistory ?? ((path, nextConversations, nextMessages, runStates) => (
      saveChatHistory(path, nextConversations, nextMessages, undefined, runStates)
    ))
    await saveHistory(projectPath, conversations, messages, loaded.runStates)
    if (useLive) {
      ;(deps.writeLive ?? ((data) => {
        useChatStore.setState({
          conversations: data.conversations,
          messages: data.messages,
          activeConversationId: data.activeConversationId,
        })
      }))({ conversations, messages, activeConversationId: conversation.id })
    }
    if (reply === STOPPED_GENERATION_TEXT) return STOPPED_GENERATION_TEXT
    return `写作对话已完成。\n会话：${conversation.id}\n模式：${parameters.workflowMode}\n模型：${parameters.chapterWritingLlm.model}\n\n${reply}`
  } finally {
    writingRunRegistry.remove(projectPath, controller)
    activeProjects.delete(projectPath)
  }
}
