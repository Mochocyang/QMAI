import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { cosineSimilarity, embed } from "@/lib/embedding-client"
import { buildAgentContext } from "@/lib/novel/story-simulation/agent-profile-builder"
import { AgentRunner, ModelDoesNotSupportToolsError } from "@/lib/agent/runner"
import type { AgentConfig, AgentMessage, AgentRunCallbacks } from "@/lib/agent/types"
import { createSimAgentTools } from "@/lib/novel/story-simulation/sim-agent-tools"
import {
  createBlackboardDebugTrace,
  createSimulationBlackboard,
  getBlackboardVisibleEvents,
  getBlackboardVisibleRumors,
  planMultiAgentRound,
  recordBlackboardEvent,
  recordRumorEvent,
  selectNodeAgentCandidates,
  type SimulationBlackboard,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"
import { directorEvaluate, shouldInjectEvent } from "./director-agent"
import {
  pickStagedEvent,
  stringArrayToStagedPool,
} from "./event-pool-generator"
import type { StagedEventPool } from "./event-pool-generator"
import type {
  ActionVisibility,
  AgentAction,
  AgentActionType,
  EventImpact,
  ExtractionResult,
  NovelAgent,
  RumorEvent,
  SimulationDebugTrace,
  SimulationEvent,
  SimulationInput,
  SimulationState,
  StoryFramework,
  StoryNode,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import { calcMaxRoundsPerNode, getModeConfig } from "@/lib/novel/story-simulation/types"
import type { ModeConfig } from "@/lib/novel/story-simulation/types"

// ── 对外接口 ──

export interface SimulationCallbacks {
  onEvent: (event: SimulationEvent) => void
  onProgress: (progress: number, label: string) => void
  onComplete: (events: SimulationEvent[]) => void
  onError: (error: Error) => void
  /** 新引擎时间线事件回调 */
  onTimelineEvent?: (event: TimelineEvent) => void
  /** 推演过程观察回调：用于 UI 展示 Agent 调度和 blackboard 状态 */
  onDebugTrace?: (trace: SimulationDebugTrace) => void
}

// ── 常量 ──

const MAX_ROUNDS_PER_NODE_FALLBACK = 3
const REACT_CHAIN_LIMIT = 2

// ── 内部辅助：将 streamChat 的流式回调收拢为一个完整字符串 ──

async function collectStream(
  config: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let result = ""
  let streamError: Error | null = null

  await streamChat(
    config,
    messages,
    {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return result
}

// ── 内部辅助：Agent 深拷贝（避免事件间共享可变状态） ──

function cloneAgent(agent: NovelAgent): NovelAgent {
  return {
    ...agent,
    knownFacts: new Set(agent.knownFacts),
    relationships: new Map(
      Array.from(agent.relationships.entries()).map(([k, v]) => [
        k,
        { ...v },
      ]),
    ),
    memory: {
      observedEvents: [...agent.memory.observedEvents],
      knownSecrets: new Set(agent.memory.knownSecrets),
      sentiments: new Map(agent.memory.sentiments),
      recentDecisions: [...agent.memory.recentDecisions],
      rumorCredibility: agent.memory.rumorCredibility,
    },
    knowledgeScope: [...agent.knowledgeScope],
    personality: [...agent.personality],
  }
}

function cloneAgentsToMap(agents: NovelAgent[]): Map<string, NovelAgent> {
  const map = new Map<string, NovelAgent>()
  for (const a of agents) {
    map.set(a.characterId, cloneAgent(a))
  }
  return map
}

// ── 内部辅助：生成唯一 ID ──

let eventCounter = 0
function nextEventId(): string {
  eventCounter++
  return `evt_${Date.now()}_${eventCounter}`
}

function timelineEventToResumeSimulationEvent(
  event: TimelineEvent,
  framework: StoryFramework,
): SimulationEvent {
  const node = framework.nodes.find((item) => item.index === event.nodeIndex)
  return {
    type: "info",
    node,
    timestamp: event.timestamp,
    message: `[已保存] 节点${event.nodeIndex + 1} 第${event.round + 1}轮 ${event.actorName}：${event.content}`,
    timelineEvent: event,
  }
}

// ── 内部辅助：构建 Agent 系统提示词 ──

function buildSystemPrompt(agent: NovelAgent): string {
  const personalityLine =
    agent.personality.length > 0
      ? `你的性格关键词：${agent.personality.join("、")}`
      : ""
  const styleLine = agent.speakingStyle
    ? `你的说话风格：${agent.speakingStyle}`
    : ""

  return [
    `你正在扮演小说中的真实角色「${agent.name}」。你不是AI助手，你就是这个角色本人。`,
    "",
    "【核心原则 - 必须严格遵守】",
    "1. 你是小说中的真实角色，只能基于你知道的信息行动，绝不能使用你不知道的信息。",
    "2. 绝对禁止全知视角：你不知道其他角色的内心想法，不知道没有发生在你面前的事情，不知道剧情走向。",
    "3. 严格遵循你的性格特征、说话风格和行为逻辑，不要跳出角色。",
    "4. 你的每个行为都应该有合理的动机，符合角色设定。",
    "",
    personalityLine,
    styleLine,
    "",
    "【行为类型说明】你只能选择以下一种行为类型：",
    "- evaluate：评价某人或某事，表达你的看法和判断",
    "- pushPlot：主动采取推动剧情发展的关键行动",
    "- observe：观察周围环境、人物或事态（不改变现状，只是获取信息）",
    "- react：对其他角色刚做出的行为做出即时反应",
    "- speak：与其他角色对话（说出台词）",
    "- ally：寻求结盟、合作、示好",
    "- confront：对抗、质疑、挑衅",
    "- conceal：隐瞒信息、假装不知道、掩饰真实想法",
    "- investigate：调查、探索、打听消息",
    "",
    "【输出格式】你必须输出一个严格的JSON对象，不要输出任何其他文字，不要使用markdown代码块：",
    "{",
    '  "type": "行为类型(从上面列表选一个)",',
    '  "content": "行为的具体内容/说的话/内心想法",',
    '  "target": "目标角色名（可选，没有目标就不填）",',
    '  "visibility": "all(所有人可见) 或 target_only(仅目标可见) 或 self(仅自己可见/内心活动)",',
    '  "motivation": "你为什么做出这个行为的内心动机",',
    '  "plot_push": "这个行为如何推动剧情向节点目标发展"',
    "}",
    "",
    "【可见性规则】",
    "- 公开的言行(speak/ally/confront/pushPlot的公开部分)用 all",
    "- 私下对话(speak带target)用 target_only",
    "- 内心想法(evaluate/observe的心理活动/conceal)用 self",
    "",
    "只输出JSON对象，不要输出任何其他文字。",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
}

// ── 内部辅助：构建用户消息（上下文 + 指令） ──

function buildUserMessage(
  context: string,
  node: StoryNode,
  agentName: string,
  injectionEvent?: string,
  modeHint?: string,
): string {
  const parts: string[] = [context]
  if (modeHint) {
    parts.push("")
    parts.push("【行为倾向】")
    parts.push(modeHint)
  }
  if (injectionEvent) {
    parts.push("")
    parts.push("【突发事件】")
    parts.push(injectionEvent)
  }
  parts.push("")
  parts.push(
    `当前是节点「${node.title}」，节点目标是：${node.goal}。请根据以上信息，以「${agentName}」的视角决定你接下来要做的一个行为，并严格按JSON格式输出。`,
  )
  return parts.join("\n")
}

// ── 内部辅助：从 LLM 文本中提取 JSON ──

function extractJson(text: string): string | null {
  const trimmed = text.trim()

  // 直接解析
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // 继续
  }

  // 从 markdown 代码块中提取
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  // 从文本中查找第一个 JSON 对象
  const objMatch = /\{[\s\S]*\}/.exec(trimmed)
  if (objMatch) {
    const candidate = objMatch[0]
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  return null
}

// ── 内部辅助：验证行为类型是否合法 ──

const VALID_ACTION_TYPES: AgentActionType[] = [
  "evaluate",
  "pushPlot",
  "observe",
  "react",
  "speak",
  "ally",
  "confront",
  "conceal",
  "investigate",
]

function isValidActionType(t: string): t is AgentActionType {
  return (VALID_ACTION_TYPES as string[]).includes(t)
}

function isValidVisibility(v: string): v is ActionVisibility {
  return v === "all" || v === "target_only" || v === "self"
}

// ── 内部辅助：解析 LLM 输出为行为（健壮：失败时作为 observe 处理） ──

interface ParsedAction {
  action: AgentAction
  motivation: string
  plotPush: string
  visibility: ActionVisibility
}

function parseAgentAction(raw: string): ParsedAction {
  const fallback: ParsedAction = {
    action: {
      type: "observe",
      content: raw.trim().slice(0, 200) || "沉默地观察周围",
      visibility: "self",
    },
    motivation: "",
    plotPush: "",
    visibility: "self",
  }

  const jsonText = extractJson(raw)
  if (!jsonText) {
    return fallback
  }

  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>
    const typeRaw = String(data.type ?? "observe").toLowerCase()
    const type: AgentActionType = isValidActionType(typeRaw)
      ? typeRaw
      : "observe"
    const content = String(data.content ?? "").trim() || fallback.action.content
    const target =
      data.target !== undefined && data.target !== null && data.target !== ""
        ? String(data.target)
        : undefined
    const visRaw = String(data.visibility ?? "all").toLowerCase()
    const visibility: ActionVisibility = isValidVisibility(visRaw)
      ? visRaw
      : type === "speak" && target
        ? "target_only"
        : type === "evaluate" || type === "observe" || type === "conceal"
          ? "self"
          : "all"
    const motivation = String(data.motivation ?? "").trim()
    const plotPush = String(data.plot_push ?? "").trim()

    // 根据行为类型推断默认可见性（LLM未明确指定时）
    let finalVisibility = visibility
    if (!data.visibility) {
      if (type === "evaluate" || type === "observe" || type === "conceal") {
        finalVisibility = "self"
      } else if ((type === "speak" || type === "ally" || type === "confront") && target) {
        finalVisibility = "target_only"
      } else {
        finalVisibility = "all"
      }
    }

    return {
      action: {
        type,
        content,
        target,
        visibility: finalVisibility,
        motivation: motivation || undefined,
        plot_push: plotPush || undefined,
      },
      motivation,
      plotPush,
      visibility: finalVisibility,
    }
  } catch {
    return fallback
  }
}

// ── 内部辅助：根据名字或 ID 查找目标 Agent ──

function resolveTarget(
  targetName: string | undefined,
  agents: Map<string, NovelAgent>,
): NovelAgent | undefined {
  if (!targetName) return undefined
  for (const agent of agents.values()) {
    if (agent.name === targetName || agent.characterId === targetName) {
      return agent
    }
  }
  return undefined
}

// ── 内部辅助：根据可见性确定 observableBy 列表 ──

function determineObservableBy(
  actor: NovelAgent,
  target: NovelAgent | undefined,
  visibility: ActionVisibility,
  allAgents: Map<string, NovelAgent>,
): string[] {
  switch (visibility) {
    case "self":
      return [actor.characterId]
    case "target_only":
      if (target) {
        return [actor.characterId, target.characterId]
      }
      return [actor.characterId]
    case "all":
    default: {
      const ids: string[] = []
      for (const id of allAgents.keys()) {
        ids.push(id)
      }
      return ids
    }
  }
}

// ── 内部辅助：计算事件对角色的影响 ──

function computeImpacts(
  actor: NovelAgent,
  parsed: ParsedAction,
  target: NovelAgent | undefined,
): EventImpact[] {
  const impacts: EventImpact[] = []
  const { action } = parsed

  // 对目标的情感影响
  if (target) {
    switch (action.type) {
      case "ally":
        impacts.push({
          characterId: target.characterId,
          type: "relationship",
          detail: `${actor.name}向${target.name}示好结盟，好感度上升`,
        })
        break
      case "confront":
        impacts.push({
          characterId: target.characterId,
          type: "relationship",
          detail: `${actor.name}与${target.name}对抗，好感度下降`,
        })
        break
      case "speak":
        impacts.push({
          characterId: target.characterId,
          type: "knowledge",
          detail: `${target.name}听到了${actor.name}说的话`,
        })
        break
      case "react":
        impacts.push({
          characterId: target.characterId,
          type: "sentiment",
          detail: `${actor.name}对${target.name}的行为做出了反应`,
        })
        break
    }
  }

  // 对自己的影响
  switch (action.type) {
    case "investigate":
    case "observe":
      impacts.push({
        characterId: actor.characterId,
        type: "knowledge",
        detail: `${actor.name}获取了新信息`,
      })
      break
    case "conceal":
      impacts.push({
        characterId: actor.characterId,
        type: "knowledge",
        detail: `${actor.name}隐藏了某些信息`,
      })
      break
    case "evaluate":
      impacts.push({
        characterId: actor.characterId,
        type: "sentiment",
        detail: `${actor.name}形成了看法/评价`,
      })
      break
  }

  // 公开事件对所有人产生知识影响
  if (action.visibility === "all") {
    impacts.push({
      characterId: "__all__",
      type: "knowledge",
      detail: `所有人都观察到了${actor.name}的公开行为`,
    })
  }

  return impacts
}

// ── 内部辅助：将事件应用到 Agent 记忆 ──

function applyEventToMemory(
  agent: NovelAgent,
  event: TimelineEvent,
): void {
  agent.memory.observedEvents.push(event.id)

  // 处理影响
  for (const impact of event.impacts) {
    if (impact.characterId === "__all__" || impact.characterId === agent.characterId) {
      if (impact.type === "knowledge") {
        // 知识类影响：加入到 knowledgeScope
        if (!agent.knowledgeScope.includes(impact.detail)) {
          agent.knowledgeScope.push(impact.detail)
        }
      } else if (impact.type === "sentiment") {
        // 情感变化
        agent.emotionalState = impact.detail.includes("正面") ? "positive" : agent.emotionalState
      } else if (impact.type === "relationship" && event.targetId) {
        // 关系变化
        const current = agent.memory.sentiments.get(event.targetId) ?? 0
        let delta = 0
        if (impact.detail.includes("上升") || impact.detail.includes("结盟") || impact.detail.includes("示好")) {
          delta = 10
        } else if (impact.detail.includes("下降") || impact.detail.includes("对抗") || impact.detail.includes("冲突")) {
          delta = -10
        }
        agent.memory.sentiments.set(
          event.targetId,
          Math.max(-100, Math.min(100, current + delta)),
        )
        // 同步到旧 relationships 字段以兼容
        const oldRel = agent.relationships.get(event.targetId)
        if (oldRel) {
          oldRel.sentiment = Math.max(-100, Math.min(100, current + delta))
          oldRel.relationType = delta > 0 ? "ally" : delta < 0 ? "hostile" : oldRel.relationType
        }
      }
    }
  }

  // 记录最近决策（仅对行为发起者）
  if (event.actorId === agent.characterId) {
    agent.memory.recentDecisions.push(
      `[R${event.round + 1}] ${event.actionType}: ${event.content.slice(0, 50)}`,
    )
    if (agent.memory.recentDecisions.length > 20) {
      agent.memory.recentDecisions = agent.memory.recentDecisions.slice(-20)
    }
  }
}

// ── 内部辅助：创建时间线事件 ──

function createTimelineEvent(
  actor: NovelAgent,
  parsed: ParsedAction,
  target: NovelAgent | undefined,
  round: number,
  nodeIndex: number,
  allAgents: Map<string, NovelAgent>,
): TimelineEvent {
  const observableBy = determineObservableBy(
    actor,
    target,
    parsed.visibility,
    allAgents,
  )
  const impacts = computeImpacts(actor, parsed, target)

  return {
    id: nextEventId(),
    round,
    nodeIndex,
    actorId: actor.characterId,
    actorName: actor.name,
    actionType: parsed.action.type,
    content: parsed.action.content,
    targetId: target?.characterId,
    targetName: target?.name,
    observableBy,
    impacts,
    timestamp: new Date().toISOString(),
  }
}

// ── 内部辅助：将 TimelineEvent 转换为旧 SimulationEvent（兼容报告生成） ──

function timelineEventToSimulationEvent(
  tlEvent: TimelineEvent,
  agent: NovelAgent,
  parsed: ParsedAction,
  node: StoryNode,
  round: number,
): SimulationEvent {
  const stateChanges: string[] = []
  if (parsed.motivation) {
    stateChanges.push(`动机：${parsed.motivation}`)
  }
  if (parsed.plotPush) {
    stateChanges.push(`剧情推动：${parsed.plotPush}`)
  }
  for (const impact of tlEvent.impacts) {
    if (impact.characterId !== "__all__") {
      stateChanges.push(impact.detail)
    }
  }

  // 将新行为类型映射为旧 AgentAction 结构（扁平接口，直接赋值）
  const action: AgentAction = {
    type: parsed.action.type,
    content: parsed.action.content,
    target: parsed.action.target,
    visibility: parsed.action.visibility,
    motivation: parsed.motivation,
    plot_push: parsed.plotPush,
  }

  return {
    type: "agent-action",
    agent: cloneAgent(agent),
    action,
    round,
    node,
    stateChanges,
    timestamp: tlEvent.timestamp,
    timelineEvent: tlEvent,
  }
}

// ── 内部辅助：为旧 SimulationEvent 生成行为描述 ──

function formatActionDescription(action: AgentAction, agentName: string): string {
  const { type, content, target } = action
  switch (type) {
    case "speak":
      return target
        ? `${agentName} 对 ${target} 说：「${content}」`
        : `${agentName} 说：「${content}」`
    case "evaluate":
      return `${agentName} 心中评价：${content}`
    case "pushPlot":
      return `${agentName} 采取行动：${content}`
    case "observe":
      return `${agentName} 观察到：${content}`
    case "react":
      return target
        ? `${agentName} 对 ${target} 的反应：${content}`
        : `${agentName} 做出反应：${content}`
    case "ally":
      return target
        ? `${agentName} 向 ${target} 示好结盟：${content}`
        : `${agentName} 寻求合作：${content}`
    case "confront":
      return target
        ? `${agentName} 与 ${target} 对抗：${content}`
        : `${agentName} 采取对抗姿态：${content}`
    case "conceal":
      return `${agentName} 隐瞒了内心想法：${content}`
    case "investigate":
      return `${agentName} 调查：${content}`
    case "act":
      return `${agentName} 行动：${content}`
    case "decide":
      return `${agentName} 做出决定：${content}`
    case "conflict":
      return target
        ? `${agentName} 与 ${target} 发生冲突：${content}`
        : `${agentName} 冲突：${content}`
    case "cooperate":
      return target
        ? `${agentName} 与 ${target} 合作：${content}`
        : `${agentName} 合作：${content}`
    case "withhold":
      return `${agentName} 隐瞒信息：${content}`
    default:
      return `${agentName}：${content}`
  }
}

// ── 内部辅助：检查节点是否达成目标（简单启发式） ──

const RANDOM_EVENTS = [
  "一阵异样的风声掠过，似乎预示着某种变故即将到来。",
  "远处传来模糊的响动，所有角色都感到了一丝不安。",
  "天色骤变，云层翻涌，仿佛有什么大事正在酝酿。",
  "一个不起眼的线索被发现，可能改变所有人的判断。",
  "时间流逝比预想的更快，紧迫感在角色间蔓延。",
  "一个意外来客出现在众人视野中。",
  "一段被遗忘的记忆突然浮现，影响着某个角色的判断。",
  "环境的微妙变化让角色们重新审视当前局势。",
]

function generateRandomEvent(
  dynamicPool?: string[] | StagedEventPool,
  usedIndices?: Set<number> | Set<string>,
  nodeIndex?: number,
  totalNodes?: number,
): { event: SimulationEvent | null; usedIndex?: number; usedEventId?: string } {
  let eventText: string
  let usedIndex: number | undefined
  let usedEventId: string | undefined

  if (dynamicPool) {
    const isStagedPool =
      typeof dynamicPool === "object" &&
      dynamicPool !== null &&
      "byStage" in dynamicPool &&
      "all" in dynamicPool

    if (isStagedPool && nodeIndex !== undefined && totalNodes !== undefined) {
      const stagedPool = dynamicPool as StagedEventPool
      const usedIds = (usedIndices as Set<string>) || new Set<string>()
      const picked = pickStagedEvent(stagedPool, usedIds, nodeIndex, totalNodes)

      if (picked) {
        eventText = picked.text
        usedEventId = picked.id
      } else {
        const idx = Math.floor(Math.random() * RANDOM_EVENTS.length)
        eventText = RANDOM_EVENTS[idx]
      }
    } else {
      const poolArray = isStagedPool
        ? (dynamicPool as StagedEventPool).all.map((e) => e.text)
        : (dynamicPool as string[])

      if (poolArray.length > 0) {
        const availableIndices: number[] = []
        const usedNumSet = usedIndices as Set<number> | undefined
        for (let i = 0; i < poolArray.length; i++) {
          if (!usedNumSet || !usedNumSet.has(i)) {
            availableIndices.push(i)
          }
        }

        if (availableIndices.length > 0) {
          const randomIdx = Math.floor(Math.random() * availableIndices.length)
          const poolIdx = availableIndices[randomIdx]
          eventText = poolArray[poolIdx]
          usedIndex = poolIdx
        } else {
          const idx = Math.floor(Math.random() * RANDOM_EVENTS.length)
          eventText = RANDOM_EVENTS[idx]
        }
      } else {
        const idx = Math.floor(Math.random() * RANDOM_EVENTS.length)
        eventText = RANDOM_EVENTS[idx]
      }
    }
  } else {
    const idx = Math.floor(Math.random() * RANDOM_EVENTS.length)
    eventText = RANDOM_EVENTS[idx]
  }

  return {
    event: {
      type: "info",
      timestamp: new Date().toISOString(),
      message: `【随机事件】${eventText}`,
    },
    usedIndex,
    usedEventId,
  }
}

function isNodeGoalReached(
  _node: StoryNode,
  nodeTimelineEvents: TimelineEvent[],
  maxRounds: number,
  currentRound: number,
): boolean {
  // 达到最大轮次
  if (currentRound >= maxRounds - 1) {
    return true
  }
  // 启发式：产生了 pushPlot 类型的关键事件（剧情推动行为）
  const pushPlotCount = nodeTimelineEvents.filter(
    (e) => e.actionType === "pushPlot",
  ).length
  if (pushPlotCount >= 2) {
    return true
  }
  // 启发式：节点内事件数足够多（>=6个事件表示有足够互动）
  if (nodeTimelineEvents.length >= 6) {
    return true
  }
  return false
}

const EMBEDDING_SIMILARITY_THRESHOLD = 0.75

export async function isNodeGoalReachedWithEmbedding(
  node: StoryNode,
  nodeTimelineEvents: TimelineEvent[],
  maxRounds: number,
  currentRound: number,
  llmConfig: LlmConfig,
): Promise<boolean> {
  if (currentRound >= maxRounds - 1) {
    return true
  }

  const expectedOutcome = node.expectedOutcome?.trim()
  if (!expectedOutcome) {
    return isNodeGoalReached(node, nodeTimelineEvents, maxRounds, currentRound)
  }

  if (nodeTimelineEvents.length === 0) {
    return false
  }

  try {
    const eventsText = nodeTimelineEvents
      .map((e) => `${e.actorName}：${e.content}`)
      .join("\n")

    const expectedEmbedding = await embed(expectedOutcome, llmConfig)
    const eventsEmbedding = await embed(eventsText, llmConfig)

    const similarity = cosineSimilarity(expectedEmbedding, eventsEmbedding)
    return similarity >= EMBEDDING_SIMILARITY_THRESHOLD
  } catch (err) {
    console.warn("[simulation] embedding 判定失败，降级为启发式判定：", err)
    return isNodeGoalReached(node, nodeTimelineEvents, maxRounds, currentRound)
  }
}

// ── 内部辅助：从事件衍生传闻 ──

let rumorCounter = 0
function nextRumorId(): string {
  rumorCounter++
  return `rumor_${Date.now()}_${rumorCounter}`
}

function maybeDeriveRumor(
  event: TimelineEvent,
  blackboard: SimulationBlackboard,
  activeAgentIds: string[],
  random: () => number = Math.random,
): RumorEvent | null {
  const totalActive = activeAgentIds.length
  if (totalActive === 0) return null

  if (event.observableBy.length >= totalActive) {
    return null
  }

  if (random() >= 0.2) {
    return null
  }

  const actorId = event.actorId
  const targetId = event.targetId
  const excludedIds = new Set<string>()
  if (actorId) excludedIds.add(actorId)
  if (targetId) excludedIds.add(targetId)
  for (const id of event.observableBy) {
    excludedIds.add(id)
  }

  const eligibleAgents = activeAgentIds.filter((id) => !excludedIds.has(id))
  if (eligibleAgents.length === 0) return null

  const minCount = Math.min(2, eligibleAgents.length)
  const maxCount = Math.min(4, eligibleAgents.length)
  const count = Math.floor(random() * (maxCount - minCount + 1)) + minCount

  const shuffled = [...eligibleAgents]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  const observableBy = shuffled.slice(0, count)

  const distortion = 0.3 + random() * 0.4

  const rumor: RumorEvent = {
    id: nextRumorId(),
    round: event.round,
    nodeIndex: event.nodeIndex,
    sourceId: actorId ?? null,
    content: `据说${event.content}`,
    distortion,
    observableBy,
    believedBy: [],
    verifiedBy: [],
    timestamp: new Date().toISOString(),
    generation: 0,
  }

  recordRumorEvent(blackboard, rumor)
  return rumor
}

// ── 内部辅助：单个 Agent 决策并产生事件 ──

async function agentDecideAndAct(
  agent: NovelAgent,
  node: StoryNode,
  state: SimulationState,
  llmConfig: LlmConfig,
  extraction: ExtractionResult,
  recentEventDescs: string[],
  injectionEvent: string | undefined,
  blackboard: SimulationBlackboard,
  signal?: AbortSignal,
  modeHint?: string,
): Promise<{ parsed: ParsedAction; tlEvent: TimelineEvent; simEvent: SimulationEvent } | null> {
  // 1. 观察：筛选该 Agent 可见的时间线事件和传闻
  const visibleEvents = getBlackboardVisibleEvents(blackboard, agent.characterId, 10)
  const visibleRumors = getBlackboardVisibleRumors(blackboard, agent.characterId, 5)

  // 2. 构建上下文（基于认知边界）
  const context = buildAgentContext(
    agent,
    node,
    recentEventDescs.slice(-8),
    extraction.worldRules,
    visibleEvents,
    visibleRumors,
  )

  // 3. 构建 LLM 消息
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent) },
    {
      role: "user",
      content: buildUserMessage(context, node, agent.name, injectionEvent, modeHint),
    },
  ]

  // 4. 调用 LLM
  const rawResponse = await collectStream(llmConfig, messages, signal)
  if (signal?.aborted) return null

  // 5. 解析行为
  const parsed = parseAgentAction(rawResponse)

  // 6. 解析目标
  const target = resolveTarget(parsed.action.target, state.activeAgents)

  // 7. 创建时间线事件
  const tlEvent = createTimelineEvent(
    agent,
    parsed,
    target,
    state.currentRound,
    node.index,
    state.activeAgents,
  )

  // 8. 应用事件到相关 Agent 的记忆
  for (const id of tlEvent.observableBy) {
    const observer = state.activeAgents.get(id)
    if (observer) {
      applyEventToMemory(observer, tlEvent)
    }
  }

  // 9. 写入状态
  state.timelineEvents.push(tlEvent)

  // 10. 转换为旧 SimulationEvent
  const simEvent = timelineEventToSimulationEvent(
    tlEvent,
    agent,
    parsed,
    node,
    state.currentRound,
  )

  return { parsed, tlEvent, simEvent }
}

// ── ReAct 路径：使用 AgentRunner 进行工具调用循环 ──

function buildReactSystemPrompt(agent: NovelAgent): string {
  const personalityLine =
    agent.personality.length > 0
      ? `你的性格关键词：${agent.personality.join("、")}`
      : ""
  const styleLine = agent.speakingStyle
    ? `你的说话风格：${agent.speakingStyle}`
    : ""

  return [
    `你正在扮演小说中的真实角色「${agent.name}」。你不是AI助手，你就是这个角色本人。`,
    "",
    "【核心原则 - 必须严格遵守】",
    "1. 你是小说中的真实角色，只能基于你知道的信息行动，绝不能使用你不知道的信息。",
    "2. 绝对禁止全知视角：你不知道其他角色的内心想法，不知道没有发生在你面前的事情，不知道剧情走向。",
    "3. 严格遵循你的性格特征、说话风格和行为逻辑，不要跳出角色。",
    "4. 你的每个行为都应该有合理的动机，符合角色设定。",
    "",
    personalityLine,
    styleLine,
    "",
    "【可用工具】",
    "你可以使用以下工具来帮助你做出决策：",
    "- recall：回忆历史上你亲眼所见的事件",
    "- observe：观察当前轮次其他角色的公开行为",
    "- inquire：向另一个角色提出问题（对方下一轮可见）",
    "- introspect：审视自己的内心状态（情绪、目标、性格等）",
    "",
    "【决策流程】",
    "1. 你可以先使用工具收集信息（回忆、观察、提问、内省）",
    "2. 收集足够信息后，输出你的最终行为决策",
    "",
    "【行为类型说明】你只能选择以下一种行为类型：",
    "- evaluate：评价某人或某事，表达你的看法和判断",
    "- pushPlot：主动采取推动剧情发展的关键行动",
    "- observe：观察周围环境、人物或事态（不改变现状，只是获取信息）",
    "- react：对其他角色刚做出的行为做出即时反应",
    "- speak：与其他角色对话（说出台词）",
    "- ally：寻求结盟、合作、示好",
    "- confront：对抗、质疑、挑衅",
    "- conceal：隐瞒信息、假装不知道、掩饰真实想法",
    "- investigate：调查、探索、打听消息",
    "",
    "【输出格式】当你决定好最终行为后，必须输出一个严格的JSON对象，不要输出任何其他文字，不要使用markdown代码块：",
    "{",
    '  "type": "行为类型(从上面列表选一个)",',
    '  "content": "行为的具体内容/说的话/内心想法",',
    '  "target": "目标角色名（可选，没有目标就不填）",',
    '  "visibility": "all(所有人可见) 或 target_only(仅目标可见) 或 self(仅自己可见/内心活动)",',
    '  "motivation": "你为什么做出这个行为的内心动机",',
    '  "plot_push": "这个行为如何推动剧情向节点目标发展"',
    "}",
    "",
    "【可见性规则】",
    "- 公开的言行(speak/ally/confront/pushPlot的公开部分)用 all",
    "- 私下对话(speak带target)用 target_only",
    "- 内心想法(evaluate/observe的心理活动/conceal)用 self",
    "",
    "只输出JSON对象，不要输出任何其他文字。",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
}

export async function agentDecideAndActWithReact(
  agent: NovelAgent,
  node: StoryNode,
  state: SimulationState,
  llmConfig: LlmConfig,
  extraction: ExtractionResult,
  recentEventDescs: string[],
  injectionEvent: string | undefined,
  blackboard: SimulationBlackboard,
  signal?: AbortSignal,
  modeHint?: string,
): Promise<{ parsed: ParsedAction; tlEvent: TimelineEvent; simEvent: SimulationEvent } | null> {
  const visibleEvents = getBlackboardVisibleEvents(blackboard, agent.characterId, 10)
  const visibleRumors = getBlackboardVisibleRumors(blackboard, agent.characterId, 5)

  const context = buildAgentContext(
    agent,
    node,
    recentEventDescs.slice(-8),
    extraction.worldRules,
    visibleEvents,
    visibleRumors,
  )

  const userMessageParts: string[] = [context]
  if (modeHint) {
    userMessageParts.push("")
    userMessageParts.push("【行为倾向】")
    userMessageParts.push(modeHint)
  }
  if (injectionEvent) {
    userMessageParts.push("")
    userMessageParts.push("【突发事件】")
    userMessageParts.push(injectionEvent)
  }
  userMessageParts.push("")
  userMessageParts.push(
    `当前是节点「${node.title}」，节点目标是：${node.goal}。请根据以上信息，以「${agent.name}」的视角决定你接下来要做的一个行为。你可以先使用工具收集信息，然后输出最终的JSON行为决策。`,
  )
  const userMessageText = userMessageParts.join("\n")

  const registry = createSimAgentTools(agent, blackboard)
  const tools = registry.list()

  const config: AgentConfig = {
    maxRounds: 3,
    tools,
    systemPrompt: buildReactSystemPrompt(agent),
    llmConfig,
  }

  const messages: AgentMessage[] = [
    { role: "system", content: buildReactSystemPrompt(agent) },
    { role: "user", content: userMessageText },
  ]

  let finalText = ""

  const callbacks: AgentRunCallbacks = {
    onText: (chunk) => {
      finalText += chunk
    },
    onToolCall: () => {},
    onToolResult: () => {},
    onToolError: () => {},
    onDone: () => {},
    onError: (err) => {
      if (err instanceof ModelDoesNotSupportToolsError) {
        throw err
      }
    },
  }

  const runner = new AgentRunner()

  try {
    const record = await runner.run(config, registry, messages, callbacks, signal)
    if (signal?.aborted) return null

    if (record.finalText) {
      finalText = record.finalText
    }
  } catch (err) {
    if (err instanceof ModelDoesNotSupportToolsError) {
      throw err
    }
    if (!finalText) {
      throw err
    }
  }

  if (!finalText.trim()) {
    return null
  }

  const parsed = parseAgentAction(finalText)
  const target = resolveTarget(parsed.action.target, state.activeAgents)
  const tlEvent = createTimelineEvent(
    agent,
    parsed,
    target,
    state.currentRound,
    node.index,
    state.activeAgents,
  )

  for (const id of tlEvent.observableBy) {
    const observer = state.activeAgents.get(id)
    if (observer) {
      applyEventToMemory(observer, tlEvent)
    }
  }

  state.timelineEvents.push(tlEvent)

  const simEvent = timelineEventToSimulationEvent(
    tlEvent,
    agent,
    parsed,
    node,
    state.currentRound,
  )

  return { parsed, tlEvent, simEvent }
}

// ── 主入口：运行仿真（多智能体，基于认知边界） ──

export async function runSimulation(
  input: SimulationInput,
  extraction: ExtractionResult,
  callbacks: SimulationCallbacks,
  signal?: AbortSignal,
): Promise<SimulationEvent[]> {
  const events: SimulationEvent[] = []
  const { agents, framework, wordBudget, llmConfig, injectionEvent, maxRoundsPerNode, dynamicEventPool, resume } = input
  const mode = input.mode || framework.simulationMode || "hybrid"
  const modeConfig: ModeConfig = getModeConfig(mode)
  const totalNodes = framework.nodes.length
  // 使用用户指定的轮数，若未指定则自动计算并乘以模式系数
  const calculatedRounds = calcMaxRoundsPerNode(wordBudget) || MAX_ROUNDS_PER_NODE_FALLBACK
  const baseRounds = Math.max(1, maxRoundsPerNode ?? calculatedRounds)
  const maxRounds = Math.max(1, Math.round(baseRounds * modeConfig.roundsMultiplier))
  let aborted = false
  const resumeTimelineEvents = resume?.timelineEvents ?? []
  const normalizedResumeNodeIndex = Math.max(0, Math.min(totalNodes - 1, resume?.nextNodeIndex ?? 0))
  const normalizedResumeRound = Math.max(0, resume?.nextRound ?? 0)

  const isStagedPool =
    dynamicEventPool &&
    typeof dynamicEventPool === "object" &&
    !Array.isArray(dynamicEventPool) &&
    "byStage" in dynamicEventPool &&
    "all" in dynamicEventPool

  const stagedPool: StagedEventPool | undefined = isStagedPool
    ? (dynamicEventPool as StagedEventPool)
    : dynamicEventPool && Array.isArray(dynamicEventPool) && dynamicEventPool.length > 0
      ? stringArrayToStagedPool(dynamicEventPool)
      : undefined

  const stringPool: string[] | undefined = dynamicEventPool
    ? (Array.isArray(dynamicEventPool)
        ? dynamicEventPool
        : (dynamicEventPool as StagedEventPool).all.map((e) => e.text))
    : undefined

  const usedEventIds: Set<string> | undefined = stagedPool ? new Set() : undefined

  // 初始化仿真状态
  const state: SimulationState = {
    currentRound: 0,
    timelineEvents: [...resumeTimelineEvents],
    activeAgents: cloneAgentsToMap(agents),
    worldState: {},
    dynamicEventPool: stringPool && stringPool.length > 0 ? stringPool : undefined,
    usedEventIndices: stringPool && stringPool.length > 0 ? new Set() : undefined,
    directorEnabled: modeConfig.directorEnabled ?? false,
    nextNodeInjectionMap: new Map(),
  }
  const blackboard = createSimulationBlackboard({
    agents: Array.from(state.activeAgents.values()),
    timelineEvents: resumeTimelineEvents,
  })

  try {
    for (const event of resumeTimelineEvents) {
      callbacks.onTimelineEvent?.(event)
      events.push(timelineEventToResumeSimulationEvent(event, framework))
    }

    let startNodeIndex = resume ? normalizedResumeNodeIndex : 0
    let firstNodeStartRound = resume ? normalizedResumeRound : 0
    if (firstNodeStartRound >= maxRounds) {
      startNodeIndex += 1
      firstNodeStartRound = 0
    }

    for (let ni = startNodeIndex; ni < totalNodes; ni++) {
      if (signal?.aborted) {
        aborted = true
        break
      }

      const node = framework.nodes[ni]
      const isResumingInsideNode = !!resume && ni === startNodeIndex && firstNodeStartRound > 0

      const nodeAgentList = selectNodeAgentCandidates(blackboard, node)

      // 设置本轮活跃 Agent
      const activeMap = new Map<string, NovelAgent>()
      for (const a of nodeAgentList) {
        activeMap.set(a.characterId, a)
      }
      state.activeAgents = activeMap
      blackboard.activeAgents = activeMap

      if (!isResumingInsideNode) {
        // 产出 node-start 事件
        const startEvent: SimulationEvent = {
          type: "node-start",
          node,
          timestamp: new Date().toISOString(),
        }
        events.push(startEvent)
        callbacks.onEvent(startEvent)
      }

      callbacks.onProgress(
        Math.round((ni / totalNodes) * 100),
        `开始节点 ${ni + 1}/${totalNodes}：${node.title}`,
      )

      // 当前节点的注入事件：优先从导演注入映射取，其次用初始注入事件（仅第一个节点）
      const directorInjection = state.nextNodeInjectionMap.get(node.index)
      const initialInjection = ni === 0 ? injectionEvent : undefined
      const nodeInjectionEvent = directorInjection || initialInjection

      // 当前节点内的事件描述（供 recentEvents 使用）
      const previousNodeEvents = resumeTimelineEvents.filter((event) => event.nodeIndex === node.index)
      const recentEventDescs: string[] = previousNodeEvents.map(
        (event) => `[已保存] ${event.actorName}：${event.content}`,
      )
      const nodeTimelineEvents: TimelineEvent[] = [...previousNodeEvents]

      // 节点内多轮交互
      const roundStart = ni === startNodeIndex ? firstNodeStartRound : 0
      for (let round = roundStart; round < maxRounds; round++) {
        if (signal?.aborted) {
          aborted = true
          break
        }

        state.currentRound = round

        const roundPlan = planMultiAgentRound({
          node,
          state,
          candidateAgents: nodeAgentList,
          modeConfig,
          round,
        })
        blackboard.roundPlans.push(roundPlan)
        callbacks.onDebugTrace?.(
          createBlackboardDebugTrace(blackboard, {
            type: "round-plan",
            node,
            round,
            candidateAgents: nodeAgentList,
            plan: roundPlan,
          }),
        )
        const roundAgentList = roundPlan.turns
          .map((turn) => state.activeAgents.get(turn.agentId))
          .filter((agent): agent is NovelAgent => !!agent)

        // a. 每个活跃 Agent 观察并决策
        for (const agent of roundAgentList) {
          if (signal?.aborted) {
            aborted = true
            break
          }

          // 获取最新状态的 agent 引用（可能被之前的事件更新了记忆）
          const currentAgent = state.activeAgents.get(agent.characterId)
          if (!currentAgent) continue

          let result: Awaited<ReturnType<typeof agentDecideAndAct>> | null = null
          try {
            try {
              result = await agentDecideAndActWithReact(
                currentAgent,
                node,
                state,
                llmConfig,
                extraction,
                recentEventDescs,
                round === 0 ? nodeInjectionEvent : undefined,
                blackboard,
                signal,
                modeConfig.behaviorHint,
              )
            } catch (reactErr) {
              if (reactErr instanceof ModelDoesNotSupportToolsError) {
                console.warn(
                  `[simulation] Agent ${currentAgent.name} ReAct 路径不支持工具调用，降级为普通路径`,
                )
                result = await agentDecideAndAct(
                  currentAgent,
                  node,
                  state,
                  llmConfig,
                  extraction,
                  recentEventDescs,
                  round === 0 ? nodeInjectionEvent : undefined,
                  blackboard,
                  signal,
                  modeConfig.behaviorHint,
                )
              } else {
                throw reactErr
              }
            }
          } catch (agentErr) {
            if (signal?.aborted || (agentErr instanceof Error && agentErr.name === "AbortError")) {
              aborted = true
              break
            }
            console.warn(`[simulation] Agent ${currentAgent.name} 决策失败，跳过本轮：`, agentErr)
            const warnEvent: SimulationEvent = {
              type: "info",
              timestamp: new Date().toISOString(),
              message: `${currentAgent.name} 本轮无行动（API错误），继续推演`,
            }
            events.push(warnEvent)
            callbacks.onEvent(warnEvent)
            continue
          }

          if (!result) {
            if (signal?.aborted) {
              aborted = true
              break
            }
            // null 且非 abort，跳过该 agent 继续
            continue
          }

          const { parsed, tlEvent, simEvent } = result

          events.push(simEvent)
          recordBlackboardEvent(blackboard, tlEvent)
          maybeDeriveRumor(tlEvent, blackboard, Array.from(state.activeAgents.keys()))
          callbacks.onEvent(simEvent)
          callbacks.onTimelineEvent?.(tlEvent)
          callbacks.onDebugTrace?.(
            createBlackboardDebugTrace(blackboard, {
              type: "event-recorded",
              node,
              round,
              candidateAgents: nodeAgentList,
              plan: roundPlan,
              latestEvent: tlEvent,
            }),
          )

          recentEventDescs.push(
            formatActionDescription(parsed.action, currentAgent.name),
          )
          nodeTimelineEvents.push(tlEvent)

          // d. 如果行为有目标且目标是可见的，触发目标的 react（反应链，限制深度）
          if (
            tlEvent.targetId &&
            parsed.action.type !== "react" &&
            parsed.visibility !== "self"
          ) {
            const targetAgent = state.activeAgents.get(tlEvent.targetId)
            if (targetAgent && REACT_CHAIN_LIMIT > 0) {
              await triggerReaction(
                targetAgent,
                currentAgent,
                tlEvent,
                node,
                state,
                llmConfig,
                extraction,
                recentEventDescs,
                events,
                callbacks,
                nodeTimelineEvents,
                blackboard,
                signal,
              )
              if (signal?.aborted) {
                aborted = true
                break
              }
            }
          }
        }

        if (aborted) break

        // e. 随机事件（根据模式概率触发）
        if (modeConfig.randomEventChance > 0 && Math.random() < modeConfig.randomEventChance) {
          const { event: randomEvent, usedIndex, usedEventId } = generateRandomEvent(
            stagedPool ?? state.dynamicEventPool,
            usedEventIds ?? state.usedEventIndices,
            node.index,
            totalNodes,
          )
          if (randomEvent) {
            if (usedEventId !== undefined && usedEventIds) {
              usedEventIds.add(usedEventId)
            }
            if (usedIndex !== undefined && state.usedEventIndices) {
              state.usedEventIndices.add(usedIndex)
            }
            events.push(randomEvent)
            callbacks.onEvent(randomEvent)
            const tlEvent: TimelineEvent = {
              id: `tl-rand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              actorId: "system",
              actorName: "系统事件",
              actionType: "pushPlot",
              content: randomEvent.message || "",
              observableBy: Array.from(state.activeAgents.keys()),
              round,
              nodeIndex: node.index,
              timestamp: new Date().toISOString(),
              impacts: [],
              targetId: undefined,
              targetName: undefined,
            }
            state.timelineEvents.push(tlEvent)
            recordBlackboardEvent(blackboard, tlEvent)
            nodeTimelineEvents.push(tlEvent)
            callbacks.onTimelineEvent?.(tlEvent)
            callbacks.onDebugTrace?.(
              createBlackboardDebugTrace(blackboard, {
                type: "event-recorded",
                node,
                round,
                candidateAgents: nodeAgentList,
                plan: roundPlan,
                latestEvent: tlEvent,
              }),
            )
            recentEventDescs.push(`[系统事件] ${randomEvent.message}`)
          }
        }

        if (signal?.aborted) {
          aborted = true
          break
        }

        // f. 检查节点目标是否达成
        const goalReached = await isNodeGoalReachedWithEmbedding(
          node,
          nodeTimelineEvents,
          maxRounds,
          round,
          llmConfig,
        )
        if (goalReached) {
          break
        }
      }

      if (aborted) break

      // 导演 Agent 评估（仅在启用时）
      if (state.directorEnabled && ni < totalNodes - 1) {
        try {
          const directorEval = await directorEvaluate({
            node,
            nodeTimelineEvents,
            worldRules: extraction.worldRules,
            llmConfig,
            signal,
          })

          if (shouldInjectEvent(directorEval) && directorEval.injectEvent) {
            const nextNodeIndex = ni + 1
            state.nextNodeInjectionMap.set(nextNodeIndex, directorEval.injectEvent)
          }
        } catch (directorErr) {
          console.warn("[simulation] 导演 Agent 评估失败，继续推演：", directorErr)
        }
      }

      // 产出 node-complete 事件
      const completeEvent: SimulationEvent = {
        type: "node-complete",
        node,
        timestamp: new Date().toISOString(),
      }
      events.push(completeEvent)
      callbacks.onEvent(completeEvent)

      callbacks.onProgress(
        Math.round(((ni + 1) / totalNodes) * 100),
        `完成节点 ${ni + 1}/${totalNodes}：${node.title}`,
      )
    }

    if (!aborted && !signal?.aborted) {
      callbacks.onComplete(events)
    }

    return events
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    // 如果是 abort 导致的错误，正常返回已收集事件
    if (signal?.aborted || error.name === "AbortError") {
      return events
    }
    // 其他致命错误才回调 onError 并抛出
    console.error("[simulation] 仿真引擎致命错误：", error)
    callbacks.onError(error)
    // 如果已经收集了一些事件，仍然返回它们而非抛出，让上层能部分使用结果
    if (events.length > 0) {
      const errorEvent: SimulationEvent = {
        type: "info",
        timestamp: new Date().toISOString(),
        message: `推演过程中遇到错误：${error.message}，已返回已推演内容`,
      }
      events.push(errorEvent)
      callbacks.onEvent(errorEvent)
      callbacks.onComplete(events)
      return events
    }
    throw error
  }
}

// ── 内部辅助：触发目标 Agent 对事件的反应（react 行为） ──

async function triggerReaction(
  targetAgent: NovelAgent,
  actor: NovelAgent,
  triggerEvent: TimelineEvent,
  node: StoryNode,
  state: SimulationState,
  llmConfig: LlmConfig,
  extraction: ExtractionResult,
  recentEventDescs: string[],
  events: SimulationEvent[],
  callbacks: SimulationCallbacks,
  nodeTimelineEvents: TimelineEvent[],
  blackboard: SimulationBlackboard,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return

  // 构建反应专用上下文：强调对刚才事件的反应
  const visibleEvents = getBlackboardVisibleEvents(
    blackboard,
    targetAgent.characterId,
    10,
  )
  const visibleRumors = getBlackboardVisibleRumors(
    blackboard,
    targetAgent.characterId,
    5,
  )

  const reactionNote = `\n\n【刚才发生的事情】\n${actor.name}刚刚对你做出了行为：[${triggerEvent.actionType}] ${triggerEvent.content}\n请你立即对此做出反应（react类型行为）。`

  const baseContext = buildAgentContext(
    targetAgent,
    node,
    recentEventDescs.slice(-8),
    extraction.worldRules,
    visibleEvents,
    visibleRumors,
  )

  const context = baseContext + reactionNote

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(targetAgent) },
    {
      role: "user",
      content:
        context +
        `\n\n请以「${targetAgent.name}」的视角，对${actor.name}刚才的行为立即做出反应，输出JSON。`,
    },
  ]

  try {
    const rawResponse = await collectStream(llmConfig, messages, signal)
    if (signal?.aborted) return

    const parsed = parseAgentAction(rawResponse)
    // 强制行为类型为 react
    parsed.action.type = "react"
    parsed.action.target = actor.name

    const tlEvent = createTimelineEvent(
      targetAgent,
      parsed,
      actor,
      state.currentRound,
      node.index,
      state.activeAgents,
    )

    // 应用记忆
    for (const id of tlEvent.observableBy) {
      const observer = state.activeAgents.get(id)
      if (observer) {
        applyEventToMemory(observer, tlEvent)
      }
    }

    state.timelineEvents.push(tlEvent)
    recordBlackboardEvent(blackboard, tlEvent)
    maybeDeriveRumor(tlEvent, blackboard, Array.from(state.activeAgents.keys()))
    nodeTimelineEvents.push(tlEvent)
    callbacks.onDebugTrace?.(
      createBlackboardDebugTrace(blackboard, {
        type: "event-recorded",
        node,
        round: state.currentRound,
        latestEvent: tlEvent,
      }),
    )

    const simEvent = timelineEventToSimulationEvent(
      tlEvent,
      targetAgent,
      parsed,
      node,
      state.currentRound,
    )

    events.push(simEvent)
    callbacks.onEvent(simEvent)
    callbacks.onTimelineEvent?.(tlEvent)

    recentEventDescs.push(
      formatActionDescription(parsed.action, targetAgent.name),
    )
  } catch {
    // 反应失败不中断主流程
  }
}
