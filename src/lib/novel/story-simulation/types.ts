import type { CharacterAura } from "@/lib/novel/character-aura"
import type { CognitionState } from "@/lib/novel/character-cognition"
import type { ForeshadowingStore } from "@/lib/novel/foreshadowing-tracker"
import type { LlmConfig } from "@/stores/wiki-store"

// ── 仿真模式 ──
export type SimulationMode = "event-driven" | "free-emergence" | "decision-tree" | "hybrid"

// ── Agent 行为类型 ──
export type AgentActionType =
  | "evaluate"    // 角色评价/看法
  | "pushPlot"    // 事态推动/主动行动
  | "observe"     // 观察/感知
  | "react"       // 对他人行为的反应
  | "speak"       // 对话
  | "ally"        // 结盟/合作
  | "confront"    // 对抗
  | "conceal"     // 隐瞒
  | "investigate" // 调查
  // 保留旧类型以兼容已有代码（新引擎不再产生）
  | "act"
  | "decide"
  | "conflict"
  | "cooperate"
  | "withhold"

export type ActionVisibility = "all" | "target_only" | "self"

/**
 * Agent 行为（扁平化结构，与 LLM 输出 JSON 对齐）
 */
export interface AgentAction {
  type: AgentActionType
  content: string
  target?: string
  /** 行为可见性：公开(all)/仅目标可见(target_only)/仅自己可见(self) */
  visibility?: ActionVisibility
  /** 行为动机 */
  motivation?: string
  /** 如何推动剧情 */
  plot_push?: string
}

// ── 事件影响类型 ──
export type EventImpactType = "sentiment" | "knowledge" | "relationship"

export interface EventImpact {
  characterId: string
  type: EventImpactType
  detail: string
}

// ── 时间线事件（新仿真引擎核心事件结构） ──
export interface TimelineEvent {
  id: string
  round: number
  nodeIndex: number
  actorId: string
  actorName: string
  actionType: AgentActionType
  content: string
  targetId?: string
  targetName?: string
  /** 能观察到该事件的角色 ID 列表 */
  observableBy: string[]
  /** 事件对角色的影响 */
  impacts: EventImpact[]
  timestamp: string
}

// ── Agent 记忆 ──
export interface AgentMemory {
  /** 已观察到的事件 ID 列表 */
  observedEvents: string[]
  /** 已知秘密集合 */
  knownSecrets: Set<string>
  /** 对其他角色的情感值：key=角色ID, value=-100~100 */
  sentiments: Map<string, number>
  /** 最近决策记录 */
  recentDecisions: string[]
}

// ── Agent ──
export interface NovelAgent {
  characterId: string
  name: string
  profile: string
  aura: CharacterAura | null
  cognition: { knows: string[]; doesNotKnow: string[] } | null
  soul: string
  currentGoal: string
  emotionalState: string
  /** @deprecated 使用 memory.sentiments 替代，保留以兼容旧代码 */
  knownFacts: Set<string>
  /** @deprecated 使用 memory.sentiments 替代，保留以兼容旧代码 */
  relationships: Map<string, AgentRelation>
  powerLevel: string
  /** 新增：Agent 记忆 */
  memory: AgentMemory
  /** 新增：角色知道的信息范围 */
  knowledgeScope: string[]
  /** 新增：性格关键词数组 */
  personality: string[]
  /** 新增：说话风格描述 */
  speakingStyle: string
}

export interface AgentRelation {
  targetId: string
  relationType: string
  sentiment: number
}

// ── 仿真状态（新引擎核心状态） ──
export interface SimulationState {
  currentRound: number
  timelineEvents: TimelineEvent[]
  activeAgents: Map<string, NovelAgent>
  worldState: Record<string, unknown>
}

// ── Agent 对话（采访/私聊） ──
export interface AgentChatMessage {
  id: string
  role: "agent" | "user"
  agentId?: string
  agentName?: string
  content: string
  timestamp: string
}

export interface AgentChatSession {
  agentId: string
  agentName: string
  messages: AgentChatMessage[]
}

// ── 提取结果 ──
export interface ExtractionResult {
  characters: ExtractedCharacter[]
  chapterContents: ExtractedChapterContent[]
  memoryData: ExtractedMemoryData
  worldRules: string
  powerSystem: string
  foreshadowing: ForeshadowingStore | null
  timeline: string[]
  outlineContent: string
  soulDoc: string
}

export interface ExtractedCharacter {
  id: string
  name: string
  profile: string
  aura: CharacterAura | null
  cognition: { knows: string[]; doesNotKnow: string[] } | null
  soul: string
  skillContent: string
}

export interface ExtractedChapterContent {
  chapterNumber: number
  title: string
  summary: string
  content: string
}

export interface ExtractedMemoryData {
  characterStates: string
  characterCognition: CognitionState | null
  foreshadowingTracker: ForeshadowingStore | null
  timeline: string[]
  canonFacts: string
  conflicts: string
}

// ── 故事框架 ──
export interface StoryFramework {
  id: string
  title: string
  /** 简短标题，不超过10字 */
  shortTitle?: string
  premise: string
  targetWords: number
  simulationMode: SimulationMode
  userIdea?: string
  sourceChapters: number
  nodes: StoryNode[]
  createdAt: string
}

export interface StoryNode {
  index: number
  phase: "起" | "承" | "转" | "合"
  title: string
  coreConflict: string
  involvedCharacters: string[]
  goal: string
  causeFromPrev: string
  expectedOutcome: string
}

// ── 仿真事件（保留以兼容报告生成器和旧流程） ──
export interface SimulationEvent {
  type: "agent-action" | "node-complete" | "node-start"
  agent?: NovelAgent
  action?: AgentAction
  round?: number
  node?: StoryNode
  stateChanges?: string[]
  timestamp: string
  /** 关联的时间线事件（新引擎填充） */
  timelineEvent?: TimelineEvent
}

// ── 推演报告 ──
export interface SimulationReport {
  frameworkId: string
  mode: SimulationMode
  characterAnalyses: CharacterAnalysis[]
  branches: StoryBranch[]
  recommendation: string
  createdAt: string
}

export interface CharacterAnalysis {
  characterId: string
  name: string
  behaviors: { node: string; action: string; motivation: string }[]
  stateChanges: string[]
  consistencyScore: number
}

export interface StoryBranch {
  title: string
  summary: string
  keyEvents: string[]
  probability: "high" | "medium" | "low"
  pros: string
  cons: string
  recommendation: boolean
}

// ── 故事草稿 ──
export interface StoryDraft {
  branchId: string
  frameworkId: string
  chapters: DraftChapter[]
  totalWords: number
  createdAt: string
}

export interface DraftChapter {
  title: string
  content: string
  correspondingNode: number
}

// ── 框架绑定 ──
export interface FrameworkBinding {
  frameworkId: string
  frameworkTitle: string
  targetChapterCount: number
  chapterAllocation: ChapterAllocation[]
  boundAt: string
}

export interface ChapterAllocation {
  nodeIndex: number
  nodeTitle: string
  startChapter: number
  endChapter: number
}

// ── 仿真输入 ──
export interface SimulationInput {
  agents: NovelAgent[]
  framework: StoryFramework
  mode: SimulationMode
  wordBudget: number
  llmConfig: LlmConfig
  userIdea?: string
  injectionEvent?: string
  /** 每个节点的仿真轮数，不传则根据字数自动计算 */
  maxRoundsPerNode?: number
}

// ── 仿真配置 ──
export interface SimulationConfig {
  mode: SimulationMode
  userIdea?: string
  targetWords: number
  sourceChapters: number
}

// ── 字数预算 ──
export const WORD_BUDGET_PRESETS = [10000, 30000, 50000] as const

export function calcNodeCount(targetWords: number): number {
  if (targetWords <= 10000) return 4
  if (targetWords <= 30000) return 6
  return 8
}

export function calcMaxRoundsPerNode(wordBudget: number): number {
  return Math.max(2, Math.floor(wordBudget / 10000))
}

export function calcMaxAgentsPerRound(activeAgentCount: number): number {
  return Math.min(8, activeAgentCount)
}
