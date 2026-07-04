import { create } from "zustand"
import type {
  AgentChatMessage,
  SimulationMode,
  StoryFramework,
  SimulationReport,
  StoryDraft,
  ExtractionResult,
  FrameworkBinding,
  SimulationDebugTrace,
  TimelineEvent,
  StagedEventPool,
  RumorEvent,
  NovelAgent,
  SimulationBranch,
  DirectorEvaluation,
} from "@/lib/novel/story-simulation/types"
import type { SerializedSimulationSnapshot } from "@/lib/novel/story-simulation/simulation-serializer"
import type { SavedInterview } from "@/lib/novel/story-simulation/interview-store"

export interface SavedSimulationResult {
  id: string
  frameworkId: string
  report: SimulationReport
  draft?: StoryDraft | null
  timelineEvents?: TimelineEvent[]
  agentSnapshot?: SerializedSimulationSnapshot | null
  createdAt: string
}

export type SimulationPhase =
  | "idle"
  | "configuring"
  | "extracting"
  | "framework-generating"
  | "framework-confirming"
  | "simulating"
  | "report-generating"
  | "report-viewing"
  | "draft-generating"
  | "draft-viewing"

export interface SimulationPreset {
  intent: string
  userInput: string
  hasFramework: boolean
}

export interface StorySimulationState {
  phase: SimulationPhase
  mode: SimulationMode
  userIdea: string
  targetWords: number
  sourceChapters: number
  /** 每个节点仿真轮数，0表示自动 */
  simulationRounds: number
  extractionResult: ExtractionResult | null
  currentFramework: StoryFramework | null
  currentReport: SimulationReport | null
  currentDraft: StoryDraft | null
  frameworks: StoryFramework[]
  selectedFrameworkId: string | null
  binding: FrameworkBinding | null
  error: string | null
  progress: number
  progressLabel: string
  /** 仿真过程中的时间线事件（实时流） */
  timelineEvents: TimelineEvent[]
  /** 仿真过程观察快照（Agent 调度和 blackboard 状态） */
  debugTraces: SimulationDebugTrace[]
  /** 当前正在采访的角色 */
  activeChatAgent: { id: string; name: string } | null
  /** 采访对话消息 */
  agentChatMessages: AgentChatMessage[]
  /** 列表刷新计数（用于触发 framework-list 重新加载） */
  listRefreshKey: number
  /** 当前框架下已保存的推演结果 */
  savedResults: SavedSimulationResult[]
  /** 当前选中查看的历史结果ID */
  selectedResultId: string | null
  /** 是否显示采访历史面板 */
  showInterviewHistory: boolean
  /** 已保存的采访列表 */
  savedInterviews: SavedInterview[]
  /** 当前查看的采访详情 */
  viewingInterview: SavedInterview | null
  /** 对比模式下要对比的结果ID（null表示不对比） */
  compareWithResultId: string | null
  /** 当前续聊的采访ID（用于保存时判断覆盖/另存） */
  continuingInterviewId: string | null
  /** LLM 预生成的动态事件池（支持字符串数组或分阶段池） */
  dynamicEventPool: string[] | StagedEventPool
  /** 已使用的事件索引 */
  usedEventIndices: Set<number>
  /** 是否启用导演 Agent */
  directorEnabled: boolean
  /** 当前所有传闻 */
  currentRumors: RumorEvent[]
  /** 当前所有角色快照 */
  currentAgents: Map<string, NovelAgent>
  /** 仿真分支列表 */
  branches: SimulationBranch[]
  /** 当前激活的分支 ID */
  activeBranchId: string | null

  setPhase: (phase: SimulationPhase) => void
  setMode: (mode: SimulationMode) => void
  setUserIdea: (idea: string) => void
  setTargetWords: (words: number) => void
  setSourceChapters: (count: number) => void
  setSimulationRounds: (rounds: number) => void
  setExtractionResult: (result: ExtractionResult | null) => void
  setCurrentFramework: (framework: StoryFramework | null) => void
  setCurrentReport: (report: SimulationReport | null) => void
  setCurrentDraft: (draft: StoryDraft | null) => void
  setFrameworks: (frameworks: StoryFramework[]) => void
  setSelectedFrameworkId: (id: string | null) => void
  setBinding: (binding: FrameworkBinding | null) => void
  setError: (error: string | null) => void
  setProgress: (progress: number, label: string) => void
  setTimelineEvents: (events: TimelineEvent[]) => void
  addTimelineEvent: (event: TimelineEvent) => void
  setDebugTraces: (traces: SimulationDebugTrace[]) => void
  addDebugTrace: (trace: SimulationDebugTrace) => void
  setActiveChatAgent: (agent: { id: string; name: string } | null) => void
  addAgentChatMessage: (message: AgentChatMessage) => void
  clearAgentChat: () => void
  bumpListRefresh: () => void
  setSavedResults: (results: SavedSimulationResult[]) => void
  setSelectedResultId: (id: string | null) => void
  setShowInterviewHistory: (show: boolean) => void
  setSavedInterviews: (interviews: SavedInterview[]) => void
  setViewingInterview: (interview: SavedInterview | null) => void
  setCompareWithResultId: (id: string | null) => void
  setContinuingInterviewId: (id: string | null) => void
  /** 设置采访消息列表 */
  setAgentChatMessages: (messages: AgentChatMessage[]) => void
  /** 设置动态事件池 */
  setDynamicEventPool: (pool: string[] | StagedEventPool) => void
  /** 设置是否启用导演 Agent */
  setDirectorEnabled: (enabled: boolean) => void
  /** 设置当前传闻列表 */
  setCurrentRumors: (rumors: RumorEvent[]) => void
  /** 设置当前角色快照 */
  setCurrentAgents: (agents: Map<string, NovelAgent>) => void
  /** 保存当前状态为分支 */
  saveCurrentAsBranch: (name: string) => void
  /** 删除分支 */
  deleteBranch: (id: string) => void
  /** 重命名分支 */
  renameBranch: (id: string, name: string) => void
  /** 切换到指定分支 */
  switchToBranch: (id: string) => void
  /** 清空所有分支 */
  clearBranches: () => void
  reset: () => void
  initWithPreset: (preset: SimulationPreset) => void
}

export const useStorySimulationStore = create<StorySimulationState>((set) => ({
  phase: "idle",
  mode: "event-driven",
  userIdea: "",
  targetWords: 10000,
  sourceChapters: 10,
  simulationRounds: 0,
  extractionResult: null,
  currentFramework: null,
  currentReport: null,
  currentDraft: null,
  frameworks: [],
  selectedFrameworkId: null,
  binding: null,
  error: null,
  progress: 0,
  progressLabel: "",
  timelineEvents: [],
  debugTraces: [],
  activeChatAgent: null,
  agentChatMessages: [],
  listRefreshKey: 0,
  savedResults: [],
  selectedResultId: null,
  showInterviewHistory: false,
  savedInterviews: [],
  viewingInterview: null,
  compareWithResultId: null,
  continuingInterviewId: null,
  dynamicEventPool: [],
  usedEventIndices: new Set(),
  directorEnabled: false,
  currentRumors: [],
  currentAgents: new Map(),
  branches: [],
  activeBranchId: null,

  setPhase: (phase) => set({ phase }),
  setMode: (mode) => set({ mode }),
  setUserIdea: (userIdea) => set({ userIdea }),
  setTargetWords: (targetWords) => set({ targetWords }),
  setSourceChapters: (sourceChapters) => set({ sourceChapters }),
  setSimulationRounds: (simulationRounds) => set({ simulationRounds }),
  setExtractionResult: (extractionResult) => set({ extractionResult }),
  setCurrentFramework: (currentFramework) => set({ currentFramework }),
  setCurrentReport: (currentReport) => set({ currentReport }),
  setCurrentDraft: (currentDraft) => set({ currentDraft }),
  setFrameworks: (frameworks) => set({ frameworks }),
  setSelectedFrameworkId: (selectedFrameworkId) => set({ selectedFrameworkId }),
  setBinding: (binding) => set({ binding }),
  setError: (error) => set({ error }),
  setProgress: (progress, progressLabel) => set({ progress, progressLabel }),
  setTimelineEvents: (timelineEvents) => set({ timelineEvents }),
  addTimelineEvent: (event) =>
    set((state) => ({ timelineEvents: [...state.timelineEvents, event] })),
  setDebugTraces: (debugTraces) => set({ debugTraces }),
  addDebugTrace: (trace) =>
    set((state) => ({ debugTraces: [...state.debugTraces, trace] })),
  setActiveChatAgent: (activeChatAgent) => set({ activeChatAgent }),
  addAgentChatMessage: (message) =>
    set((state) => ({ agentChatMessages: [...state.agentChatMessages, message] })),
  clearAgentChat: () => set({ agentChatMessages: [], activeChatAgent: null }),
  bumpListRefresh: () => set((state) => ({ listRefreshKey: state.listRefreshKey + 1 })),
  setSavedResults: (savedResults) => set({ savedResults }),
  setSelectedResultId: (selectedResultId) => set({ selectedResultId }),
  setShowInterviewHistory: (showInterviewHistory) => set({ showInterviewHistory }),
  setSavedInterviews: (savedInterviews) => set({ savedInterviews }),
  setViewingInterview: (viewingInterview) => set({ viewingInterview }),
  setCompareWithResultId: (compareWithResultId) => set({ compareWithResultId }),
  setContinuingInterviewId: (continuingInterviewId) => set({ continuingInterviewId }),
  setAgentChatMessages: (agentChatMessages) => set({ agentChatMessages }),
  setDynamicEventPool: (dynamicEventPool) => set({ dynamicEventPool }),
  setDirectorEnabled: (directorEnabled) => set({ directorEnabled }),
  setCurrentRumors: (currentRumors) => set({ currentRumors }),
  setCurrentAgents: (currentAgents) => set({ currentAgents }),

  saveCurrentAsBranch: (name) =>
    set((state) => {
      if (state.branches.length >= 10) return state
      if (!state.currentFramework) return state

      const activeAgentCount = state.currentAgents.size
      const totalAgentCount = Math.max(activeAgentCount, state.currentFramework.nodes.reduce(
        (acc, node) => Math.max(acc, node.involvedCharacters.length),
        0,
      ))

      const finalAgentSnapshots = Array.from(state.currentAgents.values()).map((agent) => ({
        agentId: agent.characterId,
        name: agent.name,
        knownSecrets: Array.from(agent.memory.knownSecrets),
        sentiments: Array.from(agent.memory.sentiments.entries()) as [string, number][],
      }))

      const { overallScore, details } = calculateBranchScore(
        [],
        state.timelineEvents.length,
        activeAgentCount,
        totalAgentCount,
        0.6,
      )

      const newBranch: SimulationBranch = {
        id: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        frameworkId: state.currentFramework.id,
        mode: state.mode,
        createdAt: new Date().toISOString(),
        timelineEvents: [...state.timelineEvents],
        rumors: [...state.currentRumors],
        finalAgentSnapshots,
        directorEvaluations: [],
        overallScore,
        scoreDetails: details,
      }

      return {
        branches: [...state.branches, newBranch],
      }
    }),

  deleteBranch: (id) =>
    set((state) => ({
      branches: state.branches.filter((b) => b.id !== id),
      activeBranchId: state.activeBranchId === id ? null : state.activeBranchId,
    })),

  renameBranch: (id, name) =>
    set((state) => ({
      branches: state.branches.map((b) =>
        b.id === id ? { ...b, name } : b,
      ),
    })),

  switchToBranch: (id) =>
    set((state) => {
      const branch = state.branches.find((b) => b.id === id)
      if (!branch) return state
      return {
        timelineEvents: [...branch.timelineEvents],
        currentRumors: [...branch.rumors],
        activeBranchId: id,
      }
    }),

  clearBranches: () =>
    set({
      branches: [],
      activeBranchId: null,
    }),

  reset: () =>
    set({
      phase: "idle",
      extractionResult: null,
      currentFramework: null,
      currentReport: null,
      currentDraft: null,
      error: null,
      progress: 0,
      progressLabel: "",
      timelineEvents: [],
      debugTraces: [],
      activeChatAgent: null,
      agentChatMessages: [],
      savedResults: [],
      selectedResultId: null,
      showInterviewHistory: false,
      savedInterviews: [],
      viewingInterview: null,
      compareWithResultId: null,
      continuingInterviewId: null,
      dynamicEventPool: [],
      usedEventIndices: new Set(),
      directorEnabled: false,
      currentRumors: [],
      currentAgents: new Map(),
      branches: [],
      activeBranchId: null,
    }),
  initWithPreset: (preset) =>
    set((state) => {
      let phase: SimulationPhase = "configuring"

      if (preset.intent === "story_framework_generate") {
        phase = "configuring"
      } else if (preset.intent === "multi_agent_simulate") {
        phase = preset.hasFramework ? "simulating" : "configuring"
      } else if (preset.intent === "character_interview") {
        phase = preset.hasFramework && state.savedResults.length > 0 ? "report-viewing" : "configuring"
      }

      return {
        userIdea: preset.userInput,
        phase,
      }
    }),
}))

export function calculateBranchScore(
  directorEvaluations: DirectorEvaluation[],
  eventCount: number,
  activeAgentCount: number,
  totalAgentCount: number,
  goalProgress: number = 0.6,
): { overallScore: number; details: { avgDirectorScore: number; eventCount: number; characterDiversity: number; plotProgression: number } } {
  const avgDirectorScore = directorEvaluations.length > 0
    ? directorEvaluations.reduce((sum, e) => sum + e.totalScore, 0) / directorEvaluations.length
    : 3.0

  const eventScore = Math.min(5, eventCount / 4) * 0.2
  const charScore = (activeAgentCount / Math.max(1, totalAgentCount)) * 5 * 0.15
  const plotScore = goalProgress * 5 * 0.15
  const directorScorePart = avgDirectorScore * 0.5

  const overallScore = Math.round((directorScorePart + eventScore + charScore + plotScore) * 10) / 10

  return {
    overallScore,
    details: {
      avgDirectorScore: Math.round(avgDirectorScore * 10) / 10,
      eventCount,
      characterDiversity: Math.round((activeAgentCount / Math.max(1, totalAgentCount)) * 100) / 100,
      plotProgression: Math.round(goalProgress * 100) / 100,
    },
  }
}
