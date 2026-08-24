import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  AgentChatMessage,
  AgentChatSession,
  NovelAgent,
  SimulationState,
} from "@/lib/novel/story-simulation/types"
import { formatTimelineEvent, getVisibleEvents } from "@/lib/novel/story-simulation/agent-profile-builder"

// ── 对外接口 ──

interface InterviewOptions {
  llmConfig: LlmConfig
  agent: NovelAgent
  simulationState: SimulationState
  userPrompt: string
  signal?: AbortSignal
  /** 流式 token 回调 */
  onToken?: (token: string) => void
  /** 对话历史（可选，用于多轮采访） */
  session?: AgentChatSession
  /** 完成回调，返回完整回复文本和更新后的会话 */
  onDone?: (fullText: string, session: AgentChatSession) => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

// ── 内部辅助：构建采访系统提示词 ──

function buildInterviewSystemPrompt(agent: NovelAgent): string {
  const personalityLine =
    agent.personality.length > 0
      ? `你的性格：${agent.personality.join("、")}`
      : ""
  const styleLine = agent.speakingStyle
    ? `你的说话风格：${agent.speakingStyle}`
    : ""

  return [
    `你正在以小说角色「${agent.name}」的身份接受采访/对话。`,
    "",
    "【核心规则 - 必须严格遵守】",
    "1. 你就是「" + agent.name + "」本人，不是AI助手，不要跳出角色。",
    "2. 严格基于你的认知范围回答：你只知道你亲身经历、亲眼看到、亲耳听到的事情。",
    "3. 你不知道的事情必须明确表示「我不知道」或「我不清楚」，绝不能编造你不知道的信息。",
    "4. 绝对禁止全知视角：你不知道其他角色的内心想法，不知道剧情走向，不知道作者的安排。",
    "5. 保持你的性格和说话风格，回答要自然、像真实的人物对话。",
    "6. 用纯文本回复，不要输出JSON，不要使用markdown格式，不要加入舞台指示或动作描写括号。",
    "",
    personalityLine,
    styleLine,
  ]
    .filter((line) => line !== null && line !== undefined && line !== "")
    .join("\n")
}

// ── 内部辅助：构建采访上下文 ──

function buildInterviewContext(
  agent: NovelAgent,
  simulationState: SimulationState,
): string {
  const sections: string[] = []

  // 角色基本信息
  sections.push("【你的身份】")
  sections.push(`姓名：${agent.name}`)
  if (agent.profile) {
    sections.push(`档案：${agent.profile}`)
  }
  if (agent.soul) {
    sections.push(`角色灵魂：${agent.soul}`)
  }

  // 你知道的信息
  sections.push("")
  sections.push("【你知道的信息】")
  if (agent.knowledgeScope.length > 0) {
    sections.push(agent.knowledgeScope.slice(-20).join("\n"))
  } else {
    sections.push("（目前你了解的信息有限）")
  }

  // 你不知道的信息（提醒不要越界）
  if (agent.cognition?.doesNotKnow && agent.cognition.doesNotKnow.length > 0) {
    sections.push("")
    sections.push("【你绝对不知道的事情（禁止提及）】")
    sections.push(agent.cognition.doesNotKnow.join("\n"))
  }

  // 人际关系/情感
  sections.push("")
  sections.push("【你对其他角色的情感】")
  let hasRelation = false
  for (const [otherId, value] of agent.memory.sentiments.entries()) {
    if (otherId === agent.characterId) continue
    const otherAgent = simulationState.activeAgents.get(otherId)
    const otherName = otherAgent?.name ?? otherId
    const desc =
      value > 30
        ? "有好感"
        : value < -30
          ? "有敌意"
          : value > 0
            ? "印象不错"
            : value < 0
              ? "有些不满"
              : "态度中立"
    sections.push(`- 对 ${otherName}：${desc}（好感度 ${value}）`)
    hasRelation = true
  }
  if (!hasRelation) {
    sections.push("（你目前对其他角色没有特别的情感倾向）")
  }

  // 你最近观察到的事件（最近10条可见事件）
  const visibleEvents = getVisibleEvents(
    agent.characterId,
    simulationState.timelineEvents,
    10,
  )
  if (visibleEvents.length > 0) {
    sections.push("")
    sections.push("【你最近经历/观察到的事情】")
    for (const ev of visibleEvents) {
      sections.push(`- ${formatTimelineEvent(ev)}`)
    }
  }

  // 当前情绪和目标
  sections.push("")
  sections.push("【你当前的状态】")
  sections.push(`当前目标：${agent.currentGoal}`)
  sections.push(`情绪状态：${agent.emotionalState}`)

  return sections.join("\n")
}

// ── 内部辅助：生成消息 ID ──

function nextMsgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── 主入口：采访/对话 Agent ──

export async function interviewAgent(
  options: InterviewOptions,
): Promise<{ fullText: string; session: AgentChatSession }> {
  const {
    llmConfig,
    agent,
    simulationState,
    userPrompt,
    signal,
    onToken,
    session: existingSession,
    onDone,
    onError,
  } = options

  // 初始化或复用会话
  const session: AgentChatSession = existingSession
    ? { ...existingSession, messages: [...existingSession.messages] }
    : {
        agentId: agent.characterId,
        agentName: agent.name,
        messages: [],
      }

  try {
    // 构建消息列表
    const messages: ChatMessage[] = [
      { role: "system", content: buildInterviewSystemPrompt(agent) },
    ]

    // 添加上下文作为第一条 user 消息（只在会话开始时添加）
    if (session.messages.length === 0) {
      const context = buildInterviewContext(agent, simulationState)
      messages.push({
        role: "user",
        content:
          context +
          "\n\n以上是你的背景信息。采访即将开始，请根据后续提问自然地以角色身份回答。",
      })
      messages.push({
        role: "assistant",
        content: "我准备好了，请问吧。",
      })
    }

    // 添加历史消息
    for (const msg of session.messages) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content })
      } else if (msg.role === "agent") {
        messages.push({
          role: "assistant",
          content: msg.content,
          ...(msg.reasoning_content !== undefined
            ? { reasoning_content: msg.reasoning_content }
            : {}),
        })
      }
    }

    // 添加当前用户提问
    const userMsg: AgentChatMessage = {
      id: nextMsgId(),
      role: "user",
      content: userPrompt,
      timestamp: new Date().toISOString(),
    }
    session.messages.push(userMsg)
    messages.push({ role: "user", content: userPrompt })

    // 调用 LLM 流式回复
    let fullText = ""
    let reasoningContent = ""
    let streamError: Error | null = null

    await streamChat(
      llmConfig,
      messages,
      {
        onToken: (token) => {
          fullText += token
          onToken?.(token)
        },
        onReasoningToken: (token) => {
          reasoningContent += token
        },
        onDone: () => {},
        onError: (err) => {
          streamError = err
        },
      },
      signal,
    )

    if (streamError) {
      throw streamError
    }

    // 记录 Agent 回复到会话
    const agentMsg: AgentChatMessage = {
      id: nextMsgId(),
      role: "agent",
      agentId: agent.characterId,
      agentName: agent.name,
      content: fullText,
      reasoning_content: reasoningContent,
      timestamp: new Date().toISOString(),
    }
    session.messages.push(agentMsg)

    onDone?.(fullText, session)

    return { fullText, session }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    onError?.(error)
    throw error
  }
}
