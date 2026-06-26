import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  buildAgentContext,
  getVisibleEvents,
} from "@/lib/novel/story-simulation/agent-profile-builder"
import type {
  ActionVisibility,
  AgentAction,
  AgentActionType,
  EventImpact,
  ExtractionResult,
  NovelAgent,
  SimulationEvent,
  SimulationInput,
  SimulationState,
  StoryNode,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import { calcMaxRoundsPerNode } from "@/lib/novel/story-simulation/types"

// ── 对外接口 ──

export interface SimulationCallbacks {
  onEvent: (event: SimulationEvent) => void
  onProgress: (progress: number, label: string) => void
  onComplete: (events: SimulationEvent[]) => void
  onError: (error: Error) => void
  /** 新引擎时间线事件回调 */
  onTimelineEvent?: (event: TimelineEvent) => void
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
): string {
  const parts: string[] = [context]
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

// ── 内部辅助：单个 Agent 决策并产生事件 ──

async function agentDecideAndAct(
  agent: NovelAgent,
  node: StoryNode,
  state: SimulationState,
  llmConfig: LlmConfig,
  extraction: ExtractionResult,
  recentEventDescs: string[],
  injectionEvent: string | undefined,
  signal?: AbortSignal,
): Promise<{ parsed: ParsedAction; tlEvent: TimelineEvent; simEvent: SimulationEvent } | null> {
  // 1. 观察：筛选该 Agent 可见的时间线事件
  const visibleEvents = getVisibleEvents(
    agent.characterId,
    state.timelineEvents,
    10,
  )

  // 2. 构建上下文（基于认知边界）
  const context = buildAgentContext(
    agent,
    node,
    recentEventDescs.slice(-8),
    extraction.worldRules,
    visibleEvents,
  )

  // 3. 构建 LLM 消息
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent) },
    {
      role: "user",
      content: buildUserMessage(context, node, agent.name, injectionEvent),
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

// ── 主入口：运行仿真（多智能体，基于认知边界） ──

export async function runSimulation(
  input: SimulationInput,
  extraction: ExtractionResult,
  callbacks: SimulationCallbacks,
  signal?: AbortSignal,
): Promise<SimulationEvent[]> {
  const events: SimulationEvent[] = []
  const { agents, framework, wordBudget, llmConfig, injectionEvent, maxRoundsPerNode } = input
  const totalNodes = framework.nodes.length
  // 使用用户指定的轮数，若未指定则自动计算
  const calculatedRounds = calcMaxRoundsPerNode(wordBudget) || MAX_ROUNDS_PER_NODE_FALLBACK
  const maxRounds = Math.max(1, maxRoundsPerNode ?? calculatedRounds)
  let aborted = false

  // 初始化仿真状态
  const state: SimulationState = {
    currentRound: 0,
    timelineEvents: [],
    activeAgents: cloneAgentsToMap(agents),
    worldState: {},
  }

  try {
    for (let ni = 0; ni < totalNodes; ni++) {
      if (signal?.aborted) {
        aborted = true
        break
      }

      const node = framework.nodes[ni]

      // 确定参与角色：从 involvedCharacters（角色名）过滤 agents
      const nodeAgentIds = new Set<string>()
      for (const a of agents) {
        if (node.involvedCharacters.includes(a.name)) {
          nodeAgentIds.add(a.characterId)
        }
      }
      // 防御：若过滤结果为空，使用全部 agents
      let nodeAgentList: NovelAgent[]
      if (nodeAgentIds.size === 0) {
        nodeAgentList = Array.from(state.activeAgents.values())
      } else {
        nodeAgentList = Array.from(state.activeAgents.values()).filter((a) =>
          nodeAgentIds.has(a.characterId),
        )
      }

      // 设置本轮活跃 Agent
      const activeMap = new Map<string, NovelAgent>()
      for (const a of nodeAgentList) {
        activeMap.set(a.characterId, a)
      }
      state.activeAgents = activeMap

      // 产出 node-start 事件
      const startEvent: SimulationEvent = {
        type: "node-start",
        node,
        timestamp: new Date().toISOString(),
      }
      events.push(startEvent)
      callbacks.onEvent(startEvent)

      callbacks.onProgress(
        Math.round((ni / totalNodes) * 100),
        `开始节点 ${ni + 1}/${totalNodes}：${node.title}`,
      )

      // 当前节点内的事件描述（供 recentEvents 使用）
      const recentEventDescs: string[] = []
      const nodeTimelineEvents: TimelineEvent[] = []

      // 节点内多轮交互
      for (let round = 0; round < maxRounds; round++) {
        if (signal?.aborted) {
          aborted = true
          break
        }

        state.currentRound = round

        // a. 每个活跃 Agent 观察并决策
        for (const agent of nodeAgentList) {
          if (signal?.aborted) {
            aborted = true
            break
          }

          // 获取最新状态的 agent 引用（可能被之前的事件更新了记忆）
          const currentAgent = state.activeAgents.get(agent.characterId)
          if (!currentAgent) continue

          const result = await agentDecideAndAct(
            currentAgent,
            node,
            state,
            llmConfig,
            extraction,
            recentEventDescs,
            round === 0 ? injectionEvent : undefined,
            signal,
          )

          if (!result) {
            if (signal?.aborted) {
              aborted = true
            }
            break
          }

          const { parsed, tlEvent, simEvent } = result

          events.push(simEvent)
          callbacks.onEvent(simEvent)
          callbacks.onTimelineEvent?.(tlEvent)

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
                signal,
              )
            }
          }
        }

        if (aborted) break

        // e. 检查节点目标是否达成
        if (isNodeGoalReached(node, nodeTimelineEvents, maxRounds, round)) {
          break
        }
      }

      if (aborted) break

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
    callbacks.onError(error)
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
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return

  // 构建反应专用上下文：强调对刚才事件的反应
  const visibleEvents = getVisibleEvents(
    targetAgent.characterId,
    state.timelineEvents,
    10,
  )

  const reactionNote = `\n\n【刚才发生的事情】\n${actor.name}刚刚对你做出了行为：[${triggerEvent.actionType}] ${triggerEvent.content}\n请你立即对此做出反应（react类型行为）。`

  const baseContext = buildAgentContext(
    targetAgent,
    node,
    recentEventDescs.slice(-8),
    extraction.worldRules,
    visibleEvents,
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
    nodeTimelineEvents.push(tlEvent)

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
