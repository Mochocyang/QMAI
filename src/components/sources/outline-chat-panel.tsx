import { ScrollToLatestButton } from "@/components/chat/scroll-to-latest-button"
import { UserMessageMeta } from "@/components/chat/user-message-meta"
import { StoppedGenerationActions } from "@/components/novel/stopped-generation-actions"
import { FailedGenerationActions } from "@/components/novel/failed-generation-actions"
import { CONTINUE_STOPPED_GENERATION_PROMPT, isStoppedGenerationMessage } from "@/lib/novel/stopped-generation"
import {
  FAILED_GENERATION_CONTINUE_PROMPT,
  hasFailedGenerationPartialContent,
  isFailedGenerationMessage,
} from "@/lib/novel/failed-generation"
import { buildSettingProfileOutputRules } from "@/lib/novel/setting-profile-contracts";
import { useGuideStore } from "@/lib/guide/guide-store"
import {
  buildGuideDemoOutlineMarkdown,
  pickGuideDemoNovel,
  readGuideDemoNovel,
  rememberGuideDemoNovel,
} from "@/lib/guide/guide-demo-novel"
import {
  type CSSProperties,
  type ReactNode,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useDeferredValue,
  isValidElement,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  X,
  Save,
  Copy,
  RefreshCw,
  FileText,
  Plus,
  Trash2,
  ListPlus,
  History,
} from "lucide-react";
import { useWikiStore } from "@/stores/wiki-store";
import {
  resolveOutlineWorkflowMode,
  type OutlineWorkflowMode,
} from "@/lib/agent/workflow-mode";
import { OUTPUT_TRUNCATED_ERROR_MARKER } from "@/lib/llm-client";
import { friendlyLlmErrorMessage } from "@/lib/novel/llm-error-message";
import { Button } from "@/components/ui/button";
import { UiTestAiIdentity, UiTestAiAuthor, UiTestAiEmpty, UiTestAiModel, UiTestAiComposer, getUiTestAiMenuStyle, useUiTestAiMenuFocus } from "@/components/uitest/ui-test-ai-parts";
import "@/components/uitest/ui-test-ai.css";
import {
  saveAiOutlineModel,
  saveAiOutlineReasoningDepth,
  saveOutlineWorkflowMode,
} from "@/lib/project-store";
import {
  useOutlineChatStore,
  type OutlineMultiAgentRunState,
  type OutlineChatMessage,
  type OutlineSaveReport,
} from "@/stores/outline-chat-store";
import { normalizePath } from "@/lib/path-utils";
import { refreshProjectState } from "@/lib/project-refresh";
import {
  readFile,
  writeFile,
  createDirectory,
  fileExists,
} from "@/commands/fs";
import { hasUsableLlm } from "@/lib/has-usable-llm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { FileEditPreview } from "@/components/chat/file-edit-preview";
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver";
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram";
import {
  AgentToolCallMessage,
  type ToolCallRecord,
} from "@/components/chat/agent-tool-call-message";
import {
  OutlineSaveConfirmDialog,
  type OutlineSaveConfirmPayload,
} from "@/components/sources/outline-save-confirm-dialog";
import { OutlineWizardDialog } from "@/components/sources/outline-wizard-dialog";
import { EventOutlineCard } from "@/components/sources/event-outline-card";
import { NovelGenerationRequestMessage } from "@/components/sources/novel-generation-request-message";
import { OutlineMultiAgentPanel } from "@/components/sources/outline-multi-agent-panel";
import { OutlineSaveReportPanel } from "@/components/sources/outline-save-report";
import {
  OutlineStandardWorkflowPanel,
  shouldShowOutlineToolCalls,
  shouldUseOutlineStandardWorkflowCard,
} from "@/components/sources/outline-standard-workflow-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-section-configs";
import {
  buildOutlineWizardPrompt,
  getOutlineWizardSkillNames,
  isFanficRequest,
  resolveFanficDeviations,
  resolveFanficMode,
  type OutlineWizardRequest,
} from "@/lib/novel/outline-wizard";
import {
  compileFanficCanon,
  fanficCanonPath,
  loadFanficCanon,
  stripFanficCanonFrontmatter,
} from "@/lib/novel/fanfic-canon";
import {
  createNovelGenerationRequestPackage,
  getOutlineMessageModelContent,
  mapOutlineMessagesForModel,
  buildOutlineRegenerationInput,
  isExplicitStructuredGenerationFollowUp,
  isInternalOutlineMessage,
  mapOutlineConversationsForModel,
  type NovelGenerationRequestPackage,
} from "@/lib/novel/novel-generation-request-package";
import { buildSelectedSkillsPrompt } from "@/lib/agent/plugins/select-skills-plugin";
import {
  getOutlineSkillNames,
  resolveAvailableSkillsByNames,
} from "@/lib/novel/skill-route-registry";
import {
  buildBoundedSubAgentMergePayload,
  type OutlineSubAgentPlan,
  planOutlineSubAgents,
  resumeOutlineMultiAgentWorkflow,
  runOutlineMultiAgentWorkflow,
} from "@/lib/novel/outline-multi-agent-orchestrator";
import type { OutlineSubAgentResult } from "@/lib/novel/outline-result-protocol";
import {
  buildDynamicOutlinePlannerPrompt,
  parseDynamicOutlinePlan,
} from "@/lib/novel/outline-dynamic-agent-planner";
import { buildScopedOutlineSubAgentContext } from "@/lib/novel/outline-agent-context";
import {
  buildClassifiedOutlineSaveRequest,
  decideOutlineAutoSaveGate,
  isEventOutlineSaveBlocked,
  isSaveableOutlineDeliverable,
  prepareOutlineSaveSourceContent,
} from "@/lib/outline-save";
import {
  type CharacterSaveDraft,
  extractCharacterSaveDrafts,
} from "@/lib/novel/character-save-extractor";
import {
  buildCharacterAgentSystemPrompt,
  buildCharacterAgentPlans,
  buildCharacterPlannerSystemPrompt,
  buildCharacterPlannerUserPrompt,
  parseCharacterPlannerResult,
  runCharacterMultiAgent,
  type CharacterAgentPlan,
  type CharacterAgentResult,
} from "@/lib/novel/character-multi-agent";
import {
  characterDraftsToSaveRequests,
  excludeEventOutlineSaveRequests,
  formatOutlineSaveParseFeedback,
  mergeOutlineSaveRequests,
  type OutlineSaveRequest,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "@/lib/novel/outline-save-request";
import { pruneVersions, saveVersion } from "@/lib/novel/version-store";
import {
  extractVolumeOutlineData,
  getVolumeSkeletonReference,
  loadSavedVolumeOutlineDataList,
  primeVolumeOutlineTemplate,
  primeVolumeSkeletonReference,
  validateVolumeOutlineData,
} from "@/lib/novel/volume-outline-template";
import {
  buildChapterBatchPrompt,
  buildChapterOutlineSaveRequest,
  crossCheckChapterAgainstVolume,
  collectProblemChapterNumbers,
  extractChapterOutlineBatch,
  extractChapterOutlineData,
  mergeChapterBatches,
  nextChapterBatchRange,
  primeChapterOutlineTemplate,
  renderChapterOutlineMarkdown,
  validateChapterOutlineData,
  type ChapterOutlineData,
} from "@/lib/novel/chapter-outline-template";
import {
  primeSettingOutlineTemplate,
  resolveSettingSpecByTitle,
  type SettingOutlineSpec,
} from "@/lib/novel/setting-outline-template";
import {
  primeCharacterProfileTemplate,
  buildCharacterProfileHtmlForDraft,
  extractCharacterProfiles,
} from "@/lib/novel/character-profile-template";
import { primeFactionProfileTemplate, extractFactionProfiles } from "@/lib/novel/faction-profile-template";
import { primePowerProfileTemplate, extractPowerProfiles } from "@/lib/novel/power-system-template";
import { primeForeshadowingProfileTemplate, extractForeshadowingProfiles } from "@/lib/novel/foreshadowing-plan-template";
import { primeGoldenFingerProfileTemplate, extractGoldenFingerProfiles } from "@/lib/novel/golden-finger-template";
import { primeGeographyProfileTemplate, extractGeographyProfiles } from "@/lib/novel/geography-setting-template";
import { primeLocationProfileTemplate, extractLocationProfiles } from "@/lib/novel/location-setting-template";
import { primeBackgroundProfileTemplate, extractBackgroundProfiles } from "@/lib/novel/background-setting-template";
import {
  resolveModelConfig,
  resolveNovelModel,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver";
import {
  buildChapterOutlineResumePrompt,
  clearChapterOutlineDraft,
  readChapterOutlineDraft,
  writeChapterOutlineDraft,
} from "@/lib/novel/chapter-outline-draft";
import { hasAvailableModels as hasConfiguredModels } from "@/lib/llm-model-keys";
import {
  planOutlineRequestBudget,
  type OutlineBudgetStage,
} from "@/lib/context-budget";
import {
  getEffectiveMaxContextSize,
  getEffectiveMaxOutputTokens,
  thinkingMinMaxTokens,
} from "@/lib/llm-providers";
import { ChatModelSelector } from "@/components/chat/chat-model-selector";
import { ReasoningDepthControl } from "@/components/chat/reasoning-depth-control";
import { applyReasoningDepth } from "@/lib/reasoning-depth";
import { ContextUsageRing } from "@/components/chat/context-usage-ring";
import { highlightCode } from "@/lib/streaming-code-highlight";
import { separateThinking } from "@/lib/separate-thinking";
import { StreamingMarkdown } from "@/components/common/streaming-markdown";
import { useWaitingHint, composeWaitingText } from "@/hooks/use-waiting-hint";
import { ContextHubDetails } from "@/components/common/context-hub-details";
import { parseContextHubSnapshotRef } from "@/lib/context-hub/types";
import {
  ReferenceInput,
  type InsertReferenceTokens,
} from "@/components/reference/ReferenceInput";
import { ReferencePickerDialog } from "@/components/reference/ReferencePickerDialog";
import { ReferenceChip } from "@/components/reference/ReferenceChip";
import {
  chapterProvider,
  createChatHistoryProvider,
  createOutlineHistoryProvider,
  createSkillProvider,
  deductionProvider,
  memoryProvider,
  outlineProvider,
} from "@/lib/reference/providers";
import type { SkillSummary } from "@/lib/reference/providers";
import type { ReferenceToken } from "@/lib/reference/types";
import { collectReferencedSoulAuraIds, SOUL_SKILL_SUBTYPE } from "@/lib/reference/soul-reference";
import {
  beginMessageScopedSoulBinding,
  releaseMessageScopedSoulBinding,
  type MessageScopedSoulBinding,
} from "@/lib/novel/message-scoped-soul-binding";
import { useCharacterSoulReference, type CharacterSoulOption } from "@/components/chat/use-character-soul-reference";
import { useChatStore } from "@/stores/chat-store";
import { AgentRunner } from "@/lib/agent/runner";
import {
  isReasoningDisabled,
  isReasoningOnlyResponseError,
  withReasoningDisabled,
} from "@/lib/reasoning-retry";
import {
  isThoughtDumpText,
  stripThoughtDumpFromText,
} from "@/lib/thought-dump";
import { ToolRegistry } from "@/lib/agent/registry";
import { buildAgentConfig, isFunctionCallingEnabled, modelSupportsTools } from "@/lib/agent/config";
import type { AgentConfig, AgentMessage, AgentRunRecord } from "@/lib/agent/types";
import {
  applyAgentToolEvent,
  settleRunningAgentToolCalls,
} from "@/lib/agent/tool-events";
import {
  loadDeAiSkillConfig,
  resolveAvailableDeAiSkills,
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library";
import {
  loadUserSkillConfig,
  resolveEnabledWritingSkills,
} from "@/lib/novel/user-skill-store";
import type { UserSkill } from "@/lib/novel/skill-library";
import { filterSkillsForSkillRoutes } from "@/lib/novel/skill-route";
import { readSoulDoc } from "@/lib/novel/soul-doc";
import {
  buildWebResearchContext,
  collectWebResearch,
  shouldUseWebResearch,
} from "@/lib/web-research";
import {
  planOutlineAgentHistory,
  planOutlineContextReuse,
} from "@/lib/novel/outline-context-reuse";
import {
  buildContextHubSystemContent,
  buildSessionContextSummary,
  flattenContextHubSystemContent,
  buildLlmRequestDiagnostics,
  getContextHub,
  persistContextHubProviderUsage,
  type ContextHubResult,
  type ContextHubSnapshotRef,
} from "@/lib/context-hub";
import type { UserMemoryDecision } from "@/lib/user-memory/decision-trace";
import {
  buildContextUsageSnapshot,
  calibrateContextUsageSnapshot,
  composeLiveContextUsage,
} from "@/lib/context-usage";
import { selectContextHistoryMessages } from "@/lib/context-hub/session-summary";
import { addLlmUsage, type LlmUsage } from "@/lib/llm-usage";
import { LlmRequestTraceCollector } from "@/lib/llm-request-trace";
import { enqueueUserMemoryLearning } from "@/lib/user-memory/learning-service";
import { recordLatestUserMemoryFeedback } from "@/lib/user-memory/feedback-service";
import {
  getConversationTabTitle,
  splitConversationToolbarItems,
} from "@/lib/workspace-layout";
import { createWriteOutlineNodeTool } from "@/lib/agent/tools/write-outline-node";
import {
  buildIntentAnalysisPrompt,
  buildIntentPhaseSystemRules,
  classifyDirectOutlineGenerationRequest,
  parseIntentClarityProtocol,
  shouldAutoFollowUpGeneration,
  stripStructuredMarkers,
  type IntentClarityResult,
} from "@/lib/novel/outline-intent-clarity";
import {
  cleanNextStepArtifacts,
  extractNextStep,
  buildNextStepPromptSuffix,
} from "@/lib/novel/outline-next-step";
import {
  buildOutlineDiscussAnswerPrompt,
  buildOutlineDiscussExecutionPrompt,
  buildOutlineDiscussPhaseSystemRules,
  findLatestOutlineDiscussProtocol,
  isOutlineDiscussFinalizeRequest,
  parseOutlineDiscussProtocol,
  type OutlineDiscussAnswer,
  type OutlineDiscussPhase,
  type OutlineDiscussProtocol,
} from "@/lib/novel/outline-discuss-protocol";
import { resolveOutlineDiscussProtocol } from "@/lib/novel/outline-discuss-repair";
import { resolveOutlinePlanProtocol } from "@/lib/novel/outline-plan-repair";
import { resolveIntentClarityProtocol } from "@/lib/novel/outline-intent-repair";
import {
  buildOutlinePlanClarifyAnswerPrompt,
  buildOutlinePlanElementCheckPrompt,
  buildOutlinePlanExecutionPrompt,
  buildOutlinePlanPhaseSystemRules,
  type OutlinePlanAnswer,
  type OutlinePlanPhase,
  type OutlinePlanProtocol,
} from "@/lib/novel/outline-plan-protocol";
import { getOutlinePlanRequiredElements } from "@/lib/novel/outline-plan-elements";
import { OutlineIntentDialog } from "@/components/sources/outline-intent-dialog";
import { listOutlineEntries, type OutlineListEntry } from "@/lib/agent/tools/outline-list-helpers";
import { OutlineClarifyCard } from "@/components/sources/outline-clarify-card";
import { OutlineDiscussCard } from "@/components/sources/outline-discuss-card";
import { OutlinePlanCard } from "@/components/sources/outline-plan-card";
import { NextStepCard } from "@/components/sources/outline-next-step-card";
import { ConversationRunStatusIcon } from "@/components/common/conversation-run-status-icon";
import { ConversationDeleteConfirmDialog } from "@/components/common/conversation-delete-confirm-dialog";
import { ConversationHistoryClearDialog } from "@/components/common/conversation-history-clear-dialog";
import {
  canCreateNewConversation,
  EMPTY_CONVERSATION_CREATE_REASON,
} from "@/lib/conversation-create-guard";
import { outlineConversationRunRegistry } from "@/lib/conversation-run-registry";
import { toast } from "@/lib/toast";
import { extractEventOutlineData, type EventOutlineData } from "@/lib/novel/event-outline";
import { handoffEventOutlineToProse } from "@/lib/novel/event-outline-handoff";
import { finalizeStructuredMarkdownMessage } from "@/lib/novel/markdown-quality-finalizer";
import { repairMarkdownFormatWithAi } from "@/lib/novel/markdown-quality-ai-repair";
import {
  type OutlineWorkflowStage,
  canTransitionOutlineWorkflow,
} from "@/lib/novel/outline-workflow-state";
import {
  canApplyOutlineRunEffect,
  setOutlineSessionValue,
  shouldClearOutlineDraft,
  shouldClearOutlineReferences,
} from "@/lib/novel/outline-chat-session-state";

type OutlineSendResult = { started: boolean; sent: boolean };

/**
 * 某条消息所属那一轮生成里，用户提的事件细纲硬要求
 * （扩写提示词里 `## 用户对本章的要求` 那一节的来源）。
 *
 * 要求就存在消息本身上（`eventOutlineRequirement`，与消息一起写进
 * `.qmai/outline-chats.json`），所以这里既不查表也不解析提示词：
 * 「谁的要求」这个问题只有一个答案 —— 这条消息自己的。
 *
 * ⚠️ 别写成「事件细纲**向导**里填的要求」：向导已按用户要求删除（丙-2c）。
 * 现在把字段写到**新**消息上的只剩两条重发路径 —— `handleRegenerate` 直接抄，
 * 以及「继续」经 `handleContinueStopped` → `handleSendMessage` → `handleSend` 盖章。
 */
function requirementFor(msg: OutlineChatMessage): string | undefined {
  return msg.eventOutlineRequirement;
}

const OUTLINE_REASONING_ONLY_ERROR_MESSAGE =
  "模型只输出了思考内容，没有输出正文。已关闭 reasoning 重试一次，仍未返回可用的大纲内容。";

export function filterOutlineGeneratedContent(content: string): {
  content: string;
  reasoningOnly: boolean;
} {
  const trimmed = content.trim();
  if (!trimmed) return { content: "", reasoningOnly: false };

  const stripped = stripThoughtDumpFromText(trimmed).trim();
  const reasoningOnly = !stripped || (
    stripped === trimmed && isThoughtDumpText(trimmed)
  );
  return {
    content: reasoningOnly ? "" : stripped,
    reasoningOnly,
  };
}

type OutlineFilteredAttempt = {
  text: string;
  error?: Error;
};

async function runOutlineAttemptWithReasoningRetry<T extends OutlineFilteredAttempt>(
  config: Pick<AgentConfig, "llmConfig" | "requestOverrides">,
  runAttempt: (requestOverrides: AgentConfig["requestOverrides"]) => Promise<T>,
  onRetry?: (thoughtText: string) => void,
): Promise<T> {
  const firstAttempt = await runAttempt(config.requestOverrides);
  const firstOutput = filterOutlineGeneratedContent(firstAttempt.text);
  const firstReasoningOnlyError = Boolean(
    firstAttempt.error && isReasoningOnlyResponseError(firstAttempt.error),
  );

  // AgentRunner 已经会对供应商明确上报的 reasoning-only 错误重试；
  // 这里只为“被当作普通文本返回”的思考摘要补一次上层重试。
  if (firstReasoningOnlyError) {
    throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
  }
  if (!firstOutput.reasoningOnly) {
    return { ...firstAttempt, text: firstOutput.content };
  }
  if (isReasoningDisabled(config.llmConfig, config.requestOverrides)) {
    throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
  }

  onRetry?.(firstAttempt.text);
  const retryAttempt = await runAttempt(withReasoningDisabled(config.requestOverrides));
  const retryOutput = filterOutlineGeneratedContent(retryAttempt.text);
  if (
    retryOutput.reasoningOnly
    || !retryOutput.content
    || (retryAttempt.error && isReasoningOnlyResponseError(retryAttempt.error))
  ) {
    throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
  }
  return { ...retryAttempt, text: retryOutput.content };
}

const OUTLINE_CHAT_DISABLED_TOOLS = ["write_chapter", "write_memory", "write_outline_node"];
const OUTLINE_CHAT_WIZARD_DISABLED_TOOLS = [...OUTLINE_CHAT_DISABLED_TOOLS];

function showOutlineAutoSaveError(message: string) {
  toast.error(message, {
    title: "大纲保存失败",
    persistent: true,
    dedupeKey: `outline-auto-save:${message}`,
  });
}

/** 自动修复配额按任务类型分开计数：同一条会话里生成卷纲后又生成章纲时，互不挤占配额。 */
function outlineRepairAttemptsKey(task: "volume" | "chapter", conversationId: string): string {
  return `${task}:${conversationId}`;
}

/** 章纲第 1 批生成提示词里的标记：用于识别「首次生成章纲」并触发草稿续跑。 */
const CHAPTER_OUTLINE_FIRST_BATCH_MARKER = "本次只写第 1 批";

function mergeDisabledTools(...groups: Array<readonly string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
}

function messageContentToText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function appendSystemRules(
  content: AgentMessage["content"],
  rules: string,
): AgentMessage["content"] {
  if (!rules.trim()) return content;
  if (typeof content === "string") return [content, rules].filter(Boolean).join("\n\n");
  return [...content, { type: "text", text: rules }];
}

function persistOutlineConversationContextUsage(input: {
  conversationId: string
  windowTokens: number
  systemPrompt: string
  contextHubResult?: ContextHubResult | null
  historyMessages?: Array<{ content: string }>
  currentInput?: string
  usage?: LlmUsage
}): void {
  useOutlineChatStore.getState().setConversationContextUsage(
    input.conversationId,
    calibrateContextUsageSnapshot(
      buildContextUsageSnapshot({
        windowTokens: input.windowTokens,
        softwareRules: input.systemPrompt,
        stableTokens: input.contextHubResult?.stats.stableTokens,
        summaryTokens: input.contextHubResult?.stats.summaryTokens,
        dynamicTokens: input.contextHubResult?.stats.dynamicTokens,
        historyTexts: (input.historyMessages ?? []).map((message) => message.content),
        currentInput: input.currentInput,
      }),
      input.usage,
    ),
  );
}

const OUTLINE_CHAT_SKILL_ROUTES = [
  "outline",
  "setting",
  "character",
  "worldbuilding",
  "faction",
  "foreshadowing",
  "map",
  "topic",
] as const;

function prioritizeOutlineSkills(
  skills: UserSkill[],
  preferredSkillNames: string[] = [],
): UserSkill[] {
  if (preferredSkillNames.length === 0) return skills;
  const preferredIndex = new Map(
    preferredSkillNames.map((name, index) => [name, index]),
  );
  return skills
    .map((skill) =>
      preferredIndex.has(skill.name)
        ? { ...skill, priority: 1, tags: [...skill.tags, "本次优先"] }
        : skill,
    )
    .sort((left, right) => {
      const leftIndex = preferredIndex.get(left.name);
      const rightIndex = preferredIndex.get(right.name);
      if (leftIndex !== undefined && rightIndex !== undefined) {
        return leftIndex - rightIndex;
      }
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return 0;
    });
}

function referenceCategoryLabel(category: ReferenceToken["category"]): string {
  switch (category) {
    case "chapter":
      return "章节";
    case "memory":
      return "记忆";
    case "outline":
      return "大纲";
    case "deduction":
      return "推演";
    case "chat_history":
      return "AI会话";
    case "outline_history":
      return "AI大纲";
    case "skill":
      return "技能";
    default:
      return "引用";
  }
}

function describeReferenceForOutlineAgent(
  token: ReferenceToken,
  index: number,
): string {
  const parts = [
    `${index + 1}. 类型：${referenceCategoryLabel(token.category)}`,
    `标题：${token.title || token.displayTitle}`,
  ];
  if (token.path) parts.push(`路径：${token.path}`);
  if (token.conversationId) parts.push(`会话ID：${token.conversationId}`);
  if (token.skillId) parts.push(`技能ID：${token.skillId}`);
  return parts.join("；");
}

function buildOutlineAgentUserContent(
  text: string,
  tokens: ReferenceToken[],
): string {
  if (tokens.length === 0) return text;
  return [
    text,
    "",
    "## 本条消息附带的 @ 引用",
    "请优先使用工具读取引用内容，不要只根据标题猜测。章节用 read_chapter，大纲用 read_outline，记忆用 read_memory，推演用 read_deduction，AI会话用 read_chat_history，AI大纲历史用 read_outline_history。",
    ...tokens.map(describeReferenceForOutlineAgent),
  ].join("\n");
}

function isOutlineOutputTruncated(error?: Error | null): boolean {
  const message = error?.message ?? "";
  return message.includes(OUTPUT_TRUNCATED_ERROR_MARKER) || message.includes("最大输出 token");
}

const OUTLINE_WORKFLOW_MODE_OPTIONS: Array<{
  mode: OutlineWorkflowMode;
  label: string;
  description: string;
  routeDescription: string;
}> = [
  {
    mode: "fast",
    label: "快速",
    description: "普通对话",
    routeDescription: "快速模式像普通对话一样直接出结果，可读取必要上下文，但不走意图分析、多 Agent 和强制需求分析。",
  },
  {
    mode: "standard",
    label: "标准",
    description: "完整工作流",
    routeDescription: "先做意图分析或向导多 Agent，再生成可保存的大纲，并保留澄清与分步生成。",
  },
  {
    mode: "plan",
    label: "计划",
    description: "先问后写",
    routeDescription: "先按大纲结构盘点要素，缺口用选项追问补齐，再生成计划并等你确认后才开始写。",
  },
  {
    mode: "discuss",
    label: "共创",
    description: "边聊边定",
    routeDescription: "把 AI 当责编来回讨论：每轮给出判断、抛出需要你决策的分歧点和它自己的倾向，等你说定稿才输出正文。",
  },
];

/** 只在模型自己建议拆成两章章纲时补写第 2 章章纲，不改其他范围规则。 */
const TWO_CHAPTER_OUTLINE_SUGGESTION_RULE =
  "如果你在本轮或上一轮主动建议分成两章章纲，这次章纲生成必须按完整流程写出这两章章纲，各一份，后一章章纲承接前一章章纲的钩子。「下一章交接」不能代替第 2 章章纲，不要等用户再说「连续生成」。用户拒绝该建议、建议不是两章章纲、或明确只要一章时，不要应用这条。";

export function buildOutlineAgentSystemPrompt(options: {
  projectName?: string;
  webResearchContext?: string;
  soulDoc?: string;
  mode?: OutlineWorkflowMode;
  /** 计划模式的目标模块；只有在要素盘点轮才传，正文生成轮不传。 */
  planModule?: string;
  /** 共创模式的目标模块；只有在讨论轮才传，定稿后的正文生成轮不传。 */
  discussModule?: string;
}): string {
  const mode = resolveOutlineWorkflowMode(options.mode);
  const discussTurn = Boolean(options.discussModule);
  const protocolTurn = Boolean(options.planModule || options.discussModule);
  /** 只读与分析纪律：所有模式共用。 */
  const sharedReadRules = [
    "你必须通过可用工具读取项目大纲、章节、记忆、推演结果和历史对话后，再进行分析、回答、生成或修改建议。",
    "不要假设引用内容已经注入上下文；不要跳过工具直接空泛回答。",
    "回答必须基于已读取内容进行分析，说明关键判断依据。",
    "## AI大纲固定分析流程",
    "1. 先调用 list_outlines、list_chapters、list_memories、list_deductions 确认可用资料范围。",
    "2. 再调用 read_outline、read_chapter、read_memory、read_deduction 读取用户 @ 引用和相关项目内容。",
    "3. 分析冲突、缺口、伏笔、角色动机和章节承接，明确哪些判断来自已读取资料。",
    "4. 最后再生成大纲建议；没有完成读取和分析前，不要直接给出结论。",
  ];
  /**
   * 生成工作流规则：**只有真的要产出正文的模式才带上**。
   *
   * 共创讨论轮必须排除它 —— 这一段讲的是「先出方案、确认后生成、生成后列写回清单」，
   * 与讨论轮「禁止生成完整正文、必须输出 outline_discuss 协议」直接冲突。
   * 两套契约同时出现时，模型会挑生成那套照做，于是整轮被闸门判死
   * （实测故障：模型返回了完整卷纲 + 写回清单，却没有任何 outline_discuss 块）。
   */
  const sharedGenerationWorkflowRules = [
    "## AI大纲生成工作流",
    "固定向导提交的小说生成需求必须先进入“需求分析/生成方案”阶段：先判断缺失信息，信息足够时只输出生成方案、文件清单、保存位置和生成顺序，并询问用户是否确认开始生成；用户确认前不得生成完整文件，不得调用保存工具。",
    "需求分析必须执行充分性闸门：缺少篇幅、频道、题材、故事灵感、核心卖点、作品规模、主要人物方向、世界观/背景方向或预期章节结构时，只追问最关键缺口。",
    "长篇小说必须先卷后章：先形成核心设定、总纲、卷节拍表、卷时间线和卷纲，再生成章纲；不得从灵感直接跳到全书章纲。",
    "章纲采用滚动章纲方式：优先生成前 10 章或用户指定范围，后续依据已确认章纲继续补齐，避免一次性生成整本导致承接断裂。",
    "生成章纲后必须列出新增设定写回清单，包含新增角色、势力、世界观规则、伏笔、地图地点和状态变化；用户确认前不得写入设定文件。",
  ];
  const sharedAnalysisRules = [...sharedReadRules, ...sharedGenerationWorkflowRules];
  const workflowRules = mode === "fast"
    ? [
      "快速模式下像普通对话一样直接出结果。可以按需读取必要上下文，但不要主动进入需求分析、意图分析或多 Agent 编排。",
      "用户要求生成或修改大纲时，直接输出可保存的大纲正文；不要先追问方案或等待确认才开始写。",
      TWO_CHAPTER_OUTLINE_SUGGESTION_RULE,
    ]
    : mode === "discuss"
    ? discussTurn
      ? [
        ...sharedReadRules,
        "## 共创讨论模式总则",
        "本模式是责编和作者围绕大纲来回讨论，不是一次性交付。未经作者确认定稿前，不要输出完整大纲正文，也不要输出 outlineSaveRequest 保存请求。",
        "禁止输出 intent_clarity 和 outline_plan 协议块。",
        "必须输出 outline_discuss 协议块；卡片认这个协议，正文里只留关键判断和下一步建议。",
        "每轮回复必须包含三部分：1）你基于已读取资料得出的关键判断和依据；2）1-3 个需要作者拍板的具体分歧点，每个都要给出可选方案、你自己的倾向和理由；3）一句下一步建议。",
        "抛出分歧点时必须给出具体可选方案，禁止只抛开放式问题让作者自己想；禁止用「你希望怎么写」这类空问题占位。",
        "资料已经足够、确实没有需要拍板的分歧时，直接说明为什么可以开写，并请作者确认定稿，不要为了提问而提问。",
        "作者明确要求「先直接给我一版」时可以给出草案，但草案之后仍要列出你认为需要继续讨论的点。",
        buildOutlineDiscussPhaseSystemRules(options.discussModule || "大纲"),
      ]
      : [
        ...sharedAnalysisRules,
        "## 共创讨论模式总则",
        "作者已经确认定稿。本轮只输出完整可保存正文并附加保存请求。",
        "禁止输出 intent_clarity、outline_plan 和 outline_discuss 协议块。",
      ]
    : mode === "plan"
    ? [
      ...sharedAnalysisRules,
      "## 计划模式总则",
      "计划模式不做意图清晰度分析，禁止输出 intent_clarity。要素齐备并经用户确认生成计划后，才允许生成大纲正文。",
      ...(options.planModule
        ? [buildOutlinePlanPhaseSystemRules(
          options.planModule,
          getOutlinePlanRequiredElements(options.planModule),
        )]
        : []),
    ]
    : [
      ...sharedAnalysisRules,
      "## 意图清晰度分析阶段",
      "仅当系统明确标记本轮为“意图分析”时，才输出 intent_clarity；正文生成阶段严禁再次输出该标记。",
      "当本轮为意图分析时：",
      "1. 调用 list_outlines、list_chapters、read_outline 读取已有资料",
      "2. 判断用户意图是否清晰（能否确定具体生成范围）",
      "3. 严格输出以下完整协议块：",
      "<!-- intent_clarity -->",
      '{"clarity":"clear|needs_input","module":"模块名","analysis":"判断依据","detectedScope":"明确范围","missingItems":[],"options":[{"id":"A","label":"具体范围","description":"现状与依据"}],"question":""}',
      "<!-- /intent_clarity -->",
      "开闭标记必须成对出现；字段名必须使用 clarity，禁止使用 status。JSON 必须完整且可解析。",
      "4. clear 时：只输出 JSON，不生成正文，等待系统自动注入生成指令",
      "5. needs_input 时：只输出 JSON，question 问清楚要哪一个，options 列出具体的候选范围",
      "options 必须是能直接执行的具体对象（如具体卷次、具体章节区间），取自刚读到的资料，最多 6 个",
      "严禁把候选塞进 missingItems 而让 options 为空：options 为空视为格式错误",
      "严禁输出「全部缺失项生成」「基于已有内容推断」「最近范围生成」这类抽象策略；「自定义」由系统自动追加，不要自己输出",
      "用户选择或回复后，直接进入生成流程，不再二次分析。",
    ];
  const appliedWorkflowRules = mode !== "fast" && !discussTurn
    ? [...workflowRules, TWO_CHAPTER_OUTLINE_SUGGESTION_RULE]
    : workflowRules;
  return [
    "你是专业小说大纲分析与创作助手。",
    "如果用户提供 @ 引用，必须优先按路径、标题或会话ID调用对应读取工具获取正文内容。",
    // 讨论轮不提保存请求：它的产出是「待拍板的分歧点」，提保存只会诱导模型直接交付正文。
    ...(discussTurn ? [] : [
      "需要保存大纲时只输出 outlineSaveRequest 或 outlineSaveRequests JSON 块，禁止调用 write_outline_node；系统解析后弹出确认，用户确认后才写入文件。",
    ]),
    ...appliedWorkflowRules,
    "",
    // 协议轮只允许输出对应协议块，不能再要求附加下一步推荐
    ...(protocolTurn ? [] : [
      "## 下一步推荐输出",
      "生成完成后，在回复末尾附加 <!-- next_step --> JSON 标记块。",
      "推荐方向仅限大纲体系内（人物小传、组织势力、力量体系等），严禁推荐正文生成。",
      "必须包含一个 id 为 D 的自定义选项。",
    ]),
    ...(mode === "fast" || protocolTurn ? [] : [
      "## 主动性要求",
      "读完资料后如果发现剧情矛盾、人物动机站不住、卖点不足、伏笔无法回收或结构失衡，必须主动指出，不要沉默照做。",
      "每轮最多提出 1 条对用户已有设定的质疑，且必须同时给出替代方案和这样改的代价；没有发现真实问题时不要为了质疑而质疑。",
      "指出问题时先给结论，再给依据，再给你建议的改法；禁止只否定不给方案。",
      "如果系统标记本轮为意图分析或要素盘点，本节不适用，仍然只输出对应协议块。",
    ]),
    ...(mode === "fast" || discussTurn ? [] : [
      "当用户要求生成、完善或续写任何大纲分项时，必须按 PRD 3.1 主流程执行：提取请求关键词，识别用户意图，按意图读取资料，提取对小说创作有用的关键内容，结合用户要用的 skill + soul.md 约束生成内容，再做结果强约束收敛。",
    ]),
    "关键内容提取必须服务于小说创作：只保留能帮助用户继续写小说的信息，例如章节目标、冲突推进、人物动机、伏笔状态、设定限制、时间线承接和结尾钩子。",
    // 章纲结构硬要求属于「产出正文」的契约，讨论轮带上会让模型直接开写章纲。
    ...(discussTurn ? [] : [
      "生成章纲时必须使用章纲标准结构：基础信息、上层依据、本章目标、核心事件、场景顺序、结构节点、章首钩子、爽点设计、章尾钩子、执行约束、人物状态、伏笔与追踪、待写回设定、写作约束、AI写作提示。核心事件不少于6条，场景顺序为2-4个场景。",
      "结构节点必须包含 CBN、CPNs、CEN；CEN 必须能承接下一章 CBN。执行约束必须包含必须覆盖节点和本章禁区。基础信息必须包含时间锚点、章内时间跨度和与上章时间差。",
    ]),
    "Markdown 格式约束：结构化资料使用一级标题，** 必须成对，不要用代码围栏包裹全文，已有表格必须保留合法分隔行。",
    // ⚠️ 整段（标题 + 正文）都要在 discussTurn 时排除。
    // 这里曾经只把「## Markdown 格式强制要求」这个**标题**放进排除数组，
    // 正文却留在数组外面，于是讨论轮的提示词里仍然出现
    // 「所有大纲正文必须使用标准 Markdown 格式输出」和整段大纲示例 ——
    // 一边要求「禁止输出完整大纲正文」，一边给了正文格式规范与范例。
    ...(discussTurn ? [] : [
    "## AI 大纲输出协议",
    "当本轮生成了可保存的大纲、卷纲、章纲、人物、设定、伏笔、组织或质量检查内容时，最终回复末尾必须附加一个 json 代码块，顶层字段为 outlineSaveRequest 或 outlineSaveRequests。",
    "保存请求必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent、content。fileName 必须是 .md 文件，targetFolder 必须是相对路径（仅文件夹名，如「大纲」「人物小传」「章纲」「设定」「伏笔」「组织」「质量检查」「卷纲」），禁止使用绝对路径（如 C:\\... 或 /Users/...）。",
    "fileType 只能使用以下英文枚举值（禁止使用中文）：outline（大纲）、volume-outline（卷纲）、chapter-outline（章纲）、character（人物小传）、setting（设定）、foreshadowing（伏笔）、organization（组织）、quality-report（质量检查）。",
    "writeMode 只能使用以下英文枚举值（禁止使用其他值）：create（新建文件）、append（追加到已有文件末尾）、replace（替换已有文件全部内容，需用户确认）、patch（局部修改，需用户确认）。禁止使用 overwrite、write、save 等其他值。",
    "content 字段强制要求：每个 outlineSaveRequest 必须包含完整 Markdown content，这是最终写入文件的正文。禁止省略 content；禁止只输出确认摘要或下一步推荐却声称已保存。多章时每个章节一个独立 request，各自携带完整章纲 content。",
    "文件名规范：不同类型内容必须使用不同文件名，禁止多项内容写入同一文件。不同角色必须每人一个独立文件（如 角色-主角林风.md、角色-反官方傲.md），严禁将所有角色塞入「角色卡.md」或同一文件。不同势力、不同伏笔、不同卷纲、不同章纲也必须各自独立文件。",
    "内容完整性强制要求：你必须为每个生成的大纲模块都创建对应的保存请求（outlineSaveRequest），不能遗漏。如果生成了多个模块，使用 outlineSaveRequests 数组，每个模块一个请求对象。系统不会静默写入；用户确认后才会落盘。",
    "## Markdown 格式强制要求",
    "所有大纲正文必须使用标准 Markdown 格式输出，严格遵循以下标题层级规范：",
    "- 一级大标题（如全书核心设定、主要人物设定、分卷大纲等）使用 # 标记，独占一行",
    "- 二级分类标题（如核心主角、核心配角、第一卷、第二卷等）使用 ## 标记，独占一行",
    "- 三级子标题（如具体人物名、具体章节名等）使用 ### 标记，独占一行",
    "- 列表项使用 - 或 * 开头",
    "- 重要属性使用 **粗体** 标注（如 **年龄：**、**身份：**、**核心技能：**）",
    "- 禁止使用中文编号（如一、二、三、（一）（二）（三）、1. 2. 3.）作为标题格式，必须用 #、##、### 标记标题层级",
    "示例：",
    "# 五、主要人物设定",
    "## 核心主角",
    "### 林风（字子墨）",
    "- **年龄：** 17岁（穿越前为21世纪普通大学生）",
    "- **身份：** 穿越者→清水村村民→清水社首领→异姓王→隐士",
    "- **核心技能：** 高中/大学化学知识（有机/无机化学基础）、物理常识、急救知识",
    "- **性格：** 表面冷漠实则心软，前期被动应对，中后期主动布局",
    ]),
    "## 输出边界（按本轮性质区分）",
    ...(discussTurn ? [] : [
    "当本轮要交付可保存的大纲正文时：最终回复只输出大纲标题和大纲正文；如果内容需要保存，末尾附加 AI 大纲输出协议 JSON 保存块（含 content）。禁止输出工具调用报告、分析过程、完成报告、下一步行动、无法直接保存的大段说明。",
    ]),
    "当本轮是讨论、答疑、方案对比、澄清或提出异议时：允许并鼓励输出你的判断、依据、疑问和方案对比，不要用「只输出正文」的规则压制讨论；此时仍然禁止输出工具调用报告和流程完成报告。",
    mode === "fast"
      ? "工具调用过程只应展示在工具调用 UI 中，不要混入最终正文。不要用流程说明冒充生成结果。"
      : "工具调用过程只应展示在工具调用 UI 中，不要混入最终正文。资料不足以生成完整正文时，先提出最少必要澄清问题，不要用流程说明冒充生成结果。",
    "所有面向用户的回复必须使用中文。",
    options.projectName ? `当前项目：${options.projectName}` : "",
    options.soulDoc?.trim() ? `## 作品灵魂与总则\n${options.soulDoc}` : "",
    options.webResearchContext?.trim()
      ? `## 用户明确要求检索的网页资料\n${options.webResearchContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 共创讨论轮里，模型偶尔不按讨论协议走，而是**直接交付一份完整大纲**
 * （MD 正文 + ```json 的 volumeOutlineData/chapterOutlineData + outlineSaveRequest）。
 *
 * 这时不能把整轮判成「未返回 outline_discuss 协议块」作废：那份正文和结构化数据
 * 是模型真正生成的内容，判死等于把它们一起丢掉，用户只能在气泡里看到一坨 JSON 源码
 * （结构化数据既没被提取成折叠树/卡片，也没进保存确认链路）。
 *
 * 所以先判定「本轮是否其实已经交付了可保存大纲」：
 * - 带 outlineSaveRequest(s) → 是交付；
 * - 解析得出 volumeOutlineData（卷纲结构化数据）→ 是交付；
 * - 正文本身像一份可保存大纲（isSaveableOutlineDeliverable）→ 是交付。
 *
 * 命中则按生成轮处理（正文照常显示、结构化数据进保存链路），
 * 只有真的只是讨论而没有交付内容时，才继续要求 outline_discuss 协议。
 * 回复里出现了 outline_discuss 标记就一定是讨论轮：正文以「# 卷纲」开头这类
 * 启发式命中也不能把协议块绕过去。
 */
function isDiscussDeliveredOutline(content: string): boolean {
  if (!content.trim()) return false;
  if (parseOutlineDiscussProtocol(content).kind !== "none") return false;
  if (parseOutlineSaveRequests(content).requests.length > 0) return true;
  if (extractVolumeOutlineData(content)) return true;
  /*
   * 章纲分批产出（chapterOutlineBatch）**不带** outlineSaveRequest —— 保存请求由软件在
   * 最后一批之后合并生成。结构化-only 之后正文也空了，上面三条判据全落空，
   * 于是「讨论轮里模型直接交付了章纲」会被判成"没交付"，回答被丢弃后重新要求它讲协议。
   * 分批数据同样是一份真交付，这里必须认。
   */
  if (extractChapterOutlineBatch(content)) return true;
  return isSaveableOutlineDeliverable(content);
}

/**
 * 只返回了结构化数据（没有 MD 正文）时，气泡里给一句可读的交代。
 *
 * 卷纲/章纲从 4.3.6 起不再让模型重复写一遍 MD —— 气泡里的正文因此会变成空，
 * 用户只看到一团被清掉的 JSON 围栏。这里用数据本身算出统计，告诉他生成成功了、
 * 有多少内容、去哪里看。文字由软件生成，不占模型输出。
 */
export function describeStructuredOnlyAnswer(raw: string): string {
  const volume = extractVolumeOutlineData(raw)
  if (volume) {
    const stages = volume.stories.reduce((sum, story) => sum + story.st.length, 0)
    return `已生成卷纲《${volume.title}》：${volume.stories.length} 个故事、${stages} 个环节。正文与折叠树由软件从结构化数据生成，可在下方保存为 .md / .html。`
  }
  const chapter = extractChapterOutlineData(raw)
  if (chapter) {
    const numbers = chapter.chapters.map((item) => item.n).sort((a, b) => a - b)
    const range = numbers.length > 1 ? `第 ${numbers[0]}–${numbers[numbers.length - 1]} 章` : `第 ${numbers[0] ?? 1} 章`
    /*
     * 节数按**实际产出的 .md** 数，不写死 17。
     *
     * 反推会跳过全空的分区（模型少给几节就少几节）。写死「每章 17 节」等于替软件
     * 保证了一件没发生的事：用户打开 .md 只有 8 节，第一反应是「软件把内容吞了」，
     * 而数据本来就只有这些。全部写满时文案与旧版逐字相同。
     */
    const sectionCounts = chapter.chapters.map(
      (item) => (renderChapterOutlineMarkdown({ ...chapter, chapters: [item] }).match(/^### /gm) ?? []).length,
    )
    const minSections = Math.min(...sectionCounts)
    const maxSections = Math.max(...sectionCounts)
    const sectionsNote = sectionCounts.length === 0 || minSections === 0
      ? ""
      : minSections === maxSections
        ? `，每章 ${minSections} 节`
        : `，每章 ${minSections}–${maxSections} 节`
    return `已生成章纲 ${range}（共 ${chapter.chapters.length} 章${sectionsNote}）。正文与卡片流由软件从结构化数据生成。`
  }
  /*
   * 事件细纲同样从 2026-10-18 起只收结构化数据（`eventOutlineData`）。
   * 它的围栏被 `extractBodyContent` 剥掉之后气泡就空了 —— 主对话那边由
   * `chat-message` 用 `renderEventOutlineMarkdown` 补正文，大纲面板没有那条腿，
   * 于是同一条细纲回复在「章节区」有完整正文、在「大纲面板」只剩一张空消息 + 卡片。
   * 这里补一句统计交代，与其余结构化-only 产线口径一致。
   */
  const eventOutline = extractEventOutlineData(raw)
  if (eventOutline) {
    const count = eventOutline.events.length
    const budget = eventOutline.targetWords > 0 ? `，目标约 ${eventOutline.targetWords} 字` : ""
    return `已生成第 ${eventOutline.chapterNumber} 章事件细纲：${count} 个事件${budget}。正文与细纲卡片由软件从结构化数据生成。`
  }
  const profiles = extractCharacterProfiles(raw)
  if (profiles.length > 0) {
    const sections = profiles.reduce((sum, profile) => sum + profile.sections.length, 0)
    const names = profiles.slice(0, 3).map((profile) => profile.name).join("、")
    const suffix = profiles.length > 3 ? "…" : ""
    const subject = profiles.length > 1
      ? `${profiles.length} 个角色（${names}${suffix}）`
      : `角色《${profiles[0].name}》`
    return `已生成${subject}的人物小传，共 ${sections} 个分区。正文与角色卡由软件从结构化数据生成，可在下方保存为 .md / .html。`
  }
  /*
   * 其余七类设定同样只收结构化数据（2026-10-18 起），气泡必须给一句可读的交代，
   * 否则用户看到的是一条空消息 —— 明明生成了内容，界面上却什么都没有。
   *
   * ⚠️ 必须**聚合全部命中的类别**，不能命中第一类就 return：「一键生成全部设定」
   * 那一轮里，同一条回复经常同时带力量体系与地点设定（八类共用 fileType=setting，
   * 批量产出是常态）。旧写法在第一类上直接返回，气泡只报「已生成 3 份力量体系」，
   * 地点那几份一个都不提 —— 用户以为软件漏做了，实际只是没报数
   * （`attachSettingFamilyHtml` 那边早就得按文件名二次配对，也是同一批回复）。
   */
  const settingFamilies: Array<{ label: string; extract: (text: string) => Array<{ name: string; sections: unknown[] }> }> = [
    { label: "势力档案", extract: extractFactionProfiles },
    { label: "力量体系", extract: extractPowerProfiles },
    { label: "金手指", extract: extractGoldenFingerProfiles },
    { label: "背景设定", extract: extractBackgroundProfiles },
    { label: "地理设定", extract: extractGeographyProfiles },
    { label: "地点设定", extract: extractLocationProfiles },
    { label: "伏笔计划", extract: extractForeshadowingProfiles },
  ]
  const familySummaries: string[] = []
  for (const family of settingFamilies) {
    const docs = family.extract(raw)
    if (docs.length === 0) continue
    const sections = docs.reduce((sum, doc) => sum + doc.sections.length, 0)
    const names = docs.slice(0, 3).map((doc) => doc.name).join("、")
    const suffix = docs.length > 3 ? "…" : ""
    const subject = docs.length > 1
      ? `${docs.length} 份${family.label}（${names}${suffix}）`
      : `${family.label}《${docs[0].name}》`
    familySummaries.push(`${subject}，共 ${sections} 个分区`)
  }
  if (familySummaries.length > 0) {
    // 单类时这一句与旧文案逐字相同（只有一类命中时 `join` 不引入任何分隔符之外的变化）。
    return `已生成${familySummaries.join("；")}。正文与卡片由软件从结构化数据生成，可在下方保存为 .md / .html。`
  }
  return ""
}

/**
 * 剥掉数据围栏后剩下的文字，是否只是「已生成…」这类交代语。
 *
 * 提示词允许模型在围栏外留一句说明，而气泡的内容判定如果只写「剥完还有没有字」，
 * 那句话就会顶掉 `describeStructuredOnlyAnswer` 的统计交代 —— 用户看到的是
 * 「好的，已按折叠树生成卷一。」这种一句话回复，明明生成了 10 个故事却什么都不显示。
 *
 * 判据只看形状（没有标题行 + 去掉空白极短），不认关键词：一份真交付的大纲
 * 必然带 `#`/`##` 标题且远超 80 字，而交代语换个说法也逃离不了长度限制。
 */
export function looksLikeOutlineDeliveryNote(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true
  if (/^#{1,6}\s/m.test(trimmed)) return false
  return trimmed.replace(/\s+/g, "").length <= 80
}

function getOutlineSectionOutputRules(title: string): string {
  if (title.includes("卷纲")) {
    return [
      "【载体】只产出两部分，缺一不可：",
      "(1) 一个 ```json 围栏，顶层字段为 volumeOutlineData（10 个故事 × 10 个环节的结构化数据）；",
      '(2) outlineSaveRequest（content 写空字符串 ""，软件会用结构化数据自动生成 MD 与 HTML）。',
      "**不要再手写一遍 MD 正文**：MD 里的每个字都能从结构化数据原样得到，重复写一遍等于让用户为同一份内容付两遍钱。",
      "**不要自己写 HTML/CSS/标签**——软件会套模板渲染折叠树。",
      "",
      "【只要故事，不要台账】卷纲只回答一件事：这卷发生了哪些故事、每个故事怎么推进。",
      "禁止输出（写了软件也不显示，纯烧 token）：卷级定位（卷定位 / 主题句 / 叙事形态 / 结构选用 / 建议章数 / 卷末落点）、角色索引、地点索引、伏笔追踪表、悬念债务、对手推进表、人物成长表、整卷账本、期待感曲线、反转类型分布、支线推进矩阵、节拍体检、环节完整性矩阵、任何评分与统计。",
      "",
      "【结构硬要求】",
      "1. stories 必须写满 10 个故事对象，一个都不能少；每个故事只有 `id` / `range` / `title` / `st` 四个字段（可选 `beats`）；",
      "2. range 是该故事覆盖的章号范围（如「第 1–12 章」）；title 是这个故事的名字；",
      "3. st 必须写满 10 个环节：起①起②起③承①承②承③转①转②合①合②，每个环节只有三个字段——",
      "   - stage：环节标识，值就写「起①」这种（**不要用 k / id / name 代替键名**）；",
      "   - label：该故事在这一步的具体小标题（如「沐浴昏死」），要具体，不要照抄环节名；",
      "   - who：这一步出场的人物（可带一句身份或功能）；",
      "   - p：3 条这个环节里**具体发生了什么**——写事件、动作、决定、代价、说出口的话，不要写「铺垫矛盾」「承上启下」「推动剧情」这类空话；",
      "4. 可选 beats：12 个字符的节拍串（平升起紧落缓升紧顶缓顶悬），章纲要靠它对齐，能写就写；",
      "5. 承③ 与 转① 不要用同一个反转。",
      "",
      "【禁止事项】禁止出现「…」「等等」「略」「参考上文」「其余同理」「此处省略」等缩写写法；禁止只写第 1 个和第 10 个故事；禁止输出方法论说明板块（10 环节表 / 8 期待感 / 7 反转库 / 8 情绪结构 / 叙事结构表 / 三层线表 / 12 章排布表）。",
      "【输出顺序】先写 ```json 的 volumeOutlineData，再写 outlineSaveRequest。",
      "【自检】输出前确认：故事数=10、每故事环节数=10、每环节 p 满 3 条且条条是具体事件、无省略号、承③≠转①。",
    ].join("\n");
  }
  if (title.includes("章节细纲") || title.includes("章纲") || title.includes("细纲")) {
    const skeletonReference = getVolumeSkeletonReference();
    return [
      "【载体】只产出两部分，缺一不可：",
      "(1) 一个 ```json 围栏，顶层字段为 chapterOutlineData（含 story 骨架 + chapters 数组）；",
      '(2) outlineSaveRequest（content 写空字符串 ""，软件会用结构化数据自动生成 MD 与 HTML）。',
      "**不要再手写一遍 MD 正文**（本分项已改为分批生成，17 节 MD 与 JSON 内容完全重复，写两遍就是让用户付两遍钱）。",
      "**不要自己写 HTML/CSS/标签**——软件会套模板渲染章纲卡片流。",
      "",
      "【每章 17 节硬要求】§1 基础信息 / §2 上章承接 / §3 本章定位 / §4 浓缩剧情 / §5 核心事件链 / §6 关键词与必要条件 / §7 四段式 / §8 情绪曲线 / §9 爽点与看点 / §10 关键信息与扩写方式 / §11 画面细节 / §12 伏笔与钩子 / §13 出场角色与状态变化 / §14 设定与道具更新 / §15 写作约束 / §16 下一章交接 / §17 写作检查清单，一节都不能少。",
      "",
      "【对齐补字段（每章必填）】stage（所属环节 起①~合②）、beat（本章节拍）、expect（本章主期待感，8 类之一）、time（章内时间）、place（主要地点）、seedFores / payFores（本章预埋 / 回收的伏笔名，多个用「、」分隔）。这七项必须与卷纲骨架逐字一致。",
      "",
      "【完整性硬要求】",
      "1. chapters 必须写满该故事的每一章，章号连续递增，禁止只写首尾章；",
      "2. story 骨架（index / name / range / beats）必须与卷纲一致，不得自创；",
      "3. §5 核心事件链必须 6 条以上，每条必须有 what/cause/action/result/use；",
      "4. §6 必要条件四类齐全（enter/trigger/interact/result）；",
      "5. §8 moodCurve 写满 4 个节点，§13 castChanges 至少 1 条；",
      "6. 各章节拍串起来必须与 story.beats 逐字一致，且遵守节拍纪律（不连续 3 章同拍、顶最多 2 连、顶后接落或缓、悬必须落在末章）；",
      "7. 第 N 章的 handover.nextStart 必须与第 N+1 章的 carry.hook / carry.left 呼应，章间不得断档；",
      "8. payFores 里的每一条都必须在本故事更早章节的 seedFores 出现过；",
      "9. 日常章只能落在 平/落/缓/悬 拍；逐章 info.words 合计与 words 偏差不超过 20%。",
      "10. 关键节不得留空：§8 moodCurve 写满 4 个节点；§10 expand 至少 1 条且含 info/how；§11 visual.env 与 visual.memory 必须有内容；§13 castChanges 至少 1 条；§14 worldUpdate 至少一项有内容（确无新增就写「无新增」）。",
      "11. §17 checks 必须覆盖 10 条固定项：三行内入戏 / 有明确变化 / 事件链有因果 / 有核心记忆点 / 有动作微细节 / 有爽点 / 回收旧信息 / 埋新信息 / 有追读钩子 / 已写明下一章交接。",
      "",
      "【分批输出（重要）】17 节标准体量大，一次写完整故事必被截断，因此**本次只写第 1 批**：从该故事的第 1 章起，连续 3 章（若该故事不足 3 章则写满为止）。",
      "分批规则：",
      "1. JSON 顶层字段固定为 `chapterOutlineBatch`（结构与 chapterOutlineData 相同：title / story 骨架 / words / chapters，chapters 只含本批章节）；",
      "2. 本批**不要**输出 outlineSaveRequest，也不要重复已完成的章节；软件会在最后一批之后自动合并并统一保存；",
      "3. 必须带上 story 骨架（index / name / range / beats）——软件据此计算剩余批次；",
      "4. 输出顺序：先写本批 ```json 围栏的 chapterOutlineBatch（**不要写 MD 正文**，正文由软件从数据生成）。",
      "",
      skeletonReference || "【卷纲骨架】项目里还没有可用的卷纲结构化数据（伴生 .json），story 骨架必须从卷纲 MD 原文逐字抄写，不得自创。",
      "",
      "【禁止事项】禁止出现「…」「等等」「略」「参考上文」「其余同理」「同上」「此处省略」等任何缩写写法；禁止输出方法论说明板块。",
      "【自检】输出前确认：本批章数正确、章号连续、17 节全写、事件链≥6 条有因果、四类必要条件齐全、节拍与骨架逐字一致、章间交接闭合。",
    ].join("\n");
  }
  // 设定类分项：由 SETTING_OUTLINE_SPECS 统一驱动，避免此处关键词与规格表漂移
  // （各分项有专属卡模板，走自己的结构化契约；未命中的才落到通用卡片流）
  const settingSpec = resolveSettingSpecByTitle(title);
  if (settingSpec) {
    switch (settingSpec.id) {
      case "characterBriefs":
        return buildCharacterProfileOutputRules();
      case "organizationsOutline":
        return buildFactionProfileOutputRules();
      case "powerSystem":
        return buildPowerSystemOutputRules();
      case "goldenFinger":
        return buildGoldenFingerOutputRules();
      case "backgroundSetting":
        return buildBackgroundOutputRules();
      case "geographySetting":
        return buildGeographyOutputRules();
      case "foreshadowingPlan":
        return buildForeshadowingOutputRules();
      case "locationsOutline":
        return buildLocationOutputRules();
      default:
        return buildSettingOutlineOutputRules(settingSpec);
    }
  }
  return "按可保存的大纲正文输出：标题清楚、条目完整、能直接指导后续小说写作。";
}

/** 人物小传专属输出规则：角色卡结构化数据 characterProfileData。 */
function buildCharacterProfileOutputRules(): string {
  return buildSettingProfileOutputRules("characterBriefs");
}

/** 组织势力专属输出规则：势力卡结构化数据 factionProfileData。 */
function buildFactionProfileOutputRules(): string {
  return buildSettingProfileOutputRules("organizationsOutline");
}

/** 力量体系专属输出规则：体系卡结构化数据 powerProfileData（等级阶梯 + 代价矩阵）。 */
function buildPowerSystemOutputRules(): string {
  return buildSettingProfileOutputRules("powerSystem");
}

/** 伏笔计划专属输出规则：伏笔台账结构化数据 foreshadowingProfileData（伏笔线 + 状态徽章）。 */
function buildForeshadowingOutputRules(): string {
  return buildSettingProfileOutputRules("foreshadowingPlan");
}

/** 金手指专属输出规则：能力卡结构化数据 goldenFingerProfileData（系统面板 + 边界代价）。 */
function buildGoldenFingerOutputRules(): string {
  return buildSettingProfileOutputRules("goldenFinger");
}

/** 地理设定专属输出规则：地理卡结构化数据 geographyProfileData（区域块 + 资源/危险）。 */
function buildGeographyOutputRules(): string {
  return buildSettingProfileOutputRules("geographySetting");
}

/** 地点设定专属输出规则：地点卡结构化数据 locationProfileData（空间规则 + 触发事件）。 */
function buildLocationOutputRules(): string {
  return buildSettingProfileOutputRules("locationsOutline");
}

/** 背景设定专属输出规则：背景卡结构化数据 backgroundProfileData（时间线 + 规则块）。 */
function buildBackgroundOutputRules(): string {
  return buildSettingProfileOutputRules("backgroundSetting");
}

/** 通用兜底输出规则（当分项未能匹配到专属模板时使用）。 */
function buildSettingOutlineOutputRules(spec: SettingOutlineSpec): string {
  const sectionLines = spec.sections
    .map((section, index) => `${index + 1}. ${section.heading}：${section.hint}`)
    .join("\n");
  return [
    "【载体】必须同时产出三部分，缺一不可：",
    `(1) MD 正文：${spec.title}的文本版；`,
    "(2) 一个 ```json 围栏，顶层字段为 settingOutlineData，结构如下：",
    '{"title":"' + spec.title + '","intro":"一句话概述","chips":["关键统计"],"cards":[{"badge":"定位/类别","title":"对象名称","subtitle":"一句话","tags":["标签"],"sections":[{"heading":"分区名","items":[{"label":"字段名","text":"内容"}]}]}]}',
    "    —— 每个对象一张 card；每张 card 必须写满下面列出的全部 sections；每条 item 尽量带 label（无字段名时用纯文本条目）。",
    "(3) outlineSaveRequest（content 为 MD 正文即可，fileType 用对应类型）。",
    "**不要自己写 HTML/CSS/标签**——软件会读取技能目录下的 setting-cards/template.html 自动渲染卡片流。",
    "",
    "【本类建议分区（每张 card 必须写全）】",
    sectionLines,
    "",
    "【完整性硬要求】",
    "1. 每个对象必须写满上面列出的所有分区，一个都不能少；",
    "2. 内容必须具体可执行，禁止出现「…」「等等」「略」「参考上文」「其余同理」「此处省略」等缩写写法；",
    "3. 若一次生成多个对象（多人 / 多组织 / 多能力），每个对象一张 card，内容互不重复；",
    "",
    "【输出顺序】先写 MD 正文，再写 ```json 的 settingOutlineData，最后写 outlineSaveRequest。",
  ].join("\n");
}

function renderOutlineCommandText(text: string) {
  const match = text.match(/^(\/[^\s]+)([\s\S]*)$/);
  if (!match || !OUTLINE_SECTION_GENERATION_CONFIGS.some((config) => `/${config.title}` === match[1])) {
    return text;
  }
  return (
    <>
      <span className="ui-test-outline-command">{match[1]}</span>
      {match[2]}
    </>
  );
}

function buildGenerationPrompt(
  title: string,
  requestHint: string,
  scope?: string,
  outputMode?: "per_chapter" | "per_item" | "single",
  originalRequest?: string,
): string {
  const isVolumeOutline = title.includes("卷纲");
  const isChapterOutline = title.includes("章节细纲") || title.includes("章纲") || title.includes("细纲");
  /*
   * 八类设定（人物小传 / 势力 / 力量 / 金手指 / 背景 / 地理 / 地点 / 伏笔）同样是
   * 结构化-only。这里必须自己判一次，不能只靠分项输出规则：`outputModeInstruction`
   * 排在那些规则**之后**，末尾一句「按可保存的大纲正文输出」会把它们整个盖掉
   * （模型倾向于听最后一句），结果又把 MD 写一遍 —— 正好是这次要省掉的那一半钱。
   */
  const isStructuredOnlySetting = Boolean(resolveSettingSpecByTitle(title));
  const outputModeInstruction = isVolumeOutline
    ? "本次为卷纲：只产出 (1) ```json 围栏的 volumeOutlineData（10 故事 × 10 环节全写满）；(2) outlineSaveRequest（content 留空字符串，软件会用它自动生成 MD 与 HTML）。不要再手写 MD 正文、不要自己写 HTML——重复写一遍等于让用户多付一倍钱。"
    : isChapterOutline
    ? "本次为章纲（分批）：只写第 1 批 3 章，只产出一个 ```json 围栏的 chapterOutlineBatch（story 骨架 + 本批章节的 17 节数据）；**不要写 MD 正文**（软件会用数据生成 MD 与 HTML 卡片流），本批不要输出 outlineSaveRequest——软件会自动继续下一批，并在最后一批之后合并渲染与统一保存。不要自己写 HTML，不要省略。"
    : outputMode === "per_chapter"
    ? "每个章节必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：第N章-章节标题.md。禁止将多个章节写入同一文件。"
    : outputMode === "per_item"
    ? "每个角色/势力/体系必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：名称.md。禁止将多个角色/势力写入同一文件。每个文件都会由软件套该分项专属模板额外渲染同名 HTML 卡（保存时可选择 HTML/MD），你无需自己写 HTML 或 MD。\n【单次体量硬限制】本次回复最多完整生成 1 个对象（结构化 JSON 与 outlineSaveRequest 都必须完整，content 留空字符串；禁止为省篇幅缩水）。若待生成对象超过 1 个，只输出第 1 个，并在回复结尾用一行注明「未完成：对象A、对象B、…」；用户回复「继续」后按同样规则生成下一批。宁可分批，不可截断。"
    : isStructuredOnlySetting
    ? "本次为设定分项：只产出一个 ```json 围栏的结构化数据（分区按上面的契约写全）与 outlineSaveRequest（content 留空字符串）。**不要写 MD 正文**、不要自己写 HTML/CSS——软件会把结构化数据一个字段不落地还原成 .md 并套专属模板渲染同名 HTML 卡；重复写一遍等于让用户多付一倍钱。"
    : "按可保存的大纲正文输出：标题清楚、条目完整、能直接指导后续小说写作。该分项会由软件套其专属模板额外渲染同名 HTML 卡（保存时可选择 HTML/MD），你无需自己写 HTML。";

  return [
    `请按「AI大纲生成工作流」生成「${title}」。`,
    originalRequest ? `\n## 原始用户请求\n${originalRequest}\n` : "",
    scope ? `\n## 已确认范围\n${scope}\n` : "",
    "## PRD 3.1 主流程要求",
    "本轮意图分析已经完成，直接使用已确认范围生成完整大纲正文；禁止再次输出 intent_clarity 标记，也不要重新进入意图分析。",
    "1. 提取请求关键词。2. 使用已确认范围。3. 读取资料。4. 提取关键内容。",
    "5. 结合 skill + soul.md 生成可直接保存的大纲正文。6. 结果强约束收敛。",
    "",
    "## 本分项内容要求",
    requestHint,
    getOutlineSectionOutputRules(title),
    "",
    "## 文件输出要求",
    outputModeInstruction,
    "",
    "如果资料足够，直接输出完整正文。",
    buildNextStepPromptSuffix(),
  ].join("\n");
}

/** 共创模式的开场 prompt：先讨论清楚要怎么写，定稿前不出正文。 */
function buildOutlineDiscussionPrompt(
  title: string,
  requestHint: string,
  originalRequest?: string,
): string {
  return [
    `本轮进入共创讨论，目标是和我一起把「${title}」讨论清楚，先不要交付正文。`,
    originalRequest ? `\n## 我的原始请求\n${originalRequest}\n` : "",
    "## 本轮要做的事",
    "1. 读取相关大纲、章节、设定和记忆，说明你实际看到了什么。",
    "2. 给出你对当前素材的关键判断：哪里够用、哪里有矛盾或缺口，各自的依据是什么。",
    "3. 抛出 1-3 个需要我拍板的具体分歧点，每个都给可选方案、你的倾向和理由。",
    "4. 最后给一句下一步建议。",
    "",
    "## 本分项内容要求（讨论时用来判断缺口，不是本轮的输出格式）",
    requestHint,
    getOutlineSectionOutputRules(title),
    "",
    "在我明确说定稿或开始生成之前，不要输出完整正文，也不要输出保存请求。",
  ].join("\n");
}

function buildOutlineWizardMultiAgentPrompt(request: OutlineWizardRequest): string {
  const basePrompt = buildOutlineWizardPrompt(request);
  const subAgentPlan = planOutlineSubAgents({
    preferredSkillNames: getOutlineWizardSkillNames(request),
    taskPrompt: basePrompt,
    maxConcurrency: 3,
  });

  return [
    basePrompt,
    "",
    "## 多 Agent 并行生成",
    "如果当前模型和环境支持多 Agent，请通过 runOutlineMultiAgentWorkflow 按以下子 Agent 计划并行生成；如果多 Agent 不支持、并发失败或合并失败，必须自动回退为单 Agent，不得中断用户流程。",
    "所有子 Agent 默认禁止写入文件，最终结果必须先进入中间编辑区预览，用户确认后再保存。",
    "",
    "## 子 Agent 计划",
    ...subAgentPlan.map((agent, index) => [
      `${index + 1}. ${agent.name}`,
      `   - 类型：${agent.kind}`,
      `   - Skill：${agent.skillNames.join("、") || "无"}`,
      "   - 写入权限：禁用",
    ].join("\n")),
    "",
    "## 回退规则",
    "多 Agent 并行生成不可用时，自动回退为单 Agent，继续使用同一份向导参数、引用内容和 Skill 路由。",
  ].join("\n");
}

function outlineToolCallsToSources(
  toolCalls: AgentRunRecord["toolCalls"],
): string[] {
  const sources: string[] = [];
  for (const call of toolCalls) {
    if (call.status !== "done") continue;
    const target =
      call.params.name ||
      call.params.path ||
      call.params.keyword ||
      call.params.conversationId ||
      call.params.conversationTitle;
    switch (call.name) {
      case "read_outline":
        sources.push(`大纲: ${String(target ?? "")}`.trim());
        break;
      case "read_chapter":
      case "search_chapters":
        sources.push(`章节: ${String(target ?? "")}`.trim());
        break;
      case "read_memory":
        sources.push(`记忆: ${String(target ?? "")}`.trim());
        break;
      case "read_deduction":
        sources.push(`推演: ${String(target ?? "")}`.trim());
        break;
      case "read_chat_history":
        sources.push(`AI会话: ${String(target ?? "")}`.trim());
        break;
      case "read_outline_history":
        sources.push(`AI大纲: ${String(target ?? "")}`.trim());
        break;
    }
  }
  return Array.from(new Set(sources.filter((source) => !source.endsWith(":"))));
}

/**
 * 卷纲「自动补全」的提示词。
 *
 * ⚠️ 必须复用**卷纲契约本身**（getOutlineSectionOutputRules），不能手写一份精简版要求。
 *
 * 实测故障（2026-10-09）：这里原先手写了一份要求清单，只要 pay / p / link /
 * position / roles / …，却漏掉了 stage / who / use / range / deliver / gift /
 * hook / climax / beats / line —— 而紧接着的校验器（validateVolumeOutlineData）
 * 恰恰要求这些。于是「自动补全」被要求产出的东西**永远不可能通过校验**：
 * 补一轮 → 仍报同样的问题 → 用户看到「卷纲内容仍不完整（138 项）」。
 * 这不是模型不听话，是提示词与校验器各说各话。
 *
 * 导出给测试用：防止将来又有人把这段改回手写清单。
 */
export function buildVolumeOutlineRepairPrompt(options: {
  fileName: string;
  problemsText: string;
}): string {
  return [
    "系统检测到上一轮卷纲内容不完整，无法渲染折叠树，问题如下：",
    `- ${options.fileName}：${options.problemsText}`,
    "请按下面的卷纲契约**完整重出这一卷**（是重新产出完整内容，不是解释、不是摘要、不是只补缺的那几项）：",
    getOutlineSectionOutputRules("卷纲"),
    "上一轮已经写对的部分也要一并重出，保证本卷能独立成文。禁止任何省略写法。",
  ].join("\n");
}

/**
 * 把保存前校验的问题挂到消息上，渲染在该条生成结果的下方。
 *
 * 背景：卷纲/章纲的结构化校验不阻止保存（用户仍可「保存当前内容」），
 * 但原先只弹一个持久 toast，把 100+ 条问题塞进一个带滚动条的小浮层里，
 * 既和生成结果脱节、又读不完。改为挂在消息上，明细可就地展开。
 */
function attachOutlineSaveReport(
  conversationId: string,
  messageId: string | undefined,
  report: OutlineSaveReport | null,
): void {
  if (!messageId) return;
  updateOutlineAssistantMessage(conversationId, messageId, (message) => ({
    ...message,
    outlineSaveReport: report ?? undefined,
  }));
}

function updateOutlineAssistantMessage(
  conversationId: string,
  messageId: string,
  updater: (message: OutlineChatMessage) => OutlineChatMessage,
): void {
  useOutlineChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      return {
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== messageId) return message
          const next = updater(message)
          return next.isAgentRunning === false && message.generationTiming && !message.generationTiming.finishedAt
            ? { ...next, generationTiming: { ...message.generationTiming, finishedAt: Date.now() } }
            : next
        }),
      };
    }),
  }));
}

function describeOutlineSubAgentTask(agent: OutlineSubAgentPlan): string {
  switch (agent.kind) {
    case "outline":
      return "负责总纲、主线结构、卷纲和章纲骨架。";
    case "topic":
      return "负责题材卖点、爽点节奏、频道期待和类型套路。";
    case "character":
      return "负责主要角色、配角、反派、人物关系和成长线。";
    case "setting":
      return "负责世界观、势力、地图、规则体系和关键设定。";
    case "foreshadowing":
      return "负责悬念、伏笔、误导信息和回收链路。";
    default:
      return agent.taskPrompt;
  }
}

function createOutlineMultiAgentRunState(
  plan: OutlineSubAgentPlan[],
  maxConcurrency: number,
): OutlineMultiAgentRunState {
  return {
    mode: "multi-agent",
    status: plan.length > 0 ? "running" : "fallback",
    maxConcurrency,
    agents: plan.map((agent) => ({
      id: agent.id,
      name: agent.name,
      kind: agent.kind,
      skillNames: agent.skillNames,
      taskPrompt: agent.taskPrompt || describeOutlineSubAgentTask(agent),
      dimension: agent.dimension,
      dependencies: agent.dependencies ?? [],
      priority: agent.priority,
      finalReview: agent.finalReview,
      status: "waiting",
    })),
    merge: {
      status: "pending",
      summary: "等待子 Agent 完成后合并。",
    },
  };
}

function updateOutlineMultiAgentRun(
  conversationId: string,
  messageId: string,
  updater: (run: OutlineMultiAgentRunState | undefined) => OutlineMultiAgentRunState | undefined,
  canApply: () => boolean = () => true,
): void {
  if (!canApply()) return;
  updateOutlineAssistantMessage(conversationId, messageId, (message) => ({
    ...message,
    multiAgentRun: updater(message.multiAgentRun),
  }));
}

function updateOutlineMultiAgentItem(
  conversationId: string,
  messageId: string,
  agentId: string,
  updater: (agent: OutlineMultiAgentRunState["agents"][number]) => OutlineMultiAgentRunState["agents"][number],
  canApply: () => boolean = () => true,
): void {
  updateOutlineMultiAgentRun(conversationId, messageId, (run) => {
    if (!run) return run;
    return {
      ...run,
      agents: run.agents.map((agent) => agent.id === agentId ? updater(agent) : agent),
    };
  }, canApply);
}

function updateOutlineToolCall(
  callId: string,
  updater: (call: ToolCallRecord) => ToolCallRecord,
): void {
  useOutlineChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (!message.agentToolCalls?.some((call) => call.id === callId)) {
          return message;
        }
        return {
          ...message,
          agentToolCalls: message.agentToolCalls.map((call) =>
            call.id === callId ? updater(call) : call,
          ),
          isAgentRunning: false,
        };
      }),
    })),
  }));
}

function formatOutlineConversationDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function buildFallbackCharacterDraftsFromRequests(
  requests: OutlineSaveRequest[],
): CharacterSaveDraft[] {
  return requests.map((request, index) => {
    const stem = request.fileName.replace(/\.md$/i, "");
    const parts = stem.split("-").filter(Boolean);
    const looksLikeRoleFile = parts[0] === "角色" && parts.length >= 3;
    const roleType = looksLikeRoleFile ? parts[1] : "角色";
    const characterName = looksLikeRoleFile ? parts.slice(2).join("-") : stem;
    return {
      id: `fallback:${index}:${request.fileName}`,
      characterName,
      roleType,
      fileName: request.fileName,
      content: request.content,
      selected: true,
      confidence: "low",
    };
  });
}

/**
 * 给人物草稿补上角色卡 HTML：优先匹配 AI 原文里的 characterProfileData/characterProfiles，
 * 匹配不到再从该草稿自己的 MD 正文解析（多 Agent 只出 MD 的场景）。
 * 这样「人物小传」的结构化契约才真正落到最终保存的 .html 上。
 */
function enrichCharacterDraftsWithHtml(
  drafts: CharacterSaveDraft[],
  sourceText?: string | null,
): CharacterSaveDraft[] {
  const profiles = extractCharacterProfiles(sourceText ?? "");
  return drafts.map((draft) => {
    if (draft.htmlContent?.trim()) return draft;
    const htmlContent = buildCharacterProfileHtmlForDraft({
      name: draft.characterName,
      content: draft.content,
      fileName: draft.fileName,
      profiles,
    });
    return htmlContent ? { ...draft, htmlContent } : draft;
  });
}

/** 识别 AI 输出中的 ```html 围栏（卷纲折叠树素材），默认折叠展示避免刷屏 */
function unwrapHtmlFence(children: ReactNode): { codeText: string } | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  if (typeof props?.className !== "string" || !props.className.includes("language-html")) {
    return null;
  }
  return { codeText: String(props.children ?? "").replace(/\n$/, "") };
}

function HtmlFenceBlock({ codeText }: { codeText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">HTML 版本已生成</span>
          <span>（保存时可选择 HTML 格式）</span>
        </span>
        <span>{open ? "收起" : "展开源码"}</span>
      </button>
      {open ? (
        <pre dir="ltr" className="overflow-x-auto bg-background/50 p-2 text-xs" style={{ textAlign: "left" }}>
          <code
            className="code-highlight"
            dangerouslySetInnerHTML={{ __html: highlightCode(codeText, "html") }}
          />
        </pre>
      ) : null}
    </div>
  );
}

function OutlineMarkdownContent({
  content,
  projectPath,
}: {
  content: string;
  projectPath: string | null;
}) {
  return (
    <div
      className="chat-markdown prose prose-sm max-w-none dark:prose-invert
        prose-p:my-1.5 prose-p:leading-relaxed
        prose-h1:text-xl prose-h1:font-bold prose-h1:mt-5 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-border
        prose-h2:text-lg prose-h2:font-semibold prose-h2:mt-4 prose-h2:mb-2
        prose-h3:text-base prose-h3:font-semibold prose-h3:mt-3 prose-h3:mb-1.5
        prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-2 prose-h4:mb-1
        prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-li:leading-relaxed
        prose-strong:font-semibold prose-strong:text-foreground
        prose-pre:my-2 prose-pre:p-3 prose-pre:rounded-md
        prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
        prose-table:text-xs prose-th:font-semibold
        prose-blockquote:border-l-4 prose-blockquote:border-primary/50 prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-muted-foreground
        break-words"
      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt, ...props }) => (
            <img
              src={
                typeof src === "string"
                  ? resolveMarkdownImageSrc(src, projectPath)
                  : undefined
              }
              alt={alt ?? ""}
              className="my-2 max-w-full rounded border border-border/40"
              loading="lazy"
              {...props}
            />
          ),
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto rounded border border-border">
              <table className="w-full border-collapse text-xs" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-border/80 px-3 py-1.5 text-start font-semibold bg-muted"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-border/60 px-3 py-1.5" {...props}>
              {children}
            </td>
          ),
          pre: ({ children, ...props }) => {
            const mermaid = unwrapMermaidPre(children);
            if (mermaid) return <>{mermaid}</>;
            const htmlFence = unwrapHtmlFence(children);
            if (htmlFence) return <HtmlFenceBlock codeText={htmlFence.codeText} />;
            return (
              <pre
                dir="ltr"
                className="rounded bg-background/50 p-2 text-xs overflow-x-auto"
                style={{ textAlign: "left" }}
                {...props}
              >
                {children}
              </pre>
            );
          },
          code: ({ className, children, ...props }) => {
            const lang = className?.replace("language-", "");
            const codeText = String(children).replace(/\n$/, "");
            if (lang === "mermaid") {
              return <MermaidDiagram code={codeText} />;
            }
            if (lang && lang !== "text" && lang !== "plain") {
              const highlighted = highlightCode(codeText, lang);
              return (
                <code
                  dir="ltr"
                  className={`${className ?? ""} code-highlight`}
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                  {...props}
                />
              );
            }
            return (
              <code dir="ltr" className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function OutlineAssistantMessage({
  msg,
  index,
  isStreaming,
  runStatusText,
  activeMessagesLength,
  copied,
  projectPath,
  onSaveAsOutline,
  onCopy,
  onRegenerate,
  onConfirmToolSave,
  onRejectTool,
  onSendMessage,
  onContinueIntentGeneration,
  onSubmitPlanAnswers,
  onConfirmPlan,
  onCancelPlan,
  onSubmitDiscussAnswers,
  onConfirmDiscuss,
  onResumeMultiAgent,
  onContinueStopped,
  onContinueFailed,
  resumeMultiAgentDisabled,
  nextStepDisabled,
  nextStepDisabledReason,
  generationContext,
  onFocusInput,
  hasEventOutline,
}: {
  msg: import("@/stores/outline-chat-store").OutlineChatMessage;
  index: number;
  isStreaming: boolean;
  runStatusText: string;
  activeMessagesLength: number;
  copied: string | null;
  projectPath: string | null;
  onSaveAsOutline: (content: string) => Promise<void>;
  onCopy: (content: string, id: string) => void;
  onRegenerate: (index: number) => Promise<void>;
  onConfirmToolSave: (call: ToolCallRecord & { preview?: string }) => void;
  onRejectTool: (call: ToolCallRecord & { preview?: string }) => void;
  onSendMessage: (text: string, options?: { intentPhase?: "intent_analysis" | "generation" | "waiting_user_input"; scope?: string }) => Promise<boolean>;
  onContinueIntentGeneration: (messageId: string, result: IntentClarityResult) => Promise<void>;
  onSubmitPlanAnswers: (
    messageId: string,
    protocol: OutlinePlanProtocol,
    answers: OutlinePlanAnswer[],
  ) => Promise<boolean>;
  onConfirmPlan: (
    messageId: string,
    protocol: OutlinePlanProtocol,
    planText: string,
  ) => Promise<boolean>;
  onCancelPlan: (messageId: string) => void;
  onSubmitDiscussAnswers: (
    messageId: string,
    protocol: OutlineDiscussProtocol,
    answers: OutlineDiscussAnswer[],
  ) => Promise<boolean>;
  onConfirmDiscuss: (messageId: string, protocol: OutlineDiscussProtocol) => Promise<boolean>;
  onResumeMultiAgent: (messageId: string) => Promise<void>;
  /**
   * 「继续」：上一条大纲回复被用户手动停止后，保留已生成内容接着往下写。
   * 与「重试」（onRegenerate，整条重发）配套，两个按钮由
   * novel/stopped-generation-actions 统一渲染。
   */
  onContinueStopped?: () => void;
  /**
   * 「继续」：上一条大纲回复**生成失败**后，保留已生成内容接着往下写。
   * 与停止那枚的区别只在提示词（失败有一种"什么都没产出"的形态）；
   * 显示条件来自 lib/novel/failed-generation.ts，两个面板共用同一判定。
   */
  onContinueFailed?: () => void;
  resumeMultiAgentDisabled: boolean;
  nextStepDisabled: boolean;
  nextStepDisabledReason?: string;
  generationContext: boolean;
  onFocusInput: () => void;
  /**
   * 这条消息本身是一份事件细纲。事件细纲只作为对话消息 + 卡片存在，
   * 不再写进 wiki/outlines/事件细纲/，所以「保存为大纲」按钮对它不渲染
   * （值由父组件按消息 id 一次算好传入，不在本组件里重复解析）。
   */
  hasEventOutline: boolean;
}) {
  const [editApplied, setEditApplied] = useState(false);
  const [editResults, setEditResults] = useState<
    import("@/lib/novel/agent-tools").FileEditResult[]
  >([]);
  const [editDismissed, setEditDismissed] = useState(false);

  // 消息内容是唯一内容通道；加载历史消息时也要防御旧版本已经落盘的
  // Gemini 普通文本思考摘要，避免再次展示或进入手动保存。
  const filteredDisplayContent = useMemo(
    () => filterOutlineGeneratedContent(msg.content),
    [msg.content],
  );
  const displayContent = filteredDisplayContent.reasoningOnly
    ? ""
    : filteredDisplayContent.content || msg.content;
  const { thinking, answer } = useMemo(
    () => separateThinking(displayContent),
    [displayContent],
  );
  const actionContent = answer || displayContent;
  const messageIsStreaming = isStreaming && index === activeMessagesLength - 1;
  /**
   * 上一条大纲回复是被用户手动停止的（正文结尾带着「已停止生成。」或
   * 「⚠️ 生成已停止，以上为已生成的内容。」）。判定收在
   * lib/novel/stopped-generation.ts 里，章节面板用的是同一份，两侧不会分歧。
   *
   * 只在最后一条、且这一轮已经跑完时成立：流式当中正文还没有收尾提示，
   * 翻出来的历史停止消息也不该再长出这两个按钮。
   */
  const isStoppedGeneration = !messageIsStreaming
    && index === activeMessagesLength - 1
    && isStoppedGenerationMessage(msg.content);
  /**
   * 这条大纲回复是**生成失败**的（正文结尾是 `生成失败：…`，或保留了半截内容
   * 之后的 `⚠️ 生成中断：…`）。判定收在 lib/novel/failed-generation.ts，
   * 章节面板用的是同一份。
   *
   * 与停止同一口径：只认最后一条、且这一轮已经跑完 —— 历史里失败过的消息
   * 不该再长出两枚"重来/接着写"的按钮，那些动作只在刚刚失败这一刻有意义。
   */
  const isFailedGeneration = !messageIsStreaming
    && index === activeMessagesLength - 1
    && !isStoppedGeneration
    && isFailedGenerationMessage(msg.content);
  /** 失败前是否真的写出了内容（决定「继续」可用还是禁用）。 */
  const canContinueFailed = hasFailedGenerationPartialContent(msg.content);
  // 轮播俏皮文案：整段生成期间始终显示，消解等待的枯燥感。
  const waitingHint = useWaitingHint(messageIsStreaming);
  // 文案并到闪烁光标那一行显示，不单独占一行。
  const waitingText = composeWaitingText({
    isStreaming: messageIsStreaming,
    hasContent: Boolean(msg.content),
    statusText: runStatusText,
    hint: waitingHint,
  });
  const intentProtocol = useMemo(
    () => parseIntentClarityProtocol(answer || displayContent),
    [answer, displayContent],
  );
  const intentProtocolError = !messageIsStreaming
    ? msg.intentProtocolError ?? (intentProtocol.kind === "invalid" && !msg.intentClarityResult
      // 补协议成功时消息上已有 intentClarityResult，这里不能再按"原始文本解析失败"补一条假错误。
      ? `意图分析格式无效：${intentProtocol.error}。回复内容已保留。`
      : undefined)
    : undefined;
  const planProtocol = msg.outlinePlanProtocol ?? null;
  const planDecided = Boolean(msg.outlinePlanDecision);
  const isPlanProtocolMessage = Boolean(planProtocol) || Boolean(msg.outlinePlanPhase);
  const discussProtocol = msg.outlineDiscussProtocol ?? null;
  const discussDecided = Boolean(msg.outlineDiscussDecision);
  const isDiscussProtocolMessage = Boolean(discussProtocol) || Boolean(msg.outlineDiscussPhase);
  const canUseAsOutlineContent = intentProtocol.kind === "none"
    && !intentProtocolError
    && !isPlanProtocolMessage
    && !isDiscussProtocolMessage;
  const historicalClearIntent = !msg.intentClarityResult
    && !msg.intentProtocolError
    && msg.intentPhase !== "generation"
    && intentProtocol.kind === "valid"
    && intentProtocol.result.clarity === "clear"
    ? intentProtocol.result
    : null;

  // Parse for file edits
  const [parsed, setParsed] = useState<{
    textContent: string;
    edits: import("@/lib/novel/agent-parser").FileEditAction[];
    hasEdits: boolean;
  }>({ textContent: "", edits: [], hasEdits: false });
  const renderedMarkdownContent = useMemo(() => {
    const rawContent = parsed.textContent || answer;
    // 计划模式的协议块只用卡片渲染，气泡里不能漏出 JSON
    if (isPlanProtocolMessage || isDiscussProtocolMessage) return stripStructuredMarkers(rawContent);
    if (intentProtocol.kind === "valid") return stripStructuredMarkers(rawContent);
    // 协议坏了也要把正文给用户（剥掉标记即可）：清空气泡等于把这一轮回复藏起来。
    if (intentProtocol.kind === "invalid" || msg.intentProtocolError) return stripStructuredMarkers(rawContent);
    const prepared = prepareOutlineSaveSourceContent(rawContent);
    /*
     * 只有结构化数据的回复（卷纲/章纲不再重复写 MD）不能让气泡空着，
     * 也不能让「已生成…」一句交代语顶掉统计交代。
     *
     * 顺序是刻意的：**先**判 prepared 是不是真正文，只有「空 / 只是一句交代语」
     * 时才去解析 JSON 算统计。反过来写（无条件先算 summary）会让每条历史消息
     * 都跑一遍围栏扫描 + JSON.parse，一条两万字的回复也照跑 —— 纯浪费。
     */
    if (prepared.trim() && !looksLikeOutlineDeliveryNote(prepared)) return prepared;
    return describeStructuredOnlyAnswer(rawContent) || prepared;
  }, [answer, intentProtocol, isDiscussProtocolMessage, isPlanProtocolMessage, msg.intentProtocolError, parsed.textContent]);
  useEffect(() => {
    if (!answer) {
      setParsed({ textContent: "", edits: [], hasEdits: false });
      return;
    }
    import("@/lib/novel/agent-parser").then(({ parseAgentResponse }) => {
      setParsed(parseAgentResponse(answer));
    });
  }, [answer]);

  const handleApplyEdits = useCallback(
    async (edits: import("@/lib/novel/agent-parser").FileEditAction[]) => {
      if (!projectPath) return [];
      const { applyFileEdits } = await import("@/lib/novel/agent-tools");
      const results = await applyFileEdits(projectPath, edits);
      setEditResults(results);
      setEditApplied(true);
      await refreshProjectState(projectPath);
      return results;
    },
    [projectPath],
  );
  const currentContextHubSnapshot = msg.contextHubSnapshot
    ? parseContextHubSnapshotRef(msg.contextHubSnapshot)
    : null;
  const isOutlineFastMode = resolveOutlineWorkflowMode(
    useWikiStore((s) => s.outlineWorkflowMode),
  ) === "fast";
  const useStandardWorkflowCard = shouldUseOutlineStandardWorkflowCard({
    fastMode: isOutlineFastMode,
    intentPhase: msg.intentPhase,
    hasMultiAgentRun: Boolean(msg.multiAgentRun),
  });
  const contextHubDetails = !isStreaming && currentContextHubSnapshot ? (
    <ContextHubDetails reference={currentContextHubSnapshot} timing={msg.generationTiming} />
  ) : null;
  const sourceDetails = msg.sources && msg.sources.length > 0 && !isStreaming ? (
    <details className="relative">
      <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" title={`引用资料（${msg.sources.length}）`} aria-label={`引用资料（${msg.sources.length}）`}>
        <FileText className="h-3.5 w-3.5" />
      </summary>
      <ul className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-lg border bg-background p-2 shadow-md space-y-0.5 text-xs text-muted-foreground">
        {msg.sources.map((src, si) => (
          <li key={si}>• {src}</li>
        ))}
      </ul>
    </details>
  ) : null;

  return (
    <>

      <OutlineMultiAgentPanel
        run={msg.multiAgentRun}
        onResume={() => { void onResumeMultiAgent(msg.id) }}
        resumeDisabled={resumeMultiAgentDisabled}
      />
      {msg.multiAgentRun || !shouldShowOutlineToolCalls(msg.intentPhase) ? null : useStandardWorkflowCard ? (
        <OutlineStandardWorkflowPanel
          intentPhase={msg.intentPhase}
          isRunning={Boolean(msg.isAgentRunning)}
          toolCalls={msg.agentToolCalls}
          thinkingContent={thinking || undefined}
          thinkingStreaming={Boolean(thinking) && Boolean(msg.isAgentRunning)}
          onConfirmSave={onConfirmToolSave}
          onReject={onRejectTool}
        />
      ) : (
        <AgentToolCallMessage
          toolCalls={msg.agentToolCalls}
          thinkingContent={thinking || undefined}
          thinkingStreaming={messageIsStreaming}
          onConfirmSave={onConfirmToolSave}
          onReject={onRejectTool}
        />
      )}
      {<UiTestAiAuthor running={messageIsStreaming} />}
      {intentProtocolError ? (
        <div role="alert" className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {intentProtocolError}
        </div>
      ) : null}
      {msg.outlinePlanNotice && !messageIsStreaming ? (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {msg.outlinePlanNotice}
        </div>
      ) : null}
      {msg.outlinePlanError && !messageIsStreaming ? (
        <div role="alert" className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {msg.outlinePlanError}
        </div>
      ) : null}
      {msg.outlineDiscussNotice && !messageIsStreaming ? (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          已按现有内容给出卡片：{msg.outlineDiscussNotice}
        </div>
      ) : null}
      {msg.outlineDiscussError && !messageIsStreaming ? (
        <div role="alert" className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {msg.outlineDiscussError}
        </div>
      ) : null}
      <StreamingMarkdown
        content={renderedMarkdownContent}
        isStreaming={messageIsStreaming}
        cursorSuffix={waitingText || undefined}
        renderCommitted={(text) => (
          <OutlineMarkdownContent content={text} projectPath={projectPath} />
        )}
      />
      {/*
        * 保存前校验的问题清单：紧贴在**生成结果下方**。
        * 这类问题不阻止保存，所以不该只弹一个和内容脱节的持久浮层 ——
        * 用户要能看到「这段结果到底缺哪几项」，再决定补全还是照样保存。
        */}
      {msg.outlineSaveReport && !messageIsStreaming ? (
        <OutlineSaveReportPanel report={msg.outlineSaveReport} />
      ) : null}
      {/*
        * 停止生成之后的补救动作，紧贴在「已停止生成」那句提示的下方。
        * 用户停止生成常常是想换个模型再试，所以停下之后必须当场给出
        * 「重试」和「继续」；按钮与章节面板共用同一个组件，行为与外观一致。
        */}
      {isStoppedGeneration ? (
        <StoppedGenerationActions
          className="mt-2"
          onRetry={() => void onRegenerate(index)}
          onContinue={onContinueStopped}
        />
      ) : null}
      {/* File edit preview */}
      {parsed.hasEdits && !editDismissed && projectPath && !isStreaming ? (
        <FileEditPreview
          edits={parsed.edits}
          onApply={handleApplyEdits}
          onDismiss={() => setEditDismissed(true)}
          applied={editApplied}
          results={editResults}
        />
      ) : null}
      {/* Action buttons */}
      {actionContent && canUseAsOutlineContent && !isStreaming ? (
        <div className="mt-2 flex w-full items-center gap-1">
          {/*
            * 事件细纲不进大纲列表（只作消息 + 卡片存在），所以这一类消息上不出现
            * 「保存为大纲」；复制 / 重新生成等其余按钮照旧。
            */}
          {!hasEventOutline ? (
            <button
              onClick={() => void onSaveAsOutline(actionContent)}
              data-guide="outline.save"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
              title="保存为大纲"
              aria-label="保存为大纲"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            onClick={() => onCopy(actionContent, msg.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            title={copied === msg.id ? "已复制" : "复制"}
            aria-label={copied === msg.id ? "已复制" : "复制"}
          >
            {copied === msg.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {/*
            * 生成失败的消息：把「重试 / 继续」放在原本「重新生成」那一格，
            * 于是这一排读起来是 保存 → 复制 → 重试 → 继续 → 引用资料，
            * 与章节面板完全一致（两边共用 FailedGenerationActions）。
            */}
          {isFailedGeneration ? (
            <FailedGenerationActions
              onRetry={() => void onRegenerate(index)}
              onContinue={onContinueFailed}
              continueDisabled={!canContinueFailed}
            />
          ) : null}
          {/*
            * 停止生成的消息不再单出一枚「重新生成」：上方那对按钮里的「重试」
            * 就是同一个动作，并排出现只会让人猜哪个才是"换模型重来"。
            * 失败消息同理 —— 「重试」接的正是 onRegenerate。
            */}
          {!isStoppedGeneration && !isFailedGeneration ? (
            <button
              onClick={() => void onRegenerate(index)}
              disabled={isStreaming}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-50"
              title="重新生成"
              aria-label="重新生成"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {sourceDetails}
          {<div className="ml-auto">{contextHubDetails}</div>}
        </div>
      ) : null}
      {historicalClearIntent && !isStreaming ? (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            onClick={() => void onContinueIntentGeneration(msg.id, historicalClearIntent)}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            继续生成
          </button>
        </div>
      ) : null}
      {/* 计划模式：要素缺口追问 */}
      {planProtocol?.status === "needs_input" && !isStreaming ? (
        <OutlineClarifyCard
          protocol={planProtocol}
          onSubmitAnswers={(answers) => onSubmitPlanAnswers(msg.id, planProtocol, answers)}
          disabled={nextStepDisabled || planDecided}
          disabledReason={planDecided
            ? "该轮追问已提交，请在最新消息里继续。"
            : nextStepDisabledReason}
        />
      ) : null}
      {/* 计划模式：生成计划确认 */}
      {planProtocol?.status === "ready" && !isStreaming ? (
        <OutlinePlanCard
          protocol={planProtocol}
          onConfirm={(planText) => onConfirmPlan(msg.id, planProtocol, planText)}
          onSupplement={onFocusInput}
          onCancel={() => onCancelPlan(msg.id)}
          disabled={nextStepDisabled || planDecided}
          disabledReason={planDecided
            ? "该计划已处理过，请在下方继续对话。"
            : nextStepDisabledReason}
        />
      ) : null}
      {discussProtocol && !isStreaming ? (
        <OutlineDiscussCard
          protocol={discussProtocol}
          onSubmitAnswers={(answers) => onSubmitDiscussAnswers(msg.id, discussProtocol, answers)}
          onConfirm={() => onConfirmDiscuss(msg.id, discussProtocol)}
          onContinue={onFocusInput}
          disabled={nextStepDisabled || discussDecided}
          disabledReason={discussDecided
            ? "该轮讨论已处理过，请在最新消息里继续。"
            : nextStepDisabledReason}
        />
      ) : null}
      {/* 下一步推荐 */}
      {msg.nextStepRecommendation && msg.nextStepRecommendation.recommendations.length > 0 ? (
        <NextStepCard
          recommendation={msg.nextStepRecommendation}
          onSelectRecommendation={(_recId, label) => onSendMessage(label, isExplicitStructuredGenerationFollowUp(label, { generationContext })
            ? { intentPhase: "generation", scope: label }
            : undefined)}
          disabled={nextStepDisabled}
          disabledReason={nextStepDisabledReason}
        />
      ) : null}
    </>
  );
}

function OutlineGenerationMenu({
  disabled,
  open,
  onOpenChange,
  onSelect,
}: {
  disabled: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (title: string, requestHint: string) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setMenuOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const generationButtonRef = useRef<HTMLButtonElement>(null);
  useUiTestAiMenuFocus(isOpen, menuRef, generationButtonRef, setMenuOpen);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ left: 0, top: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const updateMenu = () => {
      const rect = generationButtonRef.current?.getBoundingClientRect();
      if (rect) setMenuPosition(getUiTestAiMenuStyle(rect, 320, true));
    };
    updateMenu();
    window.addEventListener("resize", updateMenu);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updateMenu);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={generationButtonRef}
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const menuWidth = 224;
          const gap = 8;
          const viewportWidth = window.innerWidth || menuWidth;
          setMenuPosition({
            left: Math.min(
              Math.max(rect.left, gap),
              Math.max(gap, viewportWidth - menuWidth - gap),
            ),
            top: rect.top,
          });
          setMenuOpen(!isOpen);
        }}
        disabled={disabled}
        /*
         * 尺寸 `h-7 w-7`（28px），不是 32px：用户反馈图标之间隔得太远。
         * 28px 与同一行里本来就是 28px 的「上下文用量」圆环、@ 按钮统一，
         * 配合左组 `gap-0.5`（见 ReferenceInput.tsx）把墨迹间距从约 25px 收到约 16px。
         * 章节写作区里对应位置的按钮（计划开关）用同一组数值，两边必须一致 ——
         * 用户明确要求「大纲当中的间距也一样」。
         */
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        title="生成大纲模块"
        aria-label="生成大纲模块"
        data-guide="outline.modules"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <ListPlus className="h-4 w-4" />
      </button>
      {isOpen ? createPortal(
        <div
          ref={menuRef}
          className="qmai-outline-generation-menu fixed z-50 w-56 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ ...menuPosition, zIndex: 9999 }}
          role="menu"
          data-ui-ai-menu="generation"
        >
          {OUTLINE_SECTION_GENERATION_CONFIGS.map((config) => (
            <button
              key={config.key}
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSelect(config.title, config.requestHint);
              }}
              disabled={disabled}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={config.requestHint}
              role="menuitem"
            >
              <ListPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{config.title}</span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * 大纲/细纲引用弹窗里「技能库」分类的全部条目（丁-3），含角色灵魂（丁-4）。
 *
 * ⚠️ **故意不产出 `subtype: "style"`（文风）条目**：本面板的 `buildAgentConfig`
 * 调用从不提供 `runDeepChapterGeneration` / `getWritingStyleIdOverride`，
 * 所以 `run_chapter_workflow` 这个工具根本不会被注册，`@` 一条文风在
 * **生成链上没有任何消费者** —— 加进来就是一个「看着接上、其实断开」的死条目，
 * 正是丁-3 存在的理由。大纲/细纲不写正文，文风覆盖对它也没有语义。
 * ⇒ 文风条目只在 `chat-panel.tsx` 的 getter 里注入（那里有覆盖通道的产出端）。
 *
 * ⚠️ **与文风相反，角色灵魂在这里有消费者**（丁-4）：`contextPack.characterAuras`
 * → `buildContextHubSystemContent` 与 `buildScopedOutlineSubAgentContext`，
 * 所以**必须**产出灵魂条目。注意「产出条目」≠「已绑定」：
 * 真正写盘那一步在 `handleSend` 里、用户确认之后（见 `message-scoped-soul-binding`）。
 *
 * 为什么抽成**具名导出**（而不是留成组件里的内联 getter）：这样「这里永远没有文风条目」
 * 才是一条**可被行为断言**的性质（`outline-chat-panel.spec.tsx` 直接调它、只看产出）。
 * 之前它只能靠对源码文本做正则来钉 —— 那既会因为**改注释**而假红，
 * 又会因为**冒号空格 / 别名导入 / 中转变量**等排版变化而假绿（实测过）。
 */
export function buildOutlineReferenceSkillEntries(
  deAiSkillConfig: DeAiSkillConfig | null,
  writingSkills: UserSkill[],
  characterSouls: CharacterSoulOption[],
): SkillSummary[] {
  const deAiSkills: SkillSummary[] = deAiSkillConfig
    ? resolveAvailableDeAiSkills(deAiSkillConfig).map((skill) => ({
        id: skill.id,
        name: skill.name,
        subtype: "deai" as const,
      }))
    : [];
  const writingSkillList: SkillSummary[] = writingSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    displayName: skill.displayName,
    subtype: "writing" as const,
    kind: skill.kind,
    stages: skill.stages,
    modes: skill.modes,
  }));
  const soulEntries = characterSouls.map((soul) => ({
    id: soul.id,
    name: soul.name,
    subtype: SOUL_SKILL_SUBTYPE,
  }));
  return [...deAiSkills, ...writingSkillList, ...soulEntries];
}

export function OutlineChatPanel({ onClose }: { onClose: () => void }) {
  const project = useWikiStore((s) => s.project);
  // 卷纲 / 章纲 / 设定卡片流模板与卷纲真骨架：项目变化时预加载（项目目录覆盖 → 程序 skills 目录 → 内置模板）
  useEffect(() => {
    void primeVolumeOutlineTemplate(project?.path ?? null);
    void primeChapterOutlineTemplate(project?.path ?? null);
    void primeSettingOutlineTemplate(project?.path ?? null);
    void primeCharacterProfileTemplate(project?.path ?? null);
    void primeFactionProfileTemplate(project?.path ?? null);
    void primePowerProfileTemplate(project?.path ?? null);
    void primeForeshadowingProfileTemplate(project?.path ?? null);
    void primeGoldenFingerProfileTemplate(project?.path ?? null);
    void primeGeographyProfileTemplate(project?.path ?? null);
    void primeLocationProfileTemplate(project?.path ?? null);
    void primeBackgroundProfileTemplate(project?.path ?? null);
    void primeVolumeSkeletonReference(project?.path ?? null);
  }, [project?.path]);
  const llmConfig = useWikiStore((s) => s.llmConfig);
  const novelConfig = useWikiStore((s) => s.novelConfig);
  const providerConfigs = useWikiStore((s) => s.providerConfigs);
  const aiChatModel = useWikiStore((s) => s.aiChatModel);
  const aiOutlineModel = useWikiStore((s) => s.aiOutlineModel);
  const defaultLlmModel = useWikiStore((s) => s.defaultLlmModel);
  const setAiOutlineModel = useWikiStore((s) => s.setAiOutlineModel);
  const aiOutlineReasoningDepth = useWikiStore((s) => s.aiOutlineReasoningDepth);
  const setAiOutlineReasoningDepth = useWikiStore((s) => s.setAiOutlineReasoningDepth);
  const outlineWorkflowMode = resolveOutlineWorkflowMode(
    useWikiStore((s) => s.outlineWorkflowMode),
  );
  const setOutlineWorkflowMode = useWikiStore((s) => s.setOutlineWorkflowMode);
  const chatConversations = useChatStore((s) => s.conversations);

  const conversations = useOutlineChatStore((s) => s.conversations);
  const activeConversationId = useOutlineChatStore(
    (s) => s.activeConversationId,
  );
  const streamingContents = useOutlineChatStore((s) => s.streamingContents);
  const runStates = useOutlineChatStore((s) => s.runStates);
  const activeRunState = activeConversationId ? runStates[activeConversationId] : undefined;
  const isStreaming = activeRunState?.status === "running";
  const streamingContent = activeConversationId ? streamingContents[activeConversationId] ?? "" : "";
  const loaded = useOutlineChatStore((s) => s.loaded);
  const createConversation = useOutlineChatStore((s) => s.createConversation);
  const setActiveConversation = useOutlineChatStore(
    (s) => s.setActiveConversation,
  );
  const addMessage = useOutlineChatStore((s) => s.addMessage);
  const deleteConversation = useOutlineChatStore((s) => s.deleteConversation);
  const setConversationModel = useOutlineChatStore(
    (s) => s.setConversationModel,
  );
  const setConversationContextSummary = useOutlineChatStore(
    (s) => s.setConversationContextSummary,
  );
  const setStreamingContent = useOutlineChatStore((s) => s.setStreamingContent);
  const clearStreamingContent = useOutlineChatStore((s) => s.clearStreamingContent);
  const startConversationRun = useOutlineChatStore((s) => s.startConversationRun);
  const finishConversationRun = useOutlineChatStore((s) => s.finishConversationRun);
  const failConversationRun = useOutlineChatStore((s) => s.failConversationRun);
  const stopConversationRun = useOutlineChatStore((s) => s.stopConversationRun);
  const canStartConversationRun = useOutlineChatStore((s) => s.canStartConversationRun);
  const pendingReferenceTokens = useOutlineChatStore(
    (s) => s.pendingReferenceTokens,
  );
  const consumePendingReferenceTokens = useOutlineChatStore(
    (s) => s.consumePendingReferenceTokens,
  );
  const loadFromDisk = useOutlineChatStore((s) => s.loadFromDisk);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConv?.messages ?? [];
  /**
   * 每条助手消息解析出的事件细纲（纯函数，按帧现算）。
   *
   * 一次算好给两处共用：气泡下方的卡片，以及「保存为大纲」按钮的显示条件。
   * 后者必须知道这条消息是不是事件细纲 —— 事件细纲不再进大纲列表，
   * 那个按钮对它就没有意义了（丙-1 堵住的手动保存通道）。
   */
  const eventOutlinesByMessageId = useMemo(() => {
    const outlines = new Map<string, EventOutlineData | null>();
    for (const message of activeMessages) {
      outlines.set(
        message.id,
        message.role === "assistant"
          ? extractEventOutlineData(message.content, requirementFor(message))
          : null,
      );
    }
    return outlines;
  }, [activeMessages]);
  const hasSentUserMessage =
    activeConv?.messages.some((message) => message.role === "user") ?? false;
  const canCreateConversation = canCreateNewConversation(
    activeConversationId,
    hasSentUserMessage,
  );
  const isWorkingConversation = useCallback(
    (convId: string) => runStates[convId]?.status === "running",
    [runStates],
  );
  const { topConversations, historyConversations } = useMemo(
    () => splitConversationToolbarItems(
      conversations,
      activeConversationId,
      isWorkingConversation,
    ),
    [activeConversationId, conversations, isWorkingConversation],
  );
  const historyCount = historyConversations.length;
  // 当前 UI 用历史下拉统一承载会话切换，隐藏了顶栏 chips；因此下拉必须列出全部会话，
  // 否则当天新建的非当前会话既不在（隐藏的）chips 里，也不在历史里，导致不可达。
  const menuConversations = conversations;
  const menuConversationCount = menuConversations.length;

  const hasAvailableModels = useMemo(
    () => hasConfiguredModels(providerConfigs),
    [providerConfigs],
  );

  const defaultOutlineLlmConfig = useMemo(
    () => resolveNovelModel(llmConfig, novelConfig, "writing"),
    [aiChatModel, defaultLlmModel, llmConfig, novelConfig, providerConfigs],
  );
  const storedOutlineModelId = useMemo(
    () => resolveUsableModelKey(aiOutlineModel, llmConfig, providerConfigs),
    [aiOutlineModel, llmConfig, providerConfigs],
  );
  const fallbackOutlineModelId = useMemo(() => {
    const workflowDefaultModel = novelConfig.defaultLlmModel?.trim() || defaultLlmModel.trim();
    return resolveUsableModelKey(aiChatModel, llmConfig, providerConfigs)
      || resolveUsableModelKey(workflowDefaultModel, llmConfig, providerConfigs)
      || resolveUsableModelKey(defaultOutlineLlmConfig.model, llmConfig, providerConfigs);
  }, [
    aiChatModel,
    defaultLlmModel,
    defaultOutlineLlmConfig.model,
    llmConfig,
    novelConfig.defaultLlmModel,
    providerConfigs,
  ]);
  const effectiveOutlineModelId = storedOutlineModelId || fallbackOutlineModelId;
  const effectiveOutlineContextWindow = useMemo(() => {
    let config = resolveNovelModel(llmConfig, novelConfig, "writing");
    if (effectiveOutlineModelId) {
      config = resolveModelConfig(
        effectiveOutlineModelId,
        config,
        providerConfigs,
      );
    }
    return getEffectiveMaxContextSize(config);
  }, [effectiveOutlineModelId, llmConfig, novelConfig, providerConfigs]);

  /** The config the thinking-depth slider steers, or null to hide the slider. */
  const reasoningDepthTargetConfig = useMemo(() => {
    let config = resolveNovelModel(llmConfig, novelConfig, "writing");
    if (effectiveOutlineModelId) {
      config = resolveModelConfig(effectiveOutlineModelId, config, providerConfigs);
    }
    return config;
  }, [effectiveOutlineModelId, llmConfig, novelConfig, providerConfigs]);

  const [inputValue, setInputValue] = useState("");
  const deferredInputValue = useDeferredValue(inputValue);
  const liveContextUsage = useMemo(() => {
    const historyMessages = selectContextHistoryMessages(
      activeMessages.filter((message) => message.role === "user" || message.role === "assistant"),
      activeConv?.contextSummary?.text,
    );
    return composeLiveContextUsage(activeConv?.lastContextUsage, {
      windowTokens: effectiveOutlineContextWindow,
      softwareRules: buildOutlineAgentSystemPrompt({ projectName: project?.name ?? "", mode: outlineWorkflowMode }),
      sessionSummaryText: activeConv?.contextSummary?.text ?? "",
      historyTexts: historyMessages.map((message) => message.content),
      currentInput: deferredInputValue,
    });
  }, [
    activeConv?.contextSummary?.text,
    activeConv?.lastContextUsage,
    activeMessages,
    deferredInputValue,
    effectiveOutlineContextWindow,
    outlineWorkflowMode,
    project?.name,
  ]);
  const [outlineReferenceTokens, setOutlineReferenceTokens] = useState<
    ReferenceToken[]
  >([]);
  const outlineReferenceTokensRef = useRef<ReferenceToken[]>([]);
  const [forceRefreshNext, setForceRefreshNext] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [outlineWizardOpen, setOutlineWizardOpen] = useState(false);
  const [generationMenuOpen, setGenerationMenuOpen] = useState(false);
  const [localModelId, setLocalModelId] = useState(effectiveOutlineModelId);
  const insertReferenceTokensRef = useRef<InsertReferenceTokens>(null);
  const [hoveredConversationId, setHoveredConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workflowModeDropdownOpen, setWorkflowModeDropdownOpen] = useState(false);
  const workflowModeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowModeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [workflowModeDropdownStyle, setWorkflowModeDropdownStyle] = useState<CSSProperties | null>(null);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(null);
  const [pendingClearHistoryIds, setPendingClearHistoryIds] = useState<string[] | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);
  const [historyDropdownStyle, setHistoryDropdownStyle] = useState<CSSProperties | null>(null);
  useUiTestAiMenuFocus(historyOpen && Boolean(historyDropdownStyle), historyDropdownRef, historyButtonRef, setHistoryOpen);
  useUiTestAiMenuFocus(workflowModeDropdownOpen && Boolean(workflowModeDropdownStyle), workflowModeDropdownRef, workflowModeTriggerRef, setWorkflowModeDropdownOpen);
  const [deAiSkillConfig, setDeAiSkillConfig] = useState<DeAiSkillConfig | null>(null);
  const [writingSkills, setWritingSkills] = useState<UserSkill[]>([]);
  const intentContextsRef = useRef<Record<string, {
    result?: IntentClarityResult | null;
    title: string;
    hint: string;
    outputMode?: "per_chapter" | "per_item" | "single";
    originalRequest?: string;
    references?: ReferenceToken[];
    skillNames?: string[];
  }>>({});
  const [outlineWorkflowStages, setOutlineWorkflowStages] = useState<Record<string, OutlineWorkflowStage>>({});
  const outlineWorkflowStage = activeConversationId
    ? outlineWorkflowStages[activeConversationId] ?? "idle"
    : "idle";
  const outlineWritingSkills = useMemo(() => {
    const routed = filterSkillsForSkillRoutes(writingSkills, [...OUTLINE_CHAT_SKILL_ROUTES]);
    return routed.length > 0 ? routed : writingSkills;
  }, [writingSkills]);

  /*
   * 丁-4：角色灵魂引用。
   *
   * ⚠️ 与「文风」相反，本面板**有**灵魂的消费者：`contextHub.prepare` 建出的
   * `contextPack.characterAuras` 会进 `buildContextHubSystemContent`，
   * 也会进 `buildScopedOutlineSubAgentContext` 的 `character` 分支
   * （那一支题名就是「角色气质」）。所以「@ 一条灵魂」在这里不是死条目，
   * 它真的会改变本次大纲/细纲生成看到的东西 —— 代价是它同样会带上
   * `portablePersonalities` 的 fail-closed 断言（见确认弹窗里的说明）。
   */
  const {
    souls: characterSouls,
    requestSoulBindingTarget,
    soulBindingDialog,
  } = useCharacterSoulReference({ projectPath: project?.path ?? undefined });

  useEffect(() => {
    if (pendingReferenceTokens.length === 0) return;
    const tokens = consumePendingReferenceTokens();
    insertReferenceTokensRef.current?.(tokens);
  }, [consumePendingReferenceTokens, pendingReferenceTokens]);

  const referenceProviders = useMemo(
    () => [
      chapterProvider,
      memoryProvider,
      outlineProvider,
      deductionProvider,
      /*
       * 技能库条目（丁-3 抽出具名函数 + 丁-4 的角色灵魂）：
       * - **故意不**产出「文风」条目（见 `buildOutlineReferenceSkillEntries` 的说明）；
       * - 角色灵魂**必须**产出 —— 它在本面板确有消费者。
       */
      createSkillProvider(() => buildOutlineReferenceSkillEntries(deAiSkillConfig, outlineWritingSkills, characterSouls)),
      createChatHistoryProvider(() =>
        chatConversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        })),
      ),
      createOutlineHistoryProvider(() =>
        conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        })),
      ),
    ],
    [characterSouls, chatConversations, conversations, deAiSkillConfig, outlineWritingSkills],
  );

  // 加载持久化的历史记录
  useEffect(() => {
    if (!loaded) {
      void loadFromDisk();
    }
  }, [loaded, loadFromDisk]);

  // 加载技能配置
  useEffect(() => {
    if (!project?.path) {
      setDeAiSkillConfig(null);
      setWritingSkills([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [deAiConfig, userSkillConfig] = await Promise.all([
        loadDeAiSkillConfig(project.path).catch((): DeAiSkillConfig | null => null),
        loadUserSkillConfig(project.path).catch(() => null),
      ]);
      if (cancelled) return;
      setDeAiSkillConfig(deAiConfig);
      setWritingSkills(userSkillConfig ? resolveEnabledWritingSkills(userSkillConfig) : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.path]);

  // 当前会话切换或持久化 modelId 变化时，同步本地选择状态
  const persistOutlineModel = useCallback((modelId: string) => {
    void saveAiOutlineModel(modelId).catch(() => {
      toast.info(
        "\u0041\u0049 \u5927\u7eb2\u6a21\u578b\u4fdd\u5b58\u5931\u8d25\uff0c\u672c\u6b21\u9009\u62e9\u4ecd\u53ef\u7ee7\u7eed\u4f7f\u7528\u3002",
        { dedupeKey: "outline-model-save-failed" },
      );
    });
  }, []);

  useEffect(() => {
    setLocalModelId(effectiveOutlineModelId);
    if (!effectiveOutlineModelId) return;

    if (activeConversationId && activeConv?.modelId !== effectiveOutlineModelId) {
      setConversationModel(activeConversationId, effectiveOutlineModelId);
    }
    if (aiOutlineModel === effectiveOutlineModelId) return;

    const unavailableStoredModel = aiOutlineModel.trim().length > 0 && !storedOutlineModelId;
    setAiOutlineModel(effectiveOutlineModelId);
    if (unavailableStoredModel) {
      toast.info(
        "\u539f \u0041\u0049 \u5927\u7eb2\u6a21\u578b\u5df2\u4e0d\u53ef\u7528\uff0c\u5df2\u56de\u9000\u5230\u5f53\u524d\u9ed8\u8ba4\u6a21\u578b\u3002",
        { dedupeKey: "outline-model-fallback" },
      );
    }
    persistOutlineModel(effectiveOutlineModelId);
  }, [
    activeConv?.modelId,
    activeConversationId,
    aiOutlineModel,
    effectiveOutlineModelId,
    persistOutlineModel,
    setAiOutlineModel,
    setConversationModel,
    storedOutlineModelId,
  ]);

  useEffect(() => {
    if (!historyOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        historyRef.current && !historyRef.current.contains(target) &&
        historyDropdownRef.current && !historyDropdownRef.current.contains(target)
      ) {
        setHistoryOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setHistoryOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!historyOpen) {
      setHistoryDropdownStyle(null);
      return;
    }
    function updatePosition() {
      const rect = historyButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHistoryDropdownStyle(getUiTestAiMenuStyle(rect));
    }
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
    };
  }, [historyOpen]);

  useEffect(() => {
    setHistoryOpen(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (!workflowModeDropdownOpen) {
      setWorkflowModeDropdownStyle(null);
      return;
    }
    function updatePosition() {
      const rect = workflowModeTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setWorkflowModeDropdownStyle({ ...getUiTestAiMenuStyle(rect, 320, true), maxHeight: "none" });
    }
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
    };
  }, [workflowModeDropdownOpen]);

  const setSaveStatus = useCallback((message: string) => {
    if (!/(失败|错误|不支持|无法)/.test(message)) return;
    toast.error(message, {
      title: "大纲操作失败",
      persistent: true,
      dedupeKey: `outline-operation:${message}`,
    });
  }, []);
  type SaveConfirmBatch = {
    title: string;
    mode: "normal" | "character";
    requests: OutlineSaveRequest[];
    characterDrafts: CharacterSaveDraft[];
  };
  const [saveConfirmState, setSaveConfirmState] = useState<SaveConfirmBatch | null>(null);
  const saveConfirmStateRef = useRef<SaveConfirmBatch | null>(null);
  const pendingSaveBatchesRef = useRef<SaveConfirmBatch[]>([]);
  /** 大纲内容不完整时，每类任务（卷纲 / 章纲）在每个会话各最多自动修复一次（避免无限循环消耗 token） */
  const outlineRepairAttemptsRef = useRef<Map<string, number>>(new Map());
  /** 待触发的卷纲自动补全（由 handleSend 定义后的 effect 消费；用 state 保证 effect 可靠执行） */
  const [pendingVolumeRepair, setPendingVolumeRepair] = useState<{ conversationId: string; prompt: string } | null>(null);
  /** 待触发的章纲自动补全（配额与卷纲分开计数，互不挤占） */
  const [pendingChapterRepair, setPendingChapterRepair] = useState<{ conversationId: string; prompt: string } | null>(null);
  /** 章纲分批会话：累积每批解析出的数据与本批 MD，直到最后一批合并保存 */
  const chapterBatchSessionsRef = useRef<Map<string, Array<{ data: ChapterOutlineData; md: string }>>>(new Map());
  /** 待触发的下一批章纲生成 */
  const [pendingChapterBatch, setPendingChapterBatch] = useState<{ conversationId: string; prompt: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    saveConfirmStateRef.current = saveConfirmState;
  }, [saveConfirmState]);

  const presentOrQueueSaveBatch = useCallback((batch: SaveConfirmBatch) => {
    const current = saveConfirmStateRef.current;
    if (!current) {
      saveConfirmStateRef.current = batch;
      setSaveConfirmState(batch);
      return;
    }
    // 同为 normal：合并进当前确认框，避免下一轮覆盖导致未确认文件丢失
    if (current.mode === "normal" && batch.mode === "normal") {
      const merged: SaveConfirmBatch = {
        ...current,
        title: current.title || batch.title,
        requests: mergeOutlineSaveRequests(current.requests, batch.requests),
      };
      saveConfirmStateRef.current = merged;
      setSaveConfirmState(merged);
      return;
    }
    pendingSaveBatchesRef.current.push(batch);
  }, []);

  const drainNextSaveBatch = useCallback(() => {
    const next = pendingSaveBatchesRef.current.shift() ?? null;
    saveConfirmStateRef.current = next;
    setSaveConfirmState(next);
    if (!next) return;
    setSaveStatus(
      next.mode === "character"
        ? "检测到人物小传，请确认要保存的人物角色。"
        : "检测到可保存大纲，请确认后写入。",
    );
  }, [setSaveStatus]);

  const handleCloseSaveConfirm = useCallback(() => {
    // 丢弃当前 batch，继续展示队列中的下一批，避免关闭人物确认后 normal 成为孤儿
    drainNextSaveBatch();
  }, [drainNextSaveBatch]);

  // Auto-scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || userScrolledUpRef.current) return;
    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
  }, [activeMessages, streamingContent]);

  // 重新进入面板时滚动到最后一条消息
  // AI 大纲消息渲染较重（StreamingMarkdown、时间线、工具调用等），
  // 重新挂载时 DOM 渲染较慢，auto-scroll effect 首次执行时 scrollHeight 不是最终值。
  // 在多个时间点尝试滚动，覆盖不同渲染速度，最后一次必定到底。
  useEffect(() => {
    const timers = [100, 300, 600, 1000, 1500].map((delay) =>
      window.setTimeout(() => {
        const container = scrollRef.current;
        if (!container || userScrolledUpRef.current) return;
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollTop;
      }, delay),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const handleScrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    userScrolledUpRef.current = false;
    setShowScrollToBottom(false);
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;
      const atBottom =
        container.scrollHeight - currentScrollTop - container.clientHeight < 50;
      if (atBottom) {
        userScrolledUpRef.current = false;
      } else if (currentScrollTop < lastScrollTopRef.current - 1) {
        userScrolledUpRef.current = true;
      }
      setShowScrollToBottom(userScrolledUpRef.current && !atBottom);
      lastScrollTopRef.current = currentScrollTop;
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [isStreaming, activeConversationId]);

  useEffect(() => {
    userScrolledUpRef.current = false;
    lastScrollTopRef.current = 0;
    setShowScrollToBottom(false);
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      lastScrollTopRef.current = container.scrollTop;
    }
  }, [activeConversationId]);

  const executeConfirmedOutlineSave = useCallback(
    async (payload: OutlineSaveConfirmPayload) => {
      if (!project) return;
      const projectPath = normalizePath(project.path);
      const requests = payload.characterDrafts.length > 0
        ? characterDraftsToSaveRequests(payload.characterDrafts, "保存人物小传")
        : payload.requests;
      if (requests.length === 0) {
        setSaveStatus("没有选择需要保存的内容。");
        return;
      }

      setSaveStatus("正在保存大纲文件...");
      try {
        const saveResult = await saveOutlineSaveRequests({
          outlineRoot: `${projectPath}/wiki/outlines`,
          confirmed: true,
          requests,
          formats: payload.formats ?? { md: true, html: true },
          // 覆盖前把旧的大纲 md 留成历史版本。失败绝不影响保存：
          // 钩子内部已吞异常，这里再兜一层 .catch 以保证不会出现未处理的 rejection。
          projectPath,
          beforeOverwrite: ({ projectPath: root, name, previousContent }) => {
            void saveVersion({ projectPath: root, kind: "outline", key: name, content: previousContent })
              .then(() => pruneVersions(root, "outline", name))
              .catch((error) => console.warn("[history] 保存大纲历史版本失败：", name, error));
          },
          createDirectory,
          fileExists,
          readFile,
          writeFile,
        });
        if (saveResult.saved.length > 0) {
          await refreshProjectState(projectPath);
          // 保存成功后自动跳转到本次保存的文档预览界面：
          // 优先选中 .md（预览面板的双格式查看器会自动挂载同名 .html 伴生文件，
          // 默认以 HTML 卡片展示）；仅保存 HTML（未勾选 MD）时退回 .html 路径。
          // 多文件保存（per_item 分项）时跳到第一个文件，其余可从左侧知识树进入。
          const jumpTarget =
            saveResult.saved.find((item) => item.path.toLowerCase().endsWith(".md"))?.path
            ?? saveResult.saved[0]?.path;
          if (jumpTarget) {
            useWikiStore.getState().setSelectedFile(normalizePath(jumpTarget));
          }
          const names = saveResult.saved.map((item) => item.fileName).join("、");
          setSaveStatus(`已保存 ${saveResult.saved.length} 个文件：${names}`);
          // 文件已落盘：清掉该会话里过期的校验报告，避免「已保存」旁边还挂着警告。
          const savedConvId = useOutlineChatStore.getState().activeConversationId;
          if (savedConvId) {
            useOutlineChatStore.setState((state) => ({
              conversations: state.conversations.map((conversation) =>
                conversation.id === savedConvId
                  ? {
                      ...conversation,
                      messages: conversation.messages.map((message) =>
                        message.outlineSaveReport
                          ? { ...message, outlineSaveReport: undefined }
                          : message,
                      ),
                    }
                  : conversation,
              ),
            }));
          }
          drainNextSaveBatch();
          return;
        }
        if (saveResult.skipped.length > 0) {
          setSaveStatus(saveResult.skipped.slice(0, 2).join("；"));
          return;
        }
        if (saveResult.errors.length > 0) {
          setSaveStatus(`保存失败：${saveResult.errors.slice(0, 2).join("；")}`);
        }
        // 保存成功后刷新卷纲真骨架缓存，让紧接着生成的章纲立刻用到最新骨架
        void primeVolumeSkeletonReference(project?.path ?? null);
      } catch (error) {
        setSaveStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [drainNextSaveBatch, project],
  );

  const collectOutlineSaveSourceHint = useCallback((conversationId: string) => {
    const intent = intentContextsRef.current[conversationId];
    const conversation = useOutlineChatStore.getState().conversations.find(
      (item) => item.id === conversationId,
    );
    const lastUser = [...(conversation?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "user" && !isInternalOutlineMessage(message));
    return [
      intent?.originalRequest,
      intent?.title,
      lastUser?.content,
      conversation?.title,
    ].filter((item): item is string => Boolean(item?.trim())).join("\n");
  }, []);

  /** 有卷纲结构化数据（伴生 .json）时做「卷纲 ↔ 章纲」交叉校验，返回问题列表。 */
  const collectVolumeCrossProblems = useCallback(
    async (data: ChapterOutlineData): Promise<string[]> => {
      const projectPath = project?.path;
      if (!projectPath) return [];
      const volumes = await loadSavedVolumeOutlineDataList(projectPath);
      for (const volume of volumes) {
        const cross = crossCheckChapterAgainstVolume(data, volume);
        if (cross) return cross;
      }
      return [];
    },
    [project],
  );

  /**
   * 章纲分批推进：本批只收集数据（不落盘），全部批次到齐后由软件合并成一份保存请求。
   * 返回 true 表示这条回复已被分批流程接管，不应再走常规保存解析。
   */
  const advanceChapterOutlineBatches = useCallback(
    async (conversationId: string, content: string): Promise<boolean> => {
      const batch = extractChapterOutlineBatch(content);
      if (!batch) return false;

      const existing = chapterBatchSessionsRef.current.get(conversationId) ?? [];
      // 续跑草稿可能属于另一个故事：骨架对不上就丢弃旧批次，避免把两个故事混成一份章纲
      const sameStory = existing.length === 0
        || (existing[0].data.story.index === batch.data.story.index
          && existing[0].data.story.range.trim() === batch.data.story.range.trim());
      const batches = sameStory ? [...existing, batch] : [batch];
      chapterBatchSessionsRef.current.set(conversationId, batches);
      const merged = mergeChapterBatches(batches.map((item) => item.data));
      void writeChapterOutlineDraft(project?.path, {
        conversationId,
        title: merged.title,
        batches,
        updatedAt: Date.now(),
      });
      const next = nextChapterBatchRange(merged);

      if (next) {
        setSaveStatus(`章纲已生成 ${merged.chapters.length} 章，正在继续生成第 ${next.from}–${next.to} 章…`);
        setPendingChapterBatch({
          conversationId,
          prompt: buildChapterBatchPrompt({ data: merged, batch: next }),
        });
        return true;
      }

      // 全部批次到齐：先做完整性校验 + 卷纲交叉校验，只重写有问题的批次
      const problems = [
        ...validateChapterOutlineData(merged).problems,
        ...(await collectVolumeCrossProblems(merged)),
      ];
      if (problems.length > 0) {
        const repairKey = outlineRepairAttemptsKey("chapter", conversationId);
        const attempts = outlineRepairAttemptsRef.current.get(repairKey) ?? 0;
        const targetChapters = collectProblemChapterNumbers(problems);
        if (attempts < 1 && targetChapters.length > 0) {
          outlineRepairAttemptsRef.current.set(repairKey, attempts + 1);
          setSaveStatus("检测到章纲内容不完整，正在自动补全有问题的批次…");
          setPendingChapterBatch({
            conversationId,
            prompt: buildChapterBatchPrompt({
              data: merged,
              batch: { from: targetChapters[0], to: targetChapters[targetChapters.length - 1] },
              problems,
            }),
          });
          return true;
        }
        showOutlineAutoSaveError(
          `章纲内容仍不完整（${problems.length} 项）：${problems[0]}已保留当前内容，可确认后写入。`,
        );
      }

      chapterBatchSessionsRef.current.delete(conversationId);
      void clearChapterOutlineDraft(project?.path);
      // 正文由软件从合并后的数据生成：模型不再重复写一遍 MD（省一半输出 token）
      const md = renderChapterOutlineMarkdown(merged);
      presentOrQueueSaveBatch({
        title: "请确认要保存的章纲文件",
        mode: "normal",
        requests: [buildChapterOutlineSaveRequest(merged, md)],
        characterDrafts: [],
      });
      setSaveStatus(
        problems.length > 0
          ? `章纲 ${merged.chapters.length} 章已合并（有 ${problems.length} 项待修，仍可保存）。`
          : `章纲 ${merged.chapters.length} 章已全部生成，请确认后写入。`,
      );
      return true;
    },
    [presentOrQueueSaveBatch, collectVolumeCrossProblems, project],
  );

  const handleAutoSaveOutlineRequests = useCallback(
    async (
      conversationId: string,
      assistantContent: string,
      canApply: () => boolean,
      assistantId?: string,
    ) => {
      if (!project || !canApply()) return;
      // 新一轮校验开始：先撤掉上一条报告，内容补齐后它应当自己消失。
      attachOutlineSaveReport(conversationId, assistantId, null);
      const filteredOutput = filterOutlineGeneratedContent(assistantContent);
      if (filteredOutput.reasoningOnly || !filteredOutput.content) return;
      const safeAssistantContent = filteredOutput.content;
      // 章纲分批：本批只收集数据，全部到齐后由软件合并保存（不在此处落盘）
      if (await advanceChapterOutlineBatches(conversationId, safeAssistantContent)) return;
      // 降级路径：AI 未按分批输出（直接给了整份 chapterOutlineData + outlineSaveRequest）时，
      // 仍走下面的统一校验（章节数与骨架一致、逐章 17 节、卷纲交叉校验），不会静默保存残缺章纲。
      const parsed = parseOutlineSaveRequests(safeAssistantContent);
      // 事件细纲只作为对话消息 + 卡片存在，不再写进 wiki/outlines/事件细纲/。
      // 生成侧已经不再要求模型输出 outlineSaveRequest，这里是兜底闸门：
      // 手工或计划模式绕过来的 event-outline 请求一律丢掉，既不弹确认框也不落盘。
      const { requests: saveRequests, droppedEventOutlineCount } =
        excludeEventOutlineSaveRequests(parsed.requests);
      /*
       * 闸门的判定抽在 decideOutlineAutoSaveGate（纯函数，见 lib/outline-save.ts）：
       * 这里只负责把判定翻成可见效果。判据本身有单测直喂已分类的 event-outline，
       * 因为「删掉这几行 return」在组件层是看不出来的（源码文本断言管不住行为）。
       */
      const gateAction = decideOutlineAutoSaveGate({
        droppedEventOutlineCount,
        keptRequestCount: saveRequests.length,
        errors: parsed.errors,
        eventOutlineRejectionCount: parsed.eventOutlineRejectionCount,
      });
      if (gateAction === "drop-event-outline") return;
      if (gateAction === "continue" && saveRequests.length === 0) {
        if (!isSaveableOutlineDeliverable(safeAssistantContent)) return;
        const built = buildClassifiedOutlineSaveRequest({
          content: safeAssistantContent,
          sourceIntent: "生成完成后自动保存",
          sourceHint: collectOutlineSaveSourceHint(conversationId),
        });
        if (!built || !canApply()) return;
        // 与上面的过滤同一道闸门，只是走的是「没有保存请求、靠正文分类」这条腿：
        // 分类结果若是事件细纲，同样不弹确认框（否则丙-1 的目标会被这条腿绕过）。
        if (isEventOutlineSaveBlocked(built.classification.fileType)) return;
        if (built.classification.fileType === "character") {
          const extracted = extractCharacterSaveDrafts(built.draft.content);
          if (extracted.drafts.length === 0) return;
          presentOrQueueSaveBatch({
            title: "请确认要保存的人物角色",
            mode: "character",
            requests: [],
            characterDrafts: enrichCharacterDraftsWithHtml(extracted.drafts, safeAssistantContent),
          });
          setSaveStatus("检测到人物小传，请确认要保存的人物角色。");
          return;
        }
        presentOrQueueSaveBatch({
          title: "请确认要保存的大纲文件",
          mode: "normal",
          requests: [built.request],
          characterDrafts: [],
        });
        setSaveStatus("检测到可保存大纲，请确认后写入。");
        return;
      }
      /*
       * 只有错误里**还有非事件细纲的**才弹那条「请让 AI 重新输出
       * outlineSaveRequest」的提示。事件细纲请求在本版本里本来就要丢掉，
       * 为它去要求模型重出一遍是自相矛盾（重出一次还是会被丢掉）。
       */
      if (gateAction === "surface-parse-errors") {
        showOutlineAutoSaveError(formatOutlineSaveParseFeedback(parsed.errors));
        return;
      }
      if (gateAction === "notify-event-outline-dropped") {
        /*
         * 这里原本调的是 setSaveStatus，而它开头就是
         * `if (!/(失败|错误|不支持|无法)/.test(message)) return` ——
         * 这句话四个词一个都不含，于是**什么都不会发生**：
         * 用户看不到任何反馈，只看到「点了没反应」。改用 toast.info。
         */
        toast.info("事件细纲只作为对话消息保留，不写入大纲列表。");
        return;
      }

      if (!canApply()) return;
      try {
        const split = splitConfirmRequiredSaveRequests(saveRequests);
        const characterRequests = split.confirmRequired.filter(
          (request) => request.fileType === "character",
        );
        const normalRequests = split.confirmRequired.filter(
          (request) => request.fileType !== "character",
        );

        // 卷纲结构化数据校验（零 token）：数据不完整则自动修复一次，仍失败才放行强制保存
        const volumeRequests = normalRequests.filter(
          (request) => request.fileType === "volume-outline",
        );
        const volumeValidation = volumeRequests.length > 0
          ? (() => {
              const data = extractVolumeOutlineData(safeAssistantContent);
              const result = validateVolumeOutlineData(data, volumeRequests[0].content);
              return {
                count: result.problems.length,
                problems: result.problems,
                text: result.problems.join("；"),
                fileName: volumeRequests[0].fileName,
              };
            })()
          : { count: 0, problems: [] as string[], text: "", fileName: "" };
        if (volumeValidation.count > 0) {
          const repairKey = outlineRepairAttemptsKey("volume", conversationId);
          const attempts = outlineRepairAttemptsRef.current.get(repairKey) ?? 0;
          if (attempts < 1) {
            outlineRepairAttemptsRef.current.set(repairKey, attempts + 1);
            setSaveStatus("检测到卷纲内容不完整，正在自动补全…");
            setPendingVolumeRepair({
              conversationId,
              prompt: buildVolumeOutlineRepairPrompt({
                fileName: volumeValidation.fileName,
                problemsText: volumeValidation.text,
              }),
            });
            return;
          }
          const shown = volumeValidation.text.length > 120
            ? `${volumeValidation.text.slice(0, 120)}…`
            : volumeValidation.text;
          // 明细挂在生成结果下方（可逐条展开），浮层只留一句指路。
          attachOutlineSaveReport(conversationId, assistantId, {
            fileName: volumeValidation.fileName,
            fileType: "volume-outline",
            problems: volumeValidation.problems,
            repairAttempted: true,
          });
          showOutlineAutoSaveError(
            `卷纲内容仍不完整（${volumeValidation.count} 项）：${shown}。明细已列在该条消息下方；可保存当前内容，或让 AI 重新生成。`,
          );
        }

        // 章纲结构化数据校验（零 token）：与卷纲同机制，不完整则自动补全一次
        const chapterRequests = normalRequests.filter(
          (request) => request.fileType === "chapter-outline",
        );
        const chapterValidation = chapterRequests.length > 0
          ? await (async () => {
              const data = extractChapterOutlineData(safeAssistantContent);
              const problems = [...validateChapterOutlineData(data).problems];
              // 有卷纲结构化数据（伴生 .json）时，做「卷纲 ↔ 章纲」交叉校验
              if (data) problems.push(...(await collectVolumeCrossProblems(data)));
              return {
                count: problems.length,
                problems,
                text: problems.join("；"),
                fileName: chapterRequests[0].fileName,
              };
            })()
          : { count: 0, problems: [] as string[], text: "", fileName: "" };
        if (chapterValidation.count > 0) {
          const repairKey = outlineRepairAttemptsKey("chapter", conversationId);
          const attempts = outlineRepairAttemptsRef.current.get(repairKey) ?? 0;
          if (attempts < 1) {
            outlineRepairAttemptsRef.current.set(repairKey, attempts + 1);
            setSaveStatus("检测到章纲内容不完整，正在自动补全…");
            setPendingChapterRepair({
              conversationId,
              prompt: [
                "系统检测到上一轮章纲内容不完整，无法渲染章纲卡片流，问题如下：",
                `- ${chapterValidation.fileName}：${chapterValidation.text}`,
                "请重新输出完整章纲：只输出一个 ```json 围栏的 chapterOutlineData（**不要写 MD 正文**，正文与卡片流由软件从数据生成）—— story 骨架（index/name/range/beats）必须与卷纲一致；chapters 必须写满该故事每一章，每章写满 17 节（§1~§17），并带对齐字段 stage/beat/expect/time/place/seedFores/payFores；§5 核心事件链 ≥6 条且每条含 what/cause/action/result/use；§6 必要条件 enter/trigger/interact/result 四类齐全；§8 moodCurve 写满 4 节点；§10 expand 至少 1 条且含 info/how；§11 visual.env 与 visual.memory 必须有内容；§13 castChanges 至少 1 条；§14 worldUpdate 至少一项有内容；§17 checks 覆盖 10 条固定项；各章节拍必须与 story.beats 逐字一致；第 N 章 handover.nextStart 必须与第 N+1 章 carry.hook 呼应；payFores 必须在更早章节的 seedFores 出现过；再输出 outlineSaveRequest（content 留空字符串，文件名「章纲-第XX–XX章.md」，不要写 HTML）。禁止任何省略写法。",
              ].join("\n"),
            });
            return;
          }
          const shown = chapterValidation.text.length > 120
            ? `${chapterValidation.text.slice(0, 120)}…`
            : chapterValidation.text;
          attachOutlineSaveReport(conversationId, assistantId, {
            fileName: chapterValidation.fileName,
            fileType: "chapter-outline",
            problems: chapterValidation.problems,
            repairAttempted: true,
          });
          showOutlineAutoSaveError(
            `章纲内容仍不完整（${chapterValidation.count} 项）：${shown}。明细已列在该条消息下方；可保存当前内容，或让 AI 重新生成。`,
          );
        }

        if (characterRequests.length > 0) {
          const characterContent = characterRequests
            .map((request) => request.content)
            .join("\n\n");
          const extracted = extractCharacterSaveDrafts(characterContent);
          const characterDrafts = enrichCharacterDraftsWithHtml(
            extracted.drafts.length > 0
              ? extracted.drafts
              : buildFallbackCharacterDraftsFromRequests(characterRequests),
            safeAssistantContent,
          );
          const characterBatch: SaveConfirmBatch = {
            title: "请确认要保存的人物角色",
            mode: "character",
            requests: [],
            characterDrafts,
          };
          const normalBatch: SaveConfirmBatch | null = normalRequests.length > 0
            ? {
                title: "请确认要保存的大纲文件",
                mode: "normal",
                requests: normalRequests,
                characterDrafts: [],
              }
            : null;

          // 若当前已有未确认的 normal dialog：先合并同轮 normal，再把人物入队
          // 否则：先展示/入队人物，同轮 normal 跟在人物之后
          if (normalBatch && saveConfirmStateRef.current?.mode === "normal") {
            presentOrQueueSaveBatch(normalBatch);
            presentOrQueueSaveBatch(characterBatch);
            setSaveStatus("检测到可保存大纲，请确认后写入。");
          } else {
            presentOrQueueSaveBatch(characterBatch);
            if (normalBatch) {
              pendingSaveBatchesRef.current.push(normalBatch);
            }
            setSaveStatus(
              extracted.drafts.length > 0
                ? "检测到人物小传，请确认要保存的人物角色。"
                : `无法自动拆分角色，请在保存前检查文件名和内容。${extracted.errors.join("；")}`,
            );
          }
        } else if (normalRequests.length > 0) {
          presentOrQueueSaveBatch({
            title: "请确认要保存的大纲文件",
            mode: "normal",
            requests: normalRequests,
            characterDrafts: [],
          });
          setSaveStatus("检测到可保存大纲，请确认后写入。");
        }

        if (parsed.errors.length > 0 && characterRequests.length === 0 && normalRequests.length === 0) {
          showOutlineAutoSaveError(
            [...parsed.errors].slice(0, 2).join("；"),
          );
        }
      } catch (error) {
        if (!canApply()) return;
        showOutlineAutoSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [collectOutlineSaveSourceHint, presentOrQueueSaveBatch, project, advanceChapterOutlineBatches, collectVolumeCrossProblems],
  );

  const handleSend = useCallback(
    async (
      inputText: string,
      tokens: ReferenceToken[] = [],
      options: {
        disableWriteTools?: boolean;
        preferredSkillNames?: string[];
        enableMultiAgent?: boolean;
        forceRefresh?: boolean;
        conversationId?: string;
        clearDraft?: boolean;
        intentPhase?: "intent_analysis" | "generation" | "waiting_user_input";
        /** 计划模式的要素盘点轮；正文生成腿仍复用 intentPhase: "generation"。 */
        planPhase?: OutlinePlanPhase;
        planModule?: string;
        novelGenerationRequest?: NovelGenerationRequestPackage;
        systemGenerated?: boolean;
        userMessageVisibility?: "visible" | "internal";
        userDisplayText?: string;
        /**
         * 事件细纲的硬要求。挂在**这一轮创建的助手消息**上，
         * 让卡片渲染时不必依赖模型把要求回抄进 JSON（见 outline-chat-store 的同名字段）。
         *
         * 事件细纲向导已删（丙-2c），当前只有「继续」这条重发路径会传进来
         * —— `handleContinueStopped` 从被停止的那条消息上把它抄过来。
         */
        eventOutlineRequirement?: string;
      } = {},
    ): Promise<OutlineSendResult> => {
      let prompt = inputText.trim();
      if (!prompt || !project) return { started: false, sent: false };
      const requestedConversationId = options.conversationId ?? activeConversationId;
      const requestedRunState = requestedConversationId
        ? useOutlineChatStore.getState().runStates[requestedConversationId]
        : undefined;
      if (requestedRunState?.status === "running") return { started: false, sent: false };
      let convId = requestedConversationId;
      if (!convId) convId = createConversation();
      // 章纲分批续跑：第 1 批的生成腿若发现上次未完成的草稿，就不从第 1 批重写，
      // 直接把提示词换成「继续生成下一批」，并把草稿批次放回本会话，省掉重复生成。
      if (prompt.includes(CHAPTER_OUTLINE_FIRST_BATCH_MARKER)) {
        const draft = await readChapterOutlineDraft(project.path);
        if (draft && draft.conversationId === convId) {
          const resumePrompt = buildChapterOutlineResumePrompt(draft);
          if (resumePrompt) {
            chapterBatchSessionsRef.current.set(convId, draft.batches);
            prompt = resumePrompt;
            setSaveStatus(`检测到未完成的章纲草稿（已完成 ${mergeChapterBatches(draft.batches.map((item) => item.data)).chapters.length} 章），正在继续生成…`);
          } else {
            void clearChapterOutlineDraft(project.path);
          }
        }
      }
      let effectiveLlmConfig = resolveNovelModel(
        llmConfig,
        novelConfig,
        "writing",
      );
      const targetConversation = options.conversationId
        ? useOutlineChatStore.getState().conversations.find((conversation) => conversation.id === options.conversationId)
        : activeConv;
      if (effectiveOutlineModelId) {
        effectiveLlmConfig = resolveModelConfig(
          effectiveOutlineModelId,
          effectiveLlmConfig,
          providerConfigs,
        );
      }
      // Intent analysis and plan element-check turns are the orchestration
      // half of the outline loop; only generation turns actually emit outline
      // content, so only they take the footer's thinking depth. Stamping it
      // here rather than at the request keeps the budget planner below in
      // sync, since it derives its output floor from `config.reasoning`.
      const outlineModeForBudget = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      const discussPhase: OutlineDiscussPhase | undefined =
        outlineModeForBudget === "discuss" && options.intentPhase !== "generation"
          ? "decision"
          : undefined;
      const outlineBudgetStage: OutlineBudgetStage = options.intentPhase === "intent_analysis"
        || options.planPhase !== undefined
        || discussPhase !== undefined
        ? "analysis"
        : "generation";
      if (outlineBudgetStage === "generation") {
        effectiveLlmConfig = applyReasoningDepth(effectiveLlmConfig, aiOutlineReasoningDepth);
      }
      const effectiveModelId = effectiveOutlineModelId || effectiveLlmConfig.model || "";
      if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "请先在设置中配置并选择一个可用的 AI 模型，或在下方模型选择器中选择模型后再试。",
        });
        return { started: false, sent: false };
      }
      /*
       * 两种原因必须分开说（用户已经踩过）：
       * ① 供应商那边关掉了 Function Calling —— 这不是「模型不支持」，
       *    而是用户自己的开关，提示必须指向那个开关；
       * ② 模型确实在黑名单里。
       *
       * 为什么关掉开关也不能让大纲对话照跑：它的产出全靠 write_outline_node
       * 落到 wiki/outlines，没有工具时模型只会回一段没人保存的文本
       * （界面看着像成功了，文件却没变），比直接拦下更误导。
       */
      if (!isFunctionCallingEnabled(effectiveLlmConfig)) {
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "当前供应商已关闭「启用 Function Calling」，AI 大纲需要工具调用才能把结果写入大纲文件。请到设置 → 模型设置中打开该开关，或更换支持工具调用的模型。",
        });
        return { started: false, sent: false };
      }
      if (!modelSupportsTools(effectiveModelId, effectiveLlmConfig.provider)) {
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "当前模型不支持 AI 大纲工具调用，请在下方模型选择器中更换支持工具调用的模型。",
        });
        return { started: false, sent: false };
      }

      const capturedConvId = convId;
      const runId = crypto.randomUUID();
      if (!startConversationRun(capturedConvId, runId)) return { started: false, sent: false };
      const controller = new AbortController();
      outlineConversationRunRegistry.register(capturedConvId, controller);
      const isCurrentRun = () => canApplyOutlineRunEffect(
        useOutlineChatStore.getState().runStates,
        capturedConvId,
        runId,
      );
      const setCapturedWorkflowStage = (stage: OutlineWorkflowStage) => {
        if (!isCurrentRun()) return { started: true, sent: false };
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, stage));
      };
      // 沿允许的转移链推进阶段，链路走不通就停在最后一个合法阶段
      const advanceCapturedWorkflowStages = (targets: OutlineWorkflowStage[]) => {
        if (!isCurrentRun()) return;
        setOutlineWorkflowStages((stages) => {
          let stage = stages[capturedConvId] ?? "idle";
          for (const target of targets) {
            if (stage === target) continue;
            if (!canTransitionOutlineWorkflow(stage, target)) break;
            stage = target;
          }
          return setOutlineSessionValue(stages, capturedConvId, stage);
        });
      };
      // 计划模式的停机态要留在界面上等用户操作，不能被收尾复位成 idle
      const resetCapturedWorkflowStageToIdle = () => {
        if (!isCurrentRun()) return;
        setOutlineWorkflowStages((stages) => {
          const stage = stages[capturedConvId] ?? "idle";
          if (stage === "collecting_requirements" || stage === "waiting_user_confirm") return stages;
          return setOutlineSessionValue(stages, capturedConvId, "idle");
        });
      };
      if (discussPhase) {
        advanceCapturedWorkflowStages(["collecting_requirements"]);
      }
      if (shouldClearOutlineDraft({
        clearDraft: options.clearDraft !== false,
        invocationConversationId: capturedConvId,
        activeConversationId: useOutlineChatStore.getState().activeConversationId,
      })) {
        setInputValue("");
        outlineReferenceTokensRef.current = [];
        setOutlineReferenceTokens([]);
      }

      const historyBeforeSend = mapOutlineMessagesForModel(
        useOutlineChatStore
          .getState()
          .conversations.find((c) => c.id === convId)?.messages ?? [],
      ) satisfies AgentMessage[];
      const hasPriorAssistantAnswer = historyBeforeSend.some(
        (message) => message.role === "assistant" && message.content.trim(),
      );
      const outlineMode = outlineModeForBudget;
      // 共创模式靠自然语言来回讨论推进，多 Agent 编排会直接产出成品，绕过讨论
      const enableMultiAgent = Boolean(options.enableMultiAgent)
        && outlineMode !== "fast"
        && outlineMode !== "discuss";
      const planTargetModule = options.planModule
        ?? intentContextsRef.current[capturedConvId]?.title
        ?? "大纲";
      const forceRefresh = options.forceRefresh === true || forceRefreshNext;
      const contextDecision = planOutlineContextReuse({
        hasPriorAssistantAnswer,
        attachedReferenceCount: tokens.length,
        inputText: prompt,
        enableMultiAgent,
        forceRefresh,
        systemGenerated: options.systemGenerated,
        workflowMode: outlineMode,
        intentPhase: options.intentPhase,
        planPhase: options.planPhase,
        discussPhase,
      });
      const cachedSummary =
        contextDecision.mode === "reuse"
          ? useOutlineChatStore
              .getState()
              .conversations.find((conversation) => conversation.id === convId)
              ?.contextSummary?.text
          : undefined;
      let historyPlan = planOutlineAgentHistory({
        history: historyBeforeSend,
        contextDecision,
        cachedSummary,
        workflowMode: outlineMode,
        intentPhase: options.intentPhase,
        planPhase: options.planPhase,
        discussPhase,
        enableMultiAgent,
      });
      if (forceRefreshNext) {
        setForceRefreshNext(false);
      }
      /*
       * 丁-4：本条消息 `@` 引用的**角色灵魂** → 本条消息的临时绑定。
       *
       * ⚠️ 位置是本段的关键：必须在 `addMessage(convId, userMsg)` **之前**。
       * 确认弹窗可能在用户取消时结束，那时一条消息都还没落地 ——
       * 若放在消息之后，取消会留下「有提问、没有回复」的残局。
       *
       * 顺序：先问（`requestSoulBindingTarget`）→ 再写（`beginMessageScopedSoulBinding`）
       * → 再走下面真正读盘组装上下文的 `contextHub.prepare`。
       * 写盘晚于 `contextHub.prepare` 是无效的：那个调用就是读
       * `.qmai/character-aura.json` 的地方，晚一步这条灵魂进不了本次上下文。
       *
       * 释放统一放在本函数的 `finally`（覆盖成功、抛错、中止），不去逐条 return 打补丁。
       */
      const referencedSoulAuraIds = collectReferencedSoulAuraIds(tokens);
      if (referencedSoulAuraIds.length > 1) {
        toast.info(
          `一条消息只能引用一条角色灵魂（本次引用了 ${referencedSoulAuraIds.length} 条）。请删掉多余的灵魂引用再发送。`,
          { dedupeKey: `outline-soul-multi:${capturedConvId}` },
        );
        return { started: false, sent: false };
      }
      let messageSoulBinding: MessageScopedSoulBinding | null = null;
      const releaseMessageSoulBinding = async () => {
        const binding = messageSoulBinding;
        messageSoulBinding = null;
        if (!binding) return;
        try {
          await releaseMessageScopedSoulBinding(normalizePath(project.path), binding);
          // 绑定表没有 zustand 镜像，界面只能靠 dataVersion 触发重新读盘。
          useWikiStore.getState().bumpDataVersion();
        } catch (error) {
          // 没还回去是用户必须知道的状态，不静默吞。
          toast.error(
            error instanceof Error && error.message ? error.message : "还原临时角色灵魂绑定失败",
            { title: "临时角色灵魂绑定未还原", persistent: true, dedupeKey: `outline-soul-release:${capturedConvId}` },
          );
        }
      };
      if (referencedSoulAuraIds.length === 1) {
        const referencedAuraId = referencedSoulAuraIds[0];
        const targetCharacterName = await requestSoulBindingTarget(referencedAuraId);
        // `null` = 用户取消：直接中止，绝不用默认人物顶上。
        if (!targetCharacterName) return { started: false, sent: false };
        try {
          messageSoulBinding = await beginMessageScopedSoulBinding(normalizePath(project.path), {
            auraId: referencedAuraId,
            characterName: targetCharacterName,
          });
        } catch (error) {
          // 「请先在大纲中添加人物小传或人物设定，再绑定角色灵魂」这类原话原样转达。
          toast.error(
            error instanceof Error && error.message ? error.message : "绑定角色灵魂失败，请稍后重试",
            { title: "角色灵魂绑定失败", persistent: true, dedupeKey: `outline-soul-bind:${capturedConvId}` },
          );
          return { started: false, sent: false };
        }
        // 角色灵魂列表随项目内容变化：绑定后让弹窗列表重新读盘。
        useWikiStore.getState().bumpDataVersion();
      }
      const userMsg: OutlineChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: options.userDisplayText ?? options.novelGenerationRequest?.summary ?? prompt,
        ...(options.userDisplayText || options.userMessageVisibility === "internal"
          ? { modelContent: prompt }
          : {}),
        visibility: options.userMessageVisibility ?? "visible",
        novelGenerationRequest: options.novelGenerationRequest,
        attachedReferences: tokens,
      };
      const initialSources = tokens.map(
        (token) =>
          `@${referenceCategoryLabel(token.category)}: ${token.title || token.displayTitle}`,
      );
      const contextSources = [
        `上下文: ${contextDecision.sourceLabel}`,
        `原因: ${contextDecision.reason}`,
        ...historyPlan.sources,
      ];
      const assistantId = crypto.randomUUID();
      addMessage(convId, userMsg);
      addMessage(convId, {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: [...contextSources, ...initialSources],
        agentToolCalls: [],
        showThinkingProcess: historyPlan.showThinkingProcess,
        isAgentRunning: true,
        intentPhase: options.intentPhase,
        outlinePlanPhase: options.planPhase,
        outlineDiscussPhase: discussPhase,
        generationTiming: { startedAt: Date.now() },
        // 与消息在同一个对象字面量里落地：要求不会与它所属的那条回复错配。
        ...(options.eventOutlineRequirement?.trim()
          ? { eventOutlineRequirement: options.eventOutlineRequirement.trim() }
          : {}),
      });
      clearStreamingContent(capturedConvId);
      userScrolledUpRef.current = false;
      let hiddenToolCalls: AgentRunRecord["toolCalls"] = [];
      let followUpGenerationPrompt: string | null = null;
      let followUpReferences: ReferenceToken[] = [];
      let contextHubResult: ContextHubResult | null = null;
      let providerUsage: LlmUsage | undefined;
      let lastProviderUsage: LlmUsage | undefined;
      let memoryDecision: UserMemoryDecision | null | undefined;
      let llmRequestCount = 0;
      let providerRequestCountAvailable = true;
      const requestTraceCollector = new LlmRequestTraceCollector();
      let accumulatedReasoningContent = "";
      const missingSkillNames = new Set<string>();
      // 已生成的用户可见文本。streamingContents 只承载状态提示不存内容，
      // 出错/中断时必须依靠这个变量判断有没有可保留的内容，
      // 避免整段结果被静默丢弃。
      let bestGeneratedText = "";
      let deliverableTruncated = false;
      const outlineRequestBudget = planOutlineRequestBudget({
        maxContextSize: effectiveLlmConfig.maxContextSize,
        stage: outlineBudgetStage,
        maxOutputTokens: getEffectiveMaxOutputTokens(effectiveLlmConfig),
        thinkingFloorTokens: thinkingMinMaxTokens(effectiveLlmConfig.reasoning ?? { mode: "auto" }),
      });

      try {
        const contextHub = getContextHub(normalizePath(project.path));
        contextHubResult = await contextHub.prepare({
          projectPath: normalizePath(project.path),
          surface: "ai-outline",
          sessionId: capturedConvId,
          task: prompt,
          intent: options.intentPhase === "generation" ? "generate" : "question",
          references: tokens.map(describeReferenceForOutlineAgent),
          messages: historyBeforeSend,
          existingSummary: forceRefresh ? undefined : targetConversation?.contextSummary,
          tokenBudget: outlineRequestBudget.contextTokenBudget,
          maxContextSize: effectiveLlmConfig.maxContextSize,
          forceRefresh,
        });
        if (contextHubResult) {
          try {
            const contextHubSnapshot = await contextHub.saveSnapshot(assistantId, contextHubResult);
            if (isCurrentRun()) {
              updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                ...message,
                contextHubSnapshot,
              }));
            }
          } catch (error) {
            console.warn("AI 大纲上下文快照保存失败，继续生成：", error);
          }
        }
        if (contextHubResult && contextDecision.mode === "reuse") {
          historyPlan = planOutlineAgentHistory({
            history: historyBeforeSend,
            contextDecision,
            cachedSummary: contextHubResult.sessionSummary || undefined,
            summaryInSystem: true,
            workflowMode: outlineMode,
            intentPhase: options.intentPhase,
            discussPhase,
            enableMultiAgent,
          });
        }

        let webResearchMarkdown = "";
        let outlineSources = [...initialSources];
        if (shouldUseWebResearch(prompt)) {
          const webResearch = await collectWebResearch({
            text: prompt,
            searchApiConfig: useWikiStore.getState().searchApiConfig,
            maxSearchResults: 5,
            maxImportedDocuments: 4,
          });
          const webResearchContext = buildWebResearchContext(webResearch);
          if (webResearchContext.markdown.trim()) {
            webResearchMarkdown = webResearchContext.markdown;
          }
          outlineSources = [...outlineSources, ...webResearchContext.sources];
        }

        let result = "";
        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const planModule = options.planPhase ? planTargetModule : undefined;
        const discussModule = discussPhase ? planTargetModule : undefined;
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: outlineMode,
          planModule,
          discussModule,
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          webResearchContext: webResearchMarkdown,
          soulDoc,
          mode: outlineMode,
          planModule,
          discussModule,
        }) + `\n\n## 本轮上下文策略\n${contextDecision.instruction}\n\n${historyPlan.instruction}`;
        const commonDynamicParts = [
          webResearchMarkdown ? `## 本轮联网资料\n${webResearchMarkdown}` : "",
          `## 本轮上下文策略\n${contextDecision.instruction}\n\n${historyPlan.instruction}`,
        ];
        const buildOutlineRunSystemContent = (extraRules = ""): AgentMessage["content"] => (
          contextHubResult
            ? buildContextHubSystemContent(baseSystemPrompt, contextHubResult, [
                ...commonDynamicParts,
                extraRules,
              ])
            : [legacySystemPrompt, extraRules].filter(Boolean).join("\n\n")
        );
        const buildSubAgentSystemContent = (plan: OutlineSubAgentPlan, extraRules: string): AgentMessage["content"] => {
          if (!contextHubResult) return [legacySystemPrompt, extraRules].filter(Boolean).join("\n\n");
          return [
            { type: "text", text: baseSystemPrompt.trim() ? `${baseSystemPrompt.trim()}\n\n` : "" },
            {
              type: "text",
              text: `## 子 Agent 局部上下文\n${buildScopedOutlineSubAgentContext(contextHubResult.contextPack, plan.kind)}`,
              cacheControl: true,
            },
            {
              type: "text",
              text: [contextHubResult.sessionSummary ? `## 当前会话摘要\n${contextHubResult.sessionSummary}` : "", ...commonDynamicParts, extraRules]
                .filter(Boolean).join("\n\n"),
            },
          ];
        };
        const intentPhaseRules = buildIntentPhaseSystemRules(options.intentPhase);
        const primarySystemContent = buildOutlineRunSystemContent(intentPhaseRules);
        const systemPrompt = typeof primarySystemContent === "string"
          ? primarySystemContent
          : flattenContextHubSystemContent(primarySystemContent);
        const agentMessages: AgentMessage[] = [
          { role: "system", content: primarySystemContent },
          ...historyPlan.messages,
          {
            role: "user",
            content: buildOutlineAgentUserContent(prompt, tokens),
          },
        ];
        const allToolCalls: AgentRunRecord["toolCalls"] = [];
        const buildConfigForSkillNames = (
          skillNames: string[] | undefined,
          disableWriteTools: boolean | undefined,
          budgetStage: OutlineBudgetStage = outlineBudgetStage,
        ) => {
          const registry = new ToolRegistry();
          const skillResolution = resolveAvailableSkillsByNames(
            outlineWritingSkills,
            skillNames ?? [],
          );
          for (const name of skillResolution.missingNames) missingSkillNames.add(name);
          const effectiveOutlineWritingSkills = prioritizeOutlineSkills(
            outlineWritingSkills,
            skillNames,
          );
          const agentConfig = buildAgentConfig(
            effectiveModelId,
            systemPrompt,
            registry,
            {
              wikiPath: `${normalizePath(project.path)}/wiki`,
              getSkillConfig: () => skillConfig,
              getUserSkills: () => effectiveOutlineWritingSkills,
              getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
              getChatConversations: () => {
                const state = useChatStore.getState();
                return state.conversations.map((conversation) => ({
                  id: conversation.id,
                  title: conversation.title,
                  messages: state.messages
                    .filter(
                      (message) => message.conversationId === conversation.id,
                    )
                    .map((message) => ({
                      role: message.role,
                      content: message.content,
                    })),
                }));
              },
              getOutlineConversations: () =>
                mapOutlineConversationsForModel(
                  useOutlineChatStore.getState().conversations,
                ),
              llmConfig: effectiveLlmConfig,
              disabledTools: mergeDisabledTools(
                disableWriteTools
                  ? OUTLINE_CHAT_WIZARD_DISABLED_TOOLS
                  : OUTLINE_CHAT_DISABLED_TOOLS,
                contextDecision.disabledTools,
                (skillNames?.length ?? 0) > 0 ? ["apply_skill"] : [],
              ),
              ...(contextHubResult
                ? { readTextFile: contextHubResult.readFile }
                : {}),
            },
          );
          const requestBudget = budgetStage === outlineBudgetStage
            ? outlineRequestBudget
            : planOutlineRequestBudget({
                maxContextSize: effectiveLlmConfig.maxContextSize,
                stage: budgetStage,
                maxOutputTokens: getEffectiveMaxOutputTokens(effectiveLlmConfig),
                thinkingFloorTokens: thinkingMinMaxTokens(
                  effectiveLlmConfig.reasoning ?? { mode: "auto" },
                ),
              });
          return {
            agentConfig: {
              ...agentConfig,
              requestOverrides: {
                ...agentConfig.requestOverrides,
                max_tokens: requestBudget.outputTokens,
                userMemorySurface: "ai-outline" as const,
                userMemoryProjectKey: normalizePath(project.path),
                userMemorySessionKey: capturedConvId,
              },
            },
            registry,
            selectedSkills: skillResolution.skills,
          };
        };

        const runOutlineAgentOnce = async (
          messages: AgentMessage[],
          optionsForRun: {
            skillNames?: string[];
            disableWriteTools?: boolean;
            streamToUser?: boolean;
            statusText?: string;
            budgetStage?: OutlineBudgetStage;
          } = {},
        ): Promise<{ text: string; record: AgentRunRecord; error?: Error; reasoning_content: string }> => {
          const { agentConfig, registry, selectedSkills } = buildConfigForSkillNames(
            optionsForRun.skillNames,
            optionsForRun.disableWriteTools,
            optionsForRun.budgetStage,
          );
          const selectedSkillsPrompt = buildSelectedSkillsPrompt(selectedSkills);
          const runMessages = selectedSkillsPrompt
            ? messages.map((message, index) => index === 0 && message.role === "system"
              ? { ...message, content: appendSystemRules(message.content, selectedSkillsPrompt) }
              : message)
            : messages;
          if (optionsForRun.statusText) {
            if (isCurrentRun()) setStreamingContent(capturedConvId, optionsForRun.statusText);
          }
          return runOutlineAttemptWithReasoningRetry(
            agentConfig,
            async (requestOverrides) => {
              let runText = "";
              let runReasoningContent = "";
              const agentErrorBox: { current: Error | null } = { current: null };
              const record = await new AgentRunner().run(
                { ...agentConfig, requestOverrides },
                registry,
                runMessages,
                {
                  onText: (chunk) => {
                    runText += chunk;
                    if (optionsForRun.streamToUser) {
                      result = runText;
                      bestGeneratedText = result;
                      if (isCurrentRun()) {
                        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                          ...message,
                          content: result,
                        }));
                      }
                    }
                  },
                  onReasoningToken: (chunk) => {
                    runReasoningContent += chunk;
                    accumulatedReasoningContent += chunk;
                  },
                  onToolCall: () => {},
                  onToolResult: () => {},
                  onToolError: () => {},
                  onToolEvent: (event) => {
                    if (!isCurrentRun()) return;
                    if (!historyPlan.showToolProcess) {
                      hiddenToolCalls = applyAgentToolEvent(hiddenToolCalls, event);
                      return;
                    }
                    updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                      ...message,
                      agentToolCalls: applyAgentToolEvent(
                        message.agentToolCalls,
                        event,
                      ),
                    }));
                  },
                  onDone: () => {},
                  onRequestTrace: requestTraceCollector.record,
                  onError: (error) => {
                    agentErrorBox.current = error;
                  },
                },
                controller.signal,
              );
              providerUsage = addLlmUsage(providerUsage, record.usage);
              lastProviderUsage = record.lastRequestUsage ?? record.usage ?? lastProviderUsage;
              if (record.providerRequestCountAvailable === false) {
                providerRequestCountAvailable = false;
              } else {
                llmRequestCount += Math.max(1, record.roundsUsed || 1);
              }
              if (memoryDecision === undefined && record.userMemoryDecision !== undefined) {
                memoryDecision = record.userMemoryDecision;
              }
              allToolCalls.push(...record.toolCalls);
              const agentError = agentErrorBox.current;
              const errMsg = agentError?.message ?? "";
              const isLengthTruncated = errMsg.includes("输出被截断") || errMsg.includes("最大输出 token");
              if (
                agentError
                && !isLengthTruncated
                && !isReasoningOnlyResponseError(agentError)
              ) {
                throw agentError;
              }
              return {
                text: runText || record.finalText,
                record,
                error: agentError ?? undefined,
                reasoning_content: runReasoningContent,
              };
            },
            (thoughtText) => {
              if (controller.signal.aborted || !isCurrentRun()) throw new Error("aborted");
              if (thoughtText.trim()) {
                accumulatedReasoningContent = [accumulatedReasoningContent, thoughtText]
                  .filter((item) => item.trim())
                  .join("\n\n");
              }
              if (optionsForRun.streamToUser) {
                result = "";
                bestGeneratedText = "";
                updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                  ...message,
                  content: "",
                }));
              }
              setStreamingContent(capturedConvId, "模型仅返回思考过程，正在关闭 reasoning 重试...");
            },
          );
        };

        const runSingleAgentFallback = async () => {
          result = "";
          const singleRun = await runOutlineAgentOnce(agentMessages, {
            skillNames: options.preferredSkillNames,
            disableWriteTools: options.disableWriteTools,
            streamToUser: true,
          });
          let text = singleRun.text || "AI大纲未返回内容。";
          if (singleRun.error) {
            if (isOutlineOutputTruncated(singleRun.error)) deliverableTruncated = true;
            const errorMsg = singleRun.error.message;
            text = text + "\n\n---\n\n⚠️ **注意**：" + errorMsg + "\n\n您可以在新消息中输入\"继续\"来让模型补全剩余内容，或点击保存尝试保存已生成的内容。";
          }
          return text;
        };

        let finalText = "";
        let capturedSuccessfulResults: OutlineSubAgentResult[] = [];

        const currentIntentContext = intentContextsRef.current[capturedConvId];
        const isCharacterMultiAgentTask =
          options.intentPhase === "generation" &&
          currentIntentContext?.title === "人物小传" &&
          !enableMultiAgent &&
          outlineMode !== "fast";

        if (isCharacterMultiAgentTask) {
          setStreamingContent(capturedConvId, "正在分析需要生成的角色清单...");
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            content: "# 人物小传生成中\n\n正在分析角色清单，请稍候...",
          }));

          const projectContext = [
            targetConversation?.contextSummary?.text,
            contextDecision.instruction,
            historyPlan.instruction,
          ].filter(Boolean).join("\n");

          let characterPlans: CharacterAgentPlan[] = [];
          try {
            const plannerMessages: AgentMessage[] = [
              { role: "system", content: buildOutlineRunSystemContent(buildCharacterPlannerSystemPrompt()) },
              { role: "user", content: buildCharacterPlannerUserPrompt({ userPrompt: prompt, projectContext }) },
            ];
            const plannerRun = await runOutlineAgentOnce(plannerMessages, {
              skillNames: [],
              disableWriteTools: true,
            });
            const plannerResult = parseCharacterPlannerResult(plannerRun.text);
            characterPlans = buildCharacterAgentPlans(plannerResult, prompt, projectContext);
          } catch {
            characterPlans = [];
          }

          if (characterPlans.length === 0) {
            setStreamingContent(capturedConvId, "角色规划未识别到明确角色，按单 Agent 模式生成...");
            finalText = await runSingleAgentFallback();
          } else {
            updateOutlineAssistantMessage(convId, assistantId, (message) => ({
              ...message,
              content: `# 人物小传生成中\n\n共识别到 ${characterPlans.length} 个角色，正在并行生成...`,
            }));

            const completedByIndex: (CharacterAgentResult | null)[] = new Array(characterPlans.length).fill(null);

            const rebuildAccumulated = () => {
              const parts: string[] = ["# 人物小传\n\n"];
              let hasContent = false;
              for (const r of completedByIndex) {
                if (r) {
                  if (hasContent) parts.push("\n\n---\n\n");
                  parts.push(r.content);
                  hasContent = true;
                }
              }
              return parts.join("");
            };

            const multiAgentResult = await runCharacterMultiAgent({
              plans: characterPlans,
              maxConcurrency: 2,
              runCharacterAgent: async (charPlan) => {
                const charMessages: AgentMessage[] = [
                  { role: "system", content: buildOutlineRunSystemContent(buildCharacterAgentSystemPrompt(charPlan)) },
                  ...historyPlan.messages.slice(-2),
                  { role: "user", content: charPlan.taskPrompt },
                ];
                const charRun = await runOutlineAgentOnce(charMessages, {
                  skillNames: options.preferredSkillNames,
                  disableWriteTools: true,
                  streamToUser: false,
                  budgetStage: "generation",
                });
                if (charRun.error && !isOutlineOutputTruncated(charRun.error)) {
                  throw new Error(charRun.error.message);
                }
                if (isOutlineOutputTruncated(charRun.error)) deliverableTruncated = true;
                return charRun.text;
              },
              onCharacterStart: (_charPlan) => {
                if (!isCurrentRun()) return;
              },
              onCharacterComplete: (result) => {
                if (!isCurrentRun()) return;
                completedByIndex[result.plan.index] = result;
                const newContent = rebuildAccumulated();
                bestGeneratedText = newContent;
                updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                  ...message,
                  content: newContent,
                }));
              },
              onCharacterError: (_charPlan, _error) => {
                if (!isCurrentRun()) return;
              },
            });

            if (multiAgentResult.characters.length === 0) {
              finalText = await runSingleAgentFallback();
            } else {
              finalText = `# 人物小传\n\n${multiAgentResult.combinedMarkdown}`;
            }

            updateOutlineAssistantMessage(convId, assistantId, (message) => ({
              ...message,
              characterMultiAgentResults: multiAgentResult.characters,
            }));
          }
        } else if (enableMultiAgent) {
          const maxConcurrency = 3;
          const fallbackSubAgentPlan = planOutlineSubAgents({
            preferredSkillNames: options.preferredSkillNames ?? [],
            taskPrompt: prompt,
            maxConcurrency,
          });
          const plannerPrompt = buildDynamicOutlinePlannerPrompt({
            userTask: prompt,
            projectSummary: [
              targetConversation?.contextSummary?.text,
              contextDecision.instruction,
              historyPlan.instruction,
            ].filter(Boolean).join("\n"),
            existingModules: outlineSources.length > 0 ? outlineSources : ["当前项目尚无可识别的大纲模块"],
            missingModules: ["请根据用户任务、已有模块和项目摘要识别缺失模块"],
            skills: outlineWritingSkills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              stages: skill.stages,
              kinds: skill.kind,
            })),
          });
          let subAgentPlan = fallbackSubAgentPlan;
          try {
            const plannerRun = await runOutlineAgentOnce([
              {
                role: "system",
                content: buildOutlineRunSystemContent(
                  "你只负责规划大纲子 Agent 任务图，不执行大纲生成，不调用工具，只输出 JSON。",
                ),
              },
              { role: "user", content: plannerPrompt },
            ], {
              skillNames: [],
              disableWriteTools: true,
              statusText: "正在动态规划 Agent 任务…",
              budgetStage: "analysis",
            });
            const dynamicPlan = parseDynamicOutlinePlan(
              plannerRun.text,
              outlineWritingSkills.map((skill) => skill.name),
              prompt,
            );
            if (dynamicPlan.ok) subAgentPlan = dynamicPlan.plan;
          } catch {
            // 动态规划失败时保留规则规划，继续使用依赖调度器。
          }
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            multiAgentRun: createOutlineMultiAgentRunState(subAgentPlan, maxConcurrency),
          }));
          const multiAgentResult = await runOutlineMultiAgentWorkflow({
            plan: subAgentPlan,
            maxConcurrency,
            onStatusChange: (event) => {
              if (!isCurrentRun()) return { started: true, sent: false };
              updateOutlineMultiAgentItem(convId, assistantId, event.agentId, (agent) => ({
                ...agent,
                status: event.status === "completed"
                  ? "done"
                  : event.status === "failed"
                    ? "error"
                    : event.status === "retrying"
                      ? "retrying"
                      : event.status === "waiting" || event.status === "ready"
                        ? "waiting"
                        : "running",
                retryCount: Math.max(0, event.attempt - 1),
                startedAt: event.status === "running" && !agent.startedAt ? Date.now() : agent.startedAt,
                finishedAt: event.status === "completed" || event.status === "failed" ? Date.now() : undefined,
                error: event.error,
                summary: event.status === "completed" ? agent.summary ?? "已完成本 Agent 任务。" : agent.summary,
              }));
            },
            runSubAgent: async (subAgentPlan) => {
              if (!isCurrentRun()) throw new Error("aborted");
              updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                ...agent,
                status: "running",
                startedAt: Date.now(),
                error: undefined,
              }));
              const subAgentMessages: AgentMessage[] = [
                {
                  role: "system",
                  content: buildSubAgentSystemContent(subAgentPlan, [
                    "## 子 Agent 运行规则",
                    `当前身份：${subAgentPlan.name}`,
                    "你只能处理本 Agent 负责的维度，禁止写入文件。",
                    "必须输出符合 AI 大纲子 Agent JSON 协议的 JSON，不要输出额外说明。",
                  ].join("\n")),
                },
                ...historyPlan.messages.slice(-2),
                {
                  role: "user",
                  content: buildOutlineAgentUserContent(
                    subAgentPlan.taskPrompt,
                    tokens,
                  ),
                },
              ];
              let subRun: { text: string; record: AgentRunRecord; error?: Error };
              try {
                subRun = await runOutlineAgentOnce(subAgentMessages, {
                  skillNames: subAgentPlan.skillNames,
                  disableWriteTools: true,
                  statusText: `多 Agent 并行生成中...\n正在运行：${subAgentPlan.name}`,
                  budgetStage: "generation",
                });
              } catch (error) {
                if (!isCurrentRun()) throw new Error("aborted");
                const message = error instanceof Error ? error.message : String(error);
                updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                  ...agent,
                  status: "error",
                  error: message,
                  finishedAt: Date.now(),
                }));
                throw error;
              }
              if (subRun.error && !isOutlineOutputTruncated(subRun.error)) {
                const message = subRun.error.message;
                updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                  ...agent,
                  status: "error",
                  error: message,
                  finishedAt: Date.now(),
                }));
                throw new Error(message);
              }
              if (isOutlineOutputTruncated(subRun.error)) deliverableTruncated = true;
              return subRun.text;

            },
            runSingleAgentFallback: async () => {
              if (!isCurrentRun()) throw new Error("aborted");
              updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                ...run,
                mode: "single-agent-fallback",
                status: "fallback",
                merge: run.merge?.status === "error"
                  ? run.merge
                  : {
                      status: "skipped",
                      summary: "\u5df2\u56de\u9000\u4e3a\u5355 Agent \u751f\u6210\u3002",
                    },
                fallbackReason: run.fallbackReason ?? "多 Agent 不可用或部分子 Agent 失败，已自动回退。",
              }) : run);
              if (isCurrentRun()) {
                setStreamingContent(capturedConvId,
                  "多 Agent 生成未能完成，正在按单 Agent 大纲生成继续输出。",
                );
              }
              return runSingleAgentFallback();
            },
            mergeResults: async (subAgentResults) => {
              if (!isCurrentRun()) throw new Error("aborted");
              capturedSuccessfulResults = subAgentResults;
              result = "";
              updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                ...run,
                status: "merging",
                merge: {
                  status: "running",
                  startedAt: Date.now(),
                  summary: `正在合并 ${subAgentResults.length} 个子 Agent 结果。`,
                },
              }) : run);
              const mergeMessages: AgentMessage[] = [
                {
                  role: "system",
                  content: buildOutlineRunSystemContent([
                    "## 合并 Agent 运行规则",
                    "你负责合并多个子 Agent 的结构化结果，形成最终可预览的大纲草稿。",
                    "输出必须是用户可直接阅读和保存的大纲正文，不要输出内部调度报告。",
                  ].join("\n")),
                },
                ...historyPlan.messages.slice(-2),
                {
                  role: "user",
                  content: [
                    "请合并以下 AI 大纲子 Agent 结果，解决冲突并输出最终大纲草稿。",
                    "",
                    "## 原始用户需求",
                    buildOutlineAgentUserContent(prompt, tokens),
                    "",
                    "## 子 Agent 结构化结果",
                    buildBoundedSubAgentMergePayload(subAgentResults),
                  ].join("\n"),
                },
              ];
              let mergeRun: { text: string; record: AgentRunRecord; error?: Error };
              try {
                mergeRun = await runOutlineAgentOnce(mergeMessages, {
                  skillNames: options.preferredSkillNames,
                  disableWriteTools: true,
                  streamToUser: true,
                  statusText: "\u591a Agent \u5df2\u5b8c\u6210\uff0c\u6b63\u5728\u5408\u5e76\u5927\u7eb2\u7ed3\u679c...",
                  budgetStage: "generation",
                });
              } catch (error) {
                if (isCurrentRun()) {
                  const message = error instanceof Error ? error.message : String(error);
                  updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                    ...run,
                    merge: {
                      ...run.merge,
                      status: "error",
                      error: message,
                      finishedAt: Date.now(),
                    },
                  }) : run);
                }
                throw error;
              }
              if (!isCurrentRun()) throw new Error("aborted");
              let mergeText = mergeRun.text || "AI大纲未返回内容。";
              if (mergeRun.error) {
                if (isOutlineOutputTruncated(mergeRun.error)) deliverableTruncated = true;
                mergeText = mergeText + "\n\n---\n\n⚠️ **注意**：" + mergeRun.error.message + "\n\n您可以在新消息中输入\"继续\"来让模型补全剩余内容，或点击保存尝试保存已生成的内容。";
              }
              updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                ...run,
                status: "done",
                merge: {
                  status: "done",
                  finishedAt: Date.now(),
                  summary: mergeRun.error ? "合并完成，但内容可能被截断。" : "合并完成，已输出最终大纲草稿。",
                },
              }) : run);
              return mergeText;
            },
          });
          if (!isCurrentRun()) return { started: true, sent: false };
          updateOutlineMultiAgentRun(convId, assistantId, (run) => {
            if (!run) return run;
            const successful = new Set(multiAgentResult.successfulAgents);
            const failed = new Set(multiAgentResult.failedAgents);
            const shouldStoreResume = multiAgentResult.mode === "single-agent-fallback"
              && multiAgentResult.successfulAgents.length > 0;
            return {
              ...run,
              mode: multiAgentResult.mode,
              status: multiAgentResult.mode === "multi-agent" ? "done" : "fallback",
              fallbackReason: multiAgentResult.fallbackReason ?? run.fallbackReason,
              failureDetails: multiAgentResult.failureDetails ?? run.failureDetails,
              agents: run.agents.map((agent) => {
                if (successful.has(agent.id) && agent.status !== "done") {
                  return { ...agent, status: "done", summary: agent.summary ?? "已完成。", finishedAt: Date.now() };
                }
                if (failed.has(agent.id) && agent.status !== "error") {
                  return { ...agent, status: "error", error: agent.error ?? "子 Agent 执行失败。", finishedAt: Date.now() };
                }
                return agent;
              }),
              merge: multiAgentResult.mode === "multi-agent" || run.merge?.status === "error"
                ? run.merge
                : {
                    status: "skipped",
                    summary: "已回退为单 Agent 生成。",
                  },
              resumeablePlan: shouldStoreResume ? {
                plan: subAgentPlan as unknown[],
                completedResults: capturedSuccessfulResults as unknown[],
                failedAgentIds: multiAgentResult.failedAgents,
              } : undefined,
            };
          });
          finalText = multiAgentResult.finalText;
        } else {
          finalText = await runSingleAgentFallback();
        }

        const filteredFinalText = filterOutlineGeneratedContent(finalText);
        if (filteredFinalText.reasoningOnly) {
          throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
        }
        finalText = filteredFinalText.content;
        if (finalText.trim()) bestGeneratedText = finalText;
        if (!isCurrentRun()) {
          // run 已被停止或替换：跳过后续处理，但已生成的内容仍要写入消息，
          // 不能因为状态闸门而静默丢弃整段结果。
          if (finalText.trim()) {
            updateOutlineAssistantMessage(convId, assistantId, (message) => ({
              ...message,
              content: finalText,
              reasoning_content: accumulatedReasoningContent,
              isAgentRunning: false,
            }));
            void useOutlineChatStore.getState().saveToDisk();
          }
          return { started: true, sent: false };
        }
        if (contextHubResult && (providerUsage || requestTraceCollector.snapshot().requests.length > 0)) {
          try {
            const contextHubSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              assistantId,
              contextHubResult,
              lastProviderUsage ?? providerUsage,
              {
                memoryDecision: memoryDecision ?? null,
                requestDiagnostics: buildLlmRequestDiagnostics(
                  providerUsage,
                  Math.max(1, llmRequestCount || 1),
                  {
                    ...requestTraceCollector.snapshot(),
                    requestCountAvailable: providerRequestCountAvailable,
                  },
                ),
              },
            );
            if (contextHubSnapshot && isCurrentRun()) {
              updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                ...message,
                contextHubSnapshot,
              }));
            }
          } catch (error) {
            console.warn("AI 大纲供应商缓存用量快照保存失败，继续保留本地缓存统计：", error);
          }
        }
        {
          const userMessage = agentMessages.find((message) => message.role === "user");
          persistOutlineConversationContextUsage({
            conversationId: convId,
            windowTokens: getEffectiveMaxContextSize(effectiveLlmConfig),
            systemPrompt: contextHubResult ? baseSystemPrompt : systemPrompt,
            contextHubResult,
            historyMessages: historyPlan.messages.map((message) => ({
              content: messageContentToText(message.content),
            })),
            currentInput: userMessage ? messageContentToText(userMessage.content) : prompt,
            usage: lastProviderUsage ?? providerUsage,
          });
        }

        const finalSources = Array.from(
          new Set([
            ...contextSources,
            ...outlineSources,
            ...outlineToolCallsToSources(allToolCalls),
            ...[...missingSkillNames].map((name) => `Skill 缺失（未强制启用）: ${name}`),
          ]),
        );
        const filteredRawFinalContent = filterOutlineGeneratedContent(finalText || result);
        if (filteredRawFinalContent.reasoningOnly) {
          throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
        }
        const rawFinalContent = filteredRawFinalContent.content || "AI大纲未返回内容。";
        /*
         * 计划模式：与共创同一套容错 —— 协议不合格先补一轮，仍不行就降级成追问，
         * 绝不把"已经写好的计划"整轮作废（用户口径 2026-10-21）。
         */
        const planGate = options.planPhase
          ? await resolveOutlinePlanProtocol({
            text: rawFinalContent,
            module: planTargetModule,
            required: getOutlinePlanRequiredElements(planTargetModule),
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
          })
          : null;
        const planValidation = planGate?.validation ?? null;
        const planProtocolNotice = options.planPhase ? planGate?.notice || undefined : undefined;
        const planProtocolError = options.planPhase && planValidation?.kind === "invalid"
          ? `计划协议不满足计划模式要求：${planValidation.error}。回复内容已保留，可补一句更具体的需求后重发。`
          : undefined;
        // 共创讨论轮里模型有时会直接交付完整大纲而不是讨论协议。命中「已交付」时
        // 按生成轮处理：不要求 outline_discuss、正文照常显示、结构化数据进保存链路
        // （提取折叠树 + 弹保存确认），而不是把整轮判成「未返回协议块」连内容一起丢掉。
        const discussDeliveredOutline = discussPhase
          ? isDiscussDeliveredOutline(rawFinalContent)
          : false;
        const discussProtocolRequired = discussPhase && !discussDeliveredOutline;
        /*
         * 共创讨论轮：解析 + 「一次重试 + 降级放行」，统一走 resolveOutlineDiscussProtocol。
         *
         * 改造前这里只处理"完全没给协议块"（补协议一轮），校验不过仍然整轮作废 ——
         * 用户实测：前面问了很多问题，最后因为某个可选项缺失/倾向悬空就报「共创协议格式无效」，
         * 内容全丢。现在校验不过会再「补齐」一轮；仍不过就把已解析的分歧原样放行，
         * 只留一句说明，绝不把讨论作废。
         */
        const discussGate = discussProtocolRequired
          ? await resolveOutlineDiscussProtocol({
            text: rawFinalContent,
            module: discussModule || "大纲",
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
          })
          : { protocol: null, notice: "", error: "" };
        /** 最终放行的协议：可能是补齐后的，也可能是降级放行的原始协议。 */
        const discussFinalProtocol = discussGate.protocol;
        const discussProtocolError = discussProtocolRequired && discussGate.error
          ? `共创协议格式无效，尚未开始生成：${discussGate.error}`
          : undefined;
        const discussProtocolNotice = discussProtocolRequired ? discussGate.notice || undefined : undefined;
        const rawIntentProtocol = parseIntentClarityProtocol(rawFinalContent);
        const nextStepExtraction = extractNextStep(rawFinalContent, {
          allowFallback: options.intentPhase === "generation",
          completedModule: intentContextsRef.current[capturedConvId]?.title || "当前模块",
        });
        const cleanFinalContent = nextStepExtraction.cleanText || "AI大纲未返回内容。";
        const structuredMarkdownEnabled = (
          options.intentPhase === "generation" && rawIntentProtocol.kind === "none"
        ) || options.novelGenerationRequest !== undefined;
        const finalContent = await finalizeStructuredMarkdownMessage(
          cleanFinalContent,
          {
            enabled: structuredMarkdownEnabled,
            repairWithAi: ({ content, maxTokens }) => repairMarkdownFormatWithAi({
              content,
              llmConfig: effectiveLlmConfig,
              signal: controller.signal,
              maxTokens,
            }),
            onFailure: () => {
              if (!isCurrentRun()) return;
              toast.info("Markdown 格式自动修复未完全通过，已保留内容最完整的版本。", {
                dedupeKey: "outline-markdown-quality-incomplete",
              });
            },
          },
        );
        if (finalContent.trim()) bestGeneratedText = finalContent;
        let intentProtocol = rawIntentProtocol.kind !== "none"
          ? rawIntentProtocol
          : parseIntentClarityProtocol(finalContent);
        /*
         * 意图分析：协议缺失或坏掉时先补一轮（转写已有判断）。补不出来就照旧报错，
         * 但不会再清空气泡 —— 正文由 renderedMarkdownContent 剥掉标记后展示。
         */
        if (options.intentPhase === "intent_analysis" && intentProtocol.kind !== "valid") {
          const intentGate = await resolveIntentClarityProtocol({
            text: finalContent,
            module: intentContextsRef.current[capturedConvId]?.title || "",
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
          });
          if (intentGate.outcome.kind === "valid") intentProtocol = intentGate.outcome;
        }
        const intentProtocolError = options.intentPhase === "intent_analysis"
          ? intentProtocol.kind === "invalid"
            ? `意图分析格式无效，尚未开始生成：${intentProtocol.error}`
            : intentProtocol.kind === "none"
              ? "意图分析格式无效，尚未开始生成：模型未返回 intent_clarity 协议块"
              : undefined
          : options.intentPhase === "generation" && intentProtocol.kind !== "none"
            ? "正文生成阶段返回了 intent_clarity，已阻止重复意图分析和自动循环。"
            : undefined;
        // 内容已直接写入消息，这里只需清掉运行状态提示
        if (isCurrentRun()) clearStreamingContent(capturedConvId);
        const visibleToolCalls = allToolCalls.length ? allToolCalls : [];
        const shouldShowToolProcess =
          historyPlan.showToolProcess ||
          visibleToolCalls.some((call) => call.status === "approval_required" || call.status === "error");
        // 最终内容提交不受 run 状态闸门限制：即使运行状态已被切换/停止，
        // 已生成的结果也必须写入消息，只有后续 UI 副作用才需要闸门。
        // 标准工作流必须把工具过程留在对话里，不能在收尾时清成空数组。
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: finalContent,
          reasoning_content: accumulatedReasoningContent,
          sources: finalSources,
          showThinkingProcess: historyPlan.showThinkingProcess,
          agentToolCalls: shouldShowToolProcess
            ? settleRunningAgentToolCalls(
                allToolCalls.length
                  ? allToolCalls
                  : (message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls),
              )
            : [],
          isAgentRunning: false,
          nextStepRecommendation: intentProtocolError || options.planPhase || discussProtocolRequired
            ? null
            : nextStepExtraction.recommendation,
          intentProtocolError,
          // 直接交付了大纲的共创轮按生成轮处理：不带讨论标，正文走正常显示路径。
          outlineDiscussPhase: discussProtocolRequired ? discussPhase : undefined,
          outlinePlanProtocol: planValidation && planValidation.kind !== "invalid"
            ? planValidation.protocol
            : null,
          outlinePlanError: planProtocolError,
          outlinePlanNotice: planProtocolNotice,
          // 降级放行的协议（校验没过但内容在）同样要出卡片，所以这里不再二次过闸。
          outlineDiscussProtocol: discussFinalProtocol,
          outlineDiscussError: discussProtocolError,
          outlineDiscussNotice: discussProtocolNotice,
        }));
        if (!isCurrentRun()) {
          void useOutlineChatStore.getState().saveToDisk();
          return { started: true, sent: false };
        }

        // 计划模式阶段机：追问停在 collecting_requirements，计划停在 waiting_user_confirm
        if (options.planPhase && planValidation) {
          if (planValidation.kind === "needs_input") {
            advanceCapturedWorkflowStages(["collecting_requirements"]);
          } else if (planValidation.kind === "ready") {
            advanceCapturedWorkflowStages([
              "sufficiency_check",
              "generation_plan",
              "waiting_user_confirm",
            ]);
          }
        }
        if (discussProtocolRequired && discussFinalProtocol) {
          // 按协议自报的 status 推进：降级放行时 validate 的结果可能是 invalid，
          // 但那只是"某一项不达标"，阶段机器不该因此卡死在原地。
          if (discussFinalProtocol.status === "needs_decision") {
            advanceCapturedWorkflowStages(["collecting_requirements"]);
          } else if (discussFinalProtocol.status === "ready") {
            advanceCapturedWorkflowStages([
              "sufficiency_check",
              "generation_plan",
              "waiting_user_confirm",
            ]);
          }
        }

        // 解析意图清晰度结果
        const intentResult = intentProtocol.kind === "valid" && !intentProtocolError
          ? intentProtocol.result
          : null;
        if (intentResult) {
          const existingContext = intentContextsRef.current[capturedConvId] ?? { title: "", hint: "" };
          const matchedConfig = !existingContext.title
            ? OUTLINE_SECTION_GENERATION_CONFIGS.find((c) => c.title === intentResult.module)
            : null;
          const updatedContext = matchedConfig
            ? {
                title: matchedConfig.title,
                hint: matchedConfig.requestHint,
                outputMode: matchedConfig.outputMode,
                skillNames: getOutlineSkillNames(matchedConfig.title),
              }
            : existingContext.title
              ? existingContext
              : { ...existingContext, title: intentResult.module };
          intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
            ...updatedContext,
            result: intentResult,
          });
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            intentClarityResult: intentResult,
          }));
          if (
            intentResult.clarity === "clear" &&
            shouldAutoFollowUpGeneration(options.intentPhase)
          ) {
            const capturedStage = outlineWorkflowStages[capturedConvId] ?? "idle";
            if (canTransitionOutlineWorkflow(capturedStage, "sufficiency_check")) {
              setCapturedWorkflowStage("sufficiency_check");
            }
            const scope = intentResult.detectedScope;
            const capturedIntentContext = intentContextsRef.current[capturedConvId] ?? { title: "", hint: "" };
            followUpGenerationPrompt = buildGenerationPrompt(
              capturedIntentContext.title,
              capturedIntentContext.hint,
              scope,
              capturedIntentContext.outputMode,
              capturedIntentContext.originalRequest,
            );
            followUpReferences = capturedIntentContext.references ?? tokens;
          } else if (intentResult.clarity === "needs_input") {
            const capturedStage = outlineWorkflowStages[capturedConvId] ?? "idle";
            if (canTransitionOutlineWorkflow(capturedStage, "waiting_user_input")) {
              setCapturedWorkflowStage("waiting_user_input");
            }
          }
        }

        const nextContextSummaryPayload = {
          contextSummary: buildSessionContextSummary({
            messages: [
              ...historyBeforeSend,
              { role: "user", content: prompt },
              { role: "assistant", content: finalContent },
            ],
            dependencyFingerprint: contextHubResult?.dependencyStamp.fingerprint ?? "",
          }),
        };
        if (!isCurrentRun()) return { started: true, sent: false };
        setConversationContextSummary(convId, nextContextSummaryPayload.contextSummary);
        if (!options.systemGenerated) {
          enqueueUserMemoryLearning({
            message: prompt,
            llmConfig: effectiveLlmConfig,
            surface: "ai-outline",
            projectKey: normalizePath(project.path),
            sessionKey: capturedConvId,
          });
        }
        // 计划盘点轮、以及「只做讨论」的共创轮只产出协议块，没有可保存正文，不能进保存链路。
        // 但共创轮若其实直接交付了大纲（discussDeliveredOutline），必须放行——
        // 否则那份卷纲/章纲的结构化数据既不会被提取成折叠树，也弹不出保存确认，
        // 用户只能在气泡里看到一坨源码。
        if (
          intentProtocol.kind === "none"
          && !intentProtocolError
          && !deliverableTruncated
          && !options.planPhase
          && !discussProtocolRequired
        ) {
          await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun, assistantId);
        }
        if (!isCurrentRun()) return { started: true, sent: false };
        const firstUser = useOutlineChatStore
          .getState()
          .conversations.find((conversation) => conversation.id === convId)
          ?.messages.find((message) => message.role === "user" && !isInternalOutlineMessage(message));
        if (firstUser) {
          useOutlineChatStore.setState((state) => ({
            conversations: state.conversations.map((conversation) =>
              conversation.id === convId
                ? {
                    ...conversation,
                    title: firstUser.content.slice(0, 50),
                  }
                : conversation,
            ),
          }));
        }
        void useOutlineChatStore.getState().saveToDisk();
        resetCapturedWorkflowStageToIdle();
        finishConversationRun(
          capturedConvId,
          useOutlineChatStore.getState().activeConversationId,
          runId,
        );
        if (followUpGenerationPrompt) {
          void handleSend(followUpGenerationPrompt, followUpReferences, {
            conversationId: capturedConvId,
            clearDraft: false,
            intentPhase: "generation",
            systemGenerated: true,
            userMessageVisibility: "internal",
            preferredSkillNames: intentContextsRef.current[capturedConvId]?.skillNames,
          });
        }
        return { started: true, sent: true };
      } catch (err) {
        const errorMsg = friendlyLlmErrorMessage(err instanceof Error ? err.message : String(err));
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        // streamingContents 只承载状态提示，不再存内容；可保留内容唯一来源
        // 是 bestGeneratedText。无论中断原因如何，已生成的内容都必须落进
        // 消息，绝不静默删除整条回复。
        const filteredPartial = filterOutlineGeneratedContent(bestGeneratedText);
        const partial = filteredPartial.content;
        const reasoningOnlyFailure =
          err instanceof Error && isReasoningOnlyResponseError(err) && Boolean(accumulatedReasoningContent.trim());
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: partial
            ? aborted
              ? `${partial}\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。`
              : `${partial}\n\n---\n\n⚠️ 生成中断：${errorMsg || "未知错误"}`
            : aborted
              ? filterOutlineGeneratedContent(message.content).content || "已停止生成。"
              : `生成失败：${errorMsg || "未知错误"}`,
          reasoning_content: accumulatedReasoningContent,
          // 模型只输出思考没输出正文时，强制展示思考过程，
          // 让用户明白"看着生成完了却没有结果"的原因。
          showThinkingProcess: reasoningOnlyFailure ? true : message.showThinkingProcess,
          agentToolCalls: historyPlan.showToolProcessOnError
            ? settleRunningAgentToolCalls(
                message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls,
                aborted ? "cancelled" : "error",
                Date.now(),
                aborted ? undefined : errorMsg,
              )
            : [],
          isAgentRunning: false,
        }));
        if (isCurrentRun()) {
          clearStreamingContent(capturedConvId);
          setCapturedWorkflowStage("idle");
          failConversationRun(capturedConvId, errorMsg || "未知错误", runId);
          if (!aborted) {
            toast.error(errorMsg || "未知错误", {
              title: "大纲生成失败",
              persistent: true,
              dedupeKey: `outline-run:${capturedConvId}:${errorMsg}`,
            });
          }
        }
        void useOutlineChatStore.getState().saveToDisk();
        return { started: true, sent: false };
      } finally {
        outlineConversationRunRegistry.remove(capturedConvId, controller);
        resetCapturedWorkflowStageToIdle();
        /*
         * 丁-4：本轮大纲生成无论成功、抛错还是被中止，都要还原临时角色灵魂绑定。
         * 绑定是在本 try **之前**写入的，所以必须在这里兜底 —— 漏掉这一句，
         * 一条「只对这一条消息生效」的绑定会永久留在项目里，静默改变之后所有章节的上下文。
         * `releaseMessageSoulBinding` 幂等（先把引用置空再动盘），重复调用无害。
         */
        await releaseMessageSoulBinding();
      }
    },
    [
      project,
      isStreaming,
      llmConfig,
      novelConfig,
      providerConfigs,
      effectiveOutlineModelId,
      aiOutlineReasoningDepth,
      activeConv,
      activeConversationId,
      createConversation,
      forceRefreshNext,
      addMessage,
      setConversationContextSummary,
      handleAutoSaveOutlineRequests,
      outlineWritingSkills,
      setStreamingContent,
      clearStreamingContent,
      startConversationRun,
      finishConversationRun,
      failConversationRun,
      outlineWorkflowStage,
      requestSoulBindingTarget,
    ],
  );

  // 卷纲内容不完整时的自动补全：由 state 驱动 effect，避免 auto-save 回调与 handleSend 循环引用
  useEffect(() => {
    if (!pendingVolumeRepair) return;
    const repair = pendingVolumeRepair;
    setPendingVolumeRepair(null);
    void handleSend(repair.prompt, [], {
      conversationId: repair.conversationId,
      systemGenerated: true,
      userMessageVisibility: "internal",
      userDisplayText: "（系统提示：卷纲内容不完整，正在自动补全）",
    });
  }, [pendingVolumeRepair, handleSend]);

  // 章纲内容不完整时的自动补全：与卷纲同机制，由 state 驱动 effect
  useEffect(() => {
    if (!pendingChapterRepair) return;
    const repair = pendingChapterRepair;
    setPendingChapterRepair(null);
    void handleSend(repair.prompt, [], {
      conversationId: repair.conversationId,
      systemGenerated: true,
      userMessageVisibility: "internal",
      userDisplayText: "（系统提示：章纲内容不完整，正在自动补全）",
    });
  }, [pendingChapterRepair, handleSend]);

  // 章纲分批：自动继续生成下一批（每批 3 章）
  useEffect(() => {
    if (!pendingChapterBatch) return;
    const batch = pendingChapterBatch;
    setPendingChapterBatch(null);
    void handleSend(batch.prompt, [], {
      conversationId: batch.conversationId,
      systemGenerated: true,
      userMessageVisibility: "internal",
      userDisplayText: "（系统提示：继续生成下一批章纲）",
    });
  }, [pendingChapterBatch, handleSend]);

  // 计划模式统一入口：先把会话推进到要素盘点，再让模型按 outline_plan 协议盘点缺口
  const startOutlinePlanElementCheck = useCallback(
    (conversationId: string, input: {
      module: string;
      requestHint: string;
      originalRequest?: string;
      references?: ReferenceToken[];
      userDisplayText?: string;
      clearDraft?: boolean;
    }) => {
      if (canTransitionOutlineWorkflow(
        outlineWorkflowStages[conversationId] ?? "idle",
        "collecting_requirements",
      )) {
        setOutlineWorkflowStages((stages) => (
          setOutlineSessionValue(stages, conversationId, "collecting_requirements")
        ));
      }
      return handleSend(
        buildOutlinePlanElementCheckPrompt({
          module: input.module,
          requestHint: input.requestHint,
          originalRequest: input.originalRequest,
        }),
        input.references ?? [],
        {
          conversationId,
          planPhase: "element_check",
          planModule: input.module,
          systemGenerated: true,
          clearDraft: input.clearDraft,
          userDisplayText: input.userDisplayText,
          preferredSkillNames: getOutlineSkillNames(input.module || input.requestHint),
        },
      );
    },
    [handleSend, outlineWorkflowStages],
  );

  const insertOutlineGenerationCommand = useCallback((title: string) => {
    setInputValue((current) => {
      const withoutSlash = current.endsWith("/") ? current.slice(0, -1) : current;
      const separator = withoutSlash && !/\s$/.test(withoutSlash) ? " " : "";
      return `${withoutSlash}${separator}/${title} `;
    });
  }, []);

  const handleGenerateSection = useCallback(
    (title: string, requestHint: string, displayText?: string) => {
      const capturedConvId = activeConversationId ?? createConversation();
      const config = OUTLINE_SECTION_GENERATION_CONFIGS.find(c => c.title === title);
      const outlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      const fastMode = outlineMode === "fast";
      intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
        title,
        hint: requestHint,
        outputMode: config?.outputMode,
        skillNames: fastMode ? [] : getOutlineSkillNames(title),
      });
      if (fastMode) {
        void handleSend(buildGenerationPrompt(title, requestHint, requestHint, config?.outputMode), [], {
          conversationId: capturedConvId,
          intentPhase: "generation",
          systemGenerated: true,
          userDisplayText: displayText ?? `生成${title}`,
        });
        return;
      }
      if (outlineMode === "discuss") {
        void handleSend(buildOutlineDiscussionPrompt(title, requestHint), [], {
          conversationId: capturedConvId,
          systemGenerated: true,
          userDisplayText: displayText ?? `讨论${title}`,
          preferredSkillNames: getOutlineSkillNames(title),
        });
        return;
      }
      if (outlineMode === "plan") {
        void startOutlinePlanElementCheck(capturedConvId, {
          module: title,
          requestHint,
          userDisplayText: displayText ?? `生成${title}`,
        });
        return;
      }
      if (canTransitionOutlineWorkflow(outlineWorkflowStages[capturedConvId] ?? "idle", "intent_analysis")) {
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "intent_analysis"));
      }
      const intentPrompt = buildIntentAnalysisPrompt(title, requestHint);
      void handleSend(intentPrompt, [], {
        conversationId: capturedConvId,
        intentPhase: "intent_analysis",
        systemGenerated: true,
        userDisplayText: displayText ?? `生成${title}`,
      });
    },
    [
      activeConversationId,
      createConversation,
      handleSend,
      outlineWorkflowStages,
      startOutlinePlanElementCheck,
    ],
  );

  const handleDirectSubmit = useCallback(
    async (text: string, references: ReferenceToken[] = []) => {
      const command = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      const commandConfig = command
        ? OUTLINE_SECTION_GENERATION_CONFIGS.find((config) => config.title === command[1])
        : undefined;
      if (commandConfig) {
        const userIdea = command?.[2]?.trim() ?? "";
        const request = [commandConfig.requestHint, userIdea ? `用户补充想法：${userIdea}` : ""]
          .filter(Boolean)
          .join("\n");
        return handleGenerateSection(commandConfig.title, request, text.trim());
      }
      const outlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      // 共创模式不进意图分析和要素盘点：讨论轮自动上 discussPhase，短确认句走定稿生成
      if (outlineMode === "fast") {
        return handleSend(text, references);
      }
      if (outlineMode === "discuss") {
        if (isOutlineDiscussFinalizeRequest(text)) {
          const conversation = useOutlineChatStore.getState().conversations
            .find((item) => item.id === (activeConversationId ?? ""));
          const latest = conversation
            ? findLatestOutlineDiscussProtocol(conversation.messages)
            : null;
          return handleSend(
            latest
              ? buildOutlineDiscussExecutionPrompt({
                module: latest.module,
                judgment: latest.judgment,
                agreed: latest.agreed,
              })
              : text,
            references,
            {
              intentPhase: "generation",
              systemGenerated: Boolean(latest),
              userDisplayText: text,
              userMessageVisibility: latest ? "internal" : "visible",
            },
          );
        }
        return handleSend(text, references);
      }
      // 非生成类输入在计划模式下也照旧直接问答，不进要素盘点
      const directRequest = classifyDirectOutlineGenerationRequest(text);
      if (!directRequest) return handleSend(text, references);

      const capturedConvId = activeConversationId ?? createConversation();
      intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
        title: directRequest.module,
        hint: text.trim(),
        originalRequest: text.trim(),
        references: [...references],
        skillNames: getOutlineSkillNames(directRequest.module || text),
      });
      if (outlineMode === "plan") {
        return startOutlinePlanElementCheck(capturedConvId, {
          module: directRequest.module,
          requestHint: text.trim(),
          originalRequest: text.trim(),
          references,
          userDisplayText: text,
        });
      }
      if (canTransitionOutlineWorkflow(outlineWorkflowStages[capturedConvId] ?? "idle", "intent_analysis")) {
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "intent_analysis"));
      }
      return handleSend(text, references, {
        conversationId: capturedConvId,
        intentPhase: "intent_analysis",
      });
    },
    [
      activeConversationId,
      createConversation,
      handleGenerateSection,
      handleSend,
      outlineWorkflowStages,
      startOutlinePlanElementCheck,
    ],
  );

  const handleContinueIntentGeneration = useCallback(
    async (messageId: string, result: IntentClarityResult) => {
      if (!activeConversationId || !canStartConversationRun(activeConversationId)) return;
      const conversation = useOutlineChatStore.getState().conversations
        .find((item) => item.id === activeConversationId);
      const messageIndex = conversation?.messages.findIndex((message) => message.id === messageId) ?? -1;
      if (!conversation || messageIndex < 0) return;
      const originalUserMessage = [...conversation.messages.slice(0, messageIndex)]
        .reverse()
        .find((message) => message.role === "user" && !isInternalOutlineMessage(message));
      if (!originalUserMessage) return;

      const directRequest = classifyDirectOutlineGenerationRequest(originalUserMessage.content);
      const context = {
        title: result.module || directRequest?.module || "大纲",
        hint: originalUserMessage.content,
        originalRequest: originalUserMessage.content,
        references: originalUserMessage.attachedReferences ?? [],
        skillNames: getOutlineSkillNames(result.module || directRequest?.module || originalUserMessage.content),
        result,
      };
      intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, activeConversationId, context);
      setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, activeConversationId, "sufficiency_check"));
      await handleSend(
        buildGenerationPrompt(context.title, context.hint, result.detectedScope, undefined, context.originalRequest),
        context.references,
        {
          conversationId: activeConversationId,
          clearDraft: false,
          intentPhase: "generation",
          systemGenerated: true,
          userMessageVisibility: "internal",
          preferredSkillNames: context.skillNames,
        },
      );
    },
    [activeConversationId, canStartConversationRun, handleSend],
  );

  const markOutlinePlanDecision = useCallback(
    (
      conversationId: string,
      messageId: string,
      decision: NonNullable<OutlineChatMessage["outlinePlanDecision"]>,
    ) => {
      updateOutlineAssistantMessage(conversationId, messageId, (message) => ({
        ...message,
        outlinePlanDecision: decision,
      }));
      void useOutlineChatStore.getState().saveToDisk();
    },
    [],
  );

  // 追问答案回填：走内部消息重跑要素盘点，累计要素靠对话历史传递
  const handleSubmitOutlinePlanAnswers = useCallback(
    async (messageId: string, protocol: OutlinePlanProtocol, answers: OutlinePlanAnswer[]) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId || !canStartConversationRun(capturedConvId)) {
        toast.info("当前会话正在生成，请等待生成完成后再补充信息。", {
          dedupeKey: "outline-plan:busy",
        });
        return false;
      }
      markOutlinePlanDecision(capturedConvId, messageId, "answered");
      const result = await handleSend(
        buildOutlinePlanClarifyAnswerPrompt({
          module: protocol.module,
          answers,
          collected: protocol.elements,
        }),
        [],
        {
          conversationId: capturedConvId,
          planPhase: "element_check",
          planModule: protocol.module,
          systemGenerated: true,
          clearDraft: false,
          userMessageVisibility: "internal",
        },
      );
      return result.sent;
    },
    [activeConversationId, canStartConversationRun, handleSend, markOutlinePlanDecision],
  );

  // 确认计划：复用既有 generation 腿，markdown 修复与保存确认零改动
  const handleConfirmOutlinePlan = useCallback(
    async (messageId: string, protocol: OutlinePlanProtocol, planText: string) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId || !canStartConversationRun(capturedConvId)) {
        toast.info("当前会话正在生成，请等待生成完成后再确认计划。", {
          dedupeKey: "outline-plan:busy",
        });
        return false;
      }
      markOutlinePlanDecision(capturedConvId, messageId, "confirmed");
      setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "idle"));
      const intentContext = intentContextsRef.current[capturedConvId];
      // 计划模式的正文生成提示默认不含分项输出规则；设定类分项补上，
      // 让 AI 一并产出该分项的结构化数据与专属 HTML 契约（卷纲/章纲有各自的 JSON 契约与分批规则，追加会冲突，故不在此补）。
      const planModuleRules = resolveSettingSpecByTitle(protocol.module)
        ? getOutlineSectionOutputRules(protocol.module)
        : "";
      const result = await handleSend(
        [
          buildOutlinePlanExecutionPrompt({
            module: protocol.module,
            planText,
            elements: protocol.elements,
          }),
          planModuleRules,
        ].filter(Boolean).join("\n"),
        intentContext?.references ?? [],
        {
          conversationId: capturedConvId,
          intentPhase: "generation",
          systemGenerated: true,
          clearDraft: false,
          userMessageVisibility: "internal",
          enableMultiAgent: (protocol.plan?.files.length ?? 0) > 1,
          preferredSkillNames: intentContext?.skillNames
            ?? getOutlineSkillNames(protocol.module),
        },
      );
      return result.sent;
    },
    [activeConversationId, canStartConversationRun, handleSend, markOutlinePlanDecision],
  );

  const handleCancelOutlinePlan = useCallback(
    (messageId: string) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId) return;
      markOutlinePlanDecision(capturedConvId, messageId, "cancelled");
      setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "idle"));
    },
    [activeConversationId, markOutlinePlanDecision],
  );

  const markOutlineDiscussDecision = useCallback(
    (
      conversationId: string,
      messageId: string,
      decision: NonNullable<OutlineChatMessage["outlineDiscussDecision"]>,
    ) => {
      updateOutlineAssistantMessage(conversationId, messageId, (message) => ({
        ...message,
        outlineDiscussDecision: decision,
      }));
      void useOutlineChatStore.getState().saveToDisk();
    },
    [],
  );

  const handleSubmitOutlineDiscussAnswers = useCallback(
    async (messageId: string, protocol: OutlineDiscussProtocol, answers: OutlineDiscussAnswer[]) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId || !canStartConversationRun(capturedConvId)) {
        toast.info("当前会话正在生成，请等待生成完成后再拍板。", {
          dedupeKey: "outline-discuss:busy",
        });
        return false;
      }
      markOutlineDiscussDecision(capturedConvId, messageId, "answered");
      const result = await handleSend(
        buildOutlineDiscussAnswerPrompt({
          module: protocol.module,
          answers,
          agreed: protocol.agreed,
        }),
        [],
        {
          conversationId: capturedConvId,
          systemGenerated: true,
          clearDraft: false,
          userMessageVisibility: "internal",
        },
      );
      return result.sent;
    },
    [activeConversationId, canStartConversationRun, handleSend, markOutlineDiscussDecision],
  );

  const handleConfirmOutlineDiscuss = useCallback(
    async (messageId: string, protocol: OutlineDiscussProtocol) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId || !canStartConversationRun(capturedConvId)) {
        toast.info("当前会话正在生成，请等待生成完成后再确认定稿。", {
          dedupeKey: "outline-discuss:busy",
        });
        return false;
      }
      markOutlineDiscussDecision(capturedConvId, messageId, "confirmed");
      setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "idle"));
      const intentContext = intentContextsRef.current[capturedConvId];
      const result = await handleSend(
        buildOutlineDiscussExecutionPrompt({
          module: protocol.module,
          judgment: protocol.judgment,
          agreed: protocol.agreed,
        }),
        intentContext?.references ?? [],
        {
          conversationId: capturedConvId,
          intentPhase: "generation",
          systemGenerated: true,
          clearDraft: false,
          userMessageVisibility: "internal",
          preferredSkillNames: intentContext?.skillNames
            ?? getOutlineSkillNames(protocol.module),
        },
      );
      return result.sent;
    },
    [activeConversationId, canStartConversationRun, handleSend, markOutlineDiscussDecision],
  );

  const handleSendMessage = useCallback(
    async (text: string, options?: {
      intentPhase?: "intent_analysis" | "generation" | "waiting_user_input"
      scope?: string
      /**
       * 「继续」重发时要跟着带过去的事件细纲要求。
       *
       * 与「重新生成」同一个理由：要求存在消息上，新消息不会自动继承。
       * 模型续写时若不再回抄 requirement，扩写提示词里就会缺掉
       * 「## 用户对本章的要求」—— 用户填的硬要求悄悄失效。
       */
      eventOutlineRequirement?: string
    }) => {
      const capturedConvId = activeConversationId;
      if (!capturedConvId) {
        toast.info("当前没有可用的大纲会话，请先新建会话。", { dedupeKey: "outline-next-step:no-conversation" });
        return false;
      }
      if (!canStartConversationRun(capturedConvId)) {
        const currentRunning = useOutlineChatStore.getState().runStates[capturedConvId]?.status === "running";
        toast.info(currentRunning
          ? "当前会话正在生成，请等待生成完成后再选择下一步。"
          : "大纲 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。", {
          dedupeKey: `outline-next-step:busy:${capturedConvId}`,
        });
        return false;
      }
      try {
        if (options?.intentPhase === "generation") {
          if (canTransitionOutlineWorkflow(outlineWorkflowStage, "sufficiency_check")) {
            setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "sufficiency_check"));
          }
          const scope = options.scope || text;
          const intentContext = intentContextsRef.current[capturedConvId] ?? { title: "", hint: "" };
          const generationPrompt = buildGenerationPrompt(
            intentContext.title,
            intentContext.hint,
            scope,
            intentContext.outputMode,
            intentContext.originalRequest,
          );
          const references = Array.from(new Map([
            ...(intentContext.references ?? []),
            ...outlineReferenceTokens,
          ].map((reference) => [reference.id, reference])).values());
          const result = await handleSend(generationPrompt, references, {
            conversationId: capturedConvId,
            intentPhase: "generation",
            clearDraft: false,
            systemGenerated: true,
            userMessageVisibility: "internal",
            preferredSkillNames: intentContext.skillNames ?? getOutlineSkillNames(intentContext.title || scope),
          });
          if (result.sent) {
            if (shouldClearOutlineReferences({
              invocationConversationId: capturedConvId,
              activeConversationId: useOutlineChatStore.getState().activeConversationId,
              sentReferences: references,
              currentReferences: outlineReferenceTokensRef.current,
            })) {
              outlineReferenceTokensRef.current = [];
              setOutlineReferenceTokens([]);
            }
            return true;
          }
        } else {
          const references = outlineReferenceTokens;
          const result = await handleSend(text, references, {
            conversationId: capturedConvId,
            intentPhase: options?.intentPhase,
            clearDraft: false,
            ...(options?.eventOutlineRequirement
              ? { eventOutlineRequirement: options.eventOutlineRequirement }
              : {}),
          });
          if (result.sent) {
            if (shouldClearOutlineReferences({
              invocationConversationId: capturedConvId,
              activeConversationId: useOutlineChatStore.getState().activeConversationId,
              sentReferences: references,
              currentReferences: outlineReferenceTokensRef.current,
            })) {
              outlineReferenceTokensRef.current = [];
              setOutlineReferenceTokens([]);
            }
            return true;
          }
        }
      } catch {
        // Promise reject is handled below; the card finally block restores busy and disabled state.
      }
      toast.info("发送失败，推荐操作已恢复，请稍后重试。", {
        dedupeKey: `outline-next-step:send-failed:${capturedConvId}`,
      });
      return false;
    },
    [activeConversationId, canStartConversationRun, handleSend, outlineReferenceTokens, outlineWorkflowStage],
  );

  const handleResumeMultiAgent = useCallback(
    async (messageId: string) => {
      if (!project || !activeConversationId) return;
      const conv = useOutlineChatStore
        .getState()
        .conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;
      const targetMsg = conv.messages.find((m) => m.id === messageId);
      if (!targetMsg?.multiAgentRun?.resumeablePlan) return;

      const { plan, completedResults, failedAgentIds } = targetMsg.multiAgentRun.resumeablePlan;

      let effectiveLlmConfig = resolveNovelModel(llmConfig, novelConfig, "writing");
      if (effectiveOutlineModelId) {
        effectiveLlmConfig = resolveModelConfig(effectiveOutlineModelId, effectiveLlmConfig, providerConfigs);
      }
      // Resuming picks up a generation run, so it takes the footer depth.
      effectiveLlmConfig = applyReasoningDepth(effectiveLlmConfig, aiOutlineReasoningDepth);
      const effectiveModelId = effectiveOutlineModelId || effectiveLlmConfig.model || "";
      if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
        toast.error("请先在设置中配置并选择一个可用的 AI 模型。");
        return;
      }
      const resumeRequestBudget = planOutlineRequestBudget({
        maxContextSize: effectiveLlmConfig.maxContextSize,
        stage: "generation",
        maxOutputTokens: getEffectiveMaxOutputTokens(effectiveLlmConfig),
        thinkingFloorTokens: thinkingMinMaxTokens(effectiveLlmConfig.reasoning ?? { mode: "auto" }),
      });

      const capturedConvId = activeConversationId;
      const runId = crypto.randomUUID();
      if (!startConversationRun(capturedConvId, runId)) return;
      const controller = new AbortController();
      outlineConversationRunRegistry.register(capturedConvId, controller);
      const isCurrentRun = () => canApplyOutlineRunEffect(
        useOutlineChatStore.getState().runStates,
        capturedConvId,
        runId,
      );

      try {
        let contextHubResult: ContextHubResult | null = null;
        let providerUsage: LlmUsage | undefined;
        let lastProviderUsage: LlmUsage | undefined;
        let memoryDecision: UserMemoryDecision | null | undefined;
        let llmRequestCount = 0;
        let providerRequestCountAvailable = true;
        const requestTraceCollector = new LlmRequestTraceCollector();
        try {
          const contextHub = getContextHub(normalizePath(project.path));
          contextHubResult = await contextHub.prepare({
            projectPath: normalizePath(project.path),
            surface: "ai-outline",
            sessionId: capturedConvId,
            task: `继续未完成的 AI 大纲多 Agent 任务：${failedAgentIds.join("、")}`,
            intent: "generate",
            messages: conv.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            existingSummary: conv.contextSummary,
            tokenBudget: resumeRequestBudget.contextTokenBudget,
            maxContextSize: effectiveLlmConfig.maxContextSize,
          });
          if (contextHubResult) {
            try {
              const contextHubSnapshot = await contextHub.saveSnapshot(`${messageId}:${runId}`, contextHubResult);
              if (isCurrentRun()) {
                updateOutlineAssistantMessage(capturedConvId, messageId, (message) => ({
                  ...message,
                  contextHubSnapshot,
                }));
              }
            } catch (error) {
              console.warn("AI 大纲续传上下文快照保存失败，继续生成：", error);
            }
          }
        } catch (error) {
          console.warn("AI 大纲续传上下文中控准备失败，继续使用原有流程：", error);
        }
        const skillConfig = await loadDeAiSkillConfig(project.path).catch((): DeAiSkillConfig | null => null);
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const resumeOutlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({ projectName: project.name, mode: resumeOutlineMode });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({ projectName: project.name, soulDoc, mode: resumeOutlineMode });
        const buildResumeSystemContent = (extraRules: string): AgentMessage["content"] => (
          contextHubResult
            ? buildContextHubSystemContent(baseSystemPrompt, contextHubResult, [extraRules])
            : [legacySystemPrompt, extraRules].filter(Boolean).join("\n\n")
        );
        const buildResumeSubAgentSystemContent = (plan: OutlineSubAgentPlan, extraRules: string): AgentMessage["content"] => {
          if (!contextHubResult) return [legacySystemPrompt, extraRules].filter(Boolean).join("\n\n");
          return [
            { type: "text", text: baseSystemPrompt.trim() ? `${baseSystemPrompt.trim()}\n\n` : "" },
            {
              type: "text",
              text: `## 子 Agent 局部上下文\n${buildScopedOutlineSubAgentContext(contextHubResult.contextPack, plan.kind)}`,
              cacheControl: true,
            },
            { type: "text", text: [contextHubResult.sessionSummary ? `## 当前会话摘要\n${contextHubResult.sessionSummary}` : "", extraRules].filter(Boolean).join("\n\n") },
          ];
        };
        const primarySystemContent = buildResumeSystemContent("");
        const systemPrompt = typeof primarySystemContent === "string"
          ? primarySystemContent
          : flattenContextHubSystemContent(primarySystemContent);
        const buildConfig = (_skillNames: string[], disableWriteTools: boolean) => {
          const r = new ToolRegistry();
          const c = buildAgentConfig(effectiveModelId, systemPrompt, r, {
            wikiPath: `${normalizePath(project.path)}/wiki`,
            getSkillConfig: () => skillConfig,
            getUserSkills: () => outlineWritingSkills,
            getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
            getChatConversations: () => {
              const state = useChatStore.getState();
              return state.conversations.map((conversation) => ({
                id: conversation.id,
                title: conversation.title,
                messages: state.messages
                  .filter((message) => message.conversationId === conversation.id)
                  .map((message) => ({ role: message.role, content: message.content })),
              }));
            },
            getOutlineConversations: () => mapOutlineConversationsForModel(useOutlineChatStore.getState().conversations),
            llmConfig: effectiveLlmConfig,
            disabledTools: disableWriteTools ? OUTLINE_CHAT_DISABLED_TOOLS : [],
            ...(contextHubResult
              ? { readTextFile: contextHubResult.readFile }
              : {}),
          });
          return {
            agentConfig: {
              ...c,
              requestOverrides: {
                ...c.requestOverrides,
                max_tokens: resumeRequestBudget.outputTokens,
                userMemorySurface: "ai-outline" as const,
                userMemoryProjectKey: normalizePath(project.path),
                userMemorySessionKey: capturedConvId,
              },
            },
            registry: r,
          };
        };
        // 更新状态为续传运行中
        updateOutlineMultiAgentRun(capturedConvId, messageId, (run) => run ? ({
          ...run,
          status: "running",
          resumeablePlan: undefined,
          agents: run.agents.map((agent) =>
            failedAgentIds.includes(agent.id)
              ? { ...agent, status: "waiting" as const, error: undefined, startedAt: undefined, finishedAt: undefined }
              : agent,
          ),
        }) : run);

        const resumeResult = await resumeOutlineMultiAgentWorkflow({
          plan: plan as OutlineSubAgentPlan[],
          completedResults: completedResults as OutlineSubAgentResult[],
          failedAgentIds,
          runSubAgent: async (subAgentPlan) => {
            if (!isCurrentRun()) throw new Error("aborted");
            updateOutlineMultiAgentItem(capturedConvId, messageId, subAgentPlan.id, (agent) => ({
              ...agent,
              status: "running",
              startedAt: Date.now(),
              error: undefined,
            }));
            const { agentConfig, registry: reg } = buildConfig(subAgentPlan.skillNames, true);
            let runText = "";
            let agentError: Error | null = null;
            const record = await new AgentRunner().run(agentConfig, reg, [
              { role: "system", content: buildResumeSubAgentSystemContent(subAgentPlan, ["## 子 Agent 运行规则", `当前身份：${subAgentPlan.name}`, "你只能处理本 Agent 负责的维度，禁止写入文件。", "必须输出符合 AI 大纲子 Agent JSON 协议的 JSON，不要输出额外说明。"].join("\n")) },
              { role: "user", content: subAgentPlan.taskPrompt },
            ], {
              onText: (chunk) => { runText += chunk; },
              onToolCall: () => {},
              onToolResult: () => {},
              onToolError: () => {},
              onToolEvent: () => {},
              onDone: () => {},
              onRequestTrace: requestTraceCollector.record,
              onError: (error) => { agentError = error; },
            }, controller.signal);
            providerUsage = addLlmUsage(providerUsage, record.usage);
            lastProviderUsage = record.lastRequestUsage ?? record.usage ?? lastProviderUsage;
            if (record.providerRequestCountAvailable === false) {
              providerRequestCountAvailable = false;
            } else {
              llmRequestCount += Math.max(1, record.roundsUsed || 1);
            }
            if (memoryDecision === undefined && record.userMemoryDecision !== undefined) {
              memoryDecision = record.userMemoryDecision;
            }
            if (agentError && !isOutlineOutputTruncated(agentError)) throw agentError;
            return runText;
          },
          mergeResults: async (subAgentResults) => {
            if (!isCurrentRun()) throw new Error("aborted");
            updateOutlineMultiAgentRun(capturedConvId, messageId, (run) => run ? ({
              ...run,
              status: "merging",
              merge: { status: "running", startedAt: Date.now(), summary: `正在合并 ${subAgentResults.length} 个子 Agent 结果。` },
            }) : run);
            const { agentConfig, registry: reg } = buildConfig([], true);
            let mergeText = "";
            let mergeError: Error | null = null;
            const record = await new AgentRunner().run(agentConfig, reg, [
              { role: "system", content: buildResumeSystemContent(["## 合并 Agent 运行规则", "你负责合并多个子 Agent 的结构化结果，形成最终可预览的大纲草稿。", "输出必须是用户可直接阅读和保存的大纲正文，不要输出内部调度报告。"].join("\n")) },
              { role: "user", content: ["请合并以下 AI 大纲子 Agent 结果，解决冲突并输出最终大纲草稿。", "", "## 子 Agent 结构化结果", buildBoundedSubAgentMergePayload(subAgentResults)].join("\n") },
            ], {
              onText: (chunk) => {
                mergeText += chunk;
                if (isCurrentRun()) {
                  updateOutlineAssistantMessage(capturedConvId, messageId, (message) => ({
                    ...message,
                    content: mergeText,
                  }));
                }
              },
              onToolCall: () => {},
              onToolResult: () => {},
              onToolError: () => {},
              onToolEvent: () => {},
              onDone: () => {},
              onRequestTrace: requestTraceCollector.record,
              onError: (error) => { mergeError = error; },
            }, controller.signal);
            providerUsage = addLlmUsage(providerUsage, record.usage);
            lastProviderUsage = record.lastRequestUsage ?? record.usage ?? lastProviderUsage;
            if (record.providerRequestCountAvailable === false) {
              providerRequestCountAvailable = false;
            } else {
              llmRequestCount += Math.max(1, record.roundsUsed || 1);
            }
            if (memoryDecision === undefined && record.userMemoryDecision !== undefined) {
              memoryDecision = record.userMemoryDecision;
            }
            if (mergeError && !isOutlineOutputTruncated(mergeError)) throw mergeError;
            if (mergeError) {
              const truncatedError = mergeError as Error;
              mergeText = `${mergeText}\n\n---\n\n⚠️ **注意**：${truncatedError.message}\n\n您可以在新消息中输入"继续"来让模型补全剩余内容，或点击保存尝试保存已生成的内容。`;
            }
            return mergeText || "AI大纲未返回内容。";
          },
          onStatusChange: (event) => {
            if (!isCurrentRun()) return;
            updateOutlineMultiAgentItem(capturedConvId, messageId, event.agentId, (agent) => ({
              ...agent,
              status: event.status === "running" ? "running" : event.status === "retrying" ? "retrying" : event.status === "completed" ? "done" : event.status === "failed" ? "error" : "waiting",
              retryCount: Math.max(0, event.attempt - 1),
              error: event.error,
              summary: event.status === "completed" ? agent.summary ?? "已完成本 Agent 任务。" : agent.summary,
              finishedAt: event.status === "completed" || event.status === "failed" ? Date.now() : undefined,
            }));
          },
        });

        if (!isCurrentRun()) return;

        if (contextHubResult && (providerUsage || requestTraceCollector.snapshot().requests.length > 0)) {
          try {
            const contextHubSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              `${messageId}:${runId}`,
              contextHubResult,
              lastProviderUsage ?? providerUsage,
              {
                memoryDecision: memoryDecision ?? null,
                requestDiagnostics: buildLlmRequestDiagnostics(
                  providerUsage,
                  Math.max(1, llmRequestCount || 1),
                  {
                    ...requestTraceCollector.snapshot(),
                    requestCountAvailable: providerRequestCountAvailable,
                  },
                ),
              },
            );
            if (contextHubSnapshot && isCurrentRun()) {
              updateOutlineAssistantMessage(capturedConvId, messageId, (message) => ({
                ...message,
                contextHubSnapshot,
              }));
            }
          } catch (error) {
            console.warn("AI 大纲续传供应商缓存用量快照保存失败，继续保留本地缓存统计：", error);
          }
        }
        persistOutlineConversationContextUsage({
          conversationId: capturedConvId,
          windowTokens: getEffectiveMaxContextSize(effectiveLlmConfig),
          systemPrompt: contextHubResult ? baseSystemPrompt : systemPrompt,
          contextHubResult,
          usage: lastProviderUsage ?? providerUsage,
        });

        // 更新最终状态
        updateOutlineMultiAgentRun(capturedConvId, messageId, (run) => {
          if (!run) return run;
          const successful = new Set(resumeResult.successfulAgents);
          const failed = new Set(resumeResult.failedAgents);
          return {
            ...run,
            mode: resumeResult.mode,
            status: resumeResult.mode === "multi-agent" ? "done" : "fallback",
            fallbackReason: resumeResult.fallbackReason ?? run.fallbackReason,
            failureDetails: resumeResult.failureDetails ?? run.failureDetails,
            agents: run.agents.map((agent) => {
              if (successful.has(agent.id) && agent.status !== "done") {
                return { ...agent, status: "done" as const, summary: agent.summary ?? "已完成。", finishedAt: Date.now() };
              }
              if (failed.has(agent.id) && agent.status !== "error") {
                return { ...agent, status: "error" as const, error: agent.error ?? "子 Agent 执行失败。", finishedAt: Date.now() };
              }
              return agent;
            }),
            merge: resumeResult.mode === "multi-agent"
              ? { status: "done" as const, finishedAt: Date.now(), summary: "合并完成，已输出最终大纲草稿。" }
              : run.merge?.status === "error"
                ? run.merge
                : { status: "skipped" as const, summary: "已回退为单 Agent 生成。" },
            resumeablePlan: resumeResult.mode === "single-agent-fallback" && resumeResult.successfulAgents.length > 0
              ? { plan, completedResults, failedAgentIds: resumeResult.failedAgents }
              : undefined,
          };
        });

        // 更新消息内容
        if (resumeResult.finalText) {
          updateOutlineAssistantMessage(capturedConvId, messageId, (message) => ({
            ...message,
            content: resumeResult.finalText,
            sources: Array.from(new Set([
              ...(message.sources ?? []),
            ])),
          }));
        }
        const completedConversation = useOutlineChatStore.getState().conversations
          .find((conversation) => conversation.id === capturedConvId);
        if (completedConversation) {
          setConversationContextSummary(capturedConvId, buildSessionContextSummary({
            messages: completedConversation.messages,
            dependencyFingerprint: contextHubResult?.dependencyStamp.fingerprint ?? "",
          }));
          void useOutlineChatStore.getState().saveToDisk();
        }
      } catch (err) {
        const aborted = controller.signal.aborted || (err instanceof Error ? err.message : "").toLowerCase().includes("aborted");
        if (!aborted) {
          toast.error("续传失败，请稍后重试。");
        }
      } finally {
        stopConversationRun(capturedConvId, runId);
        clearStreamingContent(capturedConvId);
      }
    },
    [project, activeConversationId, llmConfig, novelConfig, effectiveOutlineModelId, aiOutlineReasoningDepth, providerConfigs, outlineWritingSkills, startConversationRun, stopConversationRun, clearStreamingContent, setConversationContextSummary],
  );

  const handleFocusInput = useCallback(() => {
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="输入关于大纲的问题..."]'
      );
      textarea?.focus();
    }, 0);
  }, []);

  const handleSubmitOutlineWizard = useCallback(
    async (request: OutlineWizardRequest) => {
      /*
       * 新手引导：走**本地示例大纲**，完全不请求模型。
       *
       * 引导要让一个还没拿到 API 密钥的人也能跑完「提交需求 → 得到大纲 → 保存」。
       * 所以这里在调用任何模型之前短路：把内置的一份完整卷纲 Markdown 当成
       * assistant 消息写进当前会话，后续的展示、保存、校验全部复用真实链路
       * （用户点的「保存为大纲」仍然会真的写文件）。
       *
       * 只判定「引导进行中」，不判定别的条件：正式写作时即使用户没配模型，
       * 也应该看到真实的报错，而不是悄悄塞一份假大纲。
       */
      if (useGuideStore.getState().status === "running") {
        const novel = readGuideDemoNovel() ?? pickGuideDemoNovel()
        rememberGuideDemoNovel(novel)
        const conversationId = activeConversationId ?? createConversation()
        const now = Date.now()
        const userText = request.inspiration.trim() || `按示例需求生成一版《${novel.name}》的完整大纲`
        addMessage(conversationId, {
          id: `guide-demo-user-${now}`,
          role: "user",
          content: userText,
          timestamp: now,
        })
        addMessage(conversationId, {
          id: `guide-demo-outline-${now}`,
          role: "assistant",
          content: [
            buildGuideDemoOutlineMarkdown(novel),
            "",
            "---",
            "",
            "> 这份大纲来自**引导内置内容**，没有调用模型、没有消耗 Token。",
            "> 点下方的「保存为大纲」就会真正写进这本书的 `wiki/outlines/`；想改成自己的故事，直接在这段文字上改。",
          ].join("\n"),
          timestamp: now + 1,
        })
        setSaveStatus("已生成示例大纲（未调用模型）。点消息下方的「保存为大纲」写入小说。")
        void useOutlineChatStore.getState().saveToDisk()
        return
      }
      // 同人创作先把原作素材编译成持久正典：超长原作会被分片压缩成证据包，
      // 而不是把几十万字原样塞进提示词。编译后的正典同时落盘到
      // .novel/fanfic-canon.md，供后续正文生成的上下文包按固定路径读取。
      if (isFanficRequest(request)) {
        const fanficProjectPath = project?.path ? normalizePath(project.path) : "";
        const material = (request.fanficSourceMaterial ?? "").trim();
        if (request.fanficReuseCanon && !material) {
          // 复用已落盘正典：不再跑一遍分片编译，直接读文件喂给提示词。
          // 这是持久化正典的主要收益——第二次生成大纲不必重贴几十万字、
          // 也不必再付一次几十次 LLM 调用。
          try {
            // 注意用 loadFanficCanon + strip 而不是 loadFanficCanonBody：
            // 后者会截到 8000 字给上下文包用，大纲提示词要完整的正典正文。
            const existing = stripFanficCanonFrontmatter(
              await loadFanficCanon(fanficProjectPath),
            );
            if (!existing) {
              toast.error("没有找到可复用的原作正典，请粘贴原作素材后重试。", {
                dedupeKey: "outline-fanfic-canon-reuse:missing",
              });
              return;
            }
            request = { ...request, fanficSourceMaterial: existing };
            toast.success("已复用项目里已有的原作正典。", {
              dedupeKey: "outline-fanfic-canon-reuse:done",
            });
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "复用原作正典失败，请重试。",
              { dedupeKey: "outline-fanfic-canon-reuse:error" },
            );
            return;
          }
        } else if (fanficProjectPath) {
          toast.info("正在编译原作正典…", {
            dedupeKey: "outline-fanfic-canon-compile:start",
          });
          try {
            const compiled = await compileFanficCanon({
              projectPath: fanficProjectPath,
              sourceMaterial: request.fanficSourceMaterial ?? "",
              sourceName: (request.fanficSourceName ?? "").trim(),
              mode: resolveFanficMode(request),
              allowedDeviations: resolveFanficDeviations(request),
              // 分片编译可能持续很久，把进度透出给用户；每条进度只提示一次。
              onProgress: (message) => {
                toast.info(message, { dedupeKey: `outline-fanfic-canon-compile:${message}` });
              },
            });
            // 用编译后的正典替换原始素材：提示词只带证据包，不带原文。
            request = {
              ...request,
              fanficSourceMaterial: stripFanficCanonFrontmatter(compiled.document),
            };
            toast.success(
              compiled.compiled
                ? `原作正典已编译（${compiled.chunkCount} 个片段）并保存到 .novel/fanfic-canon.md`
                : "原作正典已编译并保存到 .novel/fanfic-canon.md",
              { dedupeKey: "outline-fanfic-canon-compile:done" },
            );
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "原作正典编译失败，请重试。",
              { dedupeKey: "outline-fanfic-canon-compile:error" },
            );
            return;
          }
        }
      }
      const outlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      const fastMode = outlineMode === "fast";
      // 原创作品如果还留着上一轮同人创作的正典，它仍会参与正文生成，
      // 让模型把一部外部原作当成权威。这里只提示、不擅自删文件。
      if (!isFanficRequest(request) && project?.path) {
        const canonPath = fanficCanonPath(normalizePath(project.path));
        try {
          if (await fileExists(canonPath)) {
            toast.info(
              `本项目已存在同人正典，它仍会参与正文生成。若本作是原创作品，请删除 ${canonPath}`,
              { dedupeKey: "outline-stale-fanfic-canon" },
            );
          }
        } catch {
          // 探测失败不影响生成
        }
      }
      if (outlineMode === "discuss") {
        // 共创模式把向导需求当讨论起点：先对齐方案再产出，不直接开写
        const capturedConvId = activeConversationId ?? createConversation();
        const wizardPrompt = buildOutlineWizardPrompt(request, { mode: "standard" });
        const module = request.targets[0] || "完整新书规划";
        intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
          title: module,
          hint: wizardPrompt,
          originalRequest: request.inspiration.trim(),
          references: [...outlineReferenceTokensRef.current],
          skillNames: getOutlineWizardSkillNames(request),
        });
        void handleSend(
          buildOutlineDiscussionPrompt(module, wizardPrompt, request.inspiration.trim()),
          outlineReferenceTokensRef.current,
          {
            conversationId: capturedConvId,
            disableWriteTools: true,
            preferredSkillNames: getOutlineWizardSkillNames(request),
            systemGenerated: true,
            userDisplayText: createNovelGenerationRequestPackage(request, wizardPrompt).summary,
          },
        );
        return;
      }
      if (outlineMode === "plan") {
        // 计划模式不直接短路到生成：向导需求先当作要素输入做盘点
        const capturedConvId = activeConversationId ?? createConversation();
        const wizardPrompt = buildOutlineWizardPrompt(request, { mode: "standard" });
        const module = request.targets[0] || "完整新书规划";
        intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
          title: module,
          hint: wizardPrompt,
          originalRequest: request.inspiration.trim(),
          references: [...outlineReferenceTokensRef.current],
          skillNames: getOutlineWizardSkillNames(request),
        });
        void startOutlinePlanElementCheck(capturedConvId, {
          module,
          requestHint: wizardPrompt,
          originalRequest: request.inspiration.trim(),
          references: outlineReferenceTokensRef.current,
          userDisplayText: createNovelGenerationRequestPackage(request, wizardPrompt).summary,
        });
        return;
      }
      const modelContent = fastMode
        ? buildOutlineWizardPrompt(request, { mode: "fast" })
        : buildOutlineWizardMultiAgentPrompt(request);
      void handleSend(modelContent, outlineReferenceTokensRef.current, {
        disableWriteTools: true,
        preferredSkillNames: fastMode ? [] : getOutlineWizardSkillNames(request),
        enableMultiAgent: !fastMode,
        intentPhase: "generation",
        novelGenerationRequest: createNovelGenerationRequestPackage(request, modelContent),
        systemGenerated: true,
      });
    },
    [activeConversationId, addMessage, createConversation, handleSend, startOutlinePlanElementCheck, project],
  );

  const handleStop = useCallback(() => {
    if (!activeConversationId) return;
    const runningState = useOutlineChatStore.getState().runStates[activeConversationId];
    if (runningState?.status !== "running" || !runningState.runId) return;
    outlineConversationRunRegistry.abort(activeConversationId);
    // 内容只存在于消息里（onText 直接写消息），streamingContents 仅承载
    // 状态提示文本。这里只需中止运行并清理状态；已生成内容由 handleSend /
    // handleRegenerate 的 catch 分支在 abort 传播后统一收尾落盘。
    clearStreamingContent(activeConversationId);
    stopConversationRun(activeConversationId, runningState.runId);
  }, [
    activeConversationId,
    clearStreamingContent,
    stopConversationRun,
  ]);

  /**
   * 「继续」：上一条大纲回复被用户手动停止后，保留已生成的内容接着往下写。
   *
   * 与「重试」（handleRegenerate，会从这条消息起整条重发）的分工：
   * 继续不动已有内容，只是把"接着写"作为新一轮用户请求发出去，
   * 模型在会话历史里看得到已经生成的那半截，于是从断点续写。
   * 提示词与章节面板共用同一个常量，两侧「继续」的含义一致。
   *
   * 要求（eventOutlineRequirement）必须从被停止的那条消息上取过来：
   * 它挂在消息本身，新一轮不会自动继承。若续写时模型不再回抄 requirement，
   * 卡片后续的「用这份细纲写这一章」就会缺掉「## 用户对本章的要求」——
   * 与「重新生成」修的是同一个洞，两条重发路径都要堵。
   */
  const handleContinueStopped = useCallback(async (eventOutlineRequirement?: string) => {
    if (isStreaming) return;
    await handleSendMessage(CONTINUE_STOPPED_GENERATION_PROMPT, {
      ...(eventOutlineRequirement ? { eventOutlineRequirement } : {}),
    });
  }, [handleSendMessage, isStreaming]);

  /**
   * 「继续」：上一条大纲回复**生成失败**后，保留已生成的内容接着往下写。
   *
   * 与 handleContinueStopped 的差别只有提示词（失败有一种"一个字都没产出"
   * 的形态，那时要整份重来而不是接着写）。eventOutlineRequirement 同样要从
   * 失败的那条消息上抄过来，否则续写出来的细纲卡片会缺掉「用户对本章的要求」。
   */
  const handleContinueFailed = useCallback(async (eventOutlineRequirement?: string) => {
    if (isStreaming) return;
    await handleSendMessage(FAILED_GENERATION_CONTINUE_PROMPT, {
      ...(eventOutlineRequirement ? { eventOutlineRequirement } : {}),
    });
  }, [handleSendMessage, isStreaming]);

  const handleRegenerate = useCallback(
    async (msgIndex: number) => {
      if (!project || isStreaming || !activeConversationId) return;
      recordLatestUserMemoryFeedback("negative");
      let effectiveLlmConfig = resolveNovelModel(
        llmConfig,
        novelConfig,
        "writing",
      );
      if (effectiveOutlineModelId) {
        effectiveLlmConfig = resolveModelConfig(
          effectiveOutlineModelId,
          effectiveLlmConfig,
          providerConfigs,
        );
      }
      // Regenerating replays a generation turn, so it takes the footer depth.
      effectiveLlmConfig = applyReasoningDepth(effectiveLlmConfig, aiOutlineReasoningDepth);
      const effectiveModelId = effectiveOutlineModelId || effectiveLlmConfig.model || "";
      if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
        addMessage(activeConversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "请先在设置中配置并选择一个可用的 AI 模型，或在下方模型选择器中选择模型后再试。",
        });
        return;
      }
      // 与上面首次发送同一套判定（重试/续写同样不能在无工具时跑，
      // 否则会把上一轮"看起来成功、文件没变"的状态再复制一遍）。
      if (!isFunctionCallingEnabled(effectiveLlmConfig)) {
        addMessage(activeConversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "当前供应商已关闭「启用 Function Calling」，AI 大纲需要工具调用才能把结果写入大纲文件。请到设置 → 模型设置中打开该开关，或更换支持工具调用的模型。",
        });
        return;
      }
      if (!modelSupportsTools(effectiveModelId, effectiveLlmConfig.provider)) {
        addMessage(activeConversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "当前模型不支持 AI 大纲工具调用，请在下方模型选择器中更换支持工具调用的模型。",
        });
        return;
      }

      // Remove messages from msgIndex onwards
      const conv = useOutlineChatStore
        .getState()
        .conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;
      const capturedConvId = activeConversationId;
      const targetAssistantMessage = conv.messages[msgIndex];
      let precedingUserIndex = msgIndex - 1;
      while (precedingUserIndex >= 0 && conv.messages[precedingUserIndex]?.role !== "user") {
        precedingUserIndex -= 1;
      }
      const precedingUserMessage = precedingUserIndex >= 0 ? conv.messages[precedingUserIndex] : undefined;
      const historicalIntent = targetAssistantMessage?.role === "assistant"
        ? parseIntentClarityProtocol(targetAssistantMessage.content)
        : { kind: "none" as const };
      const regenerateAsIntentAnalysis = targetAssistantMessage?.intentPhase === "intent_analysis"
        || (targetAssistantMessage?.intentPhase == null
          && historicalIntent.kind !== "none"
          && Boolean(precedingUserMessage && classifyDirectOutlineGenerationRequest(precedingUserMessage.content)));
      if (
        regenerateAsIntentAnalysis
        && precedingUserMessage
        && !["fast", "discuss"].includes(
          resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode),
        )
      ) {
        const precedingUserContent = getOutlineMessageModelContent(precedingUserMessage);
        const directRequest = classifyDirectOutlineGenerationRequest(precedingUserContent);
        intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
          title: directRequest?.module || (historicalIntent.kind === "valid" ? historicalIntent.result.module : "大纲"),
          hint: precedingUserContent,
          originalRequest: precedingUserContent,
          references: precedingUserMessage.attachedReferences ?? [],
          skillNames: getOutlineSkillNames(directRequest?.module || precedingUserContent),
        });
        useOutlineChatStore.setState((state) => ({
          conversations: state.conversations.map((conversation) => conversation.id === capturedConvId
            ? { ...conversation, messages: conversation.messages.slice(0, precedingUserIndex) }
            : conversation),
        }));
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "intent_analysis"));
        await handleSend(precedingUserContent, precedingUserMessage.attachedReferences ?? [], {
          conversationId: capturedConvId,
          clearDraft: false,
          intentPhase: "intent_analysis",
        });
        return;
      }
      const regenerationIntentPhase = targetAssistantMessage?.intentPhase;
      const regenerationOutlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      const regenerationDiscussPhase: OutlineDiscussPhase | undefined =
        regenerationOutlineMode === "discuss" && regenerationIntentPhase !== "generation"
          ? "decision"
          : undefined;
      const runId = crypto.randomUUID();
      if (!startConversationRun(capturedConvId, runId)) return;
      const controller = new AbortController();
      outlineConversationRunRegistry.register(capturedConvId, controller);
      const isCurrentRun = () => canApplyOutlineRunEffect(
        useOutlineChatStore.getState().runStates,
        capturedConvId,
        runId,
      );
      const targetMessages = conv.messages.slice(0, msgIndex);

      // Update store
      useOutlineChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === capturedConvId
            ? { ...c, messages: targetMessages }
            : c,
        ),
      }));

      clearStreamingContent(capturedConvId);
      userScrolledUpRef.current = false;
      const assistantId = crypto.randomUUID();
      let assistantAdded = false;
      let accumulatedReasoningContent = "";

      try {
        const regenerationInput = buildOutlineRegenerationInput(targetMessages);
        const lastUserRequest = regenerationInput.request;
        const historyMessages = regenerationInput.history satisfies AgentMessage[];
        let contextHubSnapshot: ContextHubSnapshotRef | undefined;
        let contextHubResult: ContextHubResult | null = null;
        const regenerationRequestBudget = planOutlineRequestBudget({
          maxContextSize: effectiveLlmConfig.maxContextSize,
          stage: "generation",
          maxOutputTokens: getEffectiveMaxOutputTokens(effectiveLlmConfig),
          thinkingFloorTokens: thinkingMinMaxTokens(
            effectiveLlmConfig.reasoning ?? { mode: "auto" },
          ),
        });
        try {
          const contextHub = getContextHub(normalizePath(project.path));
          contextHubResult = await contextHub.prepare({
            projectPath: normalizePath(project.path),
            surface: "ai-outline",
            sessionId: capturedConvId,
            task: lastUserRequest,
            intent: "generate",
            messages: historyMessages,
            existingSummary: undefined,
            tokenBudget: regenerationRequestBudget.contextTokenBudget,
            maxContextSize: effectiveLlmConfig.maxContextSize,
          });
          if (contextHubResult && isCurrentRun()) {
            try {
              contextHubSnapshot = await contextHub.saveSnapshot(assistantId, contextHubResult);
            } catch (error) {
              console.warn("AI 大纲重新生成上下文快照保存失败，继续生成：", error);
            }
          }
        } catch (error) {
          console.warn("AI 大纲重新生成上下文中控准备失败，继续使用原有流程：", error);
        }
        let result = "";

        addMessage(capturedConvId, {
          id: assistantId,
          role: "assistant",
          content: "",
          sources: [],
          agentToolCalls: [],
          isAgentRunning: true,
          contextHubSnapshot,
          intentPhase: regenerationIntentPhase,
          outlineDiscussPhase: regenerationDiscussPhase,
          // 重发的是同一条请求：要求跟着新消息走，否则「重新生成」之后
          // 扩写提示词里就再也不会出现「## 用户对本章的要求」。
          ...(targetAssistantMessage?.eventOutlineRequirement
            ? { eventOutlineRequirement: targetAssistantMessage.eventOutlineRequirement }
            : {}),
        });
        assistantAdded = true;

        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const registry = new ToolRegistry();
        const regenerationDiscussModule = regenerationDiscussPhase
          ? (intentContextsRef.current[capturedConvId]?.title || "大纲")
          : undefined;
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: regenerationOutlineMode,
          discussModule: regenerationDiscussModule,
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: regenerationOutlineMode,
          soulDoc,
          discussModule: regenerationDiscussModule,
        });
        const regenerationPhaseRules = buildIntentPhaseSystemRules(regenerationIntentPhase);
        const regenerationContext = intentContextsRef.current[capturedConvId];
        const regenerationSkillNames = regenerationContext?.skillNames
          ?? getOutlineSkillNames(regenerationContext?.title || lastUserRequest);
        const regenerationSkills = resolveAvailableSkillsByNames(
          outlineWritingSkills,
          regenerationSkillNames,
        );
        const regenerationSkillPrompt = buildSelectedSkillsPrompt(regenerationSkills.skills);
        const baseSystemContent: AgentMessage["content"] = contextHubResult
          ? buildContextHubSystemContent(baseSystemPrompt, contextHubResult, [regenerationPhaseRules])
          : [legacySystemPrompt, regenerationPhaseRules].filter(Boolean).join("\n\n");
        const systemContent = appendSystemRules(baseSystemContent, regenerationSkillPrompt);
        const systemPrompt = typeof systemContent === "string"
          ? systemContent
          : flattenContextHubSystemContent(systemContent);
        const agentConfig = buildAgentConfig(
          effectiveModelId,
          systemPrompt,
          registry,
          {
            wikiPath: `${normalizePath(project.path)}/wiki`,
            getSkillConfig: () => skillConfig,
            getUserSkills: () => outlineWritingSkills,
            getSearchApiConfig: () => useWikiStore.getState().searchApiConfig,
            getChatConversations: () => {
              const state = useChatStore.getState();
              return state.conversations.map((conversation) => ({
                id: conversation.id,
                title: conversation.title,
                messages: state.messages
                  .filter(
                    (message) => message.conversationId === conversation.id,
                  )
                  .map((message) => ({
                    role: message.role,
                    content: message.content,
                  })),
              }));
            },
            getOutlineConversations: () =>
              mapOutlineConversationsForModel(
                useOutlineChatStore.getState().conversations,
              ),
            llmConfig: effectiveLlmConfig,
            disabledTools: mergeDisabledTools(
              OUTLINE_CHAT_DISABLED_TOOLS,
              regenerationSkillNames.length > 0 ? ["apply_skill"] : [],
            ),
            ...(contextHubResult
              ? { readTextFile: contextHubResult.readFile }
              : {}),
          },
        );
        agentConfig.requestOverrides = {
          ...agentConfig.requestOverrides,
          max_tokens: regenerationRequestBudget.outputTokens,
          userMemorySurface: "ai-outline",
          userMemoryProjectKey: normalizePath(project.path),
          userMemorySessionKey: capturedConvId,
        };
        const regenerationMessages: AgentMessage[] = [
          { role: "system", content: systemContent },
          ...historyMessages,
          { role: "user", content: lastUserRequest },
        ];
        const regenerationRecords: AgentRunRecord[] = [];
        const regenerationRun = await runOutlineAttemptWithReasoningRetry(
          agentConfig,
          async (requestOverrides) => {
            let runText = "";
            const agentErrorBox: { current: Error | null } = { current: null };
            const attemptRecord = await new AgentRunner().run(
              { ...agentConfig, requestOverrides },
              registry,
              regenerationMessages,
              {
                onText: (chunk) => {
                  runText += chunk;
                  result = runText;
                  if (isCurrentRun()) {
                    updateOutlineAssistantMessage(
                      capturedConvId,
                      assistantId,
                      (message) => ({
                        ...message,
                        content: result,
                      }),
                    );
                  }
                },
                onReasoningToken: (chunk) => {
                  accumulatedReasoningContent += chunk;
                },
                onToolCall: () => {},
                onToolResult: () => {},
                onToolError: () => {},
                onToolEvent: (event) => {
                  if (!isCurrentRun()) return;
                  updateOutlineAssistantMessage(
                    capturedConvId,
                    assistantId,
                    (message) => ({
                      ...message,
                      agentToolCalls: applyAgentToolEvent(
                        message.agentToolCalls,
                        event,
                      ),
                    }),
                  );
                },
                onDone: () => {},
                onError: (error) => {
                  agentErrorBox.current = error;
                },
              },
              controller.signal,
            );
            regenerationRecords.push(attemptRecord);
            const agentError = agentErrorBox.current;
            if (agentError && !isReasoningOnlyResponseError(agentError)) throw agentError;
            return {
              text: runText || attemptRecord.finalText,
              record: attemptRecord,
              error: agentError ?? undefined,
            };
          },
          (thoughtText) => {
            if (controller.signal.aborted || !isCurrentRun()) throw new Error("aborted");
            if (thoughtText.trim()) {
              accumulatedReasoningContent = [accumulatedReasoningContent, thoughtText]
                .filter((item) => item.trim())
                .join("\n\n");
            }
            result = "";
            updateOutlineAssistantMessage(capturedConvId, assistantId, (message) => ({
              ...message,
              content: "",
              isAgentRunning: true,
            }));
            setStreamingContent(capturedConvId, "模型仅返回思考过程，正在关闭 reasoning 重试...");
          },
        );
        if (regenerationRun.error) throw regenerationRun.error;
        const record: AgentRunRecord = {
          ...regenerationRun.record,
          finalText: regenerationRun.text,
          usage: regenerationRecords.reduce<LlmUsage | undefined>(
            (usage, item) => addLlmUsage(usage, item.usage),
            undefined,
          ),
          roundsUsed: regenerationRecords.reduce((total, item) => total + Math.max(1, item.roundsUsed || 1), 0),
          toolCalls: regenerationRecords.flatMap((item) => item.toolCalls),
          requestTraces: regenerationRecords.flatMap((item) => item.requestTraces ?? []),
          omittedRequestTraceCount: regenerationRecords.reduce(
            (total, item) => total + (item.omittedRequestTraceCount ?? 0),
            0,
          ),
          providerRequestCountAvailable: regenerationRecords.every(
            (item) => item.providerRequestCountAvailable !== false,
          ),
          userMemoryDecision: regenerationRecords.find(
            (item) => item.userMemoryDecision !== undefined,
          )?.userMemoryDecision,
        };
        if (!isCurrentRun()) return;
        if (contextHubResult && (record.usage || record.requestTraces?.length)) {
          try {
            const updatedSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              assistantId,
              contextHubResult,
              record.lastRequestUsage ?? record.usage,
              {
                memoryDecision: record.userMemoryDecision,
                requestDiagnostics: buildLlmRequestDiagnostics(
                  record.usage,
                  Math.max(1, record.roundsUsed || 1),
                  {
                    requests: record.requestTraces,
                    omittedRequestCount: record.omittedRequestTraceCount,
                    requestCountAvailable: record.providerRequestCountAvailable,
                    usageScope: record.usageAggregationScope,
                  },
                ),
              },
            );
            if (updatedSnapshot && isCurrentRun()) {
              updateOutlineAssistantMessage(capturedConvId, assistantId, (message) => ({
                ...message,
                contextHubSnapshot: updatedSnapshot,
              }));
            }
          } catch (error) {
            console.warn("AI 大纲重新生成供应商缓存用量快照保存失败，继续保留本地缓存统计：", error);
          }
        }
        persistOutlineConversationContextUsage({
          conversationId: capturedConvId,
          windowTokens: getEffectiveMaxContextSize(effectiveLlmConfig),
          systemPrompt: contextHubResult ? baseSystemPrompt : systemPrompt,
          contextHubResult,
          historyMessages: historyMessages.map((message) => ({
            content: messageContentToText(message.content),
          })),
          currentInput: lastUserRequest,
          usage: record.lastRequestUsage ?? record.usage,
        });

        const sources = [
          ...outlineToolCallsToSources(record.toolCalls),
          ...regenerationSkills.missingNames.map((name) => `Skill 缺失（未强制启用）: ${name}`),
        ];
        const filteredRegenerationContent = filterOutlineGeneratedContent(
          regenerationRun.text || result || record.finalText,
        );
        if (filteredRegenerationContent.reasoningOnly) {
          throw new Error(OUTLINE_REASONING_ONLY_ERROR_MESSAGE);
        }
        const rawRegenerationContent = filteredRegenerationContent.content || "AI大纲未返回内容。";
        // 与首轮一致：共创轮若直接交付了完整大纲，按已交付处理，不要求讨论协议。
        const regenerationDeliveredOutline = regenerationDiscussPhase
          ? isDiscussDeliveredOutline(rawRegenerationContent)
          : false;
        const regenerationProtocolRequired = regenerationDiscussPhase && !regenerationDeliveredOutline;
        // 与首轮一致：换一批 / 续跑同样走「一次重试 + 降级放行」。
        const regenerationDiscussGate = regenerationProtocolRequired
          ? await resolveOutlineDiscussProtocol({
            text: rawRegenerationContent,
            module: regenerationDiscussModule || "大纲",
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
          })
          : { protocol: null, notice: "", error: "" };
        const regenerationFinalProtocol = regenerationDiscussGate.protocol;
        const regenerationDiscussError = regenerationProtocolRequired && regenerationDiscussGate.error
          ? `共创协议格式无效，尚未开始生成：${regenerationDiscussGate.error}`
          : undefined;
        const regenerationDiscussNotice = regenerationProtocolRequired
          ? regenerationDiscussGate.notice || undefined
          : undefined;
        const rawRegenerationIntentProtocol = parseIntentClarityProtocol(rawRegenerationContent);
        const nextStepExtraction = extractNextStep(
          rawRegenerationContent,
          { allowFallback: true, completedModule: "当前模块" },
        );
        const cleanFinalContent = nextStepExtraction.cleanText || "AI大纲未返回内容。";
        const finalContent = await finalizeStructuredMarkdownMessage(cleanFinalContent, {
          enabled: regenerationInput.structuredGeneration && rawRegenerationIntentProtocol.kind === "none",
          repairWithAi: ({ content, maxTokens }) => repairMarkdownFormatWithAi({
            content,
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
            maxTokens,
          }),
          onFailure: () => toast.info("Markdown 格式自动修复未完全通过，已保留内容最完整的版本。", {
            dedupeKey: "outline-markdown-quality-incomplete",
          }),
        });
        if (!isCurrentRun()) return;
        let regenerationIntentProtocol = rawRegenerationIntentProtocol.kind !== "none"
          ? rawRegenerationIntentProtocol
          : parseIntentClarityProtocol(finalContent);
        // 与首轮一致：意图协议缺失/损坏时先补一轮再判错（正文不再被清空）。
        if (regenerationIntentPhase === "intent_analysis" && regenerationIntentProtocol.kind !== "valid") {
          const intentGate = await resolveIntentClarityProtocol({
            text: finalContent,
            module: "",
            llmConfig: effectiveLlmConfig,
            signal: controller.signal,
          });
          if (intentGate.outcome.kind === "valid") regenerationIntentProtocol = intentGate.outcome;
        }
        const regenerationIntentProtocolError = regenerationIntentPhase === "generation"
          && regenerationIntentProtocol.kind !== "none"
          ? "正文生成阶段返回了 intent_clarity，已阻止重复意图分析和自动循环。"
          : regenerationIntentPhase === "intent_analysis"
            && regenerationIntentProtocol.kind !== "valid"
            ? `意图分析格式无效，尚未开始生成：${regenerationIntentProtocol.kind === "invalid" ? regenerationIntentProtocol.error : "模型未返回 intent_clarity 协议块"}`
            : undefined;
        updateOutlineAssistantMessage(
          capturedConvId,
          assistantId,
          (message) => ({
            ...message,
            content: finalContent,
            reasoning_content: accumulatedReasoningContent,
            sources,
            agentToolCalls: settleRunningAgentToolCalls(record.toolCalls.length ? record.toolCalls : message.agentToolCalls),
            isAgentRunning: false,
            nextStepRecommendation: regenerationIntentProtocolError || regenerationProtocolRequired
              ? null
              : nextStepExtraction.recommendation,
            intentProtocolError: regenerationIntentProtocolError,
            // 直接交付了大纲的共创轮按生成轮处理：不带讨论标，正文走正常显示路径。
            outlineDiscussPhase: regenerationProtocolRequired ? regenerationDiscussPhase : undefined,
            // 降级放行的协议也照常出卡片（见首轮同名注释）。
            outlineDiscussProtocol: regenerationFinalProtocol,
            outlineDiscussError: regenerationDiscussError,
            outlineDiscussNotice: regenerationDiscussNotice,
          }),
        );
        setConversationContextSummary(capturedConvId, buildSessionContextSummary({
          messages: [
            ...historyMessages,
            { role: "user", content: lastUserRequest },
            { role: "assistant", content: finalContent },
          ],
          dependencyFingerprint: contextHubResult?.dependencyStamp.fingerprint ?? "",
        }));
        if (!isCurrentRun()) return;
        if (
          regenerationIntentProtocol.kind === "none"
          && !regenerationIntentProtocolError
          && !regenerationProtocolRequired
        ) {
          await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun, assistantId);
        }
        if (!isCurrentRun()) return;
        clearStreamingContent(capturedConvId);
        finishConversationRun(
          capturedConvId,
          useOutlineChatStore.getState().activeConversationId,
          runId,
        );
        void useOutlineChatStore.getState().saveToDisk();
      } catch (err) {
        const errorMsg = friendlyLlmErrorMessage(err instanceof Error ? err.message : String(err));
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        // 内容唯一存在于消息里（onText 直接写入）。这里只负责收尾：
        // 保留已生成内容、补错误/停止占位、结束消息运行态，绝不删除内容。
        if (assistantAdded) {
          updateOutlineAssistantMessage(capturedConvId, assistantId, (message) => ({
            ...message,
            content: filterOutlineGeneratedContent(message.content).content.trim()
              ? aborted
                ? `${filterOutlineGeneratedContent(message.content).content}\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。`
                : `${filterOutlineGeneratedContent(message.content).content}\n\n---\n\n⚠️ 生成中断：${errorMsg || "未知错误"}`
              : aborted
                ? "已停止生成。"
                : `生成失败：${errorMsg || "未知错误"}`,
            reasoning_content: accumulatedReasoningContent,
            agentToolCalls: settleRunningAgentToolCalls(
              message.agentToolCalls,
              aborted ? "cancelled" : "error",
              Date.now(),
              aborted ? undefined : errorMsg,
            ),
            isAgentRunning: false,
          }));
        } else if (!aborted && isCurrentRun()) {
          addMessage(capturedConvId, {
            id: assistantId,
            role: "assistant",
            content: `生成失败：${errorMsg || "未知错误"}`,
          });
        }
        void useOutlineChatStore.getState().saveToDisk();
        if (!isCurrentRun()) return;
        clearStreamingContent(capturedConvId);
        failConversationRun(capturedConvId, errorMsg || "未知错误", runId);
        if (!aborted) {
          toast.error(errorMsg || "未知错误", {
            title: "大纲生成失败",
            persistent: true,
            dedupeKey: `outline-run:${capturedConvId}:${errorMsg}`,
          });
        }
      } finally {
        outlineConversationRunRegistry.remove(capturedConvId, controller);
      }
    },
    [
      project,
      isStreaming,
      llmConfig,
      novelConfig,
      providerConfigs,
      effectiveOutlineModelId,
      aiOutlineReasoningDepth,
      activeConv,
      activeConversationId,
      addMessage,
      handleSend,
      handleAutoSaveOutlineRequests,
      outlineWritingSkills,
      clearStreamingContent,
      startConversationRun,
      finishConversationRun,
      failConversationRun,
      setConversationContextSummary,
    ],
  );

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard
      .writeText(cleanNextStepArtifacts(content))
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => {});
  }, []);

  const handleSaveAsOutline = useCallback(
    async (content: string) => {
      if (!project) {
        toast.error("请先打开一个项目，再保存大纲");
        return;
      }
      if (!activeConversationId) {
        toast.error("当前没有活跃的对话，无法保存大纲");
        return;
      }
      const capturedConvId = activeConversationId;
      setSaveStatus("");
      try {
        const filteredOutput = filterOutlineGeneratedContent(content);
        if (filteredOutput.reasoningOnly || !filteredOutput.content) {
          toast.error("内容仅包含模型思考过程，无法保存为大纲");
          return;
        }
        const built = buildClassifiedOutlineSaveRequest({
          content: filteredOutput.content,
          sourceIntent: "手动保存 AI 大纲结果",
          sourceHint: collectOutlineSaveSourceHint(capturedConvId),
        });
        if (!built) {
          toast.error("内容为空，无法保存为大纲");
          return;
        }

        const currentConv = useOutlineChatStore.getState().conversations.find((c) => c.id === capturedConvId);
        const lastAssistantMsg = [...(currentConv?.messages ?? [])].reverse().find((m) => m.role === "assistant");
        const characterResults = lastAssistantMsg?.characterMultiAgentResults;

        /*
         * 手动通道的咽喉闸门。必须放在这里，而不是只靠「藏起保存按钮」：
         * 按钮是靠 extractEventOutlineData 解析成功才隐藏的，而**JSON 围栏被截断时
         * 解析结果是 null** —— 于是按钮照样显示，用户点下去，这条消息里那个提示词
         * 强制的「# 事件细纲 · 第N章 …」一级标题正好命中 EVENT_TYPE_MARK，
         * 最终写进 wiki/outlines/事件细纲/。也就是说：越是在 JSON 坏掉的时候，
         * 越容易从手动通道漏进去 —— 这恰恰是丙-1 要防的那件事。
         *
         * 为什么合法的 17 节章纲在实践中不会被误拦：**只有一条**保护 ——
         * canonical 的章纲模板里**没有**事件标记
         * （chapter-outline-template.ts 里 grep 不到「事件细纲/事件清单/事件序列」），
         * 于是 inferFileTypeFromContent 的事件标记判定不命中，落到章/卷判定。
         *
         * ⚠️ 订正一处曾经的误述：这里**不是**「标题 hint 先于正文」。分类链
         * （outline-save-classifier.ts:187-194）里 `inferFileTypeFromHint(title)`
         * 是**第 5** 条通道；真正给标题带「章纲」的文档定型的是**第 3** 条
         * `resolveChapterOrVolumeType(extractDocumentSubject(title, content))`
         * （它把标题与首个 H1 一起看）。对本例这类标题（如「第一次冷处理」），
         * 标题通道什么都推不出来（inferFileTypeFromHint 对它返回 null）。
         *
         * ⚠️ 这是**当前模板的巧合**，不是结构性保证：`inferFileTypeFromContent` 的
         * 事件标记判定排在章/卷标记**之前**，所以一份正文里真出现「事件序列」的
         * 17 节章纲仍会被定型成 event-outline，然后在这里被静默拒掉
         * —— 正因如此，被拒时必须给出可见反馈（下面的 toast.info），
         * 不能让用户遇到「点了没反应」。这是已知的假阳性路径，记在实施计划里。
         */
        if (isEventOutlineSaveBlocked(built.classification.fileType)) {
          toast.info("事件细纲只作为对话消息保留，不写入大纲列表。");
          return;
        }

        if (built.classification.fileType === "character") {
          if (characterResults && characterResults.length > 0) {
            const characterDrafts: CharacterSaveDraft[] = characterResults.flatMap((r) => {
              const filteredCharacter = filterOutlineGeneratedContent(r.content);
              if (!filteredCharacter.content || filteredCharacter.reasoningOnly) return [];
              return [{
                id: `${r.plan.roleType}:${r.plan.characterName}`,
                characterName: r.plan.characterName,
                roleType: r.plan.roleType,
                fileName: r.fileName,
                content: filteredCharacter.content,
                selected: true,
                confidence: "high" as const,
              }];
            });
            if (characterDrafts.length === 0) {
              toast.error("人物小传仅包含模型思考过程，无法保存");
              return;
            }
            presentOrQueueSaveBatch({
              title: "请确认要保存的人物角色",
              mode: "character",
              requests: [],
              characterDrafts: enrichCharacterDraftsWithHtml(characterDrafts, filteredOutput.content),
            });
            return;
          }

          const extracted = extractCharacterSaveDrafts(built.draft.content);
          if (extracted.drafts.length === 0) {
            setSaveStatus(extracted.errors.join("；"));
            return;
          }
          presentOrQueueSaveBatch({
            title: "请确认要保存的人物角色",
            mode: "character",
            requests: [],
            characterDrafts: enrichCharacterDraftsWithHtml(extracted.drafts, filteredOutput.content),
          });
          return;
        }

        presentOrQueueSaveBatch({
          title: "保存大纲文件",
          mode: "normal",
          characterDrafts: [],
          requests: [built.request],
        });
      } catch (err) {
        setSaveStatus(
          `保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [activeConversationId, collectOutlineSaveSourceHint, presentOrQueueSaveBatch, project],
  );

  const handleConfirmToolSave = useCallback(
    async (call: ToolCallRecord & { preview?: string }) => {
      if (!project) return;
      if (call.status !== "approval_required") return;
      if (call.name !== "write_outline_node") {
        setSaveStatus("当前写入工具暂不支持在 AI 大纲中确认。");
        return;
      }

      setSaveStatus("正在确认写入大纲...");
      updateOutlineToolCall(call.id, (current) => ({
        ...current,
        status: "running",
        result: "正在写入大纲...",
        finishedAt: 0,
      }));

      try {
        const projectPath = normalizePath(project.path);
        const tool = createWriteOutlineNodeTool(`${projectPath}/wiki/outlines`);
        const result = await tool.execute(call.params);
        updateOutlineToolCall(call.id, (current) => ({
          ...current,
          status: result.startsWith("错误：") ? "error" : "done",
          result,
          finishedAt: Date.now(),
        }));
        await refreshProjectState(projectPath);
        setSaveStatus(result.startsWith("错误：") ? result : "已确认写入大纲");
      } catch (error) {
        const message = `写入大纲失败：${error instanceof Error ? error.message : String(error)}`;
        updateOutlineToolCall(call.id, (current) => ({
          ...current,
          status: "error",
          result: message,
          finishedAt: Date.now(),
        }));
        setSaveStatus(message);
      } finally {
        void useOutlineChatStore.getState().saveToDisk();
      }
    },
    [project],
  );

  const handleRejectTool = useCallback((call: ToolCallRecord & { preview?: string }) => {
    updateOutlineToolCall(call.id, (current) => ({
      ...current,
      status: "cancelled",
      result: "已放弃写入。",
      finishedAt: Date.now(),
    }));
    setSaveStatus("已放弃写入。");
    void useOutlineChatStore.getState().saveToDisk();
  }, []);


  const requestDeleteConversation = useCallback((conversationId: string) => {
    if (runStates[conversationId]?.status === "running") {
      setPendingDeleteConversationId(conversationId);
      return;
    }
    deleteConversation(conversationId);
  }, [deleteConversation, runStates]);

  const confirmDeleteRunningConversation = useCallback(() => {
    if (!pendingDeleteConversationId) return;
    const runningState = useOutlineChatStore.getState().runStates[pendingDeleteConversationId];
    outlineConversationRunRegistry.abort(pendingDeleteConversationId);
    if (runningState?.status === "running" && runningState.runId) {
      stopConversationRun(pendingDeleteConversationId, runningState.runId);
    }
    clearStreamingContent(pendingDeleteConversationId);
    deleteConversation(pendingDeleteConversationId);
    setPendingDeleteConversationId(null);
  }, [clearStreamingContent, deleteConversation, pendingDeleteConversationId, stopConversationRun]);

  const requestClearHistory = useCallback(() => {
    setPendingClearHistoryIds(historyConversations.map((conversation) => conversation.id));
    setHistoryOpen(false);
  }, [historyConversations]);

  const confirmClearHistory = useCallback(() => {
    for (const conversationId of pendingClearHistoryIds ?? []) {
      const runningState = useOutlineChatStore.getState().runStates[conversationId];
      outlineConversationRunRegistry.abort(conversationId);
      if (runningState?.status === "running" && runningState.runId) {
        stopConversationRun(conversationId, runningState.runId);
      }
      clearStreamingContent(conversationId);
      deleteConversation(conversationId);
    }
    setPendingClearHistoryIds(null);
  }, [clearStreamingContent, deleteConversation, pendingClearHistoryIds, stopConversationRun]);

  const outlineRunLimitReached = activeConversationId
    ? !isStreaming && !canStartConversationRun(activeConversationId)
    : Object.values(runStates).filter((state) => state.status === "running").length >= 3;
  const submitDisabled = isStreaming || outlineRunLimitReached;
  const submitDisabledReason = outlineRunLimitReached && !isStreaming
    ? "大纲 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。"
    : undefined;

  // 需求分析浮层：只认最新一条「需要用户定范围」的助手消息。
  // 用户选中后会追加新消息，最新一条随之改变，浮层自然收起。
  const latestMessage = activeMessages[activeMessages.length - 1];
  const pendingIntentPrompt = !isStreaming
    && latestMessage?.role === "assistant"
    && latestMessage.intentClarityResult?.clarity === "needs_input"
    ? { id: latestMessage.id, result: latestMessage.intentClarityResult }
    : null;
  // 关闭状态记在 store 里（按消息 ID）：面板会随功能切换卸载重建，
  // 组件内 state 会丢，导致「关过了又弹回来」或「误关后彻底不再出现」。
  const dismissedIntentPromptIds = useOutlineChatStore((s) => s.dismissedIntentPromptIds);
  const dismissIntentPrompt = useOutlineChatStore((s) => s.dismissIntentPrompt);
  const [intentOptionEntries, setIntentOptionEntries] = useState<OutlineListEntry[]>([]);
  const pendingIntentMessageId = pendingIntentPrompt?.id ?? null;
  // 兜底候选取自磁盘上真实存在的大纲文档；读盘失败就退回缺失项候选，不阻塞浮层。
  useEffect(() => {
    if (!pendingIntentMessageId || !project?.path) return;
    let cancelled = false;
    void listOutlineEntries(`${normalizePath(project.path)}/wiki/outlines`)
      .then((entries) => {
        if (!cancelled) setIntentOptionEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setIntentOptionEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingIntentMessageId, project?.path]);

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden border-border bg-background"
      data-ui-ai-panel="outline"
    >
      {/* Header with conversation tabs */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2" data-ui-ai-header>
        {<UiTestAiIdentity conversationTitle={activeConv?.title || "大纲对话"} status={<ConversationRunStatusIcon state={runStates[activeConversationId ?? ""]} />} />}
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {topConversations.length > 0 ? (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
              {topConversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                return (
                  <div
                    key={conv.id}
                    onMouseEnter={() => setHoveredConversationId(conv.id)}
                    onMouseLeave={() => setHoveredConversationId(null)}
                    className={`group flex min-w-[72px] items-center rounded-full border text-xs transition-colors ${
                      isActive
                        ? "shrink border-primary/40 bg-background text-foreground shadow-sm"
                        : "shrink-0 border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveConversation(conv.id)}
                      className="flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5"
                      title={conv.title}
                    >
                      <ConversationRunStatusIcon state={runStates[conv.id]} />
                      <span className="max-w-[140px] truncate font-medium">{getConversationTabTitle(conv.title, 10)}</span>
                      <span className="text-[0.625rem] opacity-70">{conv.messages.length}</span>
                      <span className="text-[0.625rem] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
                    </button>
                    {hoveredConversationId === conv.id ? (
                      <button
                        type="button"
                        aria-label={`删除大纲会话：${conv.title}`}
                        className="mr-2 rounded p-0.5 text-muted-foreground hover:text-destructive"
                        onClick={() => requestDeleteConversation(conv.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {outlineWorkflowStage !== "idle" && outlineWorkflowStage !== "saved" ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                  {outlineWorkflowStage === "intent_analysis" ? "意图分析中" :
                   outlineWorkflowStage === "waiting_user_input" ? "等待选择" :
                   outlineWorkflowStage === "collecting_requirements"
                     ? outlineWorkflowMode === "discuss" ? "等待拍板" : "收集要素" :
                   outlineWorkflowStage === "waiting_user_confirm"
                     ? outlineWorkflowMode === "discuss" ? "等待定稿" : "等待确认计划" :
                   outlineWorkflowStage === "sufficiency_check" ? "生成中" :
                   "处理中"}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              暂无大纲对话
            </span>
          )}
        </div>
        <div className="qmai-header-actions ml-auto flex shrink-0 items-center">
        <span
          className="inline-flex shrink-0"
          title={!canCreateConversation ? EMPTY_CONVERSATION_CREATE_REASON : undefined}
        >
          <button
            type="button"
            onClick={() => {
              createConversation();
            }}
            className="qmai-new-conversation-button flex h-7 w-7 shrink-0 items-center justify-center"
            disabled={!canCreateConversation}
            title={canCreateConversation ? "新建大纲对话" : EMPTY_CONVERSATION_CREATE_REASON}
            aria-label="新建大纲对话"
            aria-describedby={!canCreateConversation
              ? "outline-new-conversation-disabled-reason"
              : undefined}
          >
            <Plus className="h-4 w-4" />
          </button>
          {!canCreateConversation && (
            <span id="outline-new-conversation-disabled-reason" className="sr-only">
              {EMPTY_CONVERSATION_CREATE_REASON}
            </span>
          )}
        </span>
        <div className="relative shrink-0" ref={historyRef}>
          <button
            ref={historyButtonRef}
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            className="qmai-outline-history-button inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            title="大纲会话历史"
            aria-label="大纲会话历史"
            aria-expanded={historyOpen}
          >
            <History className="h-3.5 w-3.5" />
            <span>历史大纲对话</span>
            {menuConversationCount > 0 ? (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[0.625rem] font-medium text-primary">
                {menuConversationCount}
              </span>
            ) : null}
            <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </button>
          {historyOpen && historyDropdownStyle
            ? createPortal(
                <div
                  ref={historyDropdownRef}
                  className="fixed z-50 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
                  style={historyDropdownStyle}
                  data-ui-ai-menu="history"
                >
                  {menuConversationCount > 0 ? (
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-2 py-1.5">
                      <span className="text-xs text-muted-foreground">{`全部会话 ${menuConversationCount} 条`}</span>
                      {historyCount > 0 ? (
                        <button
                          type="button"
                          aria-label="一键清理会话历史"
                          title={`仅清理 ${historyCount} 条旧会话，保留当前和运行中的会话`}
                          onClick={requestClearHistory}
                          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          清理旧会话
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {menuConversationCount === 0 ? (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                      暂无历史大纲对话
                    </div>
                  ) : (
                    menuConversations.map((conv) => (
                      <div
                        key={conv.id}
                        className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <button type="button" onClick={() => setActiveConversation(conv.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={conv.title}>
                          <ConversationRunStatusIcon state={runStates[conv.id]} />
                          <span className="min-w-0 flex-1 truncate font-medium">{getConversationTabTitle(conv.title, 16)}</span>
                          <span className="shrink-0 text-[0.625rem] opacity-70">{conv.messages.length}</span>
                          <span className="shrink-0 text-[0.625rem] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
                        </button>
                        <button type="button" aria-label={`删除大纲会话：${conv.title}`} onClick={() => requestDeleteConversation(conv.id)} className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>,
                document.body,
              )
            : null}
        </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="关闭大纲助手"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="relative min-h-0 flex-1 overflow-hidden" data-chat-message-region>
        <div
          data-chat-scroll
          ref={scrollRef}
          className="h-full w-full min-w-0 max-w-full space-y-3 overflow-x-hidden overflow-y-auto px-3 py-2"
        >
        {activeMessages.length === 0 && !isStreaming ? (
          <UiTestAiEmpty kind="outline" onGenerateOutline={() => setOutlineWizardOpen(true)} generateDisabled={submitDisabled} generateDisabledReason={submitDisabledReason} />
        ) : null}
        {activeMessages.map((msg, i) => isInternalOutlineMessage(msg) ? null : (
          <div
            key={msg.id}
            className={`flex w-full min-w-0 max-w-full ${msg.role === "user" ? "flex-col items-end" : "flex-wrap justify-start"}`}
            data-ui-ai-message={msg.role}
          >
            <div
              className={`${msg.role === "user" ? "w-fit max-w-full lg:max-w-[50vw]" : "w-full min-w-0 max-w-full"} rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <OutlineAssistantMessage
                  msg={msg}
                  index={i}
                  isStreaming={isStreaming}
                  runStatusText={streamingContent}
                  activeMessagesLength={activeMessages.length}
                  copied={copied}
                  projectPath={project?.path ?? null}
                  onSaveAsOutline={handleSaveAsOutline}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onConfirmToolSave={handleConfirmToolSave}
                  onRejectTool={handleRejectTool}
                  onSendMessage={handleSendMessage}
                  onContinueIntentGeneration={handleContinueIntentGeneration}
                  onSubmitPlanAnswers={handleSubmitOutlinePlanAnswers}
                  onConfirmPlan={handleConfirmOutlinePlan}
                  onCancelPlan={handleCancelOutlinePlan}
                  onSubmitDiscussAnswers={handleSubmitOutlineDiscussAnswers}
                  onConfirmDiscuss={handleConfirmOutlineDiscuss}
                  onResumeMultiAgent={handleResumeMultiAgent}
                  onContinueStopped={isStreaming ? undefined : () => void handleContinueStopped(msg.eventOutlineRequirement)}
                  onContinueFailed={isStreaming ? undefined : () => void handleContinueFailed(msg.eventOutlineRequirement)}
                  resumeMultiAgentDisabled={isStreaming}
                  nextStepDisabled={submitDisabled}
                  generationContext={activeMessages.slice(0, i).some((message) => message.role === "user" && Boolean(message.novelGenerationRequest))
                    || Boolean(msg.nextStepRecommendation?.completedModule && /^#{1,6}\s/m.test(msg.content))}
                  nextStepDisabledReason={isStreaming
                    ? "当前会话正在生成，请等待生成完成后再选择下一步。"
                    : submitDisabledReason}
                  onFocusInput={handleFocusInput}
                  hasEventOutline={Boolean(eventOutlinesByMessageId.get(msg.id))}
                />
              ) : (
                <>
                  {msg.novelGenerationRequest ? (
                    <NovelGenerationRequestMessage request={msg.novelGenerationRequest} />
                  ) : (
                    <span className="block whitespace-pre-wrap break-words">
                      {renderOutlineCommandText(msg.content)}
                    </span>
                  )}
                  {msg.attachedReferences &&
                  msg.attachedReferences.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {msg.attachedReferences.map((token) => (
                        <ReferenceChip key={token.id} token={token} readonly />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {/* 事件细纲卡片挂在助手气泡下方：容器是 flex 行，靠 w-full + flex-wrap 换行占满整行，
                否则会被 w-full 的气泡挤成半宽。 */}
            {msg.role === "assistant" ? (() => {
              const eventOutline = eventOutlinesByMessageId.get(msg.id) ?? null;
              return eventOutline ? (
                <div className="w-full min-w-0">
                  <EventOutlineCard
                    data={eventOutline}
                    /*
                     * 交接逻辑抽在 event-outline-handoff.ts：同一张卡片在写作助手
                     * （chat-message.tsx）里也有一份，两处必须落在同一个输入框上。
                     */
                    onWriteChapter={handoffEventOutlineToProse}
                  />
                </div>
              ) : null;
            })() : null}
            {msg.role === "user" ? <UserMessageMeta content={msg.content} timestamp={msg.timestamp} /> : null}
          </div>
        ))}
        </div>

        {showScrollToBottom && <ScrollToLatestButton isStreaming={isStreaming} onClick={handleScrollToBottom} />}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t px-3 py-2" data-ui-ai-input-area>
        <UiTestAiComposer enabled={false}>
        <div data-ui-ai-composer>
        <ReferenceInput
          enableClipboardMenu
          clipboardScope={activeConversationId}
          renderTextOverlay={undefined}
          value={inputValue}
          tokens={outlineReferenceTokens}
          onStop={handleStop}
          isStreaming={isStreaming}
          submitDisabled={submitDisabled}
          submitDisabledReason={submitDisabledReason}
          placeholder="输入关于大纲的问题..."
          onChange={(text, tokens) => {
            setInputValue(text);
            if (/(?:^|\s)\/$/.test(text)) setGenerationMenuOpen(true);
            outlineReferenceTokensRef.current = tokens;
            setOutlineReferenceTokens(tokens);
          }}
          onTokensChange={(tokens) => {
            outlineReferenceTokensRef.current = tokens;
            setOutlineReferenceTokens(tokens);
          }}
          onSubmit={handleDirectSubmit}
          onAtTrigger={() => setReferencePickerOpen(true)}
          insertTokensRef={insertReferenceTokensRef}
          leftFooterControls={
            <>
              <ContextUsageRing
                usage={liveContextUsage}
                onCreateConversation={() => createConversation()}
              />
              <div className="relative" data-guide="outline.mode">
                <Button
                  ref={workflowModeTriggerRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-haspopup="listbox"
                  aria-expanded={workflowModeDropdownOpen}
                  aria-label="AI 大纲执行模式"
                  className="h-8 shrink-0 border-0 bg-transparent px-1.5 text-xs shadow-none"
                  onClick={() => setWorkflowModeDropdownOpen((open) => !open)}
                >
                  {/*
                    只有文字，**没有下拉箭头**（用户要求：不需要下拉图标；
                    章节区与大纲区必须一致）。它仍是 `aria-haspopup="listbox"`
                    + `aria-expanded` 的按钮，点开列表的行为不变 ——
                    去掉的只是一个视觉提示，不是这个控件的语义。
                  */}
                  <span>
                    {OUTLINE_WORKFLOW_MODE_OPTIONS.find((option) => option.mode === outlineWorkflowMode)?.label ?? "标准"}
                  </span>
                </Button>
                {workflowModeDropdownOpen && workflowModeDropdownStyle
                  ? createPortal(
                    <>
                      <div
                        className="fixed inset-0"
                        style={{ zIndex: 9998 }}
                        onClick={() => setWorkflowModeDropdownOpen(false)}
                      />
                      <div
                        ref={workflowModeDropdownRef}
                        role="listbox"
                        className="fixed rounded-md border bg-popover p-1 shadow-md"
                        style={{ ...workflowModeDropdownStyle, maxHeight: "none", overflow: "visible", zIndex: 9999 }}
                        data-ui-ai-menu="mode"
                      >
                        {OUTLINE_WORKFLOW_MODE_OPTIONS.map(({ mode, label, description, routeDescription }) => (
                          <button
                            key={mode}
                            type="button"
                            role="option"
                            aria-selected={outlineWorkflowMode === mode}
                            className="flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left hover:bg-accent"
                            onClick={() => {
                              setOutlineWorkflowMode(mode);
                              void saveOutlineWorkflowMode(mode);
                              setWorkflowModeDropdownOpen(false);
                            }}
                          >
                            <Check
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                outlineWorkflowMode === mode ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <span>{label}</span>
                                <span className="rounded border px-1.5 py-0.5 text-[0.6875rem] font-normal text-muted-foreground">
                                  {description}
                                </span>
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                {routeDescription}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>,
                    document.body,
                  )
                  : null}
              </div>
              <TooltipProvider delay={200}>
                <OutlineGenerationMenu
                  disabled={submitDisabled}
                  open={generationMenuOpen}
                  onOpenChange={setGenerationMenuOpen}
                  onSelect={(title) => insertOutlineGenerationCommand(title)}
                />
              </TooltipProvider>
            </>
          }
          rightControls={
            hasAvailableModels ? (
              <>
              <UiTestAiModel enabled value={localModelId}>
                <ReasoningDepthControl
                  value={aiOutlineReasoningDepth}
                  onChange={(depth) => {
                    setAiOutlineReasoningDepth(depth);
                    void saveAiOutlineReasoningDepth(depth);
                  }}
                  modelConfig={reasoningDepthTargetConfig}
                />
                <ChatModelSelector
                  value={localModelId}
                  onChange={(value) => {
                    setLocalModelId(value);
                    setAiOutlineModel(value);
                    if (activeConversationId) {
                      setConversationModel(activeConversationId, value);
                    }
                    persistOutlineModel(value);
                  }}
                  disabled={false}
                />
              </UiTestAiModel>
              </>
            ) : (
              <p
                className="max-w-48 truncate text-xs text-destructive"
                title="请先在设置中添加并启用一个模型"
              >
                请先在设置中添加并启用一个模型
              </p>
            )
          }
        />
        </div>
        </UiTestAiComposer>
        <ReferencePickerDialog
          open={referencePickerOpen}
          providers={referenceProviders}
          projectPath={project?.path ? normalizePath(project.path) : ""}
          onConfirm={(tokens) => {
            insertReferenceTokensRef.current?.(tokens);
            setReferencePickerOpen(false);
          }}
          onClose={() => setReferencePickerOpen(false)}
        />
        {/* 丁-4：`@某人灵魂` 的确认步骤。打开时 `handleSend` 正 await 它，
            所以在这里取消就等于中止本次发送（此时一条消息都还没落地）。 */}
        {soulBindingDialog}
        <OutlineWizardDialog
          open={outlineWizardOpen}
          onOpenChange={setOutlineWizardOpen}
          onSubmit={handleSubmitOutlineWizard}
          projectPath={project?.path ? normalizePath(project.path) : undefined}
        />
        <ConversationDeleteConfirmDialog
          open={pendingDeleteConversationId !== null}
          onCancel={() => setPendingDeleteConversationId(null)}
          onConfirm={confirmDeleteRunningConversation}
        />
        <ConversationHistoryClearDialog
          open={pendingClearHistoryIds !== null}
          count={pendingClearHistoryIds?.length ?? 0}
          onCancel={() => setPendingClearHistoryIds(null)}
          onConfirm={confirmClearHistory}
        />
        {saveConfirmState ? (
          <OutlineSaveConfirmDialog
            open
            title={saveConfirmState.title}
            mode={saveConfirmState.mode}
            requests={saveConfirmState.requests}
            characterDrafts={saveConfirmState.characterDrafts}
            onClose={handleCloseSaveConfirm}
            onConfirm={executeConfirmedOutlineSave}
          />
        ) : null}
      </div>

      {/* 需求分析浮层：锚定在面板底部、盖在输入区上层，宽度跟随本面板 */}
      {pendingIntentPrompt ? (
        <OutlineIntentDialog
          open={!dismissedIntentPromptIds[pendingIntentPrompt.id]}
          result={pendingIntentPrompt.result}
          entries={intentOptionEntries}
          onOpenChange={(next) => {
            if (!next) dismissIntentPrompt(pendingIntentPrompt.id);
          }}
          onSelect={(_optionId, scope) => {
            dismissIntentPrompt(pendingIntentPrompt.id);
            if (!scope) {
              handleFocusInput();
              return;
            }
            void handleSendMessage(scope, { intentPhase: "generation", scope });
          }}
        />
      ) : null}
    </div>
  );
}
