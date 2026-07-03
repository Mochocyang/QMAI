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
  reset: () => void
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
    }),
}))
