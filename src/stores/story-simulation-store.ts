import { create } from "zustand";
import type {
  AgentChatMessage,
  SimulationMode,
  StoryFramework,
  SimulationReport,
  SimulationResultStatus,
  SimulationResumePoint,
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
  SimulationHistoryEntry,
} from "@/lib/novel/story-simulation/types";
import type { SerializedSimulationSnapshot } from "@/lib/novel/story-simulation/simulation-serializer";
import type { SavedInterview } from "@/lib/novel/story-simulation/interview-store";

export interface SavedSimulationResult {
  id: string;
  frameworkId: string;
  report: SimulationReport;
  draft?: StoryDraft | null;
  timelineEvents?: TimelineEvent[];
  agentSnapshot?: SerializedSimulationSnapshot | null;
  rumors?: RumorEvent[];
  debugTraces?: SimulationDebugTrace[];
  status?: SimulationResultStatus;
  partialReason?: string | null;
  resume?: SimulationResumePoint | null;
  createdAt: string;
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
  | "draft-viewing";

export interface SimulationPreset {
  intent: string;
  userInput: string;
  hasFramework: boolean;
}

export interface StorySimulationState {
  phase: SimulationPhase;
  mode: SimulationMode;
  userIdea: string;
  targetWords: number;
  sourceChapters: number;
  /** 每个节点仿真轮数，0表示自动 */
  simulationRounds: number;
  extractionResult: ExtractionResult | null;
  currentFramework: StoryFramework | null;
  currentReport: SimulationReport | null;
  currentDraft: StoryDraft | null;
  frameworks: StoryFramework[];
  selectedFrameworkId: string | null;
  binding: FrameworkBinding | null;
  error: string | null;
  /** 提示/成功消息 */
  infoMessage: string | null;
  progress: number;
  progressLabel: string;
  /** 仿真过程中的时间线事件（实时流） */
  timelineEvents: TimelineEvent[];
  /** 仿真过程观察快照（Agent 调度和 blackboard 状态） */
  debugTraces: SimulationDebugTrace[];
  /** 当前正在采访的角色 */
  activeChatAgent: { id: string; name: string } | null;
  /** 采访对话消息 */
  agentChatMessages: AgentChatMessage[];
  /** 列表刷新计数（用于触发 framework-list 重新加载） */
  listRefreshKey: number;
  /** 当前框架下已保存的推演结果 */
  savedResults: SavedSimulationResult[];
  /** 当前选中查看的历史结果ID */
  selectedResultId: string | null;
  /** 是否显示采访历史面板 */
  showInterviewHistory: boolean;
  /** 已保存的采访列表 */
  savedInterviews: SavedInterview[];
  /** 当前查看的采访详情 */
  viewingInterview: SavedInterview | null;
  /** 对比模式下要对比的结果ID（null表示不对比） */
  compareWithResultId: string | null;
  /** 当前续聊的采访ID（用于保存时判断覆盖/另存） */
  continuingInterviewId: string | null;
  /** LLM 预生成的动态事件池（支持字符串数组或分阶段池） */
  dynamicEventPool: string[] | StagedEventPool;
  /** 已使用的事件索引 */
  usedEventIndices: Set<number>;
  /** 是否启用导演 Agent */
  directorEnabled: boolean;
  /** 当前所有传闻 */
  currentRumors: RumorEvent[];
  /** 当前所有角色快照 */
  currentAgents: Map<string, NovelAgent>;
  /** 仿真分支列表 */
  branches: SimulationBranch[];
  /** 当前激活的分支 ID */
  activeBranchId: string | null;
  /** 对比模式下选中的分支 ID 列表 */
  compareBranchIds: string[];
  /** 是否处于对比模式 */
  isCompareMode: boolean;
  /** 中断的推演状态快照（切换框架时保存，返回时恢复），按 frameworkId 映射 */
  interruptedSimStates: Record<
    string,
    {
      phase: SimulationPhase;
      timelineEvents: TimelineEvent[];
      debugTraces: SimulationDebugTrace[];
      currentRumors: RumorEvent[];
      currentAgents: Map<string, NovelAgent>;
      progress: number;
      progressLabel: string;
    }
  >;
  /** 历史快照列表 */
  history: SimulationHistoryEntry[];
  /** 当前历史索引，-1 表示实时模式 */
  historyIndex: number;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 播放速度 */
  playbackSpeed: number;

  setPhase: (phase: SimulationPhase) => void;
  setMode: (mode: SimulationMode) => void;
  setUserIdea: (idea: string) => void;
  setTargetWords: (words: number) => void;
  setSourceChapters: (count: number) => void;
  setSimulationRounds: (rounds: number) => void;
  setExtractionResult: (result: ExtractionResult | null) => void;
  setCurrentFramework: (framework: StoryFramework | null) => void;
  setCurrentReport: (report: SimulationReport | null) => void;
  setCurrentDraft: (draft: StoryDraft | null) => void;
  setFrameworks: (frameworks: StoryFramework[]) => void;
  setSelectedFrameworkId: (id: string | null) => void;
  setBinding: (binding: FrameworkBinding | null) => void;
  setError: (error: string | null) => void;
  setInfoMessage: (infoMessage: string | null) => void;
  setProgress: (progress: number, label: string) => void;
  setTimelineEvents: (events: TimelineEvent[]) => void;
  addTimelineEvent: (event: TimelineEvent) => void;
  setDebugTraces: (traces: SimulationDebugTrace[]) => void;
  addDebugTrace: (trace: SimulationDebugTrace) => void;
  setActiveChatAgent: (agent: { id: string; name: string } | null) => void;
  addAgentChatMessage: (message: AgentChatMessage) => void;
  clearAgentChat: () => void;
  bumpListRefresh: () => void;
  setSavedResults: (results: SavedSimulationResult[]) => void;
  setSelectedResultId: (id: string | null) => void;
  setShowInterviewHistory: (show: boolean) => void;
  setSavedInterviews: (interviews: SavedInterview[]) => void;
  setViewingInterview: (interview: SavedInterview | null) => void;
  setCompareWithResultId: (id: string | null) => void;
  setContinuingInterviewId: (id: string | null) => void;
  /** 设置采访消息列表 */
  setAgentChatMessages: (messages: AgentChatMessage[]) => void;
  /** 设置动态事件池 */
  setDynamicEventPool: (pool: string[] | StagedEventPool) => void;
  /** 设置是否启用导演 Agent */
  setDirectorEnabled: (enabled: boolean) => void;
  /** 设置当前传闻列表 */
  setCurrentRumors: (rumors: RumorEvent[]) => void;
  /** 设置当前角色快照 */
  setCurrentAgents: (agents: Map<string, NovelAgent>) => void;
  /** 保存当前状态为分支 */
  saveCurrentAsBranch: (name: string) => void;
  /** 删除分支 */
  deleteBranch: (id: string) => void;
  /** 重命名分支 */
  renameBranch: (id: string, name: string) => void;
  /** 切换到指定分支 */
  switchToBranch: (id: string) => void;
  /** 清空所有分支 */
  clearBranches: () => void;
  /** 设置对比模式 */
  setCompareMode: (enabled: boolean) => void;

  /** 保存当前推演状态快照（用户切换到其他框架时调用） */
  saveInterruptedState: () => void;

  /** 恢复中断的推演状态（用户回到原框架时调用） */
  restoreInterruptedState: (frameworkId?: string) => void;

  /** 切换分支的对比选中状态 */
  toggleCompareBranch: (branchId: string) => void;
  /** 清空对比选中 */
  clearCompareSelection: () => void;
  /** 添加历史快照 */
  addHistoryEntry: (entry: SimulationHistoryEntry) => void;
  /** 设置历史索引 */
  setHistoryIndex: (index: number) => void;
  /** 切换播放状态 */
  togglePlayback: () => void;
  /** 设置播放速度 */
  setPlaybackSpeed: (speed: number) => void;
  /** 清空历史记录 */
  clearHistory: () => void;
  /** 获取当前展示的 agents（回放模式或实时模式） */
  getDisplayAgents: () => Map<string, NovelAgent>;
  reset: () => void;
  initWithPreset: (preset: SimulationPreset) => void;
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
  infoMessage: null,
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
  compareBranchIds: [],
  isCompareMode: false,
  interruptedSimStates: {},
  history: [],
  historyIndex: -1,
  isPlaying: false,
  playbackSpeed: 1,

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
  setInfoMessage: (infoMessage: string | null) => set({ infoMessage }),
  setProgress: (progress, progressLabel) => set({ progress, progressLabel }),
  setTimelineEvents: (timelineEvents) => set({ timelineEvents }),
  addTimelineEvent: (event) =>
    set((state) => ({ timelineEvents: [...state.timelineEvents, event] })),
  setDebugTraces: (debugTraces) => set({ debugTraces }),
  addDebugTrace: (trace) =>
    set((state) => ({ debugTraces: [...state.debugTraces, trace] })),
  setActiveChatAgent: (activeChatAgent) => set({ activeChatAgent }),
  addAgentChatMessage: (message) =>
    set((state) => ({
      agentChatMessages: [...state.agentChatMessages, message],
    })),
  clearAgentChat: () => set({ agentChatMessages: [], activeChatAgent: null }),
  bumpListRefresh: () =>
    set((state) => ({ listRefreshKey: state.listRefreshKey + 1 })),
  setSavedResults: (savedResults) => set({ savedResults }),
  setSelectedResultId: (selectedResultId) => set({ selectedResultId }),
  setShowInterviewHistory: (showInterviewHistory) =>
    set({ showInterviewHistory }),
  setSavedInterviews: (savedInterviews) => set({ savedInterviews }),
  setViewingInterview: (viewingInterview) => set({ viewingInterview }),
  setCompareWithResultId: (compareWithResultId) => set({ compareWithResultId }),
  setContinuingInterviewId: (continuingInterviewId) =>
    set({ continuingInterviewId }),
  setAgentChatMessages: (agentChatMessages) => set({ agentChatMessages }),
  setDynamicEventPool: (dynamicEventPool) => set({ dynamicEventPool }),
  setDirectorEnabled: (directorEnabled) => set({ directorEnabled }),
  setCurrentRumors: (currentRumors) => set({ currentRumors }),
  setCurrentAgents: (currentAgents) => set({ currentAgents }),

  saveCurrentAsBranch: (name) =>
    set((state) => {
      if (state.branches.length >= 10) return state;
      if (!state.currentFramework) return state;

      const activeAgentCount = state.currentAgents.size;
      const totalAgentCount = Math.max(
        activeAgentCount,
        state.currentFramework.nodes.reduce(
          (acc, node) => Math.max(acc, node.involvedCharacters.length),
          0,
        ),
      );

      const finalAgentSnapshots = Array.from(state.currentAgents.values()).map(
        (agent) => ({
          agentId: agent.characterId,
          name: agent.name,
          knownSecrets: Array.from(agent.memory.knownSecrets),
          sentiments: Array.from(agent.memory.sentiments.entries()) as [
            string,
            number,
          ][],
        }),
      );

      const { overallScore, details } = calculateBranchScore(
        [],
        state.timelineEvents.length,
        activeAgentCount,
        totalAgentCount,
        0.6,
      );

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
      };

      return {
        branches: [...state.branches, newBranch],
      };
    }),

  deleteBranch: (id) =>
    set((state) => ({
      branches: state.branches.filter((b) => b.id !== id),
      activeBranchId: state.activeBranchId === id ? null : state.activeBranchId,
      compareBranchIds: state.compareBranchIds.filter((bid) => bid !== id),
    })),

  renameBranch: (id, name) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === id ? { ...b, name } : b)),
    })),

  switchToBranch: (id) =>
    set((state) => {
      const branch = state.branches.find((b) => b.id === id);
      if (!branch) return state;
      return {
        timelineEvents: [...branch.timelineEvents],
        currentRumors: [...branch.rumors],
        activeBranchId: id,
      };
    }),

  clearBranches: () =>
    set({
      branches: [],
      activeBranchId: null,
      compareBranchIds: [],
      isCompareMode: false,
    }),

  setCompareMode: (enabled) =>
    set((state) => {
      if (enabled) {
        const count = state.compareBranchIds.length;
        if (count < 2 || count > 3) return state;
      }
      return { isCompareMode: enabled };
    }),

  toggleCompareBranch: (branchId) =>
    set((state) => {
      const exists = state.compareBranchIds.includes(branchId);
      if (exists) {
        return {
          compareBranchIds: state.compareBranchIds.filter(
            (id) => id !== branchId,
          ),
        };
      } else {
        if (state.compareBranchIds.length >= 3) return state;
        return {
          compareBranchIds: [...state.compareBranchIds, branchId],
        };
      }
    }),

  clearCompareSelection: () =>
    set({ compareBranchIds: [], isCompareMode: false }),

  saveInterruptedState: () =>
    set((state) => {
      const saveablePhases = new Set([
        "simulating",
        "report-viewing",
        "report-generating",
        "draft-viewing",
        "draft-generating",
      ]);
      if (!saveablePhases.has(state.phase) || !state.currentFramework)
        return state;
      return {
        interruptedSimStates: {
          ...state.interruptedSimStates,
          [state.currentFramework.id]: {
            phase: state.phase,
            timelineEvents: [...state.timelineEvents],
            debugTraces: [...state.debugTraces],
            currentRumors: [...state.currentRumors],
            currentAgents: new Map(state.currentAgents),
            progress: state.progress,
            progressLabel: state.progressLabel,
          },
        },
      };
    }),

  restoreInterruptedState: (frameworkId?: string) =>
    set((state) => {
      const targetId = frameworkId || state.currentFramework?.id;
      if (!targetId || !state.interruptedSimStates[targetId]) return state;
      const saved = state.interruptedSimStates[targetId];
      const { [targetId]: _, ...rest } = state.interruptedSimStates;
      return {
        phase: saved.phase,
        timelineEvents: saved.timelineEvents,
        debugTraces: saved.debugTraces,
        currentRumors: saved.currentRumors,
        currentAgents: saved.currentAgents,
        progress: saved.progress,
        progressLabel: saved.progressLabel,
        interruptedSimStates: rest,
      };
    }),

  addHistoryEntry: (entry) =>
    set((state) => ({
      history: [...state.history, entry],
    })),

  setHistoryIndex: (index) => set({ historyIndex: index, isPlaying: false }),

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  clearHistory: () =>
    set({
      history: [],
      historyIndex: -1,
      isPlaying: false,
    }),

  getDisplayAgents: (): Map<string, NovelAgent> => {
    const state = useStorySimulationStore.getState();
    if (state.historyIndex < 0) {
      return state.currentAgents;
    }
    const entry = state.history[state.historyIndex];
    if (!entry) {
      return new Map<string, NovelAgent>();
    }
    const agents = new Map<string, NovelAgent>();
    const agentStates = entry.agentStates as Record<
      string,
      {
        name: string;
        sentiments: [string, number][];
        knownSecrets: string[];
        observedEvents: string[];
      }
    >;
    for (const [id, agentState] of Object.entries(agentStates)) {
      agents.set(id, {
        characterId: id,
        name: agentState.name,
        profile: "",
        aura: null,
        cognition: null,
        soul: "",
        currentGoal: "",
        emotionalState: "",
        knownFacts: new Set<string>(),
        relationships: new Map<
          string,
          import("@/lib/novel/story-simulation/types").AgentRelation
        >(),
        powerLevel: "",
        memory: {
          observedEvents: agentState.observedEvents,
          knownSecrets: new Set<string>(agentState.knownSecrets),
          sentiments: new Map<string, number>(agentState.sentiments),
          recentDecisions: [],
          rumorCredibility: 0.5,
        },
        knowledgeScope: [],
        personality: [],
        speakingStyle: "",
      });
    }
    return agents;
  },

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
      compareBranchIds: [],
      isCompareMode: false,
      history: [],
      historyIndex: -1,
      isPlaying: false,
      playbackSpeed: 1,
    }),
  initWithPreset: (preset) =>
    set((state) => {
      let phase: SimulationPhase = "configuring";

      if (preset.intent === "story_framework_generate") {
        phase = "configuring";
      } else if (preset.intent === "multi_agent_simulate") {
        phase = preset.hasFramework ? "simulating" : "configuring";
      } else if (preset.intent === "character_interview") {
        phase =
          preset.hasFramework && state.savedResults.length > 0
            ? "report-viewing"
            : "configuring";
      }

      return {
        userIdea: preset.userInput,
        phase,
      };
    }),
}));

export function calculateBranchScore(
  directorEvaluations: DirectorEvaluation[],
  eventCount: number,
  activeAgentCount: number,
  totalAgentCount: number,
  goalProgress: number = 0.6,
): {
  overallScore: number;
  details: {
    avgDirectorScore: number;
    eventCount: number;
    characterDiversity: number;
    plotProgression: number;
  };
} {
  const avgDirectorScore =
    directorEvaluations.length > 0
      ? directorEvaluations.reduce((sum, e) => sum + e.totalScore, 0) /
        directorEvaluations.length
      : 3.0;

  const eventScore = Math.min(5, eventCount / 4) * 0.2;
  const charScore =
    (activeAgentCount / Math.max(1, totalAgentCount)) * 5 * 0.15;
  const plotScore = goalProgress * 5 * 0.15;
  const directorScorePart = avgDirectorScore * 0.5;

  const overallScore =
    Math.round((directorScorePart + eventScore + charScore + plotScore) * 10) /
    10;

  return {
    overallScore,
    details: {
      avgDirectorScore: Math.round(avgDirectorScore * 10) / 10,
      eventCount,
      characterDiversity:
        Math.round((activeAgentCount / Math.max(1, totalAgentCount)) * 100) /
        100,
      plotProgression: Math.round(goalProgress * 100) / 100,
    },
  };
}
