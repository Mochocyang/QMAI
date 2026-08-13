import {
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  OUTLINE_WIZARD_LENGTH_OPTIONS,
  OUTLINE_WIZARD_MATERIAL_OPTIONS,
  OUTLINE_WIZARD_NARRATIVE_OPTIONS,
  OUTLINE_WIZARD_TASK_OPTIONS,
  getOutlineWizardGenreLabel,
  type OutlineWizardOption,
  type OutlineWizardRequest,
} from "./outline-wizard"

export interface NovelGenerationRequestPackage {
  version: 1
  summary: string
  details: string[]
  modelContent: string
}

type OutlineModelMessage = {
  role: "user" | "assistant"
  content: string
  modelContent?: string
  visibility?: "visible" | "internal"
  novelGenerationRequest?: NovelGenerationRequestPackage
  isAgentRunning?: boolean
  reasoning_content?: string
}

type OutlineConversationLike = {
  id: string
  title: string
  messages: OutlineModelMessage[]
}

function label<T extends string>(options: OutlineWizardOption<T>[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value
}

export function createNovelGenerationRequestPackage(
  request: OutlineWizardRequest,
  modelContent: string,
): NovelGenerationRequestPackage {
  const task = label(OUTLINE_WIZARD_TASK_OPTIONS, request.task)
  const length = label(OUTLINE_WIZARD_LENGTH_OPTIONS, request.length)
  const channel = label(OUTLINE_WIZARD_CHANNEL_OPTIONS, request.channel)
  const genre = getOutlineWizardGenreLabel(request)
  const explicit = request.explicit ?? {}
  const details = [
    explicit.task ? `生成任务：${task}` : "",
    explicit.length ? `篇幅类型：${length}` : "",
    explicit.channel ? `频道方向：${channel}` : "",
    explicit.genre || explicit.customGenre ? `题材类型：${genre}` : "",
    request.inspiration.trim() ? `故事灵感/处理要求：${request.inspiration.trim()}` : "",
    explicit.sellingPoints && request.sellingPoints.length
      ? `核心卖点：${request.sellingPoints.join("、")}`
      : "",
    explicit.targets && request.targets.length ? `生成目标：${request.targets.join("、")}` : "",
    explicit.scale && request.scale.trim() ? `作品规模：${request.scale.trim()}` : "",
    explicit.narrative
      ? `叙事要求：${label(OUTLINE_WIZARD_NARRATIVE_OPTIONS, request.narrative)}`
      : "",
    explicit.materialSource
      ? `已有资料：${label(OUTLINE_WIZARD_MATERIAL_OPTIONS, request.materialSource)}`
      : "",
  ].filter(Boolean)
  return {
    version: 1,
    summary: `${task} · ${genre} · ${request.targets.join("、")}`,
    details,
    modelContent,
  }
}

export function getNovelGenerationModelContent(request: NovelGenerationRequestPackage): string {
  return request.modelContent
}

export function getOutlineMessageModelContent(message: {
  content: string
  modelContent?: string
  novelGenerationRequest?: NovelGenerationRequestPackage
}): string {
  if (message.modelContent?.trim()) return message.modelContent
  return message.novelGenerationRequest
    ? getNovelGenerationModelContent(message.novelGenerationRequest)
    : message.content
}

export function mapOutlineMessagesForModel(messages: OutlineModelMessage[]): Array<{
  role: "user" | "assistant"
  content: string
  reasoning_content?: string
}> {
  return messages
    .filter((message) => getOutlineMessageModelContent(message).trim() && !message.isAgentRunning)
    .map((message) => ({
      role: message.role,
      content: getOutlineMessageModelContent(message),
      ...(message.reasoning_content !== undefined
        ? { reasoning_content: message.reasoning_content }
        : {}),
    }))
}

export function isInternalOutlineMessage(message: {
  role: "user" | "assistant"
  content: string
  visibility?: "visible" | "internal"
}): boolean {
  if (message.visibility === "internal") return true
  if (message.role !== "user") return false
  const content = message.content.trim()
  if (content.startsWith("✓ 意图明确（") && content.includes("开始生成")) return true
  return content.startsWith("请按「AI大纲生成工作流」生成「")
    && content.includes("## PRD 3.1 主流程要求")
    && content.includes("禁止再次输出 intent_clarity")
}

export function buildOutlineRegenerationInput(messages: OutlineModelMessage[]): {
  request: string
  history: Array<{ role: "user" | "assistant"; content: string; reasoning_content?: string }>
  structuredGeneration: boolean
} {
  const available = messages.filter((message) => message.content.trim() && !message.isAgentRunning)
  let lastUserIndex = -1
  for (let index = available.length - 1; index >= 0; index -= 1) {
    if (available[index].role === "user") {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex < 0) {
    return { request: "请基于已有大纲重新生成。", history: mapOutlineMessagesForModel(available), structuredGeneration: true }
  }
  return {
    request: getOutlineMessageModelContent(available[lastUserIndex]),
    structuredGeneration: Boolean(available[lastUserIndex].novelGenerationRequest) || isExplicitStructuredGenerationFollowUp(available[lastUserIndex].content, { generationContext: false }),
    history: mapOutlineMessagesForModel(available.filter((_, index) => index !== lastUserIndex)),
  }
}

export function mapOutlineConversationsForModel<T extends OutlineConversationLike>(conversations: T[]) {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    messages: mapOutlineMessagesForModel(conversation.messages),
  }))
}

export function isNovelGenerationRequestPackage(value: unknown): value is NovelGenerationRequestPackage {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<NovelGenerationRequestPackage>
  return candidate.version === 1
    && typeof candidate.summary === "string"
    && Array.isArray(candidate.details)
    && candidate.details.every((detail) => typeof detail === "string")
    && typeof candidate.modelContent === "string"
}


export function isExplicitStructuredGenerationFollowUp(
  label: string,
  options: { generationContext: boolean },
): boolean {
  const normalized = label.replace(/\s+/g, "").trim()
  if (!normalized) return false
  const structuredTarget = /(\u4eba\u7269(?:\u8bbe\u5b9a|\u5c0f\u4f20|\u5173\u7cfb|\u5f27\u5149)?|\u89d2\u8272(?:\u8bbe\u5b9a|\u5c0f\u4f20|\u5173\u7cfb|\u5f27\u5149)?|\u4e16\u754c\u89c2|\u5927\u7eb2|\u603b\u7eb2|\u5206\u5377|\u7ae0\u8282\u89c4\u5212|\u5267\u60c5|\u6545\u4e8b\u7ebf|\u4f0f\u7b14|\u52bf\u529b|\u5730\u70b9\u8bbe\u5b9a|\u573a\u666f\u8bbe\u5b9a|\u5f53\u524d\u6a21\u5757)/
  const explicitGeneration = /(\u751f\u6210|\u521b\u4f5c|\u64b0\u5199|\u7f16\u5199|\u8bbe\u8ba1|\u6784\u5efa|\u5236\u5b9a|\u4ea7\u51fa)/
  if (explicitGeneration.test(normalized) && structuredTarget.test(normalized)) return true
  return options.generationContext
    && /(\u7ee7\u7eed|\u5b8c\u5584|\u8865\u5145|\u6269\u5199|\u7ec6\u5316|\u6df1\u5316)/.test(normalized)
    && structuredTarget.test(normalized)
}
