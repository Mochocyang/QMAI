export const OUTLINE_CONTEXT_REUSE_DISABLED_TOOLS = [
  "read_chapter",
  "read_outline",
  "read_memory",
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "search_chapters",
  "list_chapters",
  "list_outlines",
  "list_memories",
  "list_deductions",
  "apply_skill",
] as const

export type OutlineContextReuseMode = "refresh" | "reuse"
export type OutlineContextPressureLevel = "low" | "medium" | "high"

export interface OutlineAgentHistoryMessage {
  role: "user" | "assistant" | "tool" | "system"
  content: string
}

export interface OutlineContextReuseInput {
  hasPriorAssistantAnswer: boolean
  attachedReferenceCount: number
  inputText: string
  enableMultiAgent?: boolean
  forceRefresh?: boolean
  /** 标记 prompt 由系统生成（如 buildGenerationPrompt），跳过关键词检测 */
  systemGenerated?: boolean
}

export interface OutlineContextReuseDecision {
  mode: OutlineContextReuseMode
  disabledTools: string[]
  instruction: string
  sourceLabel: string
  reason: string
}

export interface OutlineAgentHistoryInput {
  history: OutlineAgentHistoryMessage[]
  contextDecision: OutlineContextReuseDecision
  cachedSummary?: string
  summaryInSystem?: boolean
}

export interface OutlineAgentHistoryPlan {
  level: OutlineContextPressureLevel
  messages: OutlineAgentHistoryMessage[]
  instruction: string
  sources: string[]
  showThinkingProcess: boolean
  showToolProcess: boolean
  showToolProcessOnError: boolean
}

export interface OutlineContextBudgetInput {
  original: OutlineAgentHistoryMessage[]
  planned: OutlineAgentHistoryMessage[]
}

export interface OutlineContextBudget {
  originalTokens: number
  plannedTokens: number
  savedTokens: number
  compressionRatio: number
  label: string
}

const REFRESH_KEYWORD_PATTERN =
  /重新(读取|加载|分析|整理)|刷新(资料|上下文)|读取(项目|大纲|章纲|文件|资料|章节|记忆)|查看(项目|大纲|章纲|文件|资料|章节|记忆)|搜索|查找|引用|@/

export function planOutlineContextReuse(input: OutlineContextReuseInput): OutlineContextReuseDecision {
  const trimmed = input.inputText.trim()
  const shouldRefresh =
    !input.hasPriorAssistantAnswer ||
    input.forceRefresh === true ||
    input.enableMultiAgent === true ||
    input.attachedReferenceCount > 0 ||
    (!input.systemGenerated && REFRESH_KEYWORD_PATTERN.test(trimmed))

  if (shouldRefresh) {
    return {
      mode: "refresh",
      disabledTools: [],
      instruction: [
        "本轮允许按用户需求读取项目资料、调用 Skill 和使用必要工具。",
        "如果已经有足够上下文，不要重复读取无关文件。",
      ].join("\n"),
      sourceLabel: input.forceRefresh ? "强制刷新上下文" : "本轮将读取必要上下文",
      reason: refreshReason(input),
    }
  }

  return {
    mode: "reuse",
    disabledTools: [...OUTLINE_CONTEXT_REUSE_DISABLED_TOOLS],
    instruction: [
      "本轮是同一 AI 大纲会话的后续追问。",
      "请优先复用已有对话历史、上一轮最终结论和用户本轮新输入，不要重新读取项目资料、章节、大纲、记忆、推演、历史会话或 Skill。",
      "只有当用户明确要求重新读取资料，或本轮消息带有新的 @ 引用时，才应该进入刷新上下文流程。",
      "请直接回答用户当前问题，保留必要推理结论，不要输出内部过程说明。",
    ].join("\n"),
    sourceLabel: "已复用上次上下文",
    reason: "后续普通追问未附带新引用，也未要求重新读取资料。",
  }
}

export function planOutlineAgentHistory(input: OutlineAgentHistoryInput): OutlineAgentHistoryPlan {
  const history = input.history.filter((message) => message.content.trim())
  if (input.contextDecision.mode === "refresh") {
    return {
      level: "low",
      messages: history,
      instruction: "本轮需要刷新上下文，允许保留完整有效对话历史。",
      sources: ["过程: 将显示必要工具过程"],
      showThinkingProcess: true,
      showToolProcess: true,
      showToolProcessOnError: true,
    }
  }

  const totalChars = history.reduce((sum, message) => sum + message.content.length, 0)
  const level: OutlineContextPressureLevel =
    history.length > 6 || totalChars > 6_000 ? "high" : totalChars > 2_500 ? "medium" : "low"
  const compactedMessages = level === "high" ? compactOutlineHistory(history) : history.slice(-4)
  const cachedSummary = input.cachedSummary?.trim()
  const messages = cachedSummary
    ? input.summaryInSystem
      ? compactedMessages.slice(-2)
      : [
        {
          role: "assistant" as const,
          content: cachedSummary,
        },
        ...compactedMessages.slice(-2),
      ]
    : compactedMessages
  const instruction = [
    level === "high"
      ? "已压缩历史上下文：仅保留首轮目标、最近关键结论和最近对话，避免重复消耗 Token。"
      : "已裁剪历史上下文：仅保留最近有效对话，避免重复发送旧过程。",
    cachedSummary
      ? "已复用上下文摘要缓存；摘要只作为历史提要，当前用户新输入优先级更高。"
      : "",
    "不要把工具调用过程、来源列表或内部思考当成新的创作事实；以最终大纲结论为准。",
  ].filter(Boolean).join("\n")

  return {
    level,
    messages,
    instruction,
    sources: [
      "过程: 已隐藏重复工具过程",
      ...(cachedSummary ? ["摘要: 已复用上下文摘要缓存"] : []),
    ],
    showThinkingProcess: false,
    showToolProcess: false,
    showToolProcessOnError: true,
  }
}

export function buildOutlineContextSummary(history: OutlineAgentHistoryMessage[]): string {
  const cleanHistory = history.filter((message) => message.content.trim())
  const firstUser = cleanHistory.find((message) => message.role === "user")
  const lastAssistant = [...cleanHistory].reverse().find((message) => message.role === "assistant")
  const lastUser = [...cleanHistory].reverse().find((message) => message.role === "user")
  return [
    "## 上下文摘要缓存",
    firstUser ? `- 初始目标：${trimMiddle(firstUser.content, 360)}` : "",
    lastAssistant ? `- 最近结论：${trimMiddle(lastAssistant.content, 720)}` : "",
    lastUser && lastUser !== firstUser ? `- 最近问题：${trimMiddle(lastUser.content, 240)}` : "",
    "- 使用规则：摘要用于承接已确认方向，若与用户本轮新输入冲突，以用户本轮新输入为准。",
  ].filter(Boolean).join("\n")
}

export function estimateOutlineContextBudget(input: OutlineContextBudgetInput): OutlineContextBudget {
  const originalTokens = estimateMessagesTokens(input.original)
  const plannedTokens = estimateMessagesTokens(input.planned)
  const savedTokens = Math.max(0, originalTokens - plannedTokens)
  const compressionRatio = originalTokens > 0 ? plannedTokens / originalTokens : 1
  return {
    originalTokens,
    plannedTokens,
    savedTokens,
    compressionRatio,
    label: savedTokens > 0
      ? `预计节省约 ${savedTokens} tokens`
      : "预计不节省 tokens",
  }
}

function refreshReason(input: OutlineContextReuseInput): string {
  if (!input.hasPriorAssistantAnswer) return "首次生成需要建立上下文。"
  if (input.forceRefresh) return "用户手动要求强制刷新上下文。"
  if (input.enableMultiAgent) return "固定生成向导或多 Agent 任务需要完整上下文。"
  if (input.attachedReferenceCount > 0) return "本轮带有新的引用资料。"
  if (REFRESH_KEYWORD_PATTERN.test(input.inputText.trim())) {
    return "用户明确要求读取或刷新资料。"
  }
  return "本轮需要刷新上下文。"
}

function estimateMessagesTokens(messages: OutlineAgentHistoryMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTextTokens(message.content), 0)
}

function estimateTextTokens(text: string): number {
  if (!text.trim()) return 0
  const cjkMatches = text.match(/[\u3400-\u9fff]/g) ?? []
  const englishMatches = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g) ?? []
  const newlineMatches = text.match(/\n/g) ?? []
  const symbolMatches = text.match(/[^\sA-Za-z0-9\u3400-\u9fff]/g) ?? []
  const englishTokens = englishMatches.reduce(
    (sum, word) => sum + Math.max(1, Math.ceil(word.length / 5)),
    0,
  )
  const symbolTokens = Math.ceil(symbolMatches.length / 3)
  const newlineTokens = Math.ceil(newlineMatches.length / 2)
  return cjkMatches.length + englishTokens + symbolTokens + newlineTokens
}

function compactOutlineHistory(history: OutlineAgentHistoryMessage[]): OutlineAgentHistoryMessage[] {
  const firstUser = history.find((message) => message.role === "user")
  const lastMessages = history.slice(-2)
  const lastAssistant = [...history].reverse().find((message) => message.role === "assistant")
  const compacted: OutlineAgentHistoryMessage[] = []
  if (firstUser) compacted.push(firstUser)
  if (
    lastAssistant &&
    !lastMessages.some((message) => message.role === "assistant" && message.content === lastAssistant.content)
  ) {
    compacted.push({
      ...lastAssistant,
      content: trimMiddle(lastAssistant.content, 1_800),
    })
  }
  for (const message of lastMessages) {
    compacted.push({
      ...message,
      content: message.role === "assistant" ? trimMiddle(message.content, 1_800) : message.content,
    })
  }
  return dedupeAdjacentMessages(compacted)
}

function trimMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const headLength = Math.floor(maxLength * 0.55)
  const tailLength = maxLength - headLength
  return `${text.slice(0, headLength)}\n\n[中间内容已压缩，保留首尾关键结论]\n\n${text.slice(-tailLength)}`
}

function dedupeAdjacentMessages(messages: OutlineAgentHistoryMessage[]): OutlineAgentHistoryMessage[] {
  return messages.filter((message, index) => {
    const previous = messages[index - 1]
    return !previous || previous.role !== message.role || previous.content !== message.content
  })
}
