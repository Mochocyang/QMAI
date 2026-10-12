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
  /** Thinking-model chain-of-thought; must be replayed on subsequent turns. */
  reasoning_content?: string
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
  /**
   * 报告取证审计（P1-7）。旧存档没有这个字段，故为可选。
   *
   * 存在的意义：报告要求逐字引用 agent 原话，而「模型是否真引了、引的是不是
   * 编的」必须可核对。审计把通过/未通过的条数摊开，未通过的原文也留着。
   */
  evidenceAudit?: ReportEvidenceAudit
}

export interface ReportEvidenceAudit {
  /** 参与校验的引文条数（空白引文不计入） */
  total: number
  verified: number
  /** 未能逐字对上的引文原文 */
  unverified: string[]
  /** 本次报告实际发生的工具调用次数。0 表示走了单次调用回退路径 */
  toolCalls: number
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
  /** 逐字引用该角色的原话作为依据（P1-7）。旧存档无此字段。 */
  evidence?: string[]
}

export interface StoryBranch {
  title: string
  summary: string
  keyEvents: string[]
  probability: "high" | "medium" | "low"
  pros: string
  cons: string
  recommendation: boolean
  /** 逐字引用支撑该走向的原话（P1-7）。旧存档无此字段。 */
  evidence?: string[]
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
  /** 是否启用导演 Agent；显式传入时优先于模式配置，未传则回退到模式配置 */
  directorEnabled?: boolean
  /** LLM 预生成的动态事件池（支持字符串数组或分阶段池） */
  dynamicEventPool?: string[] | StagedEventPool
  /** 从中断位置继续推演 */
  resume?: SimulationResumePoint
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

// ── 成本预估（开跑前的护栏） ──

/**
 * 预估模型调用次数超过该阈值时，配置页要求用户显式勾选确认才能开跑。
 *
 * 与「舞台情景」的 `SCENARIO_COST_WARN_THRESHOLD = 40` 取同一量级：那个便宜得多
 * 的功能早就有护栏，而主推演（中等项目 175~415 次调用、几十分钟等待）此前
 * 连一句提示都没有 —— 这个阈值就是把倒挂的那一端补上。
 */
export const SIMULATION_CALL_WARN_THRESHOLD = 40

/**
 * 配置阶段拿不到真实角色数（提取发生在点「开始」之后），按此保守假设估算。
 * 5 与《剧情推演-独立功能优化方案》里举例用的规模一致。
 */
export const DEFAULT_ESTIMATED_CHARACTER_COUNT = 5

/**
 * 每角色每轮的平均调用次数。
 *
 * ReAct 工具循环下是 1~3 次（`simulation-engine.ts` 的 agentDecideAndActWithReact），
 * 取中点 1.5 作为期望值。
 */
const AGENT_CALLS_PER_TURN = 1.5

export interface SimulationCallEstimate {
  /** 节点数 N（`calcNodeCount`） */
  nodeCount: number
  /** 每节点实际轮数 R（含模式乘数） */
  roundsPerNode: number
  /** 每轮活跃角色数 A */
  activeAgents: number
  /** Agent 决策调用 */
  agentCalls: number
  /** 节点目标判定的 embedding 调用 */
  embeddingCalls: number
  /** 导演 Agent 评估调用 */
  directorCalls: number
  /** 固定开销：报告 1 次 + 逐节点草稿 N 次 */
  fixedCalls: number
  /** 合计（向上取整） */
  total: number
}

/**
 * 预估一次剧情推演的模型调用次数。
 *
 * 口径与当前引擎实现保持一致：
 * ```
 * N = calcNodeCount(targetWords)                              types.ts
 * 基础轮数 = simulationRounds || calcMaxRoundsPerNode(字数)    types.ts
 * R = max(1, round(基础轮数 × 模式轮数乘数))                   simulation-engine.ts
 * A = max(1, ceil(角色数 × 模式活跃比例))                      multi-agent-orchestrator.ts
 * agent   = N × R × A × 1.5        （每角色每轮 1~3 次，取中点）
 * embed   = strict ? N + N×R : 0   （expectedOutcome 按节点缓存一次 + 事件文本每轮一次）
 * director= 启用 ? N-1 : 0         （引擎只评估 ni < totalNodes-1）
 * fixed   = 1（报告）+ N（逐节点草稿）
 * ```
 *
 * 注意与《工作清单》里 `2NR` 的差异：那是 P0-4/P0-5 之前的写法。P0-4 之后非
 * strict 模式根本不做目标判定（0 次），P0-5 之后 `expectedOutcome` 每节点只算
 * 一次（`N` 而非 `N×R`），所以这里按实际实现写。
 *
 * 这是**量级预估**而非精确值：是否走 ReAct 工具循环、节点目标是否提前达成，
 * 都会让实际次数偏离。它的用途是让用户在点击前感知代价。
 */
export function estimateSimulationCalls(input: {
  targetWords: number
  /** 每节点轮次；0 表示按字数自动 */
  simulationRounds: number
  mode: SimulationMode
  directorEnabled?: boolean
  characterCount?: number
}): SimulationCallEstimate {
  const modeConfig = getModeConfig(input.mode)

  const nodeCount = calcNodeCount(input.targetWords)
  const baseRounds = Math.max(
    1,
    input.simulationRounds > 0
      ? input.simulationRounds
      : calcMaxRoundsPerNode(input.targetWords),
  )
  const roundsPerNode = Math.max(1, Math.round(baseRounds * modeConfig.roundsMultiplier))

  const rawCharacterCount = input.characterCount ?? DEFAULT_ESTIMATED_CHARACTER_COUNT
  const characterCount = Math.max(1, Math.round(rawCharacterCount))
  const activeAgents = Math.max(
    1,
    Math.ceil(characterCount * Math.max(0, modeConfig.agentSubsetRatio)),
  )

  const agentCalls = nodeCount * roundsPerNode * activeAgents * AGENT_CALLS_PER_TURN
  const embeddingCalls = modeConfig.strictNodeProgression
    ? nodeCount + nodeCount * roundsPerNode
    : 0
  const directorCalls = input.directorEnabled ? Math.max(0, nodeCount - 1) : 0
  const fixedCalls = 1 + nodeCount

  return {
    nodeCount,
    roundsPerNode,
    activeAgents,
    agentCalls,
    embeddingCalls,
    directorCalls,
    fixedCalls,
    total: Math.ceil(agentCalls + embeddingCalls + directorCalls + fixedCalls),
  }
}

// ── 模式可视化说明 ──

interface ModeVisualInfo {
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
