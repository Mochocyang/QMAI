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

export interface RumorEvent {
  id: string
  round: number
  nodeIndex: number
  sourceId: string | null
  content: string
  distortion: number
  observableBy: string[]
  believedBy: string[]
  /** 已验证此传闻的角色 ID 列表 */
  verifiedBy: string[]
  timestamp: string
  /** 父传闻 ID */
  parentId?: string
  /** 传播者角色 ID */
  spreadBy?: string
  /** 传播发生的轮次 */
  spreadRound?: number
  /** 传播代数，原始传闻为 0 */
  generation: number
}

export interface SimulationDebugVisibleEvent {
  id: string
  actorName: string
  actionType: AgentActionType
  content: string
  round: number
  nodeIndex: number
}

export interface SimulationDebugAgent {
  agentId: string
  agentName: string
  visibleEventCount?: number
  recentEvents?: SimulationDebugVisibleEvent[]
  reason?: string
}

export interface SimulationDebugTrace {
  id: string
  type: "round-plan" | "event-recorded"
  nodeIndex: number
  nodeTitle: string
  round: number
  strategy?: "all-agents" | "subset" | "none"
  candidateAgents: SimulationDebugAgent[]
  selectedAgents: SimulationDebugAgent[]
  blackboard: {
    allAgentCount: number
    activeAgentCount: number
    totalEventCount: number
    publicEventCount: number
    rumorCount: number
  }
  visibilityByAgent: SimulationDebugAgent[]
  latestEvent?: SimulationDebugVisibleEvent
  rumors: RumorEvent[]
  activeAgents: Map<string, NovelAgent>
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
  /** 传闻可信度，范围 0-1，默认 0.5 */
  rumorCredibility: number
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
export interface StagedEvent {
  id: string
  text: string
  stage: "setup" | "rising" | "climax" | "resolution"
}

export interface StagedEventPool {
  byStage: Record<"setup" | "rising" | "climax" | "resolution", StagedEvent[]>
  all: StagedEvent[]
}

export interface SimulationState {
  currentRound: number
  timelineEvents: TimelineEvent[]
  activeAgents: Map<string, NovelAgent>
  worldState: Record<string, unknown>
  dynamicEventPool?: string[]
  usedEventIndices?: Set<number>
  directorEnabled: boolean
  nextNodeInjectionMap: Map<number, string>
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
  type: "agent-action" | "node-complete" | "node-start" | "info"
  agent?: NovelAgent
  action?: AgentAction
  round?: number
  node?: StoryNode
  stateChanges?: string[]
  timestamp: string
  /** info 类型事件的消息 */
  message?: string
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

export type SimulationResultStatus = "complete" | "partial" | "cancelled"

export interface SimulationResumePoint {
  nextNodeIndex: number
  nextRound: number
  timelineEvents: TimelineEvent[]
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
  /** 原始 AI 生成内容（编辑前的备份），未编辑时为 undefined */
  rawContent?: string
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
  /** LLM 预生成的动态事件池（支持字符串数组或分阶段池） */
  dynamicEventPool?: string[] | StagedEventPool
  /** 从中断位置继续推演 */
  resume?: SimulationResumePoint
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

// ── 仿真模式配置 ──

export interface ModeConfig {
  /** 轮数乘数 */
  roundsMultiplier: number
  /** 注入到 prompt 中的行为倾向提示 */
  behaviorHint: string
  /** 随机事件触发概率（0-1，0=不触发） */
  randomEventChance: number
  /** 每轮活跃 Agent 比例（1=全部，0.5=随机一半） */
  agentSubsetRatio: number
  /** 是否强制按节点目标推进 */
  strictNodeProgression: boolean
  /** 是否启用导演 Agent */
  directorEnabled?: boolean
}

const MODE_CONFIGS: Record<SimulationMode, ModeConfig> = {
  "event-driven": {
    roundsMultiplier: 0.8,
    behaviorHint:
      "你倾向于推动事态发展（pushPlot），以达成节点目标为首要任务。谨慎使用观察行为，优先采取主动行动推动剧情。",
    randomEventChance: 0.1,
    agentSubsetRatio: 1,
    strictNodeProgression: true,
    directorEnabled: false,
  },
  "free-emergence": {
    roundsMultiplier: 1.5,
    behaviorHint:
      "你倾向于自由表达和互动（evaluate/speak/observe），关注自身情感和与他人关系的变化。剧情会在角色互动中自然涌现，不必急于达成节点目标。",
    randomEventChance: 0.25,
    agentSubsetRatio: 0.7,
    strictNodeProgression: false,
    directorEnabled: false,
  },
  "decision-tree": {
    roundsMultiplier: 1.0,
    behaviorHint:
      "你倾向于做出关键决策和对抗（confront/decide/react）。每个行为都应体现你在面对选择时的权衡与取舍，重点关注决策的因果链。",
    randomEventChance: 0.15,
    agentSubsetRatio: 0.5,
    strictNodeProgression: true,
    directorEnabled: false,
  },
  hybrid: {
    roundsMultiplier: 1.2,
    behaviorHint:
      "你可以灵活选择行为类型：有时推动剧情，有时观察评价，有时与他人对话。根据当前情境和角色性格自然选择最合适的行为。",
    randomEventChance: 0.2,
    agentSubsetRatio: 0.85,
    strictNodeProgression: false,
    directorEnabled: false,
  },
}

export function getModeConfig(mode: SimulationMode): ModeConfig {
  return MODE_CONFIGS[mode] ?? MODE_CONFIGS.hybrid
}

export function calcMaxAgentsPerRound(activeAgentCount: number): number {
  return Math.min(8, activeAgentCount)
}

// ── 模式可视化说明 ──

export interface ModeVisualInfo {
  /** 模式名称 */
  name: string
  /** 简短描述 */
  shortDesc: string
  /** 详细特点 */
  features: string[]
  /** 适合场景 */
  bestFor: string
  /** 轮数相对多少 */
  roundsLabel: string
  /** 随机事件多少 */
  randomnessLabel: string
  /** 剧情自由度 */
  freedomLabel: string
  /** 标签颜色 */
  color: string
  /** emoji图标 */
  icon: string
}

// ── 导演评价 ──

export interface DirectorScore {
  tension: number
  pace: number
  characterUtilization: number
  characterArc: number
  infoDensity: number
  emotionalResonance: number
  logicConsistency: number
}

export interface DirectorEvaluation {
  scores: DirectorScore
  totalScore: number
  highlights: string[]
  issues: string[]
  suggestion: string
  shouldInjectEvent: boolean
  injectEvent?: string
}

// ── 仿真分支 ──

export interface SimulationHistoryEntry {
  round: number
  nodeIndex: number
  nodeTitle: string
  agentStates: Record<string, {
    name: string
    sentiments: [string, number][]
    knownSecrets: string[]
    observedEvents: string[]
  }>
  eventCount: number
  rumorCount: number
}

export interface SimulationBranch {
  id: string
  name: string
  frameworkId: string
  mode: SimulationMode
  createdAt: string
  timelineEvents: TimelineEvent[]
  rumors: RumorEvent[]
  finalAgentSnapshots: { agentId: string; name: string; knownSecrets: string[]; sentiments: [string, number][] }[]
  directorEvaluations: DirectorEvaluation[]
  overallScore: number
  scoreDetails: {
    avgDirectorScore: number
    eventCount: number
    characterDiversity: number
    plotProgression: number
  }
}

export const MODE_VISUAL_INFO: Record<SimulationMode, ModeVisualInfo> = {
  "event-driven": {
    name: "事件驱动",
    shortDesc: "按框架节点推进，节奏紧凑，剧情走向明确",
    features: [
      "严格按节点目标推进剧情",
      "角色倾向于主动行动推动事态",
      "随机事件较少，走向可控",
      "每轮所有角色都参与互动",
    ],
    bestFor: "已有明确大纲，需要快速产出符合预期的剧情",
    roundsLabel: "适中 (0.8x)",
    randomnessLabel: "低 (10%)",
    freedomLabel: "低",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    icon: "🎯",
  },
  "free-emergence": {
    name: "自由涌现",
    shortDesc: "角色自由互动，剧情自然发展，惊喜多",
    features: [
      "不强制节点目标，剧情自然涌现",
      "角色更关注情感和关系变化",
      "随机事件较多，可能有意外发展",
      "每轮随机选择部分角色活跃",
    ],
    bestFor: "探索角色可能性，寻找灵感和意外剧情",
    roundsLabel: "较多 (1.5x)",
    randomnessLabel: "高 (25%)",
    freedomLabel: "高",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    icon: "🌊",
  },
  "decision-tree": {
    name: "决策树",
    shortDesc: "聚焦关键抉择，因果清晰，冲突感强",
    features: [
      "强调角色面临选择时的权衡",
      "重点关注决策的因果链",
      "对抗和决策类行为更多",
      "每轮聚焦关键角色互动",
    ],
    bestFor: "强剧情冲突、权谋斗争、关键抉择场景",
    roundsLabel: "标准 (1.0x)",
    randomnessLabel: "中 (15%)",
    freedomLabel: "中",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    icon: "🌳",
  },
  hybrid: {
    name: "混合模式",
    shortDesc: "平衡推进与自由，综合表现佳，推荐首选",
    features: [
      "灵活选择行为类型，平衡推进与互动",
      "既有主线推进，也有角色自由发挥",
      "随机事件适中，既有惊喜也不失控",
      "大部分角色参与，互动丰富",
    ],
    bestFor: "大多数场景，平衡可控性和创造性",
    roundsLabel: "较多 (1.2x)",
    randomnessLabel: "中 (20%)",
    freedomLabel: "中高",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    icon: "⚖️",
  },
}
