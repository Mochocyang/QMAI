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
} from "lucide-react";

import { useWikiStore } from "@/stores/wiki-store";
import { useStorySimulationStore } from "@/stores/story-simulation-store";
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
} from "@/lib/novel/story-simulation/framework-store";
import { resolveDefaultModel } from "@/lib/novel/model-resolver";
import { interviewAgent } from "@/lib/novel/story-simulation/agent-interview";
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
import { FrameworkConfirmPanel } from "./framework-confirm-panel";
import { SimulationReportView } from "./simulation-report-view";
import { StoryDraftView } from "./story-draft-view";
import { InterviewHistoryView } from "./interview-history-view";
import { RumorPropagationPanel } from "./rumor-propagation-panel";
import { ClueTimelinePanel } from "./detective-board-panel";
import { BranchManagerPanel } from "./branch-manager-panel";
import { HistoryResultsModal } from "./history-results-modal";
import { BranchCompareView } from "./branch-compare-view";
import {
  actionTypeShortLabel,
  actionTypePhraseOnly,
  actionTypePhrase,
  actionTypeIcon,
} from "@/lib/novel/story-simulation/action-type-utils";
import { Button } from "@/components/ui/button";

const PROGRESS_PHASES = [
  "extracting",
  "framework-generating",
  "simulating",
  "report-generating",
  "draft-generating",
] as const;

/**
 * 故事推演室主视图（重构后）。
 *
 * 单栏全宽布局：框架列表已迁移到左侧 SidebarPanel。
 * 主区域根据 phase 切换：配置 → 框架确认 → 推演（实时事件流）→ 报告 → 草稿。
 * 报告阶段可弹出 Agent 采访面板与角色对话。
 */
export function StorySimulationView() {
  const { t } = useTranslation();
  const projectPath = useWikiStore((s) => s.project?.path);
  const baseLlmConfig = useWikiStore((s) => s.llmConfig);

  const phase = useStorySimulationStore((s) => s.phase);
  const mode = useStorySimulationStore((s) => s.mode);
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
  const bumpListRefresh = useStorySimulationStore((s) => s.bumpListRefresh);
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

  // 保存仿真后的 agents 和 state 供采访使用
  const lastAgentsRef = useRef<NovelAgent[]>([]);
  const lastSimulationStateRef = useRef<SimulationState | null>(null);
  // 追踪上一轮的 round，确保每轮只加一次历史快照
  const lastHistoryRoundRef = useRef<number>(-1);

  // 取消控制器
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
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

  // 当前阶段的进度基线
  const phaseBaseProgressRef = useRef(0);

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
      }
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
      directorEnabled: false,
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

  /** 保存当前框架到磁盘，并刷新侧边栏列表。 */
  const handleSaveFramework = async () => {
    if (!projectPath || !currentFramework) return;
    try {
      await saveFramework(projectPath, currentFramework);
      bumpListRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 从历史结果模态框选择结果：反序列化并切换到报告阶段。 */
  const handleSelectHistoryResult = (resultId: string) => {
    const result = savedResults.find((r) => r.id === resultId);
    if (!result) return;

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
    setSelectedResultId(resultId);
    setShowHistoryModal(false);
    if ((result.status ?? "complete") !== "complete") {
      setReportViewTab("timeline");
    }
    setPhase("report-viewing");
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

      // 开始推演前，若框架尚未保存到磁盘则先保存
      // 简单判断：检查 frameworks 列表里是否有当前 id
      const existing = useStorySimulationStore
        .getState()
        .frameworks.find((f) => f.id === currentFramework.id);
      if (!existing) {
        await saveFramework(projectPath, currentFramework);
        bumpListRefresh();
      }

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
            directorEnabled: false,
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
        directorEnabled: false,
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
    <div className="flex h-full">
      {/* 主区域：单栏全宽 */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
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
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
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
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            {phaseLabel(phase)}
                          </span>
                          <span className="text-sm font-medium">
                            节点 {nodeIndex + 1}：{nodeTitle}
                          </span>
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {nodeEvents.length} 条事件
                          </span>
                        </button>
                        {/* 节点事件列表 */}
                        {!isCollapsed && (
                          <div className="space-y-1.5 border-t px-3 py-2">
                            {nodeEvents.map((ev) => (
                              <div key={ev.id} className="leading-relaxed">
                                <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
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
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
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
                        <div className="mt-0.5 max-h-12 overflow-y-auto text-[10px] text-muted-foreground/70">
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
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
              className="max-w-[120px] truncate rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
