import type { LlmConfig } from "@/stores/wiki-store";
import {
  streamChat,
  type ChatMessage,
  type RequestOverrides,
  type StreamCallbacks,
} from "@/lib/llm-client";
import { useWikiStore } from "@/stores/wiki-store";
import type { AiWorkflowMode } from "@/lib/agent/workflow-mode";
import type { AgentActivityEvent, AgentActivityKind } from "@/lib/agent/types";
import {
  isReasoningDisabled,
  isReasoningOnlyResponseError,
  withReasoningDisabled,
} from "@/lib/reasoning-retry";
import { computeNovelContextTokenBudget } from "@/lib/context-budget";
import {
  buildContextPack,
  contextPackToPrompt,
  type ContextPack,
} from "./context-engine";
import { reviewChapter, type NovelReviewResult } from "./review-adapter";
import type { TaskRouteResult } from "./task-router";
import type { GoldenThreeChapterRequest } from "./golden-three-chapters";
import {
  type ParsedChapterPlanComplianceResult,
  parseChapterPlanComplianceResult,
  runChapterPlanComplianceCheck,
  runChapterPlanDeviationRepair,
  shouldRepairChapterPlanDeviation,
} from "./chapter-plan-compliance";
import { buildChapterPlanExecutionSummary } from "./chapter-plan-execution-summary";
import {
  contractToTaskBriefText,
  fallbackParseChapterExecutionContract,
  runChapterExecutionContractBuild,
  type ChapterExecutionContract,
} from "./chapter-execution-contract";
import {
  executionReportToToolSummary,
  extractExecutionRepairItems,
  runChapterExecutionReportCheck,
} from "./chapter-execution-report";
import {
  resolveChapterLengthSpec,
  type ChapterLengthSpec,
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterExpansionPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
  buildStableContextPrefix,
} from "./deep-chapter-prompts";

export interface DeepChapterGenerationInput {
  projectPath: string;
  userRequest: string;
  chapterNumber?: number;
  goldenThreeChapter?: GoldenThreeChapterRequest;
  dismantlingReferenceDirective?: string;
  llmConfig: LlmConfig;
  aiWorkflowMode?: AiWorkflowMode;
  resumeCheckpoint?: DeepChapterGenerationResumeCheckpoint;
  /** 用户在会话层确认的章节计划，作为写作任务书的权威依据注入 brief 阶段。 */
  planBlueprint?: string;
}

export interface DeepChapterGenerationCallbacks {
  onThinking?: (content: string) => void;
  onFinalContent?: (content: string) => void;
  onCheckpoint?: (checkpoint: DeepChapterGenerationResumeCheckpoint) => void;
  onWorkflowEvent?: (event: ChapterWorkflowEvent) => void;
  onActivityEvent?: (event: AgentActivityEvent) => void;
}

export interface DeepChapterGenerationResult {
  finalContent: string;
  taskBrief: string;
  draftContent: string;
  reviewResults: NovelReviewResult[];
  revised: boolean;
  planCompliance?: string;
  executionReport?: string;
}

export type ChapterWorkflowEventType = "started" | "completed" | "error";

export interface ChapterWorkflowEvent {
  type: ChapterWorkflowEventType;
  id: string;
  name: string;
  title: string;
  detail?: string;
  result?: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

export type DeepChapterGenerationResumeStage =
  | "after_context"
  | "after_task_brief"
  | "after_draft"
  | "after_review"
  | "after_revision";

export interface DeepChapterGenerationResumeCheckpoint {
  version: 1;
  originalRequest: string;
  chapterNumber?: number;
  stage: DeepChapterGenerationResumeStage;
  taskBrief?: string;
  draftContent?: string;
  reviewResults?: NovelReviewResult[];
  currentContent?: string;
}

export interface DeepChapterGenerationDeps {
  buildContextPack: typeof buildContextPack;
  contextPackToPrompt: typeof contextPackToPrompt;
  reviewChapter: typeof reviewChapter;
  runChapterPlanComplianceCheck?: typeof runChapterPlanComplianceCheck;
  runChapterPlanDeviationRepair?: typeof runChapterPlanDeviationRepair;
  runChapterExecutionContractBuild?: typeof runChapterExecutionContractBuild;
  runChapterExecutionReportCheck?: typeof runChapterExecutionReportCheck;
  streamChat: (
    config: LlmConfig,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    requestOverrides?: RequestOverrides,
  ) => Promise<void>;
}

const defaultDeps: DeepChapterGenerationDeps = {
  buildContextPack,
  contextPackToPrompt,
  reviewChapter,
  streamChat,
};

const REPEAT_CHECK_MIN_CHARS = 600;
const REPEAT_WINDOW_CHARS = 120;
const REPEAT_HIT_LIMIT = 3;
const USER_ABORT_MESSAGE = "已停止生成";
/** Legacy deep-chapter context budget (tokens). Kept as the upper bound;
 *  computeNovelContextTokenBudget clamps it down for small context windows. */
const DEEP_CHAPTER_CONTEXT_TOKEN_BUDGET = 32000;
/** chars/token approximation used to convert the token budget to characters
 *  for the outline cap (mirrors context-budget.ts / contextPackToPrompt). */
const DEEP_CHAPTER_CHARS_PER_TOKEN = 4;

function hasUsableChapterExecutionContract(contract: ChapterExecutionContract | null): contract is ChapterExecutionContract {
  if (!contract) return false;
  const hasSceneChecks = contract.sceneSteps.some((step) =>
    step.title.trim() ||
    step.purpose.trim() ||
    step.conflict.trim() ||
    step.turn.trim() ||
    step.requiredOutcome.trim() ||
    step.acceptanceCriteria.some((item) => item.trim()),
  );
  const hasInformationFlow =
    contract.informationFlow.reveal.some((item) => item.trim()) ||
    contract.informationFlow.hide.some((item) => item.trim()) ||
    contract.informationFlow.mislead.some((item) => item.trim()) ||
    contract.informationFlow.foreshadow.some((item) => item.trim());

  return (
    hasSceneChecks ||
    contract.mustDo.some((item) => item.trim()) ||
    contract.mustAvoid.some((item) => item.trim()) ||
    contract.dialogueGoals.some((item) => item.trim()) ||
    hasInformationFlow ||
    Boolean(contract.finalHook.trim())
  );
}
/** The mandatory outline may consume at most this share of the total context
 *  budget. The remainder is left for memory/settings/search context so the
 *  outline can never crowd the whole window out on its own. */
const DEEP_CHAPTER_OUTLINE_MAX_FRAC = 0.7;
/** Floor (tokens) for the non-outline context so a huge outline still leaves
 *  some room for memory/settings/search hits. */
const DEEP_CHAPTER_REST_TOKEN_FLOOR = 2000;

/**
 * Trim the (mandatory) outline to a character cap so it can never overflow the
 * context window on its own. Keeps the head — which carries the overall
 * structure — and drops the tail with an explicit truncation marker so the
 * model knows the outline was cut. Cuts on a line boundary when possible.
 */
function capOutlineToBudget(outline: string, charCap: number): string {
  const trimmed = outline.trim();
  if (charCap <= 0 || trimmed.length <= charCap) return trimmed;

  const marker = "\n\n【大纲过长，已按上下文窗口截断，仅保留前部】";
  const room = Math.max(0, charCap - marker.length);
  let head = trimmed.slice(0, room);
  const lastBreak = head.lastIndexOf("\n");
  if (lastBreak > room * 0.6) head = head.slice(0, lastBreak);
  return `${head.trimEnd()}${marker}`;
}

export function shouldUseDeepChapterGeneration(
  _route: TaskRouteResult | null,
  enabled: boolean,
): boolean {
  void enabled;
  return (
    _route?.intent === "write_chapter" ||
    _route?.intent === "continue_chapter" ||
    _route?.intent === "rewrite_chapter" ||
    _route?.intent === "polish_chapter"
  );
}

interface ChapterWorkflowProfile {
  mode: AiWorkflowMode;
  runPreviousChaptersAnalysis: boolean;
  runExecutionContractBuild: boolean;
  runAiReview: boolean;
  runFinalPolish: boolean;
  runPostRevisionReview: boolean;
  runPostDraftPlanAudits: boolean;
  completionTitle: string;
  completionResultPrefix: string;
}

function resolveChapterWorkflowProfile(
  mode: AiWorkflowMode | undefined,
): ChapterWorkflowProfile {
  const resolvedMode = mode ?? "strict";
  if (resolvedMode === "fast") {
    return {
      mode: "fast",
      runPreviousChaptersAnalysis: false,
      runExecutionContractBuild: false,
      runAiReview: false,
      runFinalPolish: false,
      runPostRevisionReview: false,
      runPostDraftPlanAudits: false,
      completionTitle: "完成快速写作",
      completionResultPrefix: "快速模式写作完成",
    };
  }
  if (resolvedMode === "standard") {
    return {
      mode: "standard",
      runPreviousChaptersAnalysis: false,
      runExecutionContractBuild: true,
      runAiReview: false,
      runFinalPolish: true,
      runPostRevisionReview: false,
      runPostDraftPlanAudits: true,
      completionTitle: "完成多任务写作循环",
      completionResultPrefix: "多任务写作循环完成",
    };
  }
  return {
    mode: "strict",
    runPreviousChaptersAnalysis: true,
    runExecutionContractBuild: true,
    runAiReview: true,
    runFinalPolish: true,
    runPostRevisionReview: true,
    runPostDraftPlanAudits: true,
    completionTitle: "完成多任务写作循环",
    completionResultPrefix: "多任务写作循环完成",
  };
}

interface ChapterWorkflowStepSpec {
  name: string;
  title: string;
  detail?: string;
  params?: Record<string, unknown>;
}

function emitChapterWorkflowEvent(
  callbacks: DeepChapterGenerationCallbacks,
  type: ChapterWorkflowEventType,
  spec: ChapterWorkflowStepSpec,
  payload: {
    result?: string;
    detail?: string;
    params?: Record<string, unknown>;
  } = {},
): void {
  callbacks.onWorkflowEvent?.({
    type,
    id: `deep_chapter:${spec.name}`,
    name: spec.name,
    title: spec.title,
    detail: payload.detail ?? spec.detail,
    result: payload.result,
    params: {
      ...(spec.params ?? {}),
      ...(payload.params ?? {}),
    },
    timestamp: Date.now(),
  });
}

function emitDeepChapterActivity(
  callbacks: DeepChapterGenerationCallbacks,
  input: {
    id: string;
    stageId: string;
    kind: AgentActivityKind;
    title: string;
    content: string;
    timestamp?: number;
  },
): void {
  callbacks.onActivityEvent?.({
    id: input.id,
    stageId: input.stageId,
    kind: input.kind,
    title: input.title,
    content: input.content.trim() || "本阶段未返回可展示内容。",
    timestamp: input.timestamp ?? Date.now(),
  });
}

function emitDeepChapterStageStarted(
  callbacks: DeepChapterGenerationCallbacks,
  stageId: string,
  title: string,
  summary: string,
): void {
  emitDeepChapterActivity(callbacks, {
    id: `deep_chapter:${stageId}:started:${Date.now()}`,
    stageId,
    kind: "stage_started",
    title: "进入阶段",
    content: `${title}\n${summary}`,
  });
}

function startChapterWorkflowStep(
  callbacks: DeepChapterGenerationCallbacks,
  spec: ChapterWorkflowStepSpec,
): void {
  emitChapterWorkflowEvent(callbacks, "started", spec);
}

function completeChapterWorkflowStep(
  callbacks: DeepChapterGenerationCallbacks,
  spec: ChapterWorkflowStepSpec,
  result: string,
  params?: Record<string, unknown>,
): void {
  emitChapterWorkflowEvent(callbacks, "completed", spec, { result, params });
}

function errorChapterWorkflowStep(
  callbacks: DeepChapterGenerationCallbacks,
  spec: ChapterWorkflowStepSpec,
  error: unknown,
): void {
  emitChapterWorkflowEvent(callbacks, "error", spec, {
    result: getErrorMessage(error),
  });
}

async function runChapterWorkflowStep<T>(
  callbacks: DeepChapterGenerationCallbacks,
  spec: ChapterWorkflowStepSpec,
  action: () => Promise<T>,
  formatResult: (value: T) => string,
  formatParams?: (value: T) => Record<string, unknown>,
): Promise<T> {
  startChapterWorkflowStep(callbacks, spec);
  try {
    const value = await action();
    completeChapterWorkflowStep(
      callbacks,
      spec,
      formatResult(value),
      formatParams?.(value),
    );
    return value;
  } catch (error) {
    errorChapterWorkflowStep(callbacks, spec, error);
    throw error;
  }
}

function createResumeCheckpoint(
  input: DeepChapterGenerationInput,
  stage: DeepChapterGenerationResumeStage,
  data: Partial<DeepChapterGenerationResumeCheckpoint> = {},
): DeepChapterGenerationResumeCheckpoint {
  const originalRequest =
    input.resumeCheckpoint?.originalRequest?.trim() || input.userRequest.trim();
  return {
    version: 1,
    originalRequest,
    chapterNumber: input.resumeCheckpoint?.chapterNumber ?? input.chapterNumber,
    stage,
    ...data,
  };
}

function checkpointStageAtLeast(
  checkpoint: DeepChapterGenerationResumeCheckpoint | null | undefined,
  target: DeepChapterGenerationResumeStage,
): boolean {
  if (!checkpoint) return false;
  const order: DeepChapterGenerationResumeStage[] = [
    "after_context",
    "after_task_brief",
    "after_draft",
    "after_review",
    "after_revision",
  ];
  return order.indexOf(checkpoint.stage) >= order.indexOf(target);
}

function hasCheckpointTaskBrief(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & { taskBrief: string } {
  return (
    Boolean(checkpoint?.taskBrief?.trim()) &&
    checkpointStageAtLeast(checkpoint, "after_task_brief")
  );
}

function hasCheckpointDraft(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & {
  taskBrief: string;
  draftContent: string;
} {
  return (
    hasCheckpointTaskBrief(checkpoint) &&
    Boolean(checkpoint.draftContent?.trim()) &&
    checkpointStageAtLeast(checkpoint, "after_draft")
  );
}

function hasCheckpointReview(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & {
  taskBrief: string;
  draftContent: string;
  reviewResults: NovelReviewResult[];
} {
  return (
    hasCheckpointDraft(checkpoint) &&
    Array.isArray(checkpoint.reviewResults) &&
    checkpointStageAtLeast(checkpoint, "after_review")
  );
}

function hasCheckpointRevision(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & {
  taskBrief: string;
  draftContent: string;
  reviewResults: NovelReviewResult[];
  currentContent: string;
} {
  return (
    hasCheckpointReview(checkpoint) &&
    Boolean(checkpoint.currentContent?.trim()) &&
    checkpointStageAtLeast(checkpoint, "after_revision")
  );
}

export async function runDeepChapterGeneration(
  input: DeepChapterGenerationInput,
  callbacks: DeepChapterGenerationCallbacks = {},
  deps: DeepChapterGenerationDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<DeepChapterGenerationResult> {
  assertNotAborted(signal);
  const resumeCheckpoint = input.resumeCheckpoint;
  const writingConfig = resolveWritingConfig(input.llmConfig);
  const workflowProfile = resolveChapterWorkflowProfile(input.aiWorkflowMode);
  const lengthSpec = resolveCurrentChapterLengthSpec();
  const novelConfig = useWikiStore.getState().novelConfig;
  const { loadSmartDeAiSkill } = await import("./de-ai-adapter");
  const workflowBaseParams = {
    mode: workflowProfile.mode,
    chapterNumber: input.chapterNumber ?? null,
  };
  const planExecutionSummary = buildChapterPlanExecutionSummary(input.planBlueprint ?? "");
  let executionContract: ChapterExecutionContract | null = null;
  let executionContractText = "";
  if (workflowProfile.runExecutionContractBuild && input.planBlueprint?.trim()) {
    try {
      const buildContract = deps.runChapterExecutionContractBuild || runChapterExecutionContractBuild;
      executionContract = await buildContract(writingConfig, input.planBlueprint, signal);
    } catch (error) {
      console.warn("[Deep Chapter] 执行清单生成失败，使用本地兜底解析:", error);
      executionContract = fallbackParseChapterExecutionContract(input.planBlueprint);
    }
    if (hasUsableChapterExecutionContract(executionContract)) {
      executionContractText = contractToTaskBriefText(executionContract);
    } else {
      executionContract = null;
      executionContractText = "";
    }
  }
  const contextWorkflowStep: ChapterWorkflowStepSpec = {
    name: "chapter_context",
    title: "读取上下文",
    detail: "读取大纲、章节目标、近期剧情、人物状态、伏笔和时间线。",
    params: workflowBaseParams,
  };
  if (!resumeCheckpoint) {
    startChapterWorkflowStep(callbacks, contextWorkflowStep);
  }

  // 将在阶段1构建contextPack后再加载skill（需要contextPack用于场景检测）
  let customDeAiSkill: string | null = null;

  // 阶段0：前情分析（仅当章节号>1，且设置开启时；记忆库的近期摘要与上一章结尾仍会注入）
  let previousChaptersAnalysis = "";
  if (
    workflowProfile.runPreviousChaptersAnalysis &&
    input.chapterNumber &&
    input.chapterNumber > 1 &&
    !resumeCheckpoint &&
    novelConfig.deepPreviousChaptersAnalysis
  ) {
    callbacks.onThinking?.(
      formatStageThinking("阶段0：前情分析", "正在读取并分析前3章完整内容..."),
    );
    const { analyzePreviousChapters } =
      await import("./previous-chapters-analysis");
    try {
      previousChaptersAnalysis = await analyzePreviousChapters(
        input.projectPath,
        input.chapterNumber,
        writingConfig,
        3,
      );
      if (previousChaptersAnalysis) {
        callbacks.onThinking?.(
          formatStageThinking(
            "阶段0：前情分析",
            `已完成前情分析（${previousChaptersAnalysis.length}字）\n\n${previousChaptersAnalysis.slice(0, 500)}...`,
          ),
        );
      }
    } catch (error) {
      console.error("[deep-chapter-generation] 前情分析失败:", error);
    }
  }
  assertNotAborted(signal);

  const contextPack = await safeBuildChapterContextPack(
    deps,
    input.projectPath,
    input.userRequest,
    input.chapterNumber,
  );
  assertNotAborted(signal);

  if (!resumeCheckpoint) {
    emitDeepChapterStageStarted(
      callbacks,
      "read_context",
      "读取上下文",
      "读取大纲、上一章结尾、近期剧情、人物状态、伏笔和时间线。",
    );
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:read_context:sources:${Date.now()}`,
      stageId: "read_context",
      kind: "read_source",
      title: "读取内容",
      content: [
        contextPack.outline?.trim()
          ? "已读取：作品完整大纲"
          : "未读取到：作品完整大纲",
        contextPack.previousChapterEnding?.trim()
          ? "已读取：上一章结尾"
          : "未读取到：上一章结尾",
        Array.isArray(contextPack.recentSummaries) &&
        contextPack.recentSummaries.length > 0
          ? `已读取：近期剧情 ${contextPack.recentSummaries.length} 条`
          : "未读取到：近期剧情",
        contextPack.characterStates?.trim()
          ? "已读取：人物状态"
          : "未读取到：人物状态",
        contextPack.foreshadowingStates?.trim()
          ? "已读取：伏笔状态"
          : "未读取到：伏笔状态",
        contextPack.timeline?.trim() ? "已读取：时间线" : "未读取到：时间线",
      ].join("\n"),
    });
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:read_context:goals:${Date.now()}`,
      stageId: "read_context",
      kind: "extract_goal",
      title: "提取目标",
      content: [
        "上一章结尾",
        "本章章节目标",
        "大纲要求推进的事件",
        "人物当前状态",
        "必须承接的伏笔",
        "必须完成与禁止违背内容",
      ].join("\n"),
    });
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:read_context:results:${Date.now()}`,
      stageId: "read_context",
      kind: "extract_result",
      title: "提取结果",
      content: formatContextExtractionResult(input, contextPack),
    });
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:read_context:output:${Date.now()}`,
      stageId: "read_context",
      kind: "stage_output",
      title: "阶段产物",
      content:
        "已形成章节生成约束包，将传入写作任务书、正文初稿、审稿和最终去AI味阶段。",
    });
  }

  // 阶段1后：加载智能skill（传递contextPack用于场景检测）
  customDeAiSkill = await loadSmartDeAiSkill(
    input.projectPath,
    input.userRequest,
    contextPack,
  );

  // 大纲与其余上下文共用同一窗口预算（派生自 maxContextSize）。大纲优先，
  // 但设有上限占比，避免其独占整个窗口；剩余额度再分给记忆/设定/检索上下文。
  const totalContextTokenBudget = computeNovelContextTokenBudget(
    input.llmConfig.maxContextSize,
    DEEP_CHAPTER_CONTEXT_TOKEN_BUDGET,
  );
  const totalContextCharBudget =
    totalContextTokenBudget * DEEP_CHAPTER_CHARS_PER_TOKEN;
  const outlineCharCap = Math.floor(
    totalContextCharBudget * DEEP_CHAPTER_OUTLINE_MAX_FRAC,
  );
  const outlineText = capOutlineToBudget(
    contextPack.outline ?? "",
    outlineCharCap,
  );

  // 独立提取大纲，不通过contextPackToPrompt
  const outlinePrompt = outlineText
    ? [
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "# 【强制遵守】作品完整大纲",
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "**重要：以下是本作品的完整大纲，这是强制性要求。**",
        "你必须严格遵守大纲中的情节发展、角色行为、关键事件、故事走向。",
        "大纲内容必须完整体现在生成的章节中，不可偏离。",
        "",
        outlineText,
        "",
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
      ].join("\n")
    : "";

  // 其余上下文的预算 = 总预算 − 大纲已占用（换算成 token），并保留下限。
  // 这样「大纲 + 其余上下文」整体不超过窗口派生的总预算。
  const restContextTokenBudget = Math.max(
    DEEP_CHAPTER_REST_TOKEN_FLOOR,
    totalContextTokenBudget -
      Math.ceil(outlineText.length / DEEP_CHAPTER_CHARS_PER_TOKEN),
  );
  const contextPrompt = [
    previousChaptersAnalysis
      ? `## 前情分析\n\n${previousChaptersAnalysis}`
      : "",
    deps.contextPackToPrompt(contextPack, restContextTokenBudget, {
      excludeOutline: true,
    }),
    input.dismantlingReferenceDirective,
  ]
    .filter(Boolean)
    .join("\n\n");

  // 稳定上下文前缀：与任务书/初稿/扩写/返修/去AI味各阶段提示词开头逐字节一致。
  // 作为显式 prompt 缓存断点传入（Anthropic/MiniMax 走 cache_control；
  // OpenAI/DeepSeek 该断点被折叠回字符串、由其自动前缀缓存命中）。
  const cachePrefix = buildStableContextPrefix(outlinePrompt, contextPrompt);

  if (!resumeCheckpoint) {
    callbacks.onThinking?.(formatContextThinking(input, contextPack));
    callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_context"));
    completeChapterWorkflowStep(
      callbacks,
      contextWorkflowStep,
      "上下文读取完成。",
      {
        recentSummaryCount: Array.isArray(contextPack.recentSummaries)
          ? contextPack.recentSummaries.length
          : 0,
        hasOutline: Boolean(contextPack.outline?.trim()),
        hasPreviousChapterEnding: Boolean(
          contextPack.previousChapterEnding?.trim(),
        ),
      },
    );
  }
  assertNotAborted(signal);

  let taskBrief = hasCheckpointTaskBrief(resumeCheckpoint)
    ? resumeCheckpoint.taskBrief.trim()
    : "";
  if (!taskBrief) {
    emitDeepChapterStageStarted(
      callbacks,
      "plot_analysis",
      "分析剧情走向",
      "根据章节生成约束包拆解本章目标、关键情节和写作约束。",
    );
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:plot_analysis:input:${Date.now()}`,
      stageId: "plot_analysis",
      kind: "stage_input",
      title: "接收内容",
      content: "章节生成约束包",
    });
    taskBrief = await runChapterWorkflowStep(
      callbacks,
      {
        name: "chapter_task_brief",
        title: "生成写作任务书",
        detail: "根据上下文拆解本章目标、关键情节和写作约束。",
        params: workflowBaseParams,
      },
      () =>
        collectModelText(
          writingConfig,
          [
            {
              role: "user",
              content: buildDeepChapterBriefPrompt(
                outlinePrompt,
                contextPrompt,
                input.userRequest,
                input.chapterNumber,
                input.goldenThreeChapter,
                lengthSpec,
                planExecutionSummary,
                executionContractText,
              ),
            },
          ],
          deps,
          signal,
          (partial) =>
            callbacks.onThinking?.(
              formatStageThinking("阶段2：写作任务书", partial),
            ),
          undefined,
          cachePrefix,
        ),
      (value) => `写作任务书完成，约 ${countChapterChars(value)} 字。`,
      (value) => ({ chars: countChapterChars(value) }),
    );
    assertNotAborted(signal);
    callbacks.onThinking?.(formatStageThinking("阶段2：写作任务书", taskBrief));
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:task_brief:output:${Date.now()}`,
      stageId: "plot_analysis",
      kind: "stage_output",
      title: "写作任务书",
      content: taskBrief,
    });
    callbacks.onCheckpoint?.(
      createResumeCheckpoint(input, "after_task_brief", { taskBrief }),
    );
  }

  let draftContent = hasCheckpointDraft(resumeCheckpoint)
    ? resumeCheckpoint.draftContent.trim()
    : "";
  if (!draftContent) {
    emitDeepChapterStageStarted(
      callbacks,
      "generate_draft",
      "生成章节草稿",
      "读取章节生成约束包和写作任务书，生成正文初稿。",
    );
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:generate_draft:input:${Date.now()}`,
      stageId: "generate_draft",
      kind: "stage_input",
      title: "接收内容",
      content: [
        "章节生成约束包",
        "写作任务书",
        input.chapterNumber
          ? `目标章节：第${input.chapterNumber}章`
          : "目标章节：从用户请求识别",
      ].join("\n"),
    });
    draftContent = await runChapterWorkflowStep(
      callbacks,
      {
        name: "chapter_draft",
        title: "生成章节正文初稿",
        detail: "按任务书输出本章正文初稿。",
        params: workflowBaseParams,
      },
      () =>
        collectModelText(
          writingConfig,
          [
            {
              role: "user",
              content: buildDeepChapterDraftPrompt(
                outlinePrompt,
                contextPrompt,
                taskBrief,
                input.userRequest,
                input.chapterNumber,
                input.goldenThreeChapter,
                lengthSpec,
              ),
            },
          ],
          deps,
          signal,
          (partial) =>
            callbacks.onThinking?.(
              formatStageThinking("阶段3：正文初稿", partial),
            ),
          undefined,
          cachePrefix,
        ),
      (value) => `正文初稿完成，约 ${countChapterChars(value)} 字。`,
      (value) => ({ chars: countChapterChars(value) }),
    );
    assertNotAborted(signal);
    if (countChapterChars(draftContent) < lengthSpec.minChars) {
      draftContent = await runChapterWorkflowStep(
        callbacks,
        {
          name: "chapter_expansion",
          title: "正文扩写补足",
          detail: "初稿低于本章目标字数，补足场景和人物行动。",
          params: workflowBaseParams,
        },
        () =>
          collectModelText(
            writingConfig,
            [
              {
                role: "user",
                content: buildDeepChapterExpansionPrompt(
                  outlinePrompt,
                  contextPrompt,
                  taskBrief,
                  draftContent,
                  input.userRequest,
                  input.chapterNumber,
                  input.goldenThreeChapter,
                  lengthSpec,
                ),
              },
            ],
            deps,
            signal,
            (partial) =>
              callbacks.onThinking?.(
                formatStageThinking("阶段3：正文扩写补足", partial),
              ),
            undefined,
            cachePrefix,
          ),
        (value) => `正文扩写补足完成，约 ${countChapterChars(value)} 字。`,
        (value) => ({ chars: countChapterChars(value) }),
      );
      assertNotAborted(signal);
    }
    callbacks.onThinking?.(
      formatStageThinking(
        "阶段3：正文初稿",
        [
          draftContent,
          "",
          `初稿生成完成，约 ${countChapterChars(draftContent)} 字。`,
        ].join("\n"),
      ),
    );
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:generate_draft:output:${Date.now()}`,
      stageId: "generate_draft",
      kind: "stage_output",
      title: "章节草稿",
      content: `正文初稿完成，约 ${countChapterChars(draftContent)} 字。`,
    });
    callbacks.onCheckpoint?.(
      createResumeCheckpoint(input, "after_draft", { taskBrief, draftContent }),
    );
  }

  if (!workflowProfile.runPostDraftPlanAudits) {
    const finalContent = draftContent;
    callbacks.onThinking?.(
      formatStageThinking(
        "阶段4：快速完成",
        "快速模式已完成任务书与正文初稿生成，直接采用正文初稿作为最终正文。",
      ),
    );
    emitDeepChapterActivity(callbacks, {
      id: `deep_chapter:final_output:output:${Date.now()}`,
      stageId: "final_output",
      kind: "final_output",
      title: "最终正文",
      content: `最终正文已生成，约 ${countChapterChars(finalContent)} 字。`,
    });
    callbacks.onFinalContent?.(finalContent);
    completeChapterWorkflowStep(
      callbacks,
      {
        name: "chapter_complete",
        title: workflowProfile.completionTitle,
        detail: "汇总本次章节生成结果。",
        params: workflowBaseParams,
      },
      `${workflowProfile.completionResultPrefix}，最终正文约 ${countChapterChars(finalContent)} 字。`,
      {
        chars: countChapterChars(finalContent),
        revised: false,
      },
    );
    return {
      finalContent,
      taskBrief,
      draftContent,
      reviewResults: [],
      revised: false,
      planCompliance: "",
      executionReport: "",
    };
  }

  let reviewResults = hasCheckpointReview(resumeCheckpoint)
    ? resumeCheckpoint.reviewResults
    : [];
  emitDeepChapterStageStarted(
    callbacks,
    "validate_revision",
    "校验与修正",
    "检查正文完整性、剧情连续性、人物一致性和阻断问题。",
  );
  const shouldRunAiReview =
    workflowProfile.runAiReview &&
    (workflowProfile.mode === "strict" || novelConfig.deepChapterReview);
  if (!hasCheckpointReview(resumeCheckpoint)) {
    if (!shouldRunAiReview) {
      completeChapterWorkflowStep(
        callbacks,
        {
          name: "chapter_review",
          title: "执行 AI 审稿",
          detail: "根据当前模式决定是否执行 AI 审稿。",
          params: workflowBaseParams,
        },
        workflowProfile.mode === "fast"
          ? "快速模式跳过 AI 审稿、返修和最终去AI味，直接使用阶段3正文初稿。"
          : "标准模式跳过 AI 审稿与自动返修，初稿将进入阶段6简单审查与去AI味。",
        { skipped: true },
      );
      callbacks.onThinking?.(
        formatStageThinking(
          "阶段4-5：已跳过审稿与返修",
          workflowProfile.mode === "fast"
            ? "快速模式跳过 AI 审稿、返修和最终去AI味，直接使用阶段3正文初稿。"
            : "标准模式跳过 AI 审稿与自动返修，初稿将进入阶段6简单审查与去AI味。",
        ),
      );
      emitDeepChapterActivity(callbacks, {
        id: `deep_chapter:validate_revision:analysis:${Date.now()}`,
        stageId: "validate_revision",
        kind: "analysis",
        title: "审稿分析",
        content:
          workflowProfile.mode === "fast"
            ? "快速模式跳过 AI 审稿、返修和最终去AI味，直接使用阶段3正文初稿。"
            : "标准模式跳过 AI 审稿与自动返修，初稿将进入阶段6简单审查与去AI味。",
      });
    } else {
      const reviewWorkflowStep: ChapterWorkflowStepSpec = {
        name: "chapter_review",
        title: "执行 AI 审稿",
        detail: "检查正文完整性、剧情连续性、截断和阻断问题。",
        params: workflowBaseParams,
      };
      startChapterWorkflowStep(callbacks, reviewWorkflowStep);
      callbacks.onThinking?.(
        formatStageThinking(
          "阶段4：AI审稿",
          "正在检查正文完整性、剧情连续性、是否被截断以及是否存在阻断问题。",
        ),
      );
      try {
        // 复用阶段1已构建的 contextPack，避免审稿内部再 buildContextPack 一次
        // （会重复跑检索 / 向量 / 图谱）。
        reviewResults = signal
          ? await deps.reviewChapter(
              input.projectPath,
              draftContent,
              input.chapterNumber,
              { onThinking: callbacks.onThinking, contextPack, planBlueprint: planExecutionSummary },
              signal,
            )
          : await deps.reviewChapter(
              input.projectPath,
              draftContent,
              input.chapterNumber,
              { onThinking: callbacks.onThinking, contextPack, planBlueprint: planExecutionSummary },
            );
      } catch (err) {
        console.error("[Deep Chapter] Review failed:", err);
        reviewResults = [];
      }
      reviewResults = reviewResults || [];
      assertNotAborted(signal);
      completeChapterWorkflowStep(
        callbacks,
        reviewWorkflowStep,
        reviewResults.length === 0
          ? "AI 审稿完成，未发现阻断问题。"
          : `AI 审稿完成，发现 ${reviewResults.length} 个问题，其中 ${reviewResults.filter((item) => item.severity === "error").length} 个阻断问题。`,
        {
          issueCount: reviewResults.length,
          blockingIssueCount: reviewResults.filter(
            (item) => item.severity === "error",
          ).length,
        },
      );
      callbacks.onThinking?.(formatReviewThinking(reviewResults));
      emitDeepChapterActivity(callbacks, {
        id: `deep_chapter:validate_revision:analysis:${Date.now()}`,
        stageId: "validate_revision",
        kind: "analysis",
        title: "审稿分析",
        content: formatReviewThinking(reviewResults)
          .replace(/^##\s*阶段4：AI审稿\s*/, "")
          .trim(),
      });
      callbacks.onCheckpoint?.(
        createResumeCheckpoint(input, "after_review", {
          taskBrief,
          draftContent,
          reviewResults,
        }),
      );
    }
  }

  const blockingIssues = reviewResults.filter(
    (item) => item.severity === "error",
  );
  let currentContent = draftContent;
  let revised = false;

  if (hasCheckpointRevision(resumeCheckpoint)) {
    currentContent = resumeCheckpoint.currentContent.trim();
    revised = true;
  } else if (blockingIssues.length === 0) {
    if (shouldRunAiReview) {
      completeChapterWorkflowStep(
        callbacks,
        {
          name: "chapter_revision",
          title: "自动返修",
          detail: "根据 AI 审稿结果决定是否返修。",
          params: workflowBaseParams,
        },
        "AI审稿未发现阻断问题，跳过自动返修。",
        { skipped: true },
      );
      callbacks.onThinking?.(
        formatStageThinking(
          "阶段5：无需自动返修",
          "AI审稿未发现阻断问题，跳过自动返修，进入阶段6简单审查与去AI味。",
        ),
      );
    }
  } else {
    const revisedContent = await runChapterWorkflowStep(
      callbacks,
      {
        name: "chapter_revision",
        title: "自动返修",
        detail: "根据阻断问题自动返修一次。",
        params: {
          ...workflowBaseParams,
          blockingIssueCount: blockingIssues.length,
        },
      },
      () =>
        collectModelText(
          writingConfig,
          [
            {
              role: "user",
              content: buildDeepChapterRevisionPrompt(
                outlinePrompt,
                contextPrompt,
                taskBrief,
                draftContent,
                blockingIssues,
                input.userRequest,
                input.chapterNumber,
                input.goldenThreeChapter,
              ),
            },
          ],
          deps,
          signal,
          (partial) =>
            callbacks.onThinking?.(
              formatStageThinking("阶段5：自动返修", partial),
            ),
          undefined,
          cachePrefix,
        ),
      (value) =>
        `检测到 ${blockingIssues.length} 个阻断问题，已自动返修一次。返修后正文约 ${countChapterChars(value)} 字。`,
      (value) => ({ chars: countChapterChars(value) }),
    );
    assertNotAborted(signal);
    callbacks.onThinking?.(
      formatStageThinking(
        "阶段5：自动返修",
        [
          `检测到 ${blockingIssues.length} 个阻断问题，已自动返修一次。`,
          "",
          formatReviewIssueList(blockingIssues),
          "",
          `返修后正文约 ${countChapterChars(revisedContent)} 字。`,
        ].join("\n"),
      ),
    );
    currentContent = revisedContent;
    revised = true;
    callbacks.onCheckpoint?.(
      createResumeCheckpoint(input, "after_revision", {
        taskBrief,
        draftContent,
        reviewResults,
        currentContent: revisedContent,
      }),
    );
  }

  emitDeepChapterActivity(callbacks, {
    id: `deep_chapter:validate_revision:output:${Date.now()}`,
    stageId: "validate_revision",
    kind: "stage_output",
    title: "修正结果",
    content: revised
      ? "已根据阻断问题完成一次自动返修。"
      : "未执行自动返修，当前正文进入最终审查。",
  });

  // 阶段5.5：返修后复审（只在发生了返修时执行，只审查角色一致性维度，降低token消耗，不再自动返修避免循环）
  const shouldRunPostRevisionReview =
    workflowProfile.runPostRevisionReview &&
    (workflowProfile.mode === "strict" || novelConfig.deepChapterReview);
  if (revised && shouldRunPostRevisionReview) {
    const postRevisionWorkflowStep: ChapterWorkflowStepSpec = {
      name: "chapter_post_revision_review",
      title: "返修后复审",
      detail: "对返修后的正文做角色一致性专项复审。",
      params: workflowBaseParams,
    };
    startChapterWorkflowStep(callbacks, postRevisionWorkflowStep);
    callbacks.onThinking?.(
      formatStageThinking(
        "阶段5.5：返修后角色一致性复审",
        "正在对返修后的正文进行角色一致性专项复审（轻量模式，只检查角色相关维度），确认返修是否引入新的角色偏差。",
      ),
    );
    try {
      const postRevisionResults = signal
        ? await deps.reviewChapter(
            input.projectPath,
            currentContent,
            input.chapterNumber,
            {
              onThinking: callbacks.onThinking,
              contextPack,
              characterOnly: true,
            },
            signal,
          )
        : await deps.reviewChapter(
            input.projectPath,
            currentContent,
            input.chapterNumber,
            {
              onThinking: callbacks.onThinking,
              contextPack,
              characterOnly: true,
            },
          );
      const postBlockingIssues = (postRevisionResults || []).filter(
        (item) => item.severity === "error",
      );
      if (postBlockingIssues.length > 0) {
        callbacks.onThinking?.(
          formatStageThinking(
            "阶段5.5：返修后复审",
            [
              `返修后复审发现 ${postBlockingIssues.length} 个阻断问题（不再自动返修，避免循环）：`,
              "",
              formatReviewIssueList(postBlockingIssues),
              "",
              "这些问题将在阶段6去AI味时一并处理，或需要手动修改。",
            ].join("\n"),
          ),
        );
        reviewResults = [...reviewResults, ...(postRevisionResults || [])];
      } else {
        callbacks.onThinking?.(
          formatStageThinking(
            "阶段5.5：返修后复审",
            "返修后复审未发现新的阻断问题，进入阶段6。",
          ),
        );
      }
      completeChapterWorkflowStep(
        callbacks,
        postRevisionWorkflowStep,
        `返修后复审完成，发现 ${postBlockingIssues.length} 个阻断问题。`,
        { blockingIssueCount: postBlockingIssues.length },
      );
    } catch (err) {
      console.error("[Deep Chapter] 返修后复审失败:", err);
      completeChapterWorkflowStep(
        callbacks,
        postRevisionWorkflowStep,
        "返修后复审失败，已继续进入后续阶段。",
        {
          failed: true,
        },
      );
    }
  }

  const finalPolishWorkflowStep: ChapterWorkflowStepSpec = {
    name: "chapter_final_polish",
    title: "简单审查与去AI味",
    detail: "做最后一遍简单审查，减少复读、机械套话和 AI 味。",
    params: workflowBaseParams,
  };
  let finalContent = workflowProfile.runFinalPolish
    ? await runChapterWorkflowStep(
        callbacks,
        finalPolishWorkflowStep,
        () =>
          finalPolishChapter(
            writingConfig,
            outlinePrompt,
            contextPrompt,
            taskBrief,
            currentContent,
            input,
            contextPack,
            callbacks,
            deps,
            signal,
            customDeAiSkill || undefined,
            cachePrefix,
          ),
        (value) =>
          `简单审查与去AI味完成，最终正文约 ${countChapterChars(value)} 字。`,
        (value) => ({ chars: countChapterChars(value) }),
      )
    : currentContent;
  if (!workflowProfile.runFinalPolish) {
    completeChapterWorkflowStep(
      callbacks,
      finalPolishWorkflowStep,
      "快速模式跳过最终去AI味，直接采用阶段3正文作为最终正文。",
      { skipped: true, chars: countChapterChars(finalContent) },
    );
  }
  callbacks.onThinking?.(
    formatStageThinking(
      "阶段7：完成",
      workflowProfile.runFinalPolish
        ? revised
          ? "采用返修并完成简单审查、去AI味后的正文作为最终正文。"
          : "未发现阻断问题，已完成最后一遍简单审查与去AI味。"
        : "快速模式已完成任务书与正文初稿生成，直接采用阶段3正文作为最终正文。",
    ),
  );
  emitDeepChapterActivity(callbacks, {
    id: `deep_chapter:final_output:output:${Date.now()}`,
    stageId: "final_output",
    kind: "final_output",
    title: "最终正文",
    content: `最终正文已生成，约 ${countChapterChars(finalContent)} 字。`,
  });
  callbacks.onFinalContent?.(finalContent);
  let executionReportSummary = "";
  if (workflowProfile.runPostDraftPlanAudits && executionContract) {
    let repairedByExecutionReport = false;
    try {
      const runReport = deps.runChapterExecutionReportCheck || runChapterExecutionReportCheck;
      const report = await runChapterWorkflowStep(
        callbacks,
        {
          name: "chapter_execution_report",
          title: "检查执行清单",
          detail: "按场景验收标准逐项检查最终正文。",
          params: workflowBaseParams,
        },
        () => runReport(writingConfig, executionContract!, finalContent, signal),
        (value) => executionReportToToolSummary(value),
        (value) => ({
          status: value.status,
          repairItemCount: extractExecutionRepairItems(value).length,
        }),
      );
      const repairItems = extractExecutionRepairItems(report);
      executionReportSummary = executionReportToToolSummary(report);
      emitDeepChapterActivity(callbacks, {
        id: `deep_chapter:execution_report:output:${Date.now()}`,
        stageId: "execution_report",
        kind: "stage_output",
        title: "执行报告",
        content: executionReportSummary,
      });
      if (repairItems.length > 0) {
        const runRepair = deps.runChapterPlanDeviationRepair || runChapterPlanDeviationRepair;
        const repairedContent = await runChapterWorkflowStep(
          callbacks,
          {
            name: "chapter_execution_repair",
            title: "返修执行失败项",
            detail: "只修复执行报告中的失败项，不重写全章。",
            params: workflowBaseParams,
          },
          () => runRepair(
            writingConfig,
            contractToTaskBriefText(executionContract!),
            finalContent,
            repairItems.join("\n"),
            signal,
          ),
          (value) => `执行失败项返修完成，正文约 ${countChapterChars(value)} 字。`,
          (value) => ({ chars: countChapterChars(value) }),
        );
        const validation = validateChapterPlanRepairResult(finalContent, repairedContent);
        if (validation.accepted) {
          finalContent = repairedContent.trim();
          revised = true;
          repairedByExecutionReport = true;
          callbacks.onFinalContent?.(finalContent);
          const recheckReport = await runChapterWorkflowStep(
            callbacks,
            {
              name: "chapter_execution_recheck",
              title: "复检执行清单",
              detail: "返修后再次检查执行清单失败项是否消除。",
              params: workflowBaseParams,
            },
            () => runReport(writingConfig, executionContract!, finalContent, signal),
            (value) => executionReportToToolSummary(value, true),
            (value) => ({
              status: value.status,
              repairItemCount: extractExecutionRepairItems(value).length,
            }),
          );
          executionReportSummary = executionReportToToolSummary(recheckReport, true);
          emitDeepChapterActivity(callbacks, {
            id: `deep_chapter:execution_recheck:output:${Date.now()}`,
            stageId: "execution_recheck",
            kind: "stage_output",
            title: "执行复检",
            content: executionReportSummary,
          });
        }
      }
      if (!repairedByExecutionReport) {
        executionReportSummary = executionReportToToolSummary(report);
      }
    } catch (error) {
      executionReportSummary = `执行报告生成失败，已保留正文：${error instanceof Error ? error.message : String(error)}`;
      emitDeepChapterActivity(callbacks, {
        id: `deep_chapter:execution_report:error:${Date.now()}`,
        stageId: "execution_report",
        kind: "stage_output",
        title: "执行报告",
        content: executionReportSummary,
      });
    }
  }
  let planCompliance = "";
  if (workflowProfile.runPostDraftPlanAudits && planExecutionSummary.trim() && !executionContract) {
    let complianceCheckFailed = false;
    const complianceStep = {
      name: "chapter_plan_compliance",
      title: "检查计划履约度",
      detail: "对照用户确认的章节计划检查最终正文是否按计划执行。",
      params: workflowBaseParams,
    };
    try {
      const runCompliance = deps.runChapterPlanComplianceCheck || runChapterPlanComplianceCheck;
      planCompliance = await runChapterWorkflowStep(
        callbacks,
        complianceStep,
        () => runCompliance(writingConfig, planExecutionSummary, finalContent, signal),
        (value) => value ? "计划履约度检查完成。" : "计划履约度检查完成，未返回具体结果。",
        (value) => ({ hasComplianceResult: Boolean(value?.trim()) }),
      );
    } catch (error) {
      complianceCheckFailed = true;
      planCompliance = `计划履约度检查失败：${error instanceof Error ? error.message : String(error)}`;
      completeChapterWorkflowStep(
        callbacks,
        complianceStep,
        planCompliance,
        { error: true },
      );
    }
    if (planCompliance.trim() && !complianceCheckFailed) {
      const parsedCompliance = parseChapterPlanComplianceResult(planCompliance);
      const shouldRepairPlanDeviation = shouldRepairChapterPlanDeviation(parsedCompliance);
      emitDeepChapterActivity(callbacks, {
        id: `deep_chapter:plan_compliance:output:${Date.now()}`,
        stageId: "plan_compliance",
        kind: "stage_output",
        title: "计划履约度",
        content: formatPlanComplianceActivityContent(parsedCompliance, shouldRepairPlanDeviation),
      });
      if (shouldRepairPlanDeviation) {
        const repairStep = {
          name: "chapter_plan_deviation_repair",
          title: "返修计划偏离点",
          detail: "只修复计划履约检查发现的偏离点，不重写全章。",
          params: workflowBaseParams,
        };
        const runRepair = deps.runChapterPlanDeviationRepair || runChapterPlanDeviationRepair;
        try {
          const repairedContent = await runChapterWorkflowStep(
            callbacks,
            repairStep,
            () => runRepair(writingConfig, planExecutionSummary, finalContent, planCompliance, signal),
            (value) => {
              const validation = validateChapterPlanRepairResult(finalContent, value);
              return validation.accepted
                ? `计划偏离点返修完成，正文约 ${countChapterChars(value)} 字。`
                : `计划偏离点返修结果异常，已保留原正文。原因：${validation.reason}。`;
            },
            (value) => ({
              chars: countChapterChars(value),
              changed: validateChapterPlanRepairResult(finalContent, value).accepted,
            }),
          );
          const validation = validateChapterPlanRepairResult(finalContent, repairedContent);
          const beforeChars = countChapterChars(finalContent);
          if (validation.accepted) {
            finalContent = repairedContent.trim();
            revised = true;
            const afterChars = countChapterChars(finalContent);
            planCompliance = buildPlanDeviationRepairReturnContent(parsedCompliance, beforeChars, afterChars);
            emitDeepChapterActivity(callbacks, {
              id: `deep_chapter:plan_deviation_repair:output:${Date.now()}`,
              stageId: "plan_deviation_repair",
              kind: "stage_output",
              title: "计划偏离点返修",
              content: [
                "正文已更新：已按计划履约偏离点完成轻量返修。",
                `返修前：约 ${beforeChars} 字。`,
                `返修后：约 ${afterChars} 字。`,
                "处理范围：只修复履约偏离点，未重写全章。",
              ].join("\n"),
            });
            callbacks.onFinalContent?.(finalContent);
          } else {
            emitDeepChapterActivity(callbacks, {
              id: `deep_chapter:plan_deviation_repair:output:${Date.now()}`,
              stageId: "plan_deviation_repair",
              kind: "stage_output",
              title: "计划偏离点返修",
              content: [
                "返修结果异常，已保留原正文。",
                `原因：${validation.reason}。`,
                `原正文：约 ${beforeChars} 字。`,
                `返修结果：约 ${countChapterChars(repairedContent)} 字。`,
              ].join("\n"),
            });
          }
        } catch (error) {
          console.error("[Deep Chapter] 计划偏离点返修失败:", error);
        }
      }
    }
  }
  completeChapterWorkflowStep(
    callbacks,
    {
      name: "chapter_complete",
      title: workflowProfile.completionTitle,
      detail: "汇总本次章节生成结果。",
      params: workflowBaseParams,
    },
    `${workflowProfile.completionResultPrefix}，最终正文约 ${countChapterChars(finalContent)} 字。`,
    {
      chars: countChapterChars(finalContent),
      revised,
    },
  );
  return {
    finalContent,
    taskBrief,
    draftContent,
    reviewResults,
    revised,
    planCompliance,
    executionReport: executionReportSummary,
  };
}

async function finalPolishChapter(
  deAiConfig: LlmConfig,
  outlinePrompt: string,
  contextPrompt: string,
  taskBrief: string,
  currentContent: string,
  input: DeepChapterGenerationInput,
  _contextPack: ContextPack,
  callbacks: DeepChapterGenerationCallbacks,
  deps: DeepChapterGenerationDeps,
  signal?: AbortSignal,
  customDeAiSkill?: string,
  cachePrefix?: string,
): Promise<string> {
  assertNotAborted(signal);
  callbacks.onThinking?.(
    formatStageThinking(
      "阶段6：简单审查与去AI味",
      "正在进行最后一遍简单审查，去除复读、机械套话和 AI 味。",
    ),
  );
  const polished = await collectModelText(
    deAiConfig,
    [
      {
        role: "user",
        content: buildDeepChapterFinalPolishPrompt(
          outlinePrompt,
          contextPrompt,
          taskBrief,
          currentContent,
          input.userRequest,
          input.chapterNumber,
          input.goldenThreeChapter,
          customDeAiSkill,
        ),
      },
    ],
    deps,
    signal,
    (partial) =>
      callbacks.onThinking?.(
        formatStageThinking("阶段6：简单审查与去AI味", partial),
      ),
    undefined,
    cachePrefix,
  );
  assertNotAborted(signal);
  return polished.trim() ? polished : currentContent;
}

function resolveCurrentChapterLengthSpec(): ChapterLengthSpec {
  const novelConfig = useWikiStore.getState().novelConfig;
  return resolveChapterLengthSpec(novelConfig?.chapterTargetChars);
}

function resolveWritingConfig(llmConfig: LlmConfig): LlmConfig {
  // 写作模型已移除，始终使用 AI 会话当前模型。
  // llmConfig 已在 chat-panel.tsx 中通过 effectiveChatLlmConfig 正确解析，
  // 不再通过 resolveNovelModel 重新解析，避免二次解析使用不同 API 端点/密钥
  return llmConfig;
}

/**
 * 把以 cachePrefix 开头的 user 字符串消息拆成 [前缀块(cacheControl), 余下块]，
 * 让 provider 在稳定上下文前缀上打缓存断点。其余消息原样返回。
 * 注：Anthropic/MiniMax 会据此发出 cache_control；OpenAI/DeepSeek 端纯文本块会被
 * 折叠回与原字符串逐字节一致的内容，不影响其自动前缀缓存。
 */
function applyCachePrefix(
  messages: ChatMessage[],
  cachePrefix?: string,
): ChatMessage[] {
  if (!cachePrefix) return messages;
  return messages.map((message) => {
    if (
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith(cachePrefix)
    ) {
      const rest = message.content.slice(cachePrefix.length);
      return {
        role: message.role,
        content: [
          { type: "text" as const, text: cachePrefix, cacheControl: true },
          ...(rest ? [{ type: "text" as const, text: rest }] : []),
        ],
      };
    }
    return message;
  });
}

async function collectModelText(
  config: LlmConfig,
  messages: ChatMessage[],
  deps: DeepChapterGenerationDeps,
  signal?: AbortSignal,
  onUpdate?: (content: string) => void,
  requestOverrides?: RequestOverrides,
  cachePrefix?: string,
): Promise<string> {
  let content = "";
  let reasoningBuffer = "";
  let streamError: Error | null = null;
  let cutoffReason: string | null = null;
  const streamController = new AbortController();
  const combinedSignal = combineAbortSignals(signal, streamController.signal);
  const stopStream = (reason: string) => {
    if (cutoffReason) return;
    cutoffReason = reason;
    streamController.abort();
  };

  assertNotAborted(signal);

  const callbacks: StreamCallbacks = {
    onToken: (token) => {
      if (signal?.aborted) {
        stopStream(USER_ABORT_MESSAGE);
        return;
      }
      content += token;
      const loopStart = findRepeatedTailStart(content);
      if (loopStart !== null) {
        content = content.slice(0, loopStart).trimEnd();
        onUpdate?.(
          `${content}\n\n（已检测到模型重复输出，已自动停止重复内容。）`,
        );
        stopStream("检测到模型重复输出，已自动停止重复内容。");
        return;
      }
      onUpdate?.(content);
    },
    onReasoningToken: (token) => {
      if (signal?.aborted) {
        stopStream(USER_ABORT_MESSAGE);
        return;
      }
      // 推理 token 只用于进度显示，不计入最终 content
      reasoningBuffer += token;
      if (!content) {
        onUpdate?.(reasoningBuffer);
      }
    },
    onDone: () => {},
    onError: (error) => {
      streamError = error;
    },
  };

  const streamOnce = async (effectiveOverrides?: RequestOverrides) => {
    streamError = null;
    cutoffReason = null;
    await deps.streamChat(
      config,
      applyCachePrefix(messages, cachePrefix),
      callbacks,
      combinedSignal,
      effectiveOverrides,
    );
  };

  await streamOnce(requestOverrides);

  if (
    streamError &&
    isReasoningOnlyResponseError(streamError) &&
    !isReasoningDisabled(config, requestOverrides)
  ) {
    content = "";
    reasoningBuffer = "";
    onUpdate?.("模型只返回思考过程，正在自动切换为非推理模式重试当前阶段。");
    await streamOnce(withReasoningDisabled(requestOverrides));
  }

  if (signal?.aborted) throw new Error(USER_ABORT_MESSAGE);
  if (streamError && !(cutoffReason && isRequestCancelledError(streamError)))
    throw streamError;
  if (cutoffReason) {
    onUpdate?.(`${content.trim()}\n\n（${cutoffReason}）`);
  }
  return content.trim();
}

function countChapterChars(content: string): number {
  return content.replace(/\s+/g, "").length;
}

function formatPlanComplianceActivityContent(
  result: ParsedChapterPlanComplianceResult,
  willRepair: boolean,
): string {
  const decision = result.status === "unknown"
    ? "未触发返修"
    : willRepair
      ? "触发轻量返修"
      : "无需返修";
  const lines = [
    `履约状态：${chapterPlanComplianceStatusLabel(result.status)}`,
    `偏离点数量：${result.deviations.length}`,
    `处理决定：${decision}`,
  ];
  if (result.status === "unknown") {
    lines.push("原因：模型未按结构返回，已避免误改正文");
  }
  if (result.summary.trim()) {
    lines.push(`总评：${result.summary.trim()}`);
  }
  if (result.deviations.length > 0) {
    lines.push("");
    lines.push("偏离点：");
    for (const [index, item] of result.deviations.slice(0, 5).entries()) {
      lines.push(`${index + 1}. ${item.point || "未说明偏离点"}`);
      if (item.evidence) lines.push(`   正文证据：${item.evidence}`);
      if (item.suggestion) lines.push(`   建议修正：${item.suggestion}`);
    }
  }
  return lines.join("\n");
}

function chapterPlanComplianceStatusLabel(
  status: ParsedChapterPlanComplianceResult["status"],
): string {
  if (status === "compliant") return "符合";
  if (status === "mostly_compliant") return "基本符合";
  if (status === "partial_deviation") return "部分偏离";
  if (status === "clear_deviation") return "明显偏离";
  return "未知";
}

function buildPlanDeviationRepairReturnContent(
  result: ParsedChapterPlanComplianceResult,
  beforeChars: number,
  afterChars: number,
): string {
  const lines = [
    "计划偏离点返修：已完成",
    `返修前履约状态：${chapterPlanComplianceStatusLabel(result.status)}`,
    `已处理偏离点数量：${result.deviations.length}`,
    `返修前：约 ${beforeChars} 字。`,
    `返修后：约 ${afterChars} 字。`,
    "最终正文已按计划偏离点轻量返修结果更新。",
  ];
  const handledPoints = result.deviations
    .map((item) => item.point.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (handledPoints.length > 0) {
    lines.push("");
    lines.push("已处理偏离点：");
    handledPoints.forEach((point, index) => {
      lines.push(`${index + 1}. ${point}`);
    });
  }
  return lines.join("\n");
}

function validateChapterPlanRepairResult(
  originalContent: string,
  repairedContent: string,
): { accepted: boolean; reason: string } {
  const repaired = repairedContent.trim();
  if (!repaired) {
    return { accepted: false, reason: "返修未返回有效正文" };
  }
  const originalChars = countChapterChars(originalContent);
  const repairedChars = countChapterChars(repaired);
  if (originalChars >= 1000 && repairedChars < originalChars * 0.7) {
    return { accepted: false, reason: "返修后正文明显变短" };
  }
  if (originalChars >= 1000 && repairedChars > originalChars * 1.5) {
    return { accepted: false, reason: "返修后正文明显变长" };
  }
  if (originalChars >= 1000 && !hasEnoughOriginalContentAnchors(originalContent, repaired)) {
    return { accepted: false, reason: "返修后未保留原正文主要内容" };
  }
  return { accepted: true, reason: "" };
}

function hasEnoughOriginalContentAnchors(originalContent: string, repairedContent: string): boolean {
  const original = normalizeContentForAnchorCheck(originalContent);
  const repaired = normalizeContentForAnchorCheck(repairedContent);
  if (original.length < 240 || repaired.length < 240) return true;

  const anchors: string[] = [];
  const windowSize = 14;
  const step = Math.max(80, Math.floor(original.length / 20));
  for (let index = 0; index + windowSize <= original.length; index += step) {
    anchors.push(original.slice(index, index + windowSize));
    if (anchors.length >= 20) break;
  }
  if (anchors.length === 0) return true;

  const preservedCount = anchors.filter((anchor) => repaired.includes(anchor)).length;
  return preservedCount >= Math.max(2, Math.ceil(anchors.length * 0.15));
}

function normalizeContentForAnchorCheck(content: string): string {
  return content.replace(/[\s\p{P}\p{S}]+/gu, "");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(USER_ABORT_MESSAGE);
}

function isRequestCancelledError(error: Error): boolean {
  return /request cancelled|request canceled|aborted|aborterror/i.test(
    error.message,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter(Boolean) as AbortSignal[];
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function findRepeatedTailStart(content: string): number | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < REPEAT_CHECK_MIN_CHARS) return null;

  const tail = compact.slice(-REPEAT_WINDOW_CHARS);
  const first = compact.indexOf(tail);
  if (first === -1 || first >= compact.length - REPEAT_WINDOW_CHARS)
    return null;

  let hits = 0;
  let searchIndex = 0;
  while (true) {
    const found = compact.indexOf(tail, searchIndex);
    if (found === -1) break;
    hits += 1;
    if (hits >= REPEAT_HIT_LIMIT) {
      return sourceIndexFromCompactIndex(
        normalized,
        first + REPEAT_WINDOW_CHARS,
      );
    }
    searchIndex = found + Math.max(1, tail.length);
  }
  return null;
}

function sourceIndexFromCompactIndex(
  content: string,
  compactIndex: number,
): number {
  let seen = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (/\s/.test(content[index])) continue;
    seen += 1;
    if (seen >= compactIndex) return index + 1;
  }
  return content.length;
}

function formatContextThinking(
  input: DeepChapterGenerationInput,
  pack: ContextPack,
): string {
  const recentSummaries = Array.isArray(pack.recentSummaries)
    ? pack.recentSummaries
    : [];
  const goldenThreeHints = resolveGoldenThreeThinkingHints(
    input.goldenThreeChapter,
  );
  return formatStageThinking(
    "阶段1：上下文分析",
    [
      ...goldenThreeHints,
      input.chapterNumber
        ? `目标章节：第${input.chapterNumber}章`
        : "目标章节：从用户请求中识别",
      `章节目标：${fallback(pack.chapterGoal, "未读取到明确章节目标")}`,
      `上一章结尾：${fallback(pack.previousChapterEnding, "未读取到上一章结尾")}`,
      `近期剧情：${recentSummaries.length} 条`,
      `人物状态：${summaryText(pack.characterStates)}`,
      `伏笔状态：${summaryText(pack.foreshadowingStates)}`,
      `时间线：${summaryText(pack.timeline)}`,
      `禁止违背：${fallback(pack.mustAvoid, "暂无明确禁止项")}`,
      `必须完成：${fallback(pack.mustDo, "暂无明确必做项")}`,
    ].join("\n"),
  );
}

function formatContextExtractionResult(
  input: DeepChapterGenerationInput,
  pack: ContextPack,
): string {
  const recentSummaries = Array.isArray(pack.recentSummaries)
    ? pack.recentSummaries
    : [];
  return [
    input.chapterNumber
      ? `目标章节：第${input.chapterNumber}章`
      : "目标章节：从用户请求识别",
    `章节目标：${fallback(pack.chapterGoal, "未读取到明确章节目标")}`,
    `上一章结尾：${fallback(pack.previousChapterEnding, "未读取到上一章结尾")}`,
    `近期剧情：${recentSummaries.length} 条`,
    `人物状态：${summaryText(pack.characterStates)}`,
    `伏笔状态：${summaryText(pack.foreshadowingStates)}`,
    `时间线：${summaryText(pack.timeline)}`,
    `必须完成：${fallback(pack.mustDo, "暂无明确必做项")}`,
    `禁止违背：${fallback(pack.mustAvoid, "暂无明确禁止项")}`,
  ].join("\n");
}

function formatReviewThinking(reviewResults: NovelReviewResult[]): string {
  if (reviewResults.length === 0) {
    return formatStageThinking("阶段4：AI审稿", "未发现阻断问题。");
  }
  const characterIssues = reviewResults.filter(
    (item) => item.type === "character_consistency",
  );
  const otherIssues = reviewResults.filter(
    (item) => item.type !== "character_consistency",
  );
  const errorCount = reviewResults.filter(
    (item) => item.severity === "error",
  ).length;
  const sections: string[] = [
    `发现 ${reviewResults.length} 个问题，其中阻断问题 ${errorCount} 个。`,
  ];

  // 角色命中记忆库报告（单独展示 character_consistency 类型的问题）
  if (characterIssues.length > 0) {
    sections.push("");
    sections.push("【角色命中记忆库报告】");
    sections.push(formatReviewIssueList(characterIssues));
  }

  // 其他问题
  if (otherIssues.length > 0) {
    sections.push("");
    sections.push("【其他审查问题】");
    sections.push(formatReviewIssueList(otherIssues));
  }

  return formatStageThinking("阶段4：AI审稿", sections.join("\n"));
}

function formatStageThinking(title: string, content: string): string {
  return `## ${title}\n${content.trim()}`;
}

function formatReviewIssueList(reviewResults: NovelReviewResult[]): string {
  return reviewResults
    .map((item, index) =>
      [
        `${index + 1}. [${severityLabel(item.severity)}] ${item.message}`,
        item.evidence ? `   - 证据：${item.evidence}` : "",
        item.relatedMemory ? `   - 相关记忆：${item.relatedMemory}` : "",
        item.suggestion ? `   - 建议：${item.suggestion}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}

function fallback(
  value: string | null | undefined,
  fallbackText: string,
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimForThinking(trimmed, 180) : fallbackText;
}

function summaryText(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimForThinking(trimmed, 140) : "暂无";
}

function trimForThinking(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function severityLabel(severity: NovelReviewResult["severity"]): string {
  if (severity === "error") return "严重";
  if (severity === "warning") return "提醒";
  return "信息";
}

function resolveGoldenThreeThinkingHints(
  goldenThreeChapter?: GoldenThreeChapterRequest,
): string[] {
  if (!goldenThreeChapter?.enabled || !goldenThreeChapter.targetChapter)
    return [];
  if (goldenThreeChapter.outputMode === "first_chapter_with_directions") {
    return [
      "黄金三章：已启用",
      "执行策略：当前按黄金三章规则生成第1章正文，并在正文后给出第2章、第3章写作方向。",
    ];
  }
  return [
    "黄金三章：已启用",
    `执行策略：当前按黄金三章规则生成第${goldenThreeChapter.targetChapter}章正文。`,
  ];
}

async function safeBuildChapterContextPack(
  deps: DeepChapterGenerationDeps,
  projectPath: string,
  userRequest: string,
  chapterNumber?: number,
): Promise<ContextPack> {
  try {
    return await deps.buildContextPack(projectPath, userRequest, chapterNumber);
  } catch {
    return {
      task: userRequest,
      chapterGoal: "",
      outline: "",
      recentSummaries: [],
      previousChapterEnding: "",
      characterStates: "",
      soulDoc: "",
      characterAuras: "",
      cognitionStates: "",
      foreshadowingStates: "",
      timeline: "",
      relatedSettings: "",
      canonRules: "",
      writingStyle: "",
      searchResults: "",
      graphSearchResults: "",
      mustDo: "",
      mustAvoid: "",
      nextChapterAdvice: "",
      revisionDirectives: "",
    };
  }
}
