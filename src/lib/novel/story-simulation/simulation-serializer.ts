/**
 * Agent 状态序列化/反序列化
 * 将 NovelAgent 和 SimulationState 中的 Set/Map 转换为可 JSON 序列化的格式，
 * 以便保存推演结果后，加载历史结果时也能进行角色采访。
 */

import type {
  AgentMemory,
  AgentRelation,
  NovelAgent,
  SimulationState,
} from "./types"

// ── 可序列化的类型定义 ──

interface SerializedAgentMemory {
  observedEvents: string[]
  knownSecrets: string[]
  sentiments: Record<string, number>
  recentDecisions: string[]
}

interface SerializedNovelAgent {
  characterId: string
  name: string
  profile: string
  aura: unknown | null
  cognition: { knows: string[]; doesNotKnow: string[] } | null
  soul: string
  currentGoal: string
  emotionalState: string
  knownFacts: string[]
  relationships: Array<{
    targetId: string
    relationType: string
    sentiment: number
  }>
  powerLevel: string
  memory: SerializedAgentMemory
  knowledgeScope: string[]
  personality: string[]
  speakingStyle: string
}

interface SerializedSimulationState {
  currentRound: number
  timelineEvents: unknown[]
  activeAgents: Record<string, SerializedNovelAgent>
  worldState: Record<string, unknown>
}

export interface SerializedSimulationSnapshot {
  agents: SerializedNovelAgent[]
  state: SerializedSimulationState
}

// ── 序列化 ──

function serializeMemory(memory: AgentMemory): SerializedAgentMemory {
  return {
    observedEvents: Array.from(memory.observedEvents),
    knownSecrets: Array.from(memory.knownSecrets),
    sentiments: Object.fromEntries(memory.sentiments),
    recentDecisions: Array.from(memory.recentDecisions),
  }
}

export function serializeAgent(agent: NovelAgent): SerializedNovelAgent {
  return {
    characterId: agent.characterId,
    name: agent.name,
    profile: agent.profile,
    aura: agent.aura,
    cognition: agent.cognition,
    soul: agent.soul,
    currentGoal: agent.currentGoal,
    emotionalState: agent.emotionalState,
    knownFacts: Array.from(agent.knownFacts),
    relationships: Array.from(agent.relationships.values()),
    powerLevel: agent.powerLevel,
    memory: serializeMemory(agent.memory),
    knowledgeScope: agent.knowledgeScope,
    personality: agent.personality,
    speakingStyle: agent.speakingStyle,
  }
}

export function serializeSimulationState(
  state: SimulationState,
  agents: NovelAgent[],
): SerializedSimulationSnapshot {
  const serializedAgents = agents.map(serializeAgent)
  return {
    agents: serializedAgents,
    state: {
      currentRound: state.currentRound,
      timelineEvents: state.timelineEvents,
      activeAgents: Object.fromEntries(
        serializedAgents.map((a) => [a.characterId, a]),
      ),
      worldState: state.worldState,
    },
  }
}

// ── 反序列化 ──

function deserializeMemory(s: SerializedAgentMemory): AgentMemory {
  return {
    observedEvents: s.observedEvents,
    knownSecrets: new Set(s.knownSecrets),
    sentiments: new Map(Object.entries(s.sentiments)),
    recentDecisions: s.recentDecisions,
  }
}

export function deserializeAgent(s: SerializedNovelAgent): NovelAgent {
  const relationships = new Map<string, AgentRelation>()
  for (const r of s.relationships) {
    relationships.set(r.targetId, r)
  }
  return {
    characterId: s.characterId,
    name: s.name,
    profile: s.profile,
    aura: s.aura as NovelAgent["aura"],
    cognition: s.cognition,
    soul: s.soul,
    currentGoal: s.currentGoal,
    emotionalState: s.emotionalState,
    knownFacts: new Set(s.knownFacts),
    relationships,
    powerLevel: s.powerLevel,
    memory: deserializeMemory(s.memory),
    knowledgeScope: s.knowledgeScope,
    personality: s.personality,
    speakingStyle: s.speakingStyle,
  }
}

export function deserializeSimulationSnapshot(
  snapshot: SerializedSimulationSnapshot,
): { agents: NovelAgent[]; state: SimulationState } {
  const agents = snapshot.agents.map(deserializeAgent)
  const activeAgents = new Map<string, NovelAgent>()
  for (const a of agents) {
    activeAgents.set(a.characterId, a)
  }
  const state: SimulationState = {
    currentRound: snapshot.state.currentRound,
    timelineEvents: snapshot.state.timelineEvents as SimulationState["timelineEvents"],
    activeAgents,
    worldState: snapshot.state.worldState,
    directorEnabled: false,
    nextNodeInjectionMap: new Map(),
  }
  return { agents, state }
}
