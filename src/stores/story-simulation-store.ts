import { create } from "zustand"
import type {
  AgentChatMessage,
  SimulationMode,
  StoryFramework,
  SimulationReport,
  StoryDraft,
  ExtractionResult,
  FrameworkBinding,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

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
  /** 当前正在采访的角色 */
  activeChatAgent: { id: string; name: string } | null
  /** 采访对话消息 */
  agentChatMessages: AgentChatMessage[]
  /** 列表刷新计数（用于触发 framework-list 重新加载） */
  listRefreshKey: number

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
  setActiveChatAgent: (agent: { id: string; name: string } | null) => void
  addAgentChatMessage: (message: AgentChatMessage) => void
  clearAgentChat: () => void
  bumpListRefresh: () => void
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
  activeChatAgent: null,
  agentChatMessages: [],
  listRefreshKey: 0,

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
  setActiveChatAgent: (activeChatAgent) => set({ activeChatAgent }),
  addAgentChatMessage: (message) =>
    set((state) => ({ agentChatMessages: [...state.agentChatMessages, message] })),
  clearAgentChat: () => set({ agentChatMessages: [], activeChatAgent: null }),
  bumpListRefresh: () => set((state) => ({ listRefreshKey: state.listRefreshKey + 1 })),
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
      activeChatAgent: null,
      agentChatMessages: [],
    }),
}))
