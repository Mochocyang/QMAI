import "@/components/uitest/ui-test-tools.css";
import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Send,
  X,
  Download,
  ChevronDown,
  ChevronRight,
  Save,
  Loader2,
  ArrowLeft,
} from "lucide-react";

import { useWikiStore } from "@/stores/wiki-store";
import {
  useStorySimulationStore,
  type SavedSimulationResult,
} from "@/stores/story-simulation-store";
import { extractStoryContent } from "@/lib/novel/story-simulation/story-extractor";
import { generateStoryFramework } from "@/lib/novel/story-simulation/story-framework-generator";
import { buildAgents } from "@/lib/novel/story-simulation/agent-profile-builder";
import {
  runSimulation,
  type SimulationCallbacks,
} from "@/lib/novel/story-simulation/simulation-engine";
import { generateDynamicEventPool } from "@/lib/novel/story-simulation/event-pool-generator";
import { generateSimulationReport } from "@/lib/novel/story-simulation/simulation-report-agent";
import { generateStoryDraft } from "@/lib/novel/story-simulation/story-draft-generator";
import {
  saveFramework,
  saveSimulationResult,
  loadSimulationResults,
  type SimulationResultRecord,
} from "@/lib/novel/story-simulation/framework-store";
import { resolveDefaultModel } from "@/lib/novel/model-resolver";
import { interviewAgent } from "@/lib/novel/story-simulation/agent-interview";
import {
  buildScenarioCandidates,
} from "@/lib/novel/story-simulation/scenario-participant-selector";
import {
  buildScenarioSession,
  continueScenario,
  runScenario,
} from "@/lib/novel/story-simulation/scenario-engine";
import { exportScenario } from "@/lib/novel/story-simulation/scenario-export";
import { importScenarioToChapter } from "@/lib/novel/story-simulation/scenario-importer";
import { refreshProjectState } from "@/lib/project-refresh";
import {
  saveScenario,
  loadScenarios,
  deleteScenario,
} from "@/lib/novel/story-simulation/scenario-store";
import type {
  ScenarioMessage,
  ScenarioSession,
  ScenarioSetup,
} from "@/lib/novel/story-simulation/scenario-types";
import {
  lastSpokenRound,
  remainingScenarioRounds,
} from "@/lib/novel/story-simulation/scenario-types";
import { collectScenarioReferenceMaterial } from "@/lib/novel/story-simulation/scenario-reference";
import {
  saveInterview,
  loadInterviews,
} from "@/lib/novel/story-simulation/interview-store";
import { exportInterview } from "@/lib/novel/story-simulation/interview-export";
import {
  serializeSimulationState,
  deserializeSimulationSnapshot,
} from "@/lib/novel/story-simulation/simulation-serializer";
import type {
  AgentChatMessage,
  ExtractionResult,
  NovelAgent,
  RumorEvent,
  SimulationDebugTrace,
  SimulationHistoryEntry,
  SimulationReport,
  SimulationResumePoint,
  SimulationState,
  StoryBranch,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types";

import { SimulationConfigPanel } from "./simulation-config-panel";
import { averageDirectorScore } from "@/lib/novel/story-simulation/result-summary";
import { summarizeRunStatus } from "@/lib/novel/story-simulation/run-status";
import {
  buildBranchEventPlanMarkdown,
  exportBranchEventPlan,
  generateBranchEventPlan,
  resolvePlanTargetNode,
} from "@/lib/novel/story-simulation/branch-event-plan";
import { FrameworkConfirmPanel } from "./framework-confirm-panel";
import { SimulationReportView } from "./simulation-report-view";
import { StoryDraftView } from "./story-draft-view";
import { InterviewHistoryView } from "./interview-history-view";
import { RumorPropagationPanel } from "./rumor-propagation-panel";
import { ClueTimelinePanel } from "./detective-board-panel";
import { BranchManagerPanel } from "./branch-manager-panel";
import { HistoryResultsModal } from "./history-results-modal";
import { BranchCompareView } from "./branch-compare-view";
import { ScenarioSetupPanel } from "./scenario-setup-panel";
import { ScenarioRoomView } from "./scenario-room-view";
import {
  actionTypeShortLabel,
  actionTypePhraseOnly,
  actionTypePhrase,
  actionTypeIcon,
} from "@/lib/novel/story-simulation/action-type-utils";
import { Button } from "@/components/ui/button";
import { StorySimulationHub } from "./story-simulation-hub";
import { useSimulationSession } from "./use-simulation-session";

const PROGRESS_PHASES = [
  "extracting",
  "framework-generating",
  "simulating",
  "report-generating",
  "draft-generating",
] as const;

/**
 * 故事推演室主视图。
 *
 * 整窗单栏布局：不再有左侧「故事框架」目录栏（该栏已删除，所以本视图进了
 * `@/lib/full-window-views` 的整窗清单）。主区域按 phase 切换：
 *
 *   idle（落地页，两个同级入口）
 *     ├─ 剧情推演式：配置 → 框架确认 → 推演（实时事件流）→ 报告 → 草稿
 *     └─ 舞台情景：配置 → 圆桌对话
 *
 * 两个入口是**彼此独立**的功能，只在落地页并列出现；
 * 改造前「舞台情景」被压在剧情推演配置页的最底部（层级归属不合理）。
 * 报告阶段可弹出 Agent 采访面板与角色对话。
 */
export function StorySimulationView() {
  const { t } = useTranslation();
  const projectPath = useWikiStore((s) => s.project?.path);
  const projectName = useWikiStore((s) => s.project?.name);
  const baseLlmConfig = useWikiStore((s) => s.llmConfig);

  const phase = useStorySimulationStore((s) => s.phase);
  const mode = useStorySimulationStore((s) => s.mode);
  const directorEnabled = useStorySimulationStore((s) => s.directorEnabled);
  const userIdea = useStorySimulationStore((s) => s.userIdea);
  const targetWords = useStorySimulationStore((s) => s.targetWords);
  const sourceChapters = useStorySimulationStore((s) => s.sourceChapters);
  const simulationRounds = useStorySimulationStore((s) => s.simulationRounds);
  const extractionResult = useStorySimulationStore((s) => s.extractionResult);
  const currentFramework = useStorySimulationStore((s) => s.currentFramework);
  const currentReport = useStorySimulationStore((s) => s.currentReport);
  const currentDraft = useStorySimulationStore((s) => s.currentDraft);
  const error = useStorySimulationStore((s) => s.error);
  const progress = useStorySimulationStore((s) => s.progress);
  const progressLabel = useStorySimulationStore((s) => s.progressLabel);
  const timelineEvents = useStorySimulationStore((s) => s.timelineEvents);
  const debugTraces = useStorySimulationStore((s) => s.debugTraces);
  const activeChatAgent = useStorySimulationStore((s) => s.activeChatAgent);
  const savedResults = useStorySimulationStore((s) => s.savedResults);
  const selectedResultId = useStorySimulationStore((s) => s.selectedResultId);

  const setPhase = useStorySimulationStore((s) => s.setPhase);
  const setExtractionResult = useStorySimulationStore(
    (s) => s.setExtractionResult,
  );
  const setCurrentFramework = useStorySimulationStore(
    (s) => s.setCurrentFramework,
  );
  const setCurrentReport = useStorySimulationStore((s) => s.setCurrentReport);
  const setCurrentDraft = useStorySimulationStore((s) => s.setCurrentDraft);
  const setError = useStorySimulationStore((s) => s.setError);
  const infoMessage = useStorySimulationStore((s) => s.infoMessage);
  const setInfoMessage = useStorySimulationStore((s) => s.setInfoMessage);
  const setProgress = useStorySimulationStore((s) => s.setProgress);
  const setTimelineEvents = useStorySimulationStore((s) => s.setTimelineEvents);
  const addTimelineEvent = useStorySimulationStore((s) => s.addTimelineEvent);
  const setDebugTraces = useStorySimulationStore((s) => s.setDebugTraces);
  const addDebugTrace = useStorySimulationStore((s) => s.addDebugTrace);
  const setActiveChatAgent = useStorySimulationStore(
    (s) => s.setActiveChatAgent,
  );
  const addAgentChatMessage = useStorySimulationStore(
    (s) => s.addAgentChatMessage,
  );
  const agentChatMessages = useStorySimulationStore((s) => s.agentChatMessages);
  const clearAgentChat = useStorySimulationStore((s) => s.clearAgentChat);
  const setSavedResults = useStorySimulationStore((s) => s.setSavedResults);
  const setShowInterviewHistory = useStorySimulationStore(
    (s) => s.setShowInterviewHistory,
  );
  const continuingInterviewId = useStorySimulationStore(
    (s) => s.continuingInterviewId,
  );
  const setContinuingInterviewId = useStorySimulationStore(
    (s) => s.setContinuingInterviewId,
  );
  const dynamicEventPool = useStorySimulationStore((s) => s.dynamicEventPool);
  const setDynamicEventPool = useStorySimulationStore(
    (s) => s.setDynamicEventPool,
  );
  const setCurrentRumors = useStorySimulationStore((s) => s.setCurrentRumors);
  const setCurrentAgents = useStorySimulationStore((s) => s.setCurrentAgents);
  const setDirectorEvaluations = useStorySimulationStore(
    (s) => s.setDirectorEvaluations,
  );
  const addDirectorEvaluation = useStorySimulationStore(
    (s) => s.addDirectorEvaluation,
  );
  const setSelectedResultId = useStorySimulationStore(
    (s) => s.setSelectedResultId,
  );
  const currentRumors = useStorySimulationStore((s) => s.currentRumors);
  const currentAgents = useStorySimulationStore((s) => s.currentAgents);
  const branches = useStorySimulationStore((s) => s.branches);
  const activeBranchId = useStorySimulationStore((s) => s.activeBranchId);
  const compareBranchIds = useStorySimulationStore((s) => s.compareBranchIds);
  const isCompareMode = useStorySimulationStore((s) => s.isCompareMode);
  const saveCurrentAsBranch = useStorySimulationStore(
    (s) => s.saveCurrentAsBranch,
  );
  const deleteBranch = useStorySimulationStore((s) => s.deleteBranch);
  const renameBranch = useStorySimulationStore((s) => s.renameBranch);
  const switchToBranch = useStorySimulationStore((s) => s.switchToBranch);
  const setCompareMode = useStorySimulationStore((s) => s.setCompareMode);
  const toggleCompareBranch = useStorySimulationStore(
    (s) => s.toggleCompareBranch,
  );
  const clearCompareSelection = useStorySimulationStore(
    (s) => s.clearCompareSelection,
  );
  const addHistoryEntry = useStorySimulationStore((s) => s.addHistoryEntry);
  const clearHistory = useStorySimulationStore((s) => s.clearHistory);

  // 舞台情景
  const scenarioSession = useStorySimulationStore((s) => s.scenarioSession);
  const scenarioStreaming = useStorySimulationStore((s) => s.scenarioStreaming);
  const scenarioProgress = useStorySimulationStore((s) => s.scenarioProgress);
  const scenarioExtracting = useStorySimulationStore(
    (s) => s.scenarioExtracting,
  );
  const setScenarioSession = useStorySimulationStore((s) => s.setScenarioSession);
  const setScenarioStreaming = useStorySimulationStore(
    (s) => s.setScenarioStreaming,
  );
  const setScenarioProgress = useStorySimulationStore(
    (s) => s.setScenarioProgress,
  );
  const setScenarioExtracting = useStorySimulationStore(
    (s) => s.setScenarioExtracting,
  );

  // 保存仿真后的 agents 和 state 供采访使用
  const lastAgentsRef = useRef<NovelAgent[]>([]);
  const lastSimulationStateRef = useRef<SimulationState | null>(null);
  // 追踪上一轮的 round，确保每轮只加一次历史快照
  const lastHistoryRoundRef = useRef<number>(-1);

  // 取消控制器
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  /** 正在导出事件计划的分支标题（P1-10） */
  const [exportingBranchTitle, setExportingBranchTitle] = useState<
    string | null
  >(null);
  const resumeSimulationRef = useRef<SimulationResumePoint | null>(null);
  const resumeSnapshotRef = useRef<{
    agentSnapshot?: ReturnType<typeof serializeSimulationState> | null;
    debugTraces?: SimulationDebugTrace[];
    rumors?: RumorEvent[];
  } | null>(null);

  // 历史结果模态框
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // 报告阶段视图切换
  const [reportViewTab, setReportViewTab] = useState<
    "report" | "timeline" | "overview" | "rumors" | "clues"
  >("report");

  // 草稿阶段视图切换
  const [draftViewTab, setDraftViewTab] = useState<
    "draft" | "report" | "timeline" | "overview" | "rumors" | "clues"
  >("draft");

  // 采访输入框
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatExporting, setChatExporting] = useState(false);
  const [chatSaving, setChatSaving] = useState(false);
  const chatStreamRef = useRef("");
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  // ── 舞台情景本地状态 ──
  const [scenarioInput, setScenarioInput] = useState("");
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [scenarioExporting, setScenarioExporting] = useState(false);
  const [scenarioInserting, setScenarioInserting] = useState(false);
  /**
   * 本场情景实际注入了几篇参考资料（null=没填参考点或一篇都没搜到）。
   *
   * 必须让用户看见：「参考点」写着「必须以此为依据」，如果检索落空，作者看到的
   * 界面和检索成功时一模一样，只会以为模型不听话。
   */
  const [scenarioReferenceInfo, setScenarioReferenceInfo] = useState<{
    count: number;
    truncated: boolean;
  } | null>(null);
  const [scenarioSaved, setScenarioSaved] = useState<ScenarioSession[]>([]);
  const [scenarioSourceChapters, setScenarioSourceChapters] =
    useState(sourceChapters);
  const [scenarioExtractNonce, setScenarioExtractNonce] = useState(0);
  const scenarioExtractedSigRef = useRef<string | null>(null);
  const scenarioAbortRef = useRef<AbortController | null>(null);
  const scenarioStreamRef = useRef("");
  const scenarioMessagesRef = useRef<ScenarioMessage[]>([]);

  // 当前阶段的进度基线
  const phaseBaseProgressRef = useRef(0);

  // 配置跨项目/重启保留（.qmai/simulations/session.json）
  useSimulationSession(projectPath);

  // 采访面板打开时自动滚动到底部
  useEffect(() => {
    if (activeChatAgent && chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [agentChatMessages, activeChatAgent]);

  // 选择历史结果时，反序列化恢复agent状态，支持采访
  useEffect(() => {
    if (!selectedResultId) return;
    const result = savedResults.find((r) => r.id === selectedResultId);
    if (!result) return;

    if (result.agentSnapshot) {
      try {
        const { agents, state } = deserializeSimulationSnapshot(
          result.agentSnapshot,
        );
        lastAgentsRef.current = agents;
        lastSimulationStateRef.current = state;
        setCurrentAgents(new Map(agents.map((a) => [a.characterId, a])));
      } catch (err) {
        console.error("反序列化历史结果失败:", err);
        // 快照损坏时清空，避免采访继续用上一条推演的角色与世界观。
        lastAgentsRef.current = [];
        lastSimulationStateRef.current = null;
        setCurrentAgents(new Map());
      }
    } else {
      /*
       * 这条历史结果没有 agentSnapshot。必须把内存态一并清掉，否则采访会拿
       * `lastSimulationStateRef` 里**上一次推演**的世界去回答，指着一个界面
       * 上根本没显示的角色聊天。清空后采访会走 handleSendChat 的恢复分支，
       * 最终给出「没有可用的角色状态」这个诚实的提示。
       */
      lastAgentsRef.current = [];
      lastSimulationStateRef.current = null;
      setCurrentAgents(new Map());
    }
    if (result.timelineEvents) {
      setTimelineEvents(result.timelineEvents);
    }
    if (result.rumors) {
      setCurrentRumors(result.rumors);
    }
    if (result.debugTraces) {
      setDebugTraces(result.debugTraces);
    }
  }, [
    selectedResultId,
    savedResults,
    setCurrentAgents,
    setTimelineEvents,
    setCurrentRumors,
    setDebugTraces,
  ]);

  // 续聊模式：恢复 agents 和 simulationState 到 ref
  useEffect(() => {
    if (!continuingInterviewId || !projectPath) return;

    // 异步恢复 agents
    const restoreAgents = async () => {
      try {
        // 先尝试从采访记录恢复
        const interviews = await loadInterviews(projectPath);
        const interview = interviews.find(
          (i) => i.id === continuingInterviewId,
        );

        if (interview?.agentSnapshot) {
          const { agents, state } = deserializeSimulationSnapshot(
            interview.agentSnapshot,
          );
          lastAgentsRef.current = agents;
          lastSimulationStateRef.current = state;
          return;
        }

        // 若采访记录无快照，尝试从推演结果恢复
        if (interview?.frameworkId) {
          const results = await loadSimulationResults(
            projectPath,
            interview.frameworkId,
          );
          for (const r of results) {
            if (r.agentSnapshot) {
              const { agents, state } = deserializeSimulationSnapshot(
                r.agentSnapshot,
              );
              lastAgentsRef.current = agents;
              lastSimulationStateRef.current = state;
              return;
            }
          }
        }
      } catch (err) {
        console.error("恢复 agent 状态失败:", err);
      }
    };

    restoreAgents();
  }, [continuingInterviewId, projectPath]);

  // ── 核心流程 ──

  const savePartialSimulationResult = async (partialReason: string) => {
    if (!projectPath || !currentFramework) return;
    const state = useStorySimulationStore.getState();
    const savedTimelineEvents = state.timelineEvents;
    if (savedTimelineEvents.length === 0 && state.debugTraces.length === 0) {
      return;
    }

    const latestEvent = savedTimelineEvents[savedTimelineEvents.length - 1];
    const resume: SimulationResumePoint = {
      nextNodeIndex: latestEvent?.nodeIndex ?? 0,
      nextRound: latestEvent ? latestEvent.round + 1 : 0,
      timelineEvents: savedTimelineEvents,
    };
    const activeAgents =
      state.currentAgents.size > 0
        ? state.currentAgents
        : new Map(
            lastAgentsRef.current.map((agent) => [agent.characterId, agent]),
          );
    const snapshotState: SimulationState = {
      currentRound: latestEvent?.round ?? 0,
      timelineEvents: savedTimelineEvents,
      activeAgents,
      worldState: lastSimulationStateRef.current?.worldState ?? {},
      directorEnabled: state.directorEnabled,
      nextNodeInjectionMap: new Map(),
    };
    const agentsForSnapshot =
      activeAgents.size > 0
        ? Array.from(activeAgents.values())
        : lastAgentsRef.current;
    const agentSnapshot =
      agentsForSnapshot.length > 0
        ? serializeSimulationState(snapshotState, agentsForSnapshot)
        : undefined;
    const report: SimulationReport = {
      frameworkId: currentFramework.id,
      mode,
      characterAnalyses: [],
      branches: [],
      recommendation: `推演未完成：${partialReason}。可在历史推演结果中查看已生成内容，并继续推演。`,
      createdAt: new Date().toISOString(),
    };

    await saveSimulationResult(
      projectPath,
      currentFramework.id,
      report,
      undefined,
      savedTimelineEvents,
      agentSnapshot,
      state.currentRumors,
      state.debugTraces,
      {
        status: partialReason.includes("取消") ? "cancelled" : "partial",
        partialReason,
        resume,
      },
    );
    const results = await loadSimulationResults(projectPath, currentFramework.id);
    setSavedResults(
      results.map((r) => ({
        id: r.id,
        frameworkId: currentFramework.id,
        report: r.report,
        draft: r.draft,
        timelineEvents: r.timelineEvents,
        agentSnapshot: r.agentSnapshot,
        rumors: r.rumors,
        debugTraces: r.debugTraces,
        status: r.status,
        partialReason: r.partialReason,
        resume: r.resume,
        createdAt: r.report.createdAt,
      })),
    );
    setInfoMessage("已保存未完成推演，可在历史推演结果中继续。");
    setTimeout(() => setInfoMessage(null), 5000);
  };

  /** 取消当前正在进行的操作 */
  const handleCancel = () => {
    if (abortControllerRef.current) {
      setIsCancelling(true);
      setError("正在取消并保存未完成推演...");
      abortControllerRef.current.abort();
    }
  };

  /** 提取内容并生成故事框架，进入框架确认阶段。 */
  const handleStart = async () => {
    if (!projectPath) {
      setError("请先打开一个项目");
      return;
    }
    setError(null);
    setCurrentFramework(null);
    setTimelineEvents([]);
    setDebugTraces([]);
    try {
      const llmConfig = resolveDefaultModel(baseLlmConfig);

      // 1. 提取内容
      setPhase("extracting");
      phaseBaseProgressRef.current = 0;
      setProgress(0, t("storySimulation.extracting"));
      const extraction: ExtractionResult = await extractStoryContent(
        projectPath,
        {
          sourceChapters,
          llmConfig,
          onProgress: (p, label) => setProgress(p, label),
        },
      );
      setExtractionResult(extraction);

      // 1.5 预生成动态事件池
      const characterNames = extraction.characters.map((c) => c.name);
      const eventPool = await generateDynamicEventPool({
        llmConfig,
        worldRules: extraction.worldRules,
        characters: characterNames,
      });
      setDynamicEventPool(eventPool);

      // 2. 生成框架
      setPhase("framework-generating");
      phaseBaseProgressRef.current = 30;
      setProgress(30, "正在生成故事框架...");
      const framework: StoryFramework = await generateStoryFramework({
        extraction,
        mode,
        targetWords,
        userIdea: userIdea || undefined,
        llmConfig,
        onProgress: (label) => setProgress(phaseBaseProgressRef.current, label),
      });
      setCurrentFramework(framework);
      setPhase("framework-confirming");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("configuring");
    }
  };

  /** 保存当前框架到磁盘。 */
  const handleSaveFramework = async () => {
    if (!projectPath || !currentFramework) return;
    try {
      await saveFramework(projectPath, currentFramework);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 把磁盘上的推演结果记录转成 store 里的形态（补上所属框架与展示用时间）。 */
  const toSavedResult = (
    frameworkId: string,
    record: SimulationResultRecord,
  ): SavedSimulationResult => ({
    id: record.id,
    frameworkId,
    report: record.report,
    draft: record.draft ?? null,
    timelineEvents: record.timelineEvents,
    agentSnapshot: record.agentSnapshot ?? null,
    rumors: record.rumors,
    debugTraces: record.debugTraces,
    status: record.status,
    partialReason: record.partialReason ?? null,
    resume: record.resume ?? null,
    createdAt: record.report.createdAt,
  });

  /**
   * 把一条已保存的推演结果灌进 store（报告 / 草稿 / 时间线 / 传闻 / 调试轨迹 /
   * agent 快照），供报告页渲染。
   *
   * 抽成独立函数是因为现在有两个入口：框架内的「历史结果」模态框，
   * 以及落地页「最近」里那条**跨框架**的结果。
   */
  const applySimulationResult = (result: SavedSimulationResult) => {
    setCurrentReport(result.report);
    setCurrentDraft(result.draft || null);
    setTimelineEvents(result.timelineEvents || []);
    setCurrentRumors(result.rumors || []);
    setDebugTraces(result.debugTraces || []);
    if (result.agentSnapshot) {
      try {
        const { agents } = deserializeSimulationSnapshot(result.agentSnapshot);
        setCurrentAgents(new Map(agents.map((a) => [a.characterId, a])));
      } catch {
        setCurrentAgents(new Map());
      }
    } else {
      setCurrentAgents(new Map());
    }
    setSelectedResultId(result.id);
  };

  /** 从历史结果模态框选择结果：反序列化并切换到报告阶段。 */
  const handleSelectHistoryResult = (resultId: string) => {
    const result = savedResults.find((r) => r.id === resultId);
    if (!result) return;

    applySimulationResult(result);
    setShowHistoryModal(false);
    if ((result.status ?? "complete") !== "complete") {
      setReportViewTab("timeline");
    }
    setPhase("report-viewing");
  };

  /**
   * 报告页内置下拉的历史结果切换。
   *
   * 必须走 `applySimulationResult` 而不是只改一个「选中 id」：报告页展示的是
   * `currentResult.report`，而「生成草稿」用的是 store 的 `currentReport`。只改 id
   * 会让两者错位 —— 界面显示 B 结果，草稿却按 A 结果的角色分析去生成。
   *
   * 选中 `null`（下拉里的「最新推演」）时回到最新一条；`loadSimulationResults`
   * 按 `report.createdAt` 倒序，所以 `savedResults[0]` 就是最新。
   */
  const handleSelectReportResult = (resultId: string | null) => {
    if (!resultId) {
      const latest = savedResults[0];
      if (latest) {
        applySimulationResult(latest);
      } else {
        setSelectedResultId(null);
      }
      return;
    }

    const result = savedResults.find((r) => r.id === resultId);
    if (!result) {
      setSelectedResultId(null);
      return;
    }

    applySimulationResult(result);
  };

  /**
   * 从落地页的「最近」打开一条**跨框架**的推演结果。
   *
   * 与上面那个入口的区别：那条结果可能属于别的框架，所以必须先把框架设成
   * currentFramework —— 否则报告页的上下文（框架标题、重新推演、导出）是错的。
   *
   * `savedResults` 必须至少含这一条：报告页会按 `selectedResultId` 在
   * `savedResults` 里回查（导出草稿、继续推演都走那条路）。
   * 这里先放一条让报告页立刻可用，再异步把该框架的完整历史补齐 ——
   * 补齐失败就保持这一条，不影响正在看的报告。
   */
  const handleResumeSimulationResult = (
    framework: StoryFramework,
    record: SimulationResultRecord,
  ) => {
    setError(null);
    setInfoMessage(null);
    setCurrentFramework(framework);

    const mapped = toSavedResult(framework.id, record);
    setSavedResults([mapped]);
    applySimulationResult(mapped);

    if ((record.status ?? "complete") !== "complete") {
      setReportViewTab("timeline");
    }
    setPhase("report-viewing");

    const path = projectPath;
    if (!path) return;
    void (async () => {
      try {
        const records = await loadSimulationResults(path, framework.id);
        setSavedResults(records.map((item) => toSavedResult(framework.id, item)));
      } catch {
        // 补全失败就保持刚才那一条
      }
    })();
  };

  const handleContinuePartialResult = (resultId: string) => {
    const result = savedResults.find((r) => r.id === resultId);
    if (!result?.resume) return;

    setTimelineEvents(result.timelineEvents || []);
    setDebugTraces(result.debugTraces || []);
    setCurrentRumors(result.rumors || []);
    setCurrentReport(null);
    setCurrentDraft(null);
    if (result.agentSnapshot) {
      try {
        const { agents, state } = deserializeSimulationSnapshot(
          result.agentSnapshot,
        );
        lastAgentsRef.current = agents;
        lastSimulationStateRef.current = state;
        setCurrentAgents(new Map(agents.map((a) => [a.characterId, a])));
      } catch {
        setCurrentAgents(new Map());
      }
    }
    resumeSimulationRef.current = result.resume;
    resumeSnapshotRef.current = {
      agentSnapshot: result.agentSnapshot,
      debugTraces: result.debugTraces,
      rumors: result.rumors,
    };
    setSelectedResultId(resultId);
    setShowHistoryModal(false);
    void handleConfirmFramework();
  };

  /** 确认框架：必要时先保存 → 构建角色 → 仿真 → 生成报告。 */
  const handleConfirmFramework = async () => {
    if (!projectPath || !currentFramework) {
      setError("缺少项目路径或故事框架");
      return;
    }
    const resumePoint = resumeSimulationRef.current;
    const resumeSnapshot = resumeSnapshotRef.current;
    setError(null);
    setTimelineEvents([]);
    setDebugTraces(resumePoint ? resumeSnapshot?.debugTraces || [] : []);
    setCurrentRumors(resumePoint ? resumeSnapshot?.rumors || [] : []);
    /*
     * 开跑前清掉「正在查看的历史结果」。
     *
     * 报告页的 `viewingResultId` 现在就是 store 的 `selectedResultId`，若不清，
     * 新一次推演跑完后报告页会继续显示上一次浏览的那条历史结果，而不是刚跑出来的。
     * 继续推演路径不依赖它：需要用的快照已由 handleContinuePartialResult 直接
     * 写进 lastSimulationStateRef / lastAgentsRef。
     */
    setSelectedResultId(null);
    setIsCancelling(false);
    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      // 若尚无提取结果（如从历史框架进入），先提取
      let extraction = extractionResult;
      if (!extraction) {
        const llmConfig = resolveDefaultModel(baseLlmConfig);
        setPhase("extracting");
        phaseBaseProgressRef.current = 0;
        setProgress(0, t("storySimulation.extracting"));
        extraction = await extractStoryContent(projectPath, {
          sourceChapters,
          llmConfig,
          onProgress: (p, label) => setProgress(p, label),
        });
        setExtractionResult(extraction);
      }

      /*
       * 开始推演前先把当前框架落盘。
       *
       * 以前这里靠 store 里那份 `frameworks` 列表判断「是否已经保存过」，
       * 那份列表随左侧「故事框架」栏一起删掉了（落地页自己按需读取）。
       * `saveFramework` 是幂等的原子写，直接写即可 —— 少了缓存，
       * 也就不存在「缓存里没有但其实已在磁盘上」这类误判。
       */
      await saveFramework(projectPath, currentFramework);

      // 构建角色并运行仿真
      setPhase("simulating");
      phaseBaseProgressRef.current = 50;
      setProgress(50, t("storySimulation.simulating"));
      let agents = buildAgents(extraction, currentFramework);
      if (resumePoint && resumeSnapshot?.agentSnapshot) {
        try {
          agents = deserializeSimulationSnapshot(resumeSnapshot.agentSnapshot).agents;
        } catch {
          // 快照损坏时回退为重新构建角色，避免继续推演入口直接失败。
        }
      }
      // 强制校验：没有 Agent 直接中止推演，避免空跑浪费 token
      if (agents.length === 0) {
        throw new Error(
          "未提取到任何角色 Agent，无法推演。请检查项目快照（.novel/snapshots）中是否包含 characters 字段，或检查框架节点的 involvedCharacters 是否与提取到的角色名匹配。",
        );
      }
      lastAgentsRef.current = agents;
      const llmConfig = resolveDefaultModel(baseLlmConfig);

      // 清空历史记录
      clearHistory();
      lastHistoryRoundRef.current = -1;

      const collectedTimeline: TimelineEvent[] = [];

      // 导演开关以面板 store 值为准，贯穿本次推演的状态快照与分支评分
      const directorEnabledForRun = directorEnabled;
      setDirectorEvaluations([]);

      const callbacks: SimulationCallbacks = {
        onEvent: () => {},
        onProgress: (p, label) => setProgress(50 + Math.floor(p / 2), label),
        onComplete: () => {},
        onError: () => {},
        onTimelineEvent: (event) => {
          collectedTimeline.push(event);
          addTimelineEvent(event);
        },
        onDebugTrace: (trace) => {
          addDebugTrace(trace);
          setCurrentRumors(trace.rumors);
          setCurrentAgents(trace.activeAgents);
          lastAgentsRef.current = Array.from(trace.activeAgents.values());
          lastSimulationStateRef.current = {
            currentRound: trace.round,
            timelineEvents: useStorySimulationStore.getState().timelineEvents,
            activeAgents: trace.activeAgents,
            worldState: {},
            directorEnabled: directorEnabledForRun,
            nextNodeInjectionMap: new Map(),
          };

          // 每轮只加一次历史快照（当 round 变化时）
          if (trace.round !== lastHistoryRoundRef.current) {
            lastHistoryRoundRef.current = trace.round;

            const agentStates: SimulationHistoryEntry["agentStates"] = {};
            for (const [id, agent] of trace.activeAgents) {
              agentStates[id] = {
                name: agent.name,
                sentiments: Array.from(agent.memory.sentiments.entries()) as [
                  string,
                  number,
                ][],
                knownSecrets: Array.from(agent.memory.knownSecrets),
                observedEvents: [...agent.memory.observedEvents],
              };
            }

            const entry: SimulationHistoryEntry = {
              round: trace.round,
              nodeIndex: trace.nodeIndex,
              nodeTitle: trace.nodeTitle,
              agentStates,
              eventCount: trace.blackboard.totalEventCount,
              rumorCount: trace.blackboard.rumorCount,
            };

            addHistoryEntry(entry);
          }
        },
        onDirectorEvaluation: (evaluation) => {
          addDirectorEvaluation(evaluation);
        },
      };
      const events = await runSimulation(
        {
          agents,
          framework: currentFramework,
          mode,
          wordBudget: targetWords,
          llmConfig,
          userIdea: userIdea || undefined,
          maxRoundsPerNode: simulationRounds > 0 ? simulationRounds : undefined,
          directorEnabled: directorEnabledForRun,
          dynamicEventPool: (
            Array.isArray(dynamicEventPool)
              ? dynamicEventPool.length > 0
              : dynamicEventPool.all.length > 0
          )
            ? dynamicEventPool
            : undefined,
          resume: resumePoint ?? undefined,
        },
        extraction,
        callbacks,
        ac.signal,
      );

      if (ac.signal.aborted) {
        await savePartialSimulationResult("用户取消推演");
        setPhase("framework-confirming");
        setError("推演已取消");
        setTimeout(() => setError(null), 3000);
        return;
      }

      // 保存仿真状态供采访使用
      lastSimulationStateRef.current = {
        currentRound: 0,
        timelineEvents: collectedTimeline,
        activeAgents: new Map(agents.map((a) => [a.characterId, a])),
        worldState: {},
        directorEnabled: directorEnabledForRun,
        nextNodeInjectionMap: new Map(),
      };

      // 生成推演报告
      setPhase("report-generating");
      phaseBaseProgressRef.current = 80;
      setProgress(80, "正在生成推演报告...");
      const report = await generateSimulationReport({
        events,
        framework: currentFramework,
        mode,
        llmConfig,
        onProgress: (label) => setProgress(phaseBaseProgressRef.current, label),
        signal: ac.signal,
      });

      // 把导演评分落进报告：历史结果列表读的是磁盘上的报告，而导演评估只存在
      // 内存分支里。不落盘的话，列表永远显示不出「导演均分」。
      const directorEvals =
        useStorySimulationStore.getState().directorEvaluations;
      const directorAverageScore = averageDirectorScore(directorEvals);
      if (directorAverageScore !== null) {
        report.directorAverageScore = directorAverageScore;
        report.directorEvaluationCount = directorEvals.length;
      }

      if (ac.signal.aborted) {
        await savePartialSimulationResult("用户取消推演");
        setPhase("framework-confirming");
        setError("已取消");
        setTimeout(() => setError(null), 3000);
        return;
      }

      setCurrentReport(report);
      setPhase("report-viewing");

      // 自动保存推演结果（包含时间线事件和agent快照）
      try {
        const agentSnapshot = serializeSimulationState(
          lastSimulationStateRef.current!,
          lastAgentsRef.current,
        );
        await saveSimulationResult(
          projectPath,
          currentFramework.id,
          report,
          undefined,
          collectedTimeline,
          agentSnapshot,
          currentRumors,
          debugTraces,
        );
        // 刷新历史结果列表
        const results = await loadSimulationResults(
          projectPath,
          currentFramework.id,
        );
        setSavedResults(
          results.map((r) => ({
            id: r.id,
            frameworkId: currentFramework.id,
            report: r.report,
            draft: r.draft,
            timelineEvents: r.timelineEvents,
            agentSnapshot: r.agentSnapshot,
            rumors: r.rumors,
            debugTraces: r.debugTraces,
            status: r.status,
            partialReason: r.partialReason,
            resume: r.resume,
            createdAt: r.report.createdAt,
          })),
        );
      } catch (saveErr) {
        console.error("保存推演结果失败:", saveErr);
      }
    } catch (err) {
      if (ac.signal.aborted) {
        await savePartialSimulationResult("用户取消推演");
        setPhase("framework-confirming");
        setError("推演已取消");
        setTimeout(() => setError(null), 3000);
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("framework-confirming");
      }
    } finally {
      setIsCancelling(false);
      abortControllerRef.current = null;
      resumeSimulationRef.current = null;
      resumeSnapshotRef.current = null;
    }
  };

  /** 重新生成框架（重新提取 + 生成）。 */
  const handleRegenerateFramework = () => {
    void handleStart();
  };

  /** 重新推演：回退到框架确认阶段。 */
  const handleResimulate = () => {
    setTimelineEvents([]);
    setDebugTraces([]);
    setCurrentReport(null);
    // 同 handleConfirmFramework：别让报告页继续挂着上次浏览的历史结果。
    setSelectedResultId(null);
    setPhase("framework-confirming");
  };

  /** 选择走向分支并生成故事草稿。 */
  const handleGenerateDraft = async (branch: StoryBranch) => {
    if (!projectPath || !currentFramework || !currentReport) {
      setError("缺少项目路径、故事框架或推演报告");
      return;
    }
    setError(null);
    setIsCancelling(false);
    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      setPhase("draft-generating");
      phaseBaseProgressRef.current = 90;
      setProgress(90, "正在生成故事草稿...");
      const llmConfig = resolveDefaultModel(baseLlmConfig);
      const draft = await generateStoryDraft({
        framework: currentFramework,
        report: currentReport,
        selectedBranch: branch,
        llmConfig,
        onProgress: (label) => setProgress(phaseBaseProgressRef.current, label),
        signal: ac.signal,
      });

      if (ac.signal.aborted) {
        setPhase("report-viewing");
        setError("草稿生成已取消");
        setTimeout(() => setError(null), 3000);
        return;
      }

      setCurrentDraft(draft);
      setPhase("draft-viewing");

      // 更新保存的推演结果，添加草稿
      try {
        const agentSnapshot = lastSimulationStateRef.current
          ? serializeSimulationState(
              lastSimulationStateRef.current,
              lastAgentsRef.current,
            )
          : undefined;
        await saveSimulationResult(
          projectPath,
          currentFramework.id,
          currentReport,
          draft,
          timelineEvents,
          agentSnapshot,
          currentRumors,
          debugTraces,
        );
        // 刷新历史结果列表
        const results2 = await loadSimulationResults(
          projectPath,
          currentFramework.id,
        );
        setSavedResults(
          results2.map((r) => ({
            id: r.id,
            frameworkId: currentFramework.id,
            report: r.report,
            draft: r.draft,
            timelineEvents: r.timelineEvents,
              agentSnapshot: r.agentSnapshot,
              rumors: r.rumors,
              debugTraces: r.debugTraces,
              status: r.status,
              partialReason: r.partialReason,
              resume: r.resume,
              createdAt: r.report.createdAt,
            })),
          );
      } catch (saveErr) {
        console.error("更新推演结果草稿失败:", saveErr);
      }
    } catch (err) {
      if (ac.signal.aborted) {
        setPhase("report-viewing");
        setError("草稿生成已取消");
        setTimeout(() => setError(null), 3000);
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("report-viewing");
      }
    } finally {
      setIsCancelling(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * P1-10：把一条走向分支导出成本章事件计划（`wiki/outlines/事件计划/`）。
   *
   * 在这之前推演结果的唯一出口是「生成草稿」→ 正文，中间缺一步可审阅、可修改
   * 的计划。而 `StoryBranch.summary` / `keyEvents` 与章纲 §5「核心事件链」本就
   * 同构，差的只是一个出口。
   *
   * 两个判断：
   * - 计划必须落到某个框架节点上，否则「本章」无从谈起。优先取与分支同名的
   *   节点；没有同名节点就退回第一个节点，并在提示里说明落到了哪一章 ——
   *   不能悄悄挑一个让用户以为就是对的那章。
   * - 生成不达标时**不落盘**：宁可报错让他重试，也不要存一份支离破碎的计划，
   *   否则用户会把它当成可用产物。
   */
  const handleExportEventPlan = async (branch: StoryBranch) => {
    if (!projectPath || !currentFramework || !currentReport) {
      setError("缺少项目路径、故事框架或推演报告，无法导出事件计划");
      return;
    }

    const target = resolvePlanTargetNode(currentFramework, branch);
    if (!target) {
      setError("当前故事框架没有任何节点，无法确定「本章」是哪一章");
      return;
    }
    const { node, matchedByTitle } = target;

    setExportingBranchTitle(branch.title);
    try {
      const llmConfig = resolveDefaultModel(baseLlmConfig);
      const events = await generateBranchEventPlan({
        framework: currentFramework,
        node,
        branch,
        report: currentReport,
        llmConfig,
      });
      const markdown = buildBranchEventPlanMarkdown({
        framework: currentFramework,
        node,
        branch,
        events,
      });
      const { path } = await exportBranchEventPlan({
        projectPath,
        chapterNumber: node.index + 1,
        branchTitle: branch.title,
        markdown,
      });

      const fallbackNote = matchedByTitle
        ? ""
        : `（框架里没有与分支同名的节点，已按「${node.title}」这一章生成）`;
      setInfoMessage(`事件计划已导出到：${path}${fallbackNote}`);
      setTimeout(() => setInfoMessage(null), 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出事件计划失败");
      setTimeout(() => setError(null), 8000);
    } finally {
      setExportingBranchTitle(null);
    }
  };

  /** 草稿视图返回报告视图。 */
  const handleBackToReport = () => {
    setPhase("report-viewing");
  };

  /** 从报告视图进入草稿视图。 */
  const handleViewDraft = () => {
    if (currentDraft) {
      setPhase("draft-viewing");
    }
  };

  /** 打开 Agent 采访面板。 */
  const handleInterviewAgent = (agentId: string, agentName: string) => {
    clearAgentChat();
    setActiveChatAgent({ id: agentId, name: agentName });
  };

  /** 关闭采访面板。 */
  const handleCloseChat = () => {
    clearAgentChat();
  };

  /** 导出对话记录为MD。 */
  const handleExportChat = async () => {
    if (!activeChatAgent || !projectPath || agentChatMessages.length === 0)
      return;
    setChatExporting(true);
    try {
      const filePath = await exportInterview(
        projectPath,
        activeChatAgent.name,
        agentChatMessages,
      );
      setInfoMessage(`对话已导出到：${filePath}`);
      setTimeout(() => setInfoMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setChatExporting(false);
    }
  };

  /** 保存采访对话到项目。 */
  const handleSaveChat = async () => {
    if (!activeChatAgent || !projectPath || agentChatMessages.length === 0)
      return;
    setChatSaving(true);
    try {
      const session = {
        agentId: activeChatAgent.id,
        agentName: activeChatAgent.name,
        messages: agentChatMessages,
      };
      const agentSnapshot =
        lastSimulationStateRef.current && lastAgentsRef.current.length > 0
          ? serializeSimulationState(
              lastSimulationStateRef.current,
              lastAgentsRef.current,
            )
          : undefined;
      // 续聊模式下询问覆盖原采访或另存为新采访
      let existingId: string | undefined;
      if (continuingInterviewId) {
        const choice = confirm(
          "覆盖原采访对话？\n\n确定 = 覆盖原采访\n取消 = 另存为新采访",
        );
        if (choice) {
          existingId = continuingInterviewId;
        }
      }
      await saveInterview(projectPath, session, {
        frameworkId: currentFramework?.id,
        frameworkTitle: currentFramework?.title,
        agentSnapshot,
        existingId,
      });
      setContinuingInterviewId(null);
      setInfoMessage(`采访对话已保存（${agentChatMessages.length}条消息）`);
      setTimeout(() => setInfoMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setTimeout(() => setError(null), 5000);
    } finally {
      setChatSaving(false);
    }
  };

  /** 发送采访消息。 */
  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatSending || !activeChatAgent) return;

    // 确保有可用的仿真状态和角色数据
    if (!lastSimulationStateRef.current || lastAgentsRef.current.length === 0) {
      // 尝试从当前选中的历史结果中恢复
      if (selectedResultId) {
        const result = savedResults.find((r) => r.id === selectedResultId);
        if (result?.agentSnapshot) {
          try {
            const { agents, state } = deserializeSimulationSnapshot(
              result.agentSnapshot,
            );
            lastAgentsRef.current = agents;
            lastSimulationStateRef.current = state;
          } catch (err) {
            setError(
              "恢复角色状态失败：" +
                (err instanceof Error ? err.message : String(err)),
            );
            return;
          }
        }
      }
      // 如果还是没有，说明无法采访
      if (
        !lastSimulationStateRef.current ||
        lastAgentsRef.current.length === 0
      ) {
        setError("没有可用的角色状态，无法进行采访。请先完成一次推演。");
        return;
      }
    }

    const llmConfig = resolveDefaultModel(baseLlmConfig);
    let agent = lastAgentsRef.current.find(
      (a) => a.characterId === activeChatAgent.id,
    );
    // 如果按id找不到，按名字找（兼容旧数据）
    if (!agent) {
      agent = lastAgentsRef.current.find(
        (a) => a.name === activeChatAgent.name,
      );
    }
    if (!agent) {
      setError(`找不到角色：${activeChatAgent.name}`);
      return;
    }

    setChatInput("");
    setChatSending(true);
    chatStreamRef.current = "";

    // 先添加一条占位的 agent 消息，流式更新
    const placeholderId = `msg_${Date.now()}_stream`;
    const placeholder: AgentChatMessage = {
      id: placeholderId,
      role: "agent",
      agentId: agent.characterId,
      agentName: agent.name,
      content: "",
      timestamp: new Date().toISOString(),
    };

    try {
      // 把已有消息（除 placeholder）组织成 session
      const existingMessages = agentChatMessages;
      const session = {
        agentId: agent.characterId,
        agentName: agent.name,
        messages: [...existingMessages],
      };

      addAgentChatMessage({
        id: `msg_${Date.now()}_user`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      });
      addAgentChatMessage(placeholder);

      await interviewAgent({
        llmConfig,
        agent,
        simulationState: lastSimulationStateRef.current,
        userPrompt: text,
        session,
        onToken: (token) => {
          chatStreamRef.current += token;
          // 直接更新最后一条消息：通过替换 store 中的消息
          // 简化：用 setAgentChatMessages 替换整条消息；这里用 addAgentChatMessage 不好做增量
          // 我们用一个小技巧：拿到当前消息列表，替换最后一条 content
          const state = useStorySimulationStore.getState();
          const msgs = [...state.agentChatMessages];
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0 && msgs[lastIdx].id === placeholderId) {
            msgs[lastIdx] = {
              ...msgs[lastIdx],
              content: chatStreamRef.current,
            };
            useStorySimulationStore.setState({ agentChatMessages: msgs });
          }
        },
        onDone: () => {},
        onError: (err) => {
          setError(err.message);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatSending(false);
    }
  };

  // ── 舞台情景流程 ──

  /** 候选角色（由提取结果整理）。 */
  const scenarioCandidates = useMemo(
    () => (extractionResult ? buildScenarioCandidates(extractionResult) : []),
    [extractionResult],
  );

  /**
   * 进入舞台情景设置时按需提取角色；支持「提取章节数」变更与「重新分析」。
   * 用签名（章节数#nonce）去重，避免重复提取；首次进入若主流程已提取过则直接复用。
   */
  useEffect(() => {
    if (phase !== "scenario-setup") return;
    if (!projectPath) return;
    const sig = `${scenarioSourceChapters}#${scenarioExtractNonce}`;
    if (scenarioExtractedSigRef.current === sig) return;
    if (scenarioExtractNonce === 0 && extractionResult) {
      scenarioExtractedSigRef.current = sig;
      return;
    }
    let cancelled = false;
    scenarioExtractedSigRef.current = sig;
    void (async () => {
      setScenarioExtracting(true);
      setError(null);
      try {
        const llmConfig = resolveDefaultModel(baseLlmConfig);
        const extraction = await extractStoryContent(projectPath, {
          sourceChapters: scenarioSourceChapters,
          llmConfig,
          onProgress: (p, label) => setProgress(p, label),
        });
        if (!cancelled) setExtractionResult(extraction);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setScenarioExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    phase,
    projectPath,
    scenarioSourceChapters,
    scenarioExtractNonce,
    extractionResult,
    baseLlmConfig,
    setError,
    setExtractionResult,
    setProgress,
    setScenarioExtracting,
  ]);

  /** 变更提取章节数（自动触发重新分析）。 */
  const handleScenarioSourceChaptersChange = (count: number) => {
    setScenarioSourceChapters(count);
    setScenarioExtractNonce((k) => k + 1);
  };

  /** 手动重新分析角色。 */
  const handleScenarioReExtract = () => {
    setScenarioExtractNonce((k) => k + 1);
  };

  /** 进入舞台情景设置时，加载已保存的历史情景。 */
  useEffect(() => {
    if (phase !== "scenario-setup") return;
    if (!projectPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadScenarios(projectPath);
        if (!cancelled) setScenarioSaved(list);
      } catch {
        if (!cancelled) setScenarioSaved([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, projectPath]);

  /**
   * 从落地页的「最近」回到一条历史故事框架，继续上次的推演。
   *
   * 这是删掉左侧「故事框架」栏后需要补回的能力（原 SidebarPanel 里的
   * handleSelectFramework 就做这几件事）。落到 framework-confirming 而不是
   * simulating：用户应该先看到框架、确认无误再开跑，而不是一点就直接消耗 token。
   */
  const handleResumeFramework = (framework: StoryFramework) => {
    setError(null);
    setInfoMessage(null);
    setCurrentFramework(framework);
    setCurrentReport(null);
    setCurrentDraft(null);
    setTimelineEvents([]);
    setSelectedResultId(null);
    setPhase("framework-confirming");
  };

  const handleOpenScenario = () => {
    setError(null);
    setInfoMessage(null);
    setPhase("scenario-setup");
  };

  /** 打开一条历史情景（在房间视图中只读回顾，可继续插话续写）。 */
  const handleOpenSavedScenario = (session: ScenarioSession) => {
    setError(null);
    setInfoMessage(null);
    scenarioMessagesRef.current = session.messages ?? [];
    setScenarioSession(session);
    setScenarioStreaming(null);
    setScenarioProgress(null);
    setScenarioRunning(false);
    setPhase("scenario-running");
  };

  /** 删除一条历史情景。 */
  const handleDeleteSavedScenario = async (id: string) => {
    if (!projectPath) return;
    try {
      await deleteScenario(projectPath, id);
      setScenarioSaved((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 构造舞台情景引擎回调（每次生成绑定一个 setup）。 */
  const makeScenarioCallbacks = (setup: ScenarioSetup) => ({
    onMessageStart: (info: {
      kind: ScenarioMessage["kind"];
      speakerId: string;
      speakerName: string;
      round: number;
    }) => {
      scenarioStreamRef.current = "";
      setScenarioStreaming({
        kind: info.kind,
        speakerName: info.speakerName,
        content: "",
      });
    },
    onToken: (token: string) => {
      scenarioStreamRef.current += token;
      const cur = useStorySimulationStore.getState().scenarioStreaming;
      if (cur) {
        setScenarioStreaming({ ...cur, content: scenarioStreamRef.current });
      }
    },
    onMessage: (message: ScenarioMessage) => {
      scenarioMessagesRef.current = [...scenarioMessagesRef.current, message];
      setScenarioSession(
        buildScenarioSession(setup, scenarioMessagesRef.current, "running"),
      );
      setScenarioStreaming(null);
    },
    onProgress: (done: number, total: number) =>
      setScenarioProgress({ done, total }),
  });

  /** 启动舞台情景：从设置面板收到的 setup 开始生成。 */
  /**
   * 取本场情景的「参考点」资料。
   *
   * 没填参考点就完全不检索（省一次 IO）。检索落空也照常返回 undefined，情景
   * 必须能开演 —— 资料是锦上添花。结果记进 scenarioReferenceInfo，好在房间里
   * 如实告诉用户「依据了 N 篇资料」还是「一篇都没找到」。
   */
  const resolveScenarioReference = async (setup: ScenarioSetup) => {
    const reference = setup.rules.reference?.trim();
    if (!projectPath || !reference) {
      setScenarioReferenceInfo(null);
      return undefined;
    }
    const material = await collectScenarioReferenceMaterial(projectPath, reference);
    setScenarioReferenceInfo(
      material.sources.length > 0
        ? { count: material.sources.length, truncated: material.truncated }
        : null,
    );
    return material.text || undefined;
  };

  const handleScenarioStart = async (setup: ScenarioSetup) => {
    if (!projectPath) {
      setError(t("storySimulation.scenarioNoProject"));
      return;
    }
    setError(null);
    setInfoMessage(null);
    scenarioMessagesRef.current = [];
    setScenarioSession(buildScenarioSession(setup, [], "running"));
    setScenarioStreaming(null);
    setScenarioProgress(null);
    setPhase("scenario-running");
    setScenarioRunning(true);
    const controller = new AbortController();
    scenarioAbortRef.current = controller;
    try {
      const llmConfig = resolveDefaultModel(baseLlmConfig);
      const referenceMaterial = await resolveScenarioReference(setup);
      const result = await runScenario({
        setup,
        llmConfig,
        signal: controller.signal,
        worldRules: extractionResult?.worldRules,
        referenceMaterial,
        ...makeScenarioCallbacks(setup),
      });
      scenarioMessagesRef.current = result.messages;
      const finalSession = buildScenarioSession(
        setup,
        result.messages,
        result.cancelled ? "cancelled" : "completed",
      );
      setScenarioSession(finalSession);
      try {
        await saveScenario(projectPath, finalSession);
      } catch {
        // 持久化失败不影响展示
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioRunning(false);
      setScenarioStreaming(null);
      setScenarioProgress(null);
      scenarioAbortRef.current = null;
    }
  };

  /** 舞台情景：用户插话后继续生成。 */
  const handleScenarioSend = async () => {
    const text = scenarioInput.trim();
    if (!text || !scenarioSession || !projectPath || scenarioRunning) return;
    setScenarioInput("");
    setError(null);
    scenarioMessagesRef.current = [...scenarioSession.messages];
    setScenarioRunning(true);
    const controller = new AbortController();
    scenarioAbortRef.current = controller;
    try {
      const llmConfig = resolveDefaultModel(baseLlmConfig);
      const referenceMaterial = await resolveScenarioReference(
        scenarioSession.setup,
      );
      const result = await continueScenario({
        session: scenarioSession,
        llmConfig,
        userInput: text,
        signal: controller.signal,
        rounds: 1,
        worldRules: extractionResult?.worldRules,
        referenceMaterial,
        ...makeScenarioCallbacks(scenarioSession.setup),
      });
      scenarioMessagesRef.current = result.messages;
      const finalSession = buildScenarioSession(
        scenarioSession.setup,
        result.messages,
        result.cancelled ? "cancelled" : "completed",
      );
      setScenarioSession(finalSession);
      try {
        await saveScenario(projectPath, finalSession);
      } catch {
        // 持久化失败不影响展示
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioRunning(false);
      setScenarioStreaming(null);
      scenarioAbortRef.current = null;
    }
  };

  const handleScenarioCancel = () => {
    scenarioAbortRef.current?.abort();
  };

  /**
   * 接着跑完剩余轮数。
   *
   * 「停止」原本等于毁掉剩余计划：想跑完只能手动插话，而每条插话固定只跑 1 轮。
   * 这里从「已经说到的下一轮」接着跑，主持人串场按绝对轮次延续（与 P1 修好的
   * 那套节奏同一个口径），收束仍由这次续跑补上，所以中止不再等于半成品。
   */
  const handleScenarioContinue = async () => {
    if (!scenarioSession || !projectPath || scenarioRunning) return;
    const remaining = remainingScenarioRounds(
      scenarioSession.setup,
      scenarioSession.messages,
    );
    if (remaining <= 0) return;
    setError(null);
    setScenarioRunning(true);
    const controller = new AbortController();
    scenarioAbortRef.current = controller;
    const continuedFrom = scenarioSession;
    try {
      const llmConfig = resolveDefaultModel(baseLlmConfig);
      const result = await runScenario({
        setup: continuedFrom.setup,
        llmConfig,
        signal: controller.signal,
        worldRules: extractionResult?.worldRules,
        referenceMaterial: await resolveScenarioReference(continuedFrom.setup),
        initialMessages: continuedFrom.messages,
        startRound: lastSpokenRound(continuedFrom.messages) + 1,
        rounds: remaining,
        withOpening: false,
        withClosing: true,
        moderatorOriginRound: 1,
        ...makeScenarioCallbacks(continuedFrom.setup),
      });
      scenarioMessagesRef.current = result.messages;
      const finalSession = buildScenarioSession(
        continuedFrom.setup,
        result.messages,
        result.cancelled ? "cancelled" : "completed",
      );
      setScenarioSession(finalSession);
      try {
        await saveScenario(projectPath, finalSession);
      } catch {
        // 持久化失败不影响展示
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioRunning(false);
      setScenarioStreaming(null);
      setScenarioProgress(null);
      scenarioAbortRef.current = null;
    }
  };

  const handleScenarioExport = async () => {
    if (!projectPath || !scenarioSession) return;
    setScenarioExporting(true);
    try {
      const path = await exportScenario(projectPath, scenarioSession);
      setInfoMessage(t("storySimulation.scenarioExported", { path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioExporting(false);
    }
  };

  const handleScenarioBack = () => {
    setPhase("scenario-setup");
    setScenarioSession(null);
    scenarioMessagesRef.current = [];
  };

  /** 将本场情景导入为一章草稿。 */
  const handleScenarioInsert = async () => {
    if (!projectPath || !scenarioSession) return;
    setScenarioInserting(true);
    setError(null);
    try {
      const result = await importScenarioToChapter(projectPath, scenarioSession);
      setInfoMessage(
        t("storySimulation.scenarioInserted", {
          n: result.chapterNumber,
          path: result.chapterPath,
        }),
      );
      await refreshProjectState(projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioInserting(false);
    }
  };

  // ── 渲染 ──

  const isProgressPhase = (PROGRESS_PHASES as readonly string[]).includes(
    phase,
  );

  const progressTitle = (() => {
    switch (phase) {
      case "extracting":
        return t("storySimulation.extracting");
      case "framework-generating":
        return "正在生成故事框架...";
      case "simulating":
        return t("storySimulation.simulating");
      case "report-generating":
        return "正在生成推演报告...";
      case "draft-generating":
        return "正在生成故事草稿...";
      default:
        return "";
    }
  })();

  return (
    <div data-ui-page="simulation" data-ui-state={phase} className="flex h-full">
      {/* 主区域：单栏全宽 */}
      <div data-ui="simulation-content" className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        <header data-ui="tool-heading">
            <div>
              <nav aria-label="面包屑" className="ui-test-breadcrumb"><span>{projectName ?? "未选择项目"}</span><span aria-hidden="true">/</span><span aria-current="page">故事推演</span></nav>
              <h1 className="ui-test-page-title">{phase === "idle" ? t("storySimulation.title") : phase === "report-viewing" ? "推演报告" : phase === "draft-viewing" ? "故事草稿" : phase === "framework-confirming" ? "确认故事框架" : phase === "scenario-setup" ? "配置舞台情景" : phase === "scenario-running" ? "舞台情景" : "让角色先走一步。"}</h1>
            </div>
            {/*
              所有子阶段共用的「返回功能选择」入口。
              没有它的话，phase 在会话内是持久的（store 常驻内存），
              进过一次流程后回到本视图会直接落在那个阶段、再也回不到落地页，
              「舞台情景」就又看不见了 —— 正是这次要修的问题。
              进行中的阶段（提取/推演/生成）不显示：那些阶段有自己的「取消」。
            */}
            {phase !== "idle" && !isProgressPhase && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setPhase("idle")}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                {t("storySimulation.hubBack")}
              </Button>
            )}
          </header>
        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
            <span>
              {t("storySimulation.error")}: {error}
            </span>
            <button
              type="button"
              className="shrink-0 text-xs underline"
              onClick={() => setError(null)}
            >
              {t("storySimulation.back")}
            </button>
          </div>
        )}
        {infoMessage && !error && (
          <div className="flex items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            <span>{infoMessage}</span>
            <button
              type="button"
              className="shrink-0 text-xs underline"
              onClick={() => setInfoMessage(null)}
            >
              关闭
            </button>
          </div>
        )}

        {isProgressPhase && phase !== "simulating" ? (
          <ProgressPanel
            progress={progress}
            label={progressLabel || progressTitle}
            onCancel={handleCancel}
            cancelling={isCancelling}
          />
        ) : phase === "simulating" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            {isCompareMode ? (
              <BranchCompareView
                branches={branches}
                compareBranchIds={compareBranchIds}
                onBack={() => setCompareMode(false)}
              />
            ) : (
              <SimulatingTimelinePanel
                progress={progress}
                label={progressLabel || progressTitle}
                events={timelineEvents}
                debugTraces={debugTraces}
                framework={currentFramework}
                onInterviewAgent={(id, name) => handleInterviewAgent(id, name)}
                onCancel={handleCancel}
                cancelling={isCancelling}
                branches={branches}
                activeBranchId={activeBranchId}
                compareBranchIds={compareBranchIds}
                isCompareMode={isCompareMode}
                onSaveBranch={saveCurrentAsBranch}
                onDeleteBranch={deleteBranch}
                onRenameBranch={renameBranch}
                onSwitchBranch={switchToBranch}
                onToggleCompareBranch={toggleCompareBranch}
                onSetCompareMode={setCompareMode}
                onClearCompareSelection={clearCompareSelection}
              />
            )}
          </div>
        ) : phase === "framework-confirming" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <FrameworkConfirmPanel
              onConfirm={() => void handleConfirmFramework()}
              onRegenerate={handleRegenerateFramework}
              onSave={() => void handleSaveFramework()}
              onViewHistory={() => setShowHistoryModal(true)}
            />
            {/* 历史结果模态框 */}
            <HistoryResultsModal
              open={showHistoryModal}
                projectPath={projectPath}
                frameworkId={currentFramework?.id}
                onSelectResult={handleSelectHistoryResult}
                onContinueResult={handleContinuePartialResult}
                onClose={() => setShowHistoryModal(false)}
              />
          </div>
        ) : phase === "report-viewing" ? (
          <div className="flex min-h-0 flex-1">
            {isCompareMode ? (
              <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
                <BranchCompareView
                  branches={branches}
                  compareBranchIds={compareBranchIds}
                  onBack={() => setCompareMode(false)}
                />
              </div>
            ) : (
              <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b px-3 py-2">
                  <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5 text-xs">
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 ${
                        reportViewTab === "report"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setReportViewTab("report")}
                    >
                      推演报告
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 ${
                        reportViewTab === "timeline"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setReportViewTab("timeline")}
                    >
                      时间线
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 ${
                        reportViewTab === "overview"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setReportViewTab("overview")}
                    >
                      概览
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 ${
                        reportViewTab === "rumors"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setReportViewTab("rumors")}
                    >
                      传闻
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 ${
                        reportViewTab === "clues"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setReportViewTab("clues")}
                    >
                      线索
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {reportViewTab === "report" ? (
                    <SimulationReportView
                      onResimulate={handleResimulate}
                      onGenerateDraft={(branch) =>
                        void handleGenerateDraft(branch)
                      }
                      onInterviewAgent={(id, name) =>
                        handleInterviewAgent(id, name)
                      }
                      onViewDraft={handleViewDraft}
                      hasDraft={!!currentDraft}
                      onViewInterviewHistory={() =>
                        setShowInterviewHistory(true)
                      }
                      onSelectResult={handleSelectReportResult}
                      onExportEventPlan={(branch) =>
                        void handleExportEventPlan(branch)
                      }
                      exportingBranchTitle={exportingBranchTitle}
                    />
                  ) : reportViewTab === "timeline" ? (
                    <div className="h-full overflow-y-auto p-3">
                      <div className="mb-2 text-xs text-muted-foreground">
                        共 {timelineEvents.length} 条事件
                      </div>
                      <div className="space-y-2">
                        {timelineEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="rounded-md border bg-background/70 p-3 text-sm"
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                                节点{ev.nodeIndex + 1} · 第{ev.round}轮
                              </span>
                              <span className="text-muted-foreground">
                                {ev.actorName || "系统"}
                              </span>
                              <span className="text-muted-foreground">·</span>
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                {(() => {
                                  const Icon = actionTypeIcon(ev.actionType);
                                  return <Icon className="h-3 w-3" />;
                                })()}
                                {actionTypeShortLabel(ev.actionType)}
                              </span>
                            </div>
                            <div className="text-sm">
                              {ev.content || "(无内容)"}
                            </div>
                          </div>
                        ))}
                        {timelineEvents.length === 0 && (
                          <div className="py-12 text-center text-sm text-muted-foreground">
                            暂无事件
                          </div>
                        )}
                      </div>
                    </div>
                  ) : reportViewTab === "overview" ? (
                    <div className="h-full overflow-hidden">
                      <ProcessDebugPanel debugTraces={debugTraces} />
                    </div>
                  ) : reportViewTab === "rumors" ? (
                    <div className="h-full">
                      <RumorPropagationPanel
                        rumors={currentRumors}
                        agents={currentAgents}
                        events={timelineEvents}
                      />
                    </div>
                  ) : (
                    <div className="h-full">
                      <ClueTimelinePanel
                        agents={currentAgents}
                        rumors={currentRumors}
                        events={timelineEvents}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeChatAgent ? (
              <AgentChatPanel
                agentName={activeChatAgent.name}
                messages={agentChatMessages}
                input={chatInput}
                onInputChange={setChatInput}
                onSend={() => void handleSendChat()}
                onClose={handleCloseChat}
                onExport={() => void handleExportChat()}
                onSave={() => void handleSaveChat()}
                sending={chatSending}
                exporting={chatExporting}
                saving={chatSaving}
                chatLogRef={chatLogRef}
              />
            ) : (
              <div className="flex w-80 shrink-0 flex-col border-l p-3">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <BranchManagerPanel
                    branches={branches}
                    activeBranchId={activeBranchId}
                    compareBranchIds={compareBranchIds}
                    isCompareMode={isCompareMode}
                    onSaveBranch={saveCurrentAsBranch}
                    onDeleteBranch={deleteBranch}
                    onRenameBranch={renameBranch}
                    onSwitchBranch={switchToBranch}
                    onToggleCompareBranch={toggleCompareBranch}
                    onSetCompareMode={setCompareMode}
                    onClearCompareSelection={clearCompareSelection}
                  />
                </div>
              </div>
            )}
          </div>
        ) : phase === "draft-viewing" ? (
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b px-3 py-2">
              <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "draft"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("draft")}
                >
                  故事草稿
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "report"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("report")}
                >
                  推演报告
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "timeline"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("timeline")}
                >
                  时间线
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "overview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("overview")}
                >
                  过程观察
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "rumors"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("rumors")}
                >
                  传闻
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${
                    draftViewTab === "clues"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setDraftViewTab("clues")}
                >
                  线索
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {draftViewTab === "draft" ? (
                <StoryDraftView onBack={handleBackToReport} />
              ) : draftViewTab === "report" ? (
                <SimulationReportView
                  onResimulate={handleResimulate}
                  onGenerateDraft={(branch) => void handleGenerateDraft(branch)}
                  onInterviewAgent={(id, name) =>
                    handleInterviewAgent(id, name)
                  }
                  onViewDraft={handleViewDraft}
                  hasDraft={!!currentDraft}
                  onViewInterviewHistory={() => setShowInterviewHistory(true)}
                  onSelectResult={handleSelectReportResult}
                  onExportEventPlan={(branch) =>
                    void handleExportEventPlan(branch)
                  }
                  exportingBranchTitle={exportingBranchTitle}
                />
              ) : draftViewTab === "timeline" ? (
                <div className="h-full overflow-y-auto p-3">
                  <div className="mb-2 text-xs text-muted-foreground">
                    共 {timelineEvents.length} 条事件
                  </div>
                  <div className="space-y-2">
                    {timelineEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-md border bg-background/70 p-3 text-sm"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                            节点{ev.nodeIndex + 1} · 第{ev.round}轮
                          </span>
                          <span className="text-muted-foreground">
                            {ev.actorName || "系统"}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">
                            {actionTypeShortLabel(ev.actionType)}
                          </span>
                        </div>
                        <div className="text-sm">
                          {ev.content || "(无内容)"}
                        </div>
                      </div>
                    ))}
                    {timelineEvents.length === 0 && (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        暂无事件
                      </div>
                    )}
                  </div>
                </div>
              ) : draftViewTab === "overview" ? (
                <div className="h-full overflow-hidden">
                  <ProcessDebugPanel debugTraces={debugTraces} />
                </div>
              ) : draftViewTab === "rumors" ? (
                <div className="h-full">
                  <RumorPropagationPanel
                    rumors={currentRumors}
                    agents={currentAgents}
                    events={timelineEvents}
                  />
                </div>
              ) : (
                <div className="h-full">
                  <ClueTimelinePanel
                    agents={currentAgents}
                    rumors={currentRumors}
                    events={timelineEvents}
                  />
                </div>
              )}
            </div>
          </div>
        ) : phase === "scenario-setup" ? (
          <div data-ui="scenario-setup" className="min-h-0 flex-1 overflow-y-auto">
            <ScenarioSetupPanel
              candidates={scenarioCandidates}
              extracting={scenarioExtracting}
              progress={{ progress, label: progressLabel }}
              sourceChapters={scenarioSourceChapters}
              onSourceChaptersChange={handleScenarioSourceChaptersChange}
              onReExtract={handleScenarioReExtract}
              savedScenarios={scenarioSaved}
              onStart={(setup) => void handleScenarioStart(setup)}
              onOpenSaved={handleOpenSavedScenario}
              onDeleteSaved={(id) => void handleDeleteSavedScenario(id)}
              onCancel={() => setPhase("idle")}
            />
          </div>
        ) : phase === "scenario-running" && scenarioSession ? (
          <ScenarioRoomView
            session={scenarioSession}
            running={scenarioRunning}
            streaming={scenarioStreaming}
            progress={scenarioProgress}
            input={scenarioInput}
            onInputChange={setScenarioInput}
            onSend={() => void handleScenarioSend()}
            onExport={() => void handleScenarioExport()}
            onInsertToChapters={() => void handleScenarioInsert()}
            onCancel={handleScenarioCancel}
            onBack={handleScenarioBack}
            onContinue={() => void handleScenarioContinue()}
            remainingRounds={
              scenarioSession
                ? remainingScenarioRounds(
                    scenarioSession.setup,
                    scenarioSession.messages,
                  )
                : 0
            }
            exporting={scenarioExporting}
            inserting={scenarioInserting}
            referenceInfo={scenarioReferenceInfo}
          />
        ) : phase === "idle" ? (
          /* 落地页：两个彼此独立的功能并列成同级入口 */
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StorySimulationHub
              onEnterSimulation={() => setPhase("configuring")}
              onEnterScenario={handleOpenScenario}
              onResumeFramework={handleResumeFramework}
              onResumeScenario={handleOpenSavedScenario}
              onResumeResult={handleResumeSimulationResult}
            />
          </div>
        ) : (
          <div data-ui="simulation-config" className="min-h-0 flex-1 overflow-y-auto">
            <SimulationConfigPanel onStart={() => void handleStart()} />
          </div>
        )}
      </div>
      <InterviewHistoryView />
    </div>
  );
}

/** 进度展示面板：文字 + 进度条 + 取消按钮。 */
function ProgressPanel({
  progress,
  label,
  onCancel,
  cancelling,
}: {
  progress: number;
  label: string;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, progress));
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="text-base font-medium">{label}</div>
      <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">{clamped}%</div>
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="mt-2"
        >
          {cancelling ? "正在取消..." : "取消"}
        </Button>
      )}
    </div>
  );
}

/** 仿真中面板：进度条 + 实时时间线事件流（按节点分组折叠，带筛选）。 */
function SimulatingTimelinePanel({
  progress,
  label,
  events,
  debugTraces,
  framework,
  onInterviewAgent,
  onCancel,
  cancelling,
  branches,
  activeBranchId,
  compareBranchIds,
  isCompareMode,
  onSaveBranch,
  onDeleteBranch,
  onRenameBranch,
  onSwitchBranch,
  onToggleCompareBranch,
  onSetCompareMode,
  onClearCompareSelection,
}: {
  progress: number;
  label: string;
  events: TimelineEvent[];
  debugTraces: SimulationDebugTrace[];
  framework?: StoryFramework | null;
  onInterviewAgent?: (agentId: string, agentName: string) => void;
  onCancel?: () => void;
  cancelling?: boolean;
  branches: import("@/lib/novel/story-simulation/types").SimulationBranch[];
  activeBranchId: string | null;
  compareBranchIds: string[];
  isCompareMode: boolean;
  onSaveBranch: (name: string) => void;
  onDeleteBranch: (id: string) => void;
  onRenameBranch: (id: string, name: string) => void;
  onSwitchBranch: (id: string) => void;
  onToggleCompareBranch: (branchId: string) => void;
  onSetCompareMode: (enabled: boolean) => void;
  onClearCompareSelection: () => void;
}) {
  const clamped = Math.min(100, Math.max(0, progress));
  const logRef = useRef<HTMLDivElement | null>(null);
  const [activeStreamView, setActiveStreamView] = useState<
    "timeline" | "overview" | "rumors" | "clues" | "branches"
  >("timeline");

  const currentRumors = useStorySimulationStore((s) => s.currentRumors);
  const currentAgents = useStorySimulationStore((s) => s.currentAgents);
  const timelineEvents = useStorySimulationStore((s) => s.timelineEvents);

  const runStatus = useMemo(
    () => summarizeRunStatus({ debugTraces, framework, events }),
    [debugTraces, framework, events],
  );

  // 筛选状态
  const [filterActor, setFilterActor] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  // 折叠状态：key = nodeIndex，value = 是否折叠
  const [collapsedNodes, setCollapsedNodes] = useState<Set<number>>(new Set());

  // 从事件中提取所有角色和行动类型
  const actors = useMemo(
    () => Array.from(new Set(events.map((e) => e.actorName))).sort(),
    [events],
  );
  const actionTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.actionType))).sort(),
    [events],
  );

  // 构建节点索引映射
  const nodeMap = useMemo(() => {
    const map = new Map<number, { title: string; phase: string }>();
    if (framework) {
      for (const node of framework.nodes) {
        map.set(node.index, { title: node.title, phase: node.phase });
      }
    }
    return map;
  }, [framework]);

  // 阶段中文标签
  const phaseLabel = (phase: string): string => {
    const map: Record<string, string> = {
      起: "起",
      承: "承",
      转: "转",
      合: "合",
    };
    return map[phase] || phase;
  };

  // 按节点分组事件
  const groupedEvents = useMemo(() => {
    // 先过滤事件
    const filtered = events.filter((e) => {
      if (filterActor !== "all" && e.actorName !== filterActor) return false;
      if (filterType !== "all" && e.actionType !== filterType) return false;
      return true;
    });
    // 按 nodeIndex 分组
    const groups = new Map<number, TimelineEvent[]>();
    for (const ev of filtered) {
      const idx = ev.nodeIndex;
      if (!groups.has(idx)) groups.set(idx, []);
      groups.get(idx)!.push(ev);
    }
    // 按节点索引排序
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([nodeIndex, evs]) => ({
        nodeIndex,
        nodeInfo: nodeMap.get(nodeIndex),
        events: evs,
      }));
  }, [events, filterActor, filterType, nodeMap]);

  // 计算过滤后的事件总数
  const totalFiltered = groupedEvents.reduce(
    (sum, g) => sum + g.events.length,
    0,
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [totalFiltered]);

  const toggleNode = (idx: number) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedNodes(new Set());
  const collapseAll = () => {
    const allNodes = new Set(groupedEvents.map((g) => g.nodeIndex));
    setCollapsedNodes(allNodes);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="text-base font-medium">{label}</div>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${clamped}%` }}
          />
        </div>
        {/* 常驻状态条：跑到一半也能看出在哪个节点、第几轮、已产生多少事件、花了多少次决策 */}
        {runStatus && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {runStatus.nodeTitle}
              {runStatus.totalNodes !== null && (
                <span className="font-normal text-muted-foreground">
                  （{runStatus.nodeNumber}/{runStatus.totalNodes}）
                </span>
              )}
            </span>
            <span>第 {runStatus.round} 轮</span>
            <span>{runStatus.eventCount} 事件</span>
            <span>{runStatus.decisionCount} 次决策</span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">{clamped}%</div>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={cancelling}
              className="h-7 text-xs"
            >
              {cancelling ? "正在取消..." : "取消推演"}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-3 flex justify-center">
        <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              activeStreamView === "timeline"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveStreamView("timeline")}
          >
            时间线
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              activeStreamView === "overview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveStreamView("overview")}
          >
            过程观察
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              activeStreamView === "rumors"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveStreamView("rumors")}
          >
            传闻
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              activeStreamView === "clues"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveStreamView("clues")}
          >
            线索
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              activeStreamView === "branches"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveStreamView("branches")}
          >
            分支管理
          </button>
        </div>
      </div>

      {activeStreamView === "timeline" ? (
        <>
          {/* 筛选栏 */}
          {events.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">筛选：</span>
              <select
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
                className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">全部角色</option>
                {actors.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">全部行为</option>
                {actionTypes.map((type) => (
                  <option key={type} value={type}>
                    {actionTypeShortLabel(type)}
                  </option>
                ))}
              </select>
              {(filterActor !== "all" || filterType !== "all") && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    setFilterActor("all");
                    setFilterType("all");
                  }}
                >
                  清除筛选
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={expandAll}
                >
                  全部展开
                </button>
                <span className="text-muted-foreground">|</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={collapseAll}
                >
                  全部折叠
                </button>
                <span className="ml-2 text-muted-foreground">
                  显示 {totalFiltered}/{events.length} 条
                </span>
              </div>
            </div>
          )}

          <div
            ref={logRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm"
          >
            {groupedEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {events.length === 0
                  ? "等待角色行动..."
                  : "没有符合筛选条件的事件"}
              </div>
            ) : (
              <div className="space-y-3">
                {groupedEvents.map(
                  ({ nodeIndex, nodeInfo, events: nodeEvents }) => {
                    const isCollapsed = collapsedNodes.has(nodeIndex);
                    const phase = nodeInfo?.phase || "起";
                    const nodeTitle =
                      nodeInfo?.title || `节点 ${nodeIndex + 1}`;
                    return (
                      <div
                        key={nodeIndex}
                        className="rounded-md border bg-background/50"
                      >
                        {/* 节点标题栏 - 可点击折叠 */}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
                          onClick={() => toggleNode(nodeIndex)}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                            {phaseLabel(phase)}
                          </span>
                          <span className="text-sm font-medium">
                            节点 {nodeIndex + 1}：{nodeTitle}
                          </span>
                          <span className="ml-auto text-[0.6875rem] text-muted-foreground">
                            {nodeEvents.length} 条事件
                          </span>
                        </button>
                        {/* 节点事件列表 */}
                        {!isCollapsed && (
                          <div className="space-y-1.5 border-t px-3 py-2">
                            {nodeEvents.map((ev) => (
                              <div key={ev.id} className="leading-relaxed">
                                <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[0.625rem] text-muted-foreground">
                                  R{ev.round + 1}
                                </span>
                                {onInterviewAgent ? (
                                  <button
                                    type="button"
                                    className="font-medium text-primary hover:underline"
                                    onClick={() =>
                                      onInterviewAgent(ev.actorId, ev.actorName)
                                    }
                                  >
                                    {ev.actorName}
                                  </button>
                                ) : (
                                  <span className="font-medium">
                                    {ev.actorName}
                                  </span>
                                )}
                                <span className="text-muted-foreground">
                                  {" "}
                                  {ev.targetName &&
                                  ev.targetId &&
                                  onInterviewAgent ? (
                                    <>
                                      {actionTypePhraseOnly(ev.actionType)}{" "}
                                      <button
                                        type="button"
                                        className="text-primary hover:underline"
                                        onClick={() =>
                                          onInterviewAgent(
                                            ev.targetId!,
                                            ev.targetName!,
                                          )
                                        }
                                      >
                                        {ev.targetName}
                                      </button>
                                      ：
                                    </>
                                  ) : (
                                    <>
                                      {actionTypePhrase(
                                        ev.actionType,
                                        ev.targetName,
                                      )}
                                      ：
                                    </>
                                  )}
                                </span>
                                <span>{ev.content}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>
        </>
      ) : activeStreamView === "overview" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ProcessDebugPanel debugTraces={debugTraces} />
        </div>
      ) : activeStreamView === "rumors" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <RumorPropagationPanel
            rumors={currentRumors}
            agents={currentAgents}
            events={timelineEvents}
          />
        </div>
      ) : activeStreamView === "clues" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ClueTimelinePanel
            agents={currentAgents}
            rumors={currentRumors}
            events={timelineEvents}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <BranchManagerPanel
            branches={branches}
            activeBranchId={activeBranchId}
            compareBranchIds={compareBranchIds}
            isCompareMode={isCompareMode}
            onSaveBranch={onSaveBranch}
            onDeleteBranch={onDeleteBranch}
            onRenameBranch={onRenameBranch}
            onSwitchBranch={onSwitchBranch}
            onToggleCompareBranch={onToggleCompareBranch}
            onSetCompareMode={onSetCompareMode}
            onClearCompareSelection={onClearCompareSelection}
          />
        </div>
      )}
    </div>
  );
}

function ProcessDebugPanel({
  debugTraces,
}: {
  debugTraces: SimulationDebugTrace[];
}) {
  const latestTrace = debugTraces[debugTraces.length - 1];
  const displayTraces = debugTraces.slice(-50).reverse();

  if (!latestTrace) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        等待推演过程数据...
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="h-full overflow-y-auto p-3 text-sm">
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <DebugStat
            label="全量角色"
            value={latestTrace.blackboard.allAgentCount}
          />
          <DebugStat
            label="活跃角色"
            value={latestTrace.blackboard.activeAgentCount}
          />
          <DebugStat
            label="总事件"
            value={latestTrace.blackboard.totalEventCount}
          />
          <DebugStat
            label="公共事件"
            value={latestTrace.blackboard.publicEventCount}
          />
        </div>

        {latestTrace.blackboard.allAgentCount === 0 && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="mb-1 font-medium">💡 当前推演没有角色参与</div>
            <div className="text-amber-700">
              可能原因：故事框架的节点未指定涉及角色，或提取的角色未匹配到框架节点。
              请在框架编辑器中为每个节点设置"涉及角色"，角色才会参与推演。
            </div>
          </div>
        )}

        <div className="space-y-3">
          {displayTraces.map((trace) => (
            <div
              key={trace.id}
              className="rounded-md border bg-background/70 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                  {trace.type === "round-plan" ? "轮次计划" : "事件写入"}
                </span>
                <span className="text-xs text-muted-foreground">
                  节点 {trace.nodeIndex + 1}：{trace.nodeTitle}
                </span>
                <span className="text-xs text-muted-foreground">
                  R{trace.round + 1}
                </span>
                {trace.strategy && (
                  <span className="text-xs text-muted-foreground">
                    策略：
                    {trace.strategy === "all-agents"
                      ? "全部角色"
                      : trace.strategy === "subset"
                        ? "部分角色"
                        : "无角色"}
                  </span>
                )}
              </div>

              <div className="mb-2 grid gap-2 md:grid-cols-2">
                <DebugAgentList
                  title="候选 Agent"
                  agents={trace.candidateAgents}
                />
                <DebugAgentList
                  title="本轮行动 Agent"
                  agents={trace.selectedAgents}
                />
              </div>

              {trace.latestEvent && (
                <div className="mb-2 rounded border bg-muted/30 px-2 py-1.5 text-xs">
                  <span className="font-medium">最近事件：</span>
                  <span className="text-muted-foreground">
                    {trace.latestEvent.actorName} /{" "}
                    {actionTypeShortLabel(trace.latestEvent.actionType)}
                  </span>
                  <span>：{trace.latestEvent.content}</span>
                </div>
              )}

              <div className="rounded border bg-muted/20 p-2">
                <div className="mb-1 text-xs font-medium">
                  Blackboard 可见事件
                </div>
                <div className="grid gap-1 md:grid-cols-2">
                  {trace.visibilityByAgent.map((agent) => (
                    <div
                      key={agent.agentId}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">
                        {agent.agentName}
                      </span>
                      <span> 可见事件 {agent.visibleEventCount ?? 0} 条</span>
                      {agent.recentEvents && agent.recentEvents.length > 0 && (
                        <div className="mt-0.5 max-h-12 overflow-y-auto text-[0.625rem] text-muted-foreground/70">
                          {agent.recentEvents
                            .map((event) => event.id)
                            .join("、")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DebugStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background/70 px-3 py-2">
      <div className="text-[0.6875rem] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function DebugAgentList({
  title,
  agents,
}: {
  title: string;
  agents: SimulationDebugTrace["candidateAgents"];
}) {
  return (
    <div className="rounded border bg-muted/20 p-2">
      <div className="mb-1 text-xs font-medium">{title}</div>
      <div className="flex flex-wrap gap-1">
        {agents.length === 0 ? (
          <span className="text-xs text-muted-foreground">无</span>
        ) : (
          agents.map((agent) => (
            <span
              key={`${title}-${agent.agentId}`}
              className="max-w-[120px] truncate rounded bg-background px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground"
              title={agent.reason}
            >
              {agent.agentName}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** Agent 采访对话面板（右侧内联面板）。 */
function AgentChatPanel({
  agentName,
  messages,
  input,
  onInputChange,
  onSend,
  onClose,
  onExport,
  onSave,
  sending,
  exporting,
  saving,
  chatLogRef,
}: {
  agentName: string;
  messages: AgentChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
  onExport: () => void;
  onSave: () => void;
  sending: boolean;
  exporting: boolean;
  saving: boolean;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col border-l">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-semibold">与 {agentName} 对话</div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onSave}
            title="保存采访对话"
            disabled={saving || messages.length === 0}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onExport}
            title="导出对话为MD"
            disabled={exporting || messages.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onClose}
            title="关闭对话"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={chatLogRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            你可以向 {agentName} 提问，了解他/她的想法。
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.content || (sending && msg.role === "agent" ? "..." : "")}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="输入你的问题..."
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            disabled={sending}
          />
          <Button
            type="button"
            size="icon"
            className="h-8 w-8"
            onClick={onSend}
            disabled={sending || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
