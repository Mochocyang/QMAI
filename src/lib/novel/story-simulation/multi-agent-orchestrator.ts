import type {
  ModeConfig,
  NovelAgent,
  SimulationDebugTrace,
  SimulationDebugVisibleEvent,
  SimulationState,
  StoryNode,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

export interface AgentTurnPlan {
  agentId: string
  agentName: string
  round: number
  nodeIndex: number
  role: "actor"
  reason: string
}

export interface MultiAgentRoundPlan {
  round: number
  nodeIndex: number
  strategy: "all-agents" | "subset" | "none"
  turns: AgentTurnPlan[]
}

export interface SimulationBlackboard {
  allAgents: Map<string, NovelAgent>
  activeAgents: Map<string, NovelAgent>
  events: TimelineEvent[]
  publicEvents: TimelineEvent[]
  visibleEventsByAgent: Map<string, TimelineEvent[]>
  roundPlans: MultiAgentRoundPlan[]
}

export interface CreateSimulationBlackboardInput {
  agents: NovelAgent[]
  timelineEvents?: TimelineEvent[]
}

export interface PlanMultiAgentRoundInput {
  node: StoryNode
  state: SimulationState
  candidateAgents: NovelAgent[]
  modeConfig: ModeConfig
  round: number
  random?: () => number
}

export interface CreateBlackboardDebugTraceInput {
  type: SimulationDebugTrace["type"]
  node: StoryNode
  round: number
  candidateAgents?: NovelAgent[]
  plan?: MultiAgentRoundPlan
  latestEvent?: TimelineEvent
  visibleEventLimit?: number
  timestamp?: string
}

export function createSimulationBlackboard(
  input: CreateSimulationBlackboardInput,
): SimulationBlackboard {
  const activeAgents = new Map(
    input.agents.map((agent) => [agent.characterId, agent] as const),
  )
  const blackboard: SimulationBlackboard = {
    allAgents: new Map(activeAgents),
    activeAgents,
    events: [],
    publicEvents: [],
    visibleEventsByAgent: new Map(
      input.agents.map((agent) => [agent.characterId, [] as TimelineEvent[]]),
    ),
    roundPlans: [],
  }

  for (const event of input.timelineEvents ?? []) {
    recordBlackboardEvent(blackboard, event)
  }

  return blackboard
}

export function selectNodeAgentCandidates(
  blackboard: SimulationBlackboard,
  node: StoryNode,
): NovelAgent[] {
  const allAgents = Array.from(blackboard.allAgents.values())
  if (allAgents.length === 0) return []

  const involved = new Set(node.involvedCharacters.map((name) => name.trim()))
  const matched = allAgents.filter(
    (agent) => involved.has(agent.name) || involved.has(agent.characterId),
  )

  return matched.length > 0 ? matched : allAgents
}

export function getBlackboardVisibleEvents(
  blackboard: SimulationBlackboard,
  agentId: string,
  limit?: number,
): TimelineEvent[] {
  const events = blackboard.visibleEventsByAgent.get(agentId) ?? []
  if (limit === undefined || limit <= 0 || events.length <= limit) {
    return [...events]
  }
  return events.slice(-limit)
}

export function createBlackboardDebugTrace(
  blackboard: SimulationBlackboard,
  input: CreateBlackboardDebugTraceInput,
): SimulationDebugTrace {
  const timestamp = input.timestamp ?? new Date().toISOString()
  const visibleEventLimit = input.visibleEventLimit ?? 3

  return {
    id: `debug-${input.type}-${input.node.index}-${input.round}-${timestamp}`,
    type: input.type,
    nodeIndex: input.node.index,
    nodeTitle: input.node.title,
    round: input.round,
    strategy: input.plan?.strategy,
    candidateAgents: (input.candidateAgents ?? []).map((agent) => ({
      agentId: agent.characterId,
      agentName: agent.name,
    })),
    selectedAgents: (input.plan?.turns ?? []).map((turn) => ({
      agentId: turn.agentId,
      agentName: turn.agentName,
      reason: turn.reason,
    })),
    blackboard: {
      allAgentCount: blackboard.allAgents.size,
      activeAgentCount: blackboard.activeAgents.size,
      totalEventCount: blackboard.events.length,
      publicEventCount: blackboard.publicEvents.length,
    },
    visibilityByAgent: Array.from(blackboard.allAgents.values()).map((agent) => {
      const allVisibleEvents = blackboard.visibleEventsByAgent.get(agent.characterId) ?? []
      return {
        agentId: agent.characterId,
        agentName: agent.name,
        visibleEventCount: allVisibleEvents.length,
        recentEvents: getBlackboardVisibleEvents(
          blackboard,
          agent.characterId,
          visibleEventLimit,
        ).map(toDebugVisibleEvent),
      }
    }),
    latestEvent: input.latestEvent ? toDebugVisibleEvent(input.latestEvent) : undefined,
    timestamp,
  }
}

export function recordBlackboardEvent(
  blackboard: SimulationBlackboard,
  event: TimelineEvent,
): void {
  blackboard.events.push(event)

  for (const agentId of event.observableBy) {
    if (!blackboard.visibleEventsByAgent.has(agentId)) {
      blackboard.visibleEventsByAgent.set(agentId, [])
    }
    blackboard.visibleEventsByAgent.get(agentId)!.push(event)
  }

  if (isPublicEvent(blackboard, event)) {
    blackboard.publicEvents.push(event)
  }
}

export function planMultiAgentRound(
  input: PlanMultiAgentRoundInput,
): MultiAgentRoundPlan {
  const eligibleAgents = input.candidateAgents.filter((agent) =>
    input.state.activeAgents.has(agent.characterId),
  )

  if (eligibleAgents.length === 0) {
    return {
      round: input.round,
      nodeIndex: input.node.index,
      strategy: "none",
      turns: [],
    }
  }

  const ratio = input.modeConfig.agentSubsetRatio
  const strategy: MultiAgentRoundPlan["strategy"] =
    ratio >= 1 ? "all-agents" : "subset"
  const selectedAgents =
    ratio >= 1
      ? eligibleAgents
      : selectAgentSubset(
          eligibleAgents,
          Math.max(1, Math.ceil(eligibleAgents.length * Math.max(0, ratio))),
          input.random ?? Math.random,
        )

  const turns: AgentTurnPlan[] = selectedAgents.map((agent) => ({
    agentId: agent.characterId,
    agentName: agent.name,
    round: input.round,
    nodeIndex: input.node.index,
    role: "actor",
    reason: strategy === "all-agents" ? "模式要求全部角色参与" : "模式选择部分角色参与",
  }))

  return {
    round: input.round,
    nodeIndex: input.node.index,
    strategy,
    turns,
  }
}

function isPublicEvent(
  blackboard: SimulationBlackboard,
  event: TimelineEvent,
): boolean {
  if (blackboard.activeAgents.size === 0) return false
  const visibleIds = new Set(event.observableBy)
  for (const agentId of blackboard.activeAgents.keys()) {
    if (!visibleIds.has(agentId)) return false
  }
  return true
}

function selectAgentSubset(
  agents: NovelAgent[],
  count: number,
  random: () => number,
): NovelAgent[] {
  const shuffled = [...agents]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

function toDebugVisibleEvent(event: TimelineEvent): SimulationDebugVisibleEvent {
  return {
    id: event.id,
    actorName: event.actorName,
    actionType: event.actionType,
    content: event.content,
    round: event.round,
    nodeIndex: event.nodeIndex,
  }
}
