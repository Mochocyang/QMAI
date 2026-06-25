import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat, type ChatMessage, type RequestOverrides, type StreamCallbacks } from "@/lib/llm-client"

export interface DeepOutlineGenerationInput {
  llmConfig: LlmConfig
  userRequest: string
  context: string
  historyMessages?: ChatMessage[]
}

export interface DeepOutlineGenerationCallbacks {
  onThinking?: (content: string) => void
  onFinalContent?: (content: string) => void
}

export interface DeepOutlineGenerationResult {
  finalContent: string
  taskBrief: string
  draftContent: string
  selfCheck: string
}

export interface DeepOutlineGenerationDeps {
  streamChat: (
    config: LlmConfig,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    requestOverrides?: RequestOverrides,
  ) => Promise<void>
}

const defaultDeps: DeepOutlineGenerationDeps = {
  streamChat,
}

export async function runDeepOutlineGeneration(
  input: DeepOutlineGenerationInput,
  callbacks: DeepOutlineGenerationCallbacks = {},
  deps: DeepOutlineGenerationDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<DeepOutlineGenerationResult> {
  const safeContext = ensureString(input.context)
  const safeUserRequest = ensureString(input.userRequest)
  const history = formatRecentHistory(input.historyMessages ?? [])

  callbacks.onThinking?.(formatStageThinking(
    "阶段1：大纲上下文分析",
    [
      `用户要求：${safeUserRequest || "未提供用户要求"}`,
      safeContext.trim()
        ? `已读取大纲/章节上下文，约 ${safeContext.length} 字。`
        : "未读取到现有大纲或章节上下文，将仅基于本次要求生成。",
      history ? "已纳入本轮大纲对话历史。" : "暂无可用的大纲对话历史。",
    ].join("\n"),
  ))

  const taskBrief = await collectModelText(
    input.llmConfig,
    [{ role: "user", content: buildOutlineTaskBriefPrompt(safeContext, history, safeUserRequest) }],
    deps,
    signal,
    (partial) => callbacks.onThinking?.(formatStageThinking("阶段2：大纲任务书", partial)),
  )
  callbacks.onThinking?.(formatStageThinking("阶段2：大纲任务书", taskBrief))

  const draftContent = await collectModelText(
    input.llmConfig,
    [{ role: "user", content: buildOutlineDraftPrompt(safeContext, history, taskBrief, safeUserRequest) }],
    deps,
    signal,
    (partial) => callbacks.onThinking?.(formatStageThinking("阶段3：大纲草稿", partial)),
  )
  callbacks.onThinking?.(formatStageThinking("阶段3：大纲草稿", [
    draftContent,
    "",
    `大纲草稿生成完成，约 ${draftContent.length} 字。`,
  ].join("\n")))

  const selfCheck = await collectModelText(
    input.llmConfig,
    [{ role: "user", content: buildOutlineSelfCheckPrompt(safeContext, history, taskBrief, draftContent, safeUserRequest) }],
    deps,
    signal,
    (partial) => callbacks.onThinking?.(formatStageThinking("阶段4：大纲自检", partial)),
  )
  callbacks.onThinking?.(formatStageThinking("阶段4：大纲自检", selfCheck))
  callbacks.onThinking?.(formatStageThinking("阶段5：完成", "采用自检后的大纲草稿作为最终输出。"))
  callbacks.onFinalContent?.(draftContent)

  return {
    finalContent: draftContent,
    taskBrief,
    draftContent,
    selfCheck,
  }
}

async function collectModelText(
  config: LlmConfig,
  messages: ChatMessage[],
  deps: DeepOutlineGenerationDeps,
  signal?: AbortSignal,
  onUpdate?: (content: string) => void,
): Promise<string> {
  let content = ""
  let streamError: Error | null = null

  await deps.streamChat(
    config,
    messages,
    {
      onToken: (token) => {
        content += token
        onUpdate?.(content)
      },
      onDone: () => {},
      onError: (error) => {
        streamError = error
      },
    },
    signal,
    { reasoning: config.reasoning },
  )

  if (streamError) throw streamError
  return content.trim()
}

function buildOutlineTaskBriefPrompt(context: string, history: string, userRequest: string): string {
  return [
    "你是小说大纲规划助手。请先输出一份大纲任务书，不要直接写大纲正文。",
    "",
    "任务书必须包含：",
    "1. 本次要生成或细化的大纲范围。",
    "2. 必须承接的已有剧情、人物状态、伏笔和时间线。",
    "3. 必须避免推翻的既定设定。",
    "4. 本次输出结构和重点。",
    "",
    `用户要求：${userRequest}`,
    history ? `\n近期对话：\n${history}` : "",
    "",
    "已有大纲与章节上下文：",
    context || "暂无可用上下文。",
  ].join("\n")
}

function buildOutlineDraftPrompt(context: string, history: string, taskBrief: string, userRequest: string): string {
  return [
    "你是小说大纲写作助手。请根据大纲任务书生成大纲草稿。",
    "",
    "输出要求：",
    "1. 只输出可保存为大纲的 Markdown 正文。",
    "2. 不要输出思考过程、任务书、解释、引用来源或后续建议。",
    "3. 必须承接已有大纲、章节内容、人物状态和伏笔。",
    "4. 如果用户要求章节细纲，需要写清章节目标、冲突、转折、伏笔推进和结尾钩子。",
    "",
    `用户要求：${userRequest}`,
    history ? `\n近期对话：\n${history}` : "",
    "",
    "大纲任务书：",
    taskBrief,
    "",
    "已有大纲与章节上下文：",
    context || "暂无可用上下文。",
  ].join("\n")
}

function buildOutlineSelfCheckPrompt(
  context: string,
  history: string,
  taskBrief: string,
  draftContent: string,
  userRequest: string,
): string {
  return [
    "你是小说大纲自检助手。请对大纲草稿做一次简短自检。",
    "",
    "只输出自检结论，不要改写正文。检查重点：",
    "1. 是否承接用户要求。",
    "2. 是否推翻已有大纲、人物状态、伏笔、时间线或正史规则。",
    "3. 是否足够具体，能指导后续正文生成。",
    "4. 是否存在明显缺口，并给出简短修正建议。",
    "",
    `用户要求：${userRequest}`,
    history ? `\n近期对话：\n${history}` : "",
    "",
    "大纲任务书：",
    taskBrief,
    "",
    "大纲草稿：",
    draftContent,
    "",
    "已有上下文：",
    context || "暂无可用上下文。",
  ].join("\n")
}

function formatRecentHistory(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${ensureString(message.content).slice(0, 1200)}`)
    .join("\n\n")
}

function formatStageThinking(title: string, content: string): string {
  return `## ${title}\n${ensureString(content).trim()}`
}

function ensureString(value: unknown): string {
  return typeof value === "string" ? value : ""
}
