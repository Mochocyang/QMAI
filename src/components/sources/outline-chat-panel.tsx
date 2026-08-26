import {
  type CSSProperties,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useDeferredValue,
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
  ArrowDown,
} from "lucide-react";
import { useWikiStore } from "@/stores/wiki-store";
import {
  resolveOutlineWorkflowMode,
  type OutlineWorkflowMode,
} from "@/lib/agent/workflow-mode";
import { OUTPUT_TRUNCATED_ERROR_MARKER } from "@/lib/llm-client";
import { Button } from "@/components/ui/button";
import { saveAiOutlineModel, saveOutlineWorkflowMode } from "@/lib/project-store";
import {
  useOutlineChatStore,
  type OutlineMultiAgentRunState,
  type OutlineChatMessage,
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
import { NovelGenerationRequestMessage } from "@/components/sources/novel-generation-request-message";
import { OutlineMultiAgentPanel } from "@/components/sources/outline-multi-agent-panel";
import {
  OutlineStandardWorkflowPanel,
  shouldUseOutlineStandardWorkflowCard,
} from "@/components/sources/outline-standard-workflow-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-section-configs";
import {
  buildOutlineWizardPrompt,
  getOutlineWizardSkillNames,
  type OutlineWizardRequest,
} from "@/lib/novel/outline-wizard";
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
  formatOutlineSaveParseFeedback,
  mergeOutlineSaveRequests,
  type OutlineSaveRequest,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "@/lib/novel/outline-save-request";
import {
  resolveModelConfig,
  resolveNovelModel,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver";
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
import { ContextUsageRing } from "@/components/chat/context-usage-ring";
import { highlightCode } from "@/lib/streaming-code-highlight";
import { separateThinking } from "@/lib/separate-thinking";
import { StreamingMarkdown } from "@/components/common/streaming-markdown";
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
import type { ReferenceToken } from "@/lib/reference/types";
import { useChatStore } from "@/stores/chat-store";
import { AgentRunner } from "@/lib/agent/runner";
import { isReasoningOnlyResponseError } from "@/lib/reasoning-retry";
import { ToolRegistry } from "@/lib/agent/registry";
import { buildAgentConfig, modelSupportsTools } from "@/lib/agent/config";
import type { AgentMessage, AgentRunRecord } from "@/lib/agent/types";
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
import { IntentOptionsCard } from "@/components/sources/outline-intent-options-card";
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

const OUTLINE_CHAT_DISABLED_TOOLS = ["write_chapter", "write_memory", "write_outline_node"];
const OUTLINE_CHAT_WIZARD_DISABLED_TOOLS = [...OUTLINE_CHAT_DISABLED_TOOLS];

function showOutlineAutoSaveError(message: string) {
  toast.error(message, {
    title: "大纲保存失败",
    persistent: true,
    dedupeKey: `outline-auto-save:${message}`,
  });
}

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
];

export function buildOutlineAgentSystemPrompt(options: {
  projectName?: string;
  webResearchContext?: string;
  soulDoc?: string;
  mode?: OutlineWorkflowMode;
}): string {
  const mode = resolveOutlineWorkflowMode(options.mode);
  const workflowRules = mode === "fast"
    ? [
      "快速模式下像普通对话一样直接出结果。可以按需读取必要上下文，但不要主动进入需求分析、意图分析或多 Agent 编排。",
      "用户要求生成或修改大纲时，直接输出可保存的大纲正文；不要先追问方案或等待确认才开始写。",
    ]
    : [
      "你必须通过可用工具读取项目大纲、章节、记忆、推演结果和历史对话后，再进行分析、回答、生成或修改建议。",
      "不要假设引用内容已经注入上下文；不要跳过工具直接空泛回答。",
      "回答必须基于已读取内容进行分析，说明关键判断依据。",
      "## AI大纲固定分析流程",
      "1. 先调用 list_outlines、list_chapters、list_memories、list_deductions 确认可用资料范围。",
      "2. 再调用 read_outline、read_chapter、read_memory、read_deduction 读取用户 @ 引用和相关项目内容。",
      "3. 分析冲突、缺口、伏笔、角色动机和章节承接，明确哪些判断来自已读取资料。",
      "4. 最后再生成大纲建议；没有完成读取和分析前，不要直接给出结论。",
      "## AI大纲生成工作流",
      "固定向导提交的小说生成需求必须先进入“需求分析/生成方案”阶段：先判断缺失信息，信息足够时只输出生成方案、文件清单、保存位置和生成顺序，并询问用户是否确认开始生成；用户确认前不得生成完整文件，不得调用保存工具。",
      "需求分析必须执行充分性闸门：缺少篇幅、频道、题材、故事灵感、核心卖点、作品规模、主要人物方向、世界观/背景方向或预期章节结构时，只追问最关键缺口。",
      "长篇小说必须先卷后章：先形成核心设定、总纲、卷节拍表、卷时间线和卷纲，再生成章纲；不得从灵感直接跳到全书章纲。",
      "章纲采用滚动章纲方式：优先生成前 10 章或用户指定范围，后续依据已确认章纲继续补齐，避免一次性生成整本导致承接断裂。",
      "生成章纲后必须列出新增设定写回清单，包含新增角色、势力、世界观规则、伏笔、地图地点和状态变化；用户确认前不得写入设定文件。",
      "## 意图清晰度分析阶段",
      "仅当系统明确标记本轮为“意图分析”时，才输出 intent_clarity；正文生成阶段严禁再次输出该标记。",
      "当本轮为意图分析时：",
      "1. 调用 list_outlines、list_chapters、read_outline 读取已有资料",
      "2. 判断用户意图是否清晰（能否确定具体生成范围）",
      "3. 严格输出以下完整协议块：",
      "<!-- intent_clarity -->",
      '{"clarity":"clear|needs_input","module":"模块名","analysis":"判断依据","detectedScope":"明确范围","missingItems":[],"options":[],"question":""}',
      "<!-- /intent_clarity -->",
      "开闭标记必须成对出现；字段名必须使用 clarity，禁止使用 status。JSON 必须完整且可解析。",
      "4. clear 时：只输出 JSON，不生成正文，等待系统自动注入生成指令",
      "5. needs_input 时：只输出 JSON，在 question 和 options 中提供澄清问题与4个推荐选项",
      "推荐选项必须包含：A.全部缺失项 B.基于已有内容推断 C.最近范围 D.自定义",
      "用户选择或回复后，直接进入生成流程，不再二次分析。",
    ];
  return [
    "你是专业小说大纲分析与创作助手。",
    "如果用户提供 @ 引用，必须优先按路径、标题或会话ID调用对应读取工具获取正文内容。",
    "需要保存大纲时只输出 outlineSaveRequest 或 outlineSaveRequests JSON 块，禁止调用 write_outline_node；系统解析后弹出确认，用户确认后才写入文件。",
    ...workflowRules,
    "",
    "## 下一步推荐输出",
    "生成完成后，在回复末尾附加 <!-- next_step --> JSON 标记块。",
    "推荐方向仅限大纲体系内（人物小传、组织势力、力量体系等），严禁推荐正文生成。",
    "必须包含一个 id 为 D 的自定义选项。",
    ...(mode === "fast" ? [] : [
      "当用户要求生成、完善或续写任何大纲分项时，必须按 PRD 3.1 主流程执行：提取请求关键词，识别用户意图，按意图读取资料，提取对小说创作有用的关键内容，结合用户要用的 skill + soul.md 约束生成内容，再做结果强约束收敛。",
    ]),
    "关键内容提取必须服务于小说创作：只保留能帮助用户继续写小说的信息，例如章节目标、冲突推进、人物动机、伏笔状态、设定限制、时间线承接和结尾钩子。",
    "生成章纲时必须使用章纲标准结构：基础信息、上层依据、本章目标、核心事件、场景顺序、结构节点、章首钩子、爽点设计、章尾钩子、执行约束、人物状态、伏笔与追踪、待写回设定、写作约束、AI写作提示。核心事件不少于6条，场景顺序为2-4个场景。",
    "结构节点必须包含 CBN、CPNs、CEN；CEN 必须能承接下一章 CBN。执行约束必须包含必须覆盖节点和本章禁区。基础信息必须包含时间锚点、章内时间跨度和与上章时间差。",
    "Markdown 格式约束：结构化资料使用一级标题，** 必须成对，不要用代码围栏包裹全文，已有表格必须保留合法分隔行。",
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
    "最终回复只输出大纲标题和大纲正文；如果内容需要保存，末尾附加 AI 大纲输出协议 JSON 保存块（含 content）。禁止输出工具调用报告、分析过程、完成报告、下一步行动、无法直接保存的大段说明。",
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

function getOutlineSectionOutputRules(title: string): string {
  if (title.includes("章节细纲")) {
    return "按章节输出：章节标题、章节目标、核心事件、主要冲突、关键转折、结尾钩子、与前后章节承接。";
  }
  if (title.includes("人物")) {
    return "按人物输出：人物定位、目标与动机、欲望和恐惧、关系变化、冲突点、成长或崩坏路径、当前状态。";
  }
  if (title.includes("组织") || title.includes("势力")) {
    return "按组织或势力输出：阵营目标、利益诉求、掌握资源、内部矛盾、外部冲突、剧情作用、与主角线关系。";
  }
  if (title.includes("金手指") || title.includes("能力")) {
    return "按能力体系输出：能力规则、限制、代价、成长路径、反制方式、剧情用途、容易制造的冲突。";
  }
  if (title.includes("伏笔")) {
    return "按伏笔输出：伏笔名称、埋设位置、表层误导、真实指向、推进节点、回收位置、关联人物和风险。";
  }
  if (title.includes("地点")) {
    return "按地点输出：地点定位、所属势力、空间规则、资源与限制、可触发事件、剧情作用、与人物线关系。";
  }
  return "按可保存的大纲正文输出：标题清楚、条目完整、能直接指导后续小说写作。";
}

function buildGenerationPrompt(
  title: string,
  requestHint: string,
  scope?: string,
  outputMode?: "per_chapter" | "per_item" | "single",
  originalRequest?: string,
): string {
  const outputModeInstruction = outputMode === "per_chapter"
    ? "每个章节必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：第N章-章节标题.md。禁止将多个章节写入同一文件。"
    : outputMode === "per_item"
    ? "每个角色/势力/体系必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：名称.md。禁止将多个角色/势力写入同一文件。"
    : "按可保存的大纲正文输出：标题清楚、条目完整、能直接指导后续小说写作。";

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
        messages: conversation.messages.map((message) =>
          message.id === messageId ? updater(message) : message,
        ),
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
  onResumeMultiAgent,
  resumeMultiAgentDisabled,
  nextStepDisabled,
  nextStepDisabledReason,
  generationContext,
  onFocusInput,
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
  onResumeMultiAgent: (messageId: string) => Promise<void>;
  resumeMultiAgentDisabled: boolean;
  nextStepDisabled: boolean;
  nextStepDisabledReason?: string;
  generationContext: boolean;
  onFocusInput: () => void;
}) {
  const [editApplied, setEditApplied] = useState(false);
  const [editResults, setEditResults] = useState<
    import("@/lib/novel/agent-tools").FileEditResult[]
  >([]);
  const [editDismissed, setEditDismissed] = useState(false);

  // 消息内容是唯一内容通道；运行状态提示单独渲染，绝不混入正文
  const displayContent = msg.content;
  const { thinking, answer } = useMemo(
    () => separateThinking(displayContent),
    [displayContent],
  );
  const actionContent = answer || displayContent;
  const messageIsStreaming = isStreaming && index === activeMessagesLength - 1;
  const intentProtocol = useMemo(
    () => parseIntentClarityProtocol(answer || displayContent),
    [answer, displayContent],
  );
  const intentProtocolError = !messageIsStreaming
    ? msg.intentProtocolError ?? (intentProtocol.kind === "invalid"
      ? `意图分析格式无效，尚未开始生成：${intentProtocol.error}`
      : undefined)
    : undefined;
  const canUseAsOutlineContent = intentProtocol.kind === "none" && !intentProtocolError;
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
    if (intentProtocol.kind === "valid") return stripStructuredMarkers(rawContent);
    if (intentProtocol.kind === "invalid" || msg.intentProtocolError) return "";
    return prepareOutlineSaveSourceContent(rawContent);
  }, [answer, intentProtocol, msg.intentProtocolError, parsed.textContent]);
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

  return (
    <>

      <OutlineMultiAgentPanel
        run={msg.multiAgentRun}
        onResume={() => { void onResumeMultiAgent(msg.id) }}
        resumeDisabled={resumeMultiAgentDisabled}
      />
      {msg.multiAgentRun ? null : useStandardWorkflowCard ? (
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
      {messageIsStreaming && !msg.content && runStatusText ? (
        <div className="mb-1 whitespace-pre-wrap text-xs text-muted-foreground">
          {runStatusText}
        </div>
      ) : null}
      {intentProtocolError ? (
        <div role="alert" className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {intentProtocolError}
        </div>
      ) : null}
      <StreamingMarkdown
        content={renderedMarkdownContent}
        isStreaming={messageIsStreaming}
        renderCommitted={(text) => (
          <OutlineMarkdownContent content={text} projectPath={projectPath} />
        )}
      />
      {currentContextHubSnapshot ? (
        <ContextHubDetails
          reference={currentContextHubSnapshot}
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
      {/* Sources */}
      {msg.sources && msg.sources.length > 0 && !isStreaming ? (
        <details className="mt-2 border-t pt-2">
          <summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <FileText className="h-3 w-3" />
            引用资料（{msg.sources.length}）
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {msg.sources.map((src, si) => (
              <li key={si}>• {src}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {/* Action buttons */}
      {actionContent && canUseAsOutlineContent && !isStreaming ? (
        <div className="mt-2 flex gap-2 border-t pt-2">
          <button
            onClick={() => void onSaveAsOutline(actionContent)}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
          >
            <Save className="h-3 w-3" /> 保存为大纲
          </button>
          <button
            onClick={() => onCopy(actionContent, msg.id)}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
          >
            <Copy className="h-3 w-3" /> {copied === msg.id ? "已复制" : "复制"}
          </button>
          <button
            onClick={() => void onRegenerate(index)}
            disabled={isStreaming}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" /> 重新生成
          </button>
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
      {/* 意图不清晰时的推荐选项 */}
      {msg.intentClarityResult?.clarity === "needs_input" && !isStreaming ? (
        <IntentOptionsCard
          result={msg.intentClarityResult}
          onSelectOption={(optionId, label, description) => {
            if (optionId === "D") {
              onFocusInput();
            } else {
              const scope = label + (description ? `：${description}` : "");
              onSendMessage(scope, { intentPhase: "generation", scope });
            }
          }}
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
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: (title: string, requestHint: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
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
          setOpen((value) => !value);
        }}
        disabled={disabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-accent/50 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        title="生成大纲模块"
        aria-label="生成大纲模块"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ListPlus className="h-4 w-4" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="qmai-outline-generation-menu fixed z-50 w-56 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            transform: "translateY(calc(-100% - 8px))",
          }}
          role="menu"
        >
          {OUTLINE_SECTION_GENERATION_CONFIGS.map((config) => (
            <button
              key={config.key}
              type="button"
              onClick={() => {
                setOpen(false);
                onGenerate(config.title, config.requestHint);
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
        </div>
      ) : null}
    </div>
  );
}

export function OutlineChatPanel({ onClose }: { onClose: () => void }) {
  const project = useWikiStore((s) => s.project);
  const llmConfig = useWikiStore((s) => s.llmConfig);
  const novelConfig = useWikiStore((s) => s.novelConfig);
  const providerConfigs = useWikiStore((s) => s.providerConfigs);
  const aiChatModel = useWikiStore((s) => s.aiChatModel);
  const aiOutlineModel = useWikiStore((s) => s.aiOutlineModel);
  const defaultLlmModel = useWikiStore((s) => s.defaultLlmModel);
  const setAiOutlineModel = useWikiStore((s) => s.setAiOutlineModel);
  const outlineWorkflowMode = resolveOutlineWorkflowMode(
    useWikiStore((s) => s.outlineWorkflowMode),
  );
  const setOutlineWorkflowMode = useWikiStore((s) => s.setOutlineWorkflowMode);
  const isOutlineFastMode = outlineWorkflowMode === "fast";
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

  const [inputValue, setInputValue] = useState("");
  const deferredInputValue = useDeferredValue(inputValue);
  const liveContextUsage = useMemo(() => {
    const historyMessages = selectContextHistoryMessages(
      activeMessages.filter((message) => message.role === "user" || message.role === "assistant"),
      activeConv?.contextSummary?.text,
    );
    return composeLiveContextUsage(activeConv?.lastContextUsage, {
      windowTokens: effectiveOutlineContextWindow,
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
  ]);
  const [outlineReferenceTokens, setOutlineReferenceTokens] = useState<
    ReferenceToken[]
  >([]);
  const outlineReferenceTokensRef = useRef<ReferenceToken[]>([]);
  const [forceRefreshNext, setForceRefreshNext] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [outlineWizardOpen, setOutlineWizardOpen] = useState(false);
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
      createSkillProvider(() => {
        const deAiSkills = deAiSkillConfig
          ? resolveAvailableDeAiSkills(deAiSkillConfig).map((skill) => ({
              id: skill.id,
              name: skill.name,
              subtype: "deai" as const,
            }))
          : []
        const writingSkillList = outlineWritingSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          subtype: "writing" as const,
          kind: skill.kind,
          stages: skill.stages,
          modes: skill.modes,
        }))
        return [...deAiSkills, ...writingSkillList]
      }),
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
    [chatConversations, conversations, deAiSkillConfig, outlineWritingSkills],
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
    const panelWidth = 288;
    const gap = 6;
    function updatePosition() {
      const rect = historyButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.min(
        Math.max(gap, rect.right - panelWidth),
        Math.max(gap, viewportWidth - panelWidth - gap),
      );
      const availableBelow = viewportHeight - rect.bottom;
      const availableAbove = rect.top;
      const maxHeight = Math.min(360, Math.max(160, Math.max(availableBelow, availableAbove) - gap));
      const top = availableBelow >= 160 || availableBelow >= availableAbove
        ? rect.bottom + gap
        : Math.max(gap, rect.top - maxHeight - gap);
      setHistoryDropdownStyle({ left, top, width: panelWidth, maxHeight });
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
      setWorkflowModeDropdownStyle({
        left: rect.left,
        top: rect.top - 8,
        width: Math.max(rect.width, 320),
        transform: "translateY(-100%)",
      });
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
      behavior: "smooth",
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
      if (currentScrollTop < lastScrollTopRef.current - 1) {
        userScrolledUpRef.current = true;
      } else if (atBottom) {
        userScrolledUpRef.current = false;
      }
      setShowScrollToBottom(userScrolledUpRef.current && isStreaming);
      lastScrollTopRef.current = currentScrollTop;
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [isStreaming]);

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
          createDirectory,
          fileExists,
          readFile,
          writeFile,
        });
        if (saveResult.saved.length > 0) {
          await refreshProjectState(projectPath);
          const names = saveResult.saved.map((item) => item.fileName).join("、");
          setSaveStatus(`已保存 ${saveResult.saved.length} 个文件：${names}`);
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

  const handleAutoSaveOutlineRequests = useCallback(
    async (conversationId: string, assistantContent: string, canApply: () => boolean) => {
      if (!project || !canApply()) return;
      const parsed = parseOutlineSaveRequests(assistantContent);
      if (parsed.requests.length === 0) {
        if (parsed.errors.length > 0) {
          showOutlineAutoSaveError(formatOutlineSaveParseFeedback(parsed.errors));
          return;
        }
        if (!isSaveableOutlineDeliverable(assistantContent)) return;
        const built = buildClassifiedOutlineSaveRequest({
          content: assistantContent,
          sourceIntent: "生成完成后自动保存",
          sourceHint: collectOutlineSaveSourceHint(conversationId),
        });
        if (!built || !canApply()) return;
        if (built.classification.fileType === "character") {
          const extracted = extractCharacterSaveDrafts(built.draft.content);
          if (extracted.drafts.length === 0) return;
          presentOrQueueSaveBatch({
            title: "请确认要保存的人物角色",
            mode: "character",
            requests: [],
            characterDrafts: extracted.drafts,
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

      if (!canApply()) return;
      try {
        const split = splitConfirmRequiredSaveRequests(parsed.requests);
        const characterRequests = split.confirmRequired.filter(
          (request) => request.fileType === "character",
        );
        const normalRequests = split.confirmRequired.filter(
          (request) => request.fileType !== "character",
        );

        if (characterRequests.length > 0) {
          const characterContent = characterRequests
            .map((request) => request.content)
            .join("\n\n");
          const extracted = extractCharacterSaveDrafts(characterContent);
          const characterDrafts = extracted.drafts.length > 0
            ? extracted.drafts
            : buildFallbackCharacterDraftsFromRequests(characterRequests);
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
    [collectOutlineSaveSourceHint, presentOrQueueSaveBatch, project],
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
        novelGenerationRequest?: NovelGenerationRequestPackage;
        systemGenerated?: boolean;
        userMessageVisibility?: "visible" | "internal";
        userDisplayText?: string;
      } = {},
    ): Promise<OutlineSendResult> => {
      const prompt = inputText.trim();
      if (!prompt || !project) return { started: false, sent: false };
      const requestedConversationId = options.conversationId ?? activeConversationId;
      const requestedRunState = requestedConversationId
        ? useOutlineChatStore.getState().runStates[requestedConversationId]
        : undefined;
      if (requestedRunState?.status === "running") return { started: false, sent: false };
      let convId = requestedConversationId;
      if (!convId) convId = createConversation();
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
      const outlineMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode);
      const enableMultiAgent = Boolean(options.enableMultiAgent) && outlineMode !== "fast";
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
        enableMultiAgent,
      });
      if (forceRefreshNext) {
        setForceRefreshNext(false);
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
      const outlineBudgetStage: OutlineBudgetStage = options.intentPhase === "intent_analysis"
        ? "analysis"
        : "generation";
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
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: outlineMode,
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          webResearchContext: webResearchMarkdown,
          soulDoc,
          mode: outlineMode,
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
          let runText = "";
          let runReasoningContent = "";
          const agentErrorBox: { current: Error | null } = { current: null };
          if (optionsForRun.statusText) {
            if (isCurrentRun()) setStreamingContent(capturedConvId, optionsForRun.statusText);
          }
          const record = await new AgentRunner().run(
            agentConfig,
            registry,
            runMessages,
            {
              onText: (chunk) => {
                runText += chunk;
                if (optionsForRun.streamToUser) {
                  result += chunk;
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
          if (agentError && !isLengthTruncated) throw agentError;
          return {
            text: runText || record.finalText,
            record,
            error: agentError ?? undefined,
            reasoning_content: runReasoningContent,
          };
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
        const rawFinalContent = finalText || result || "AI大纲未返回内容。";
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
        const intentProtocol = rawIntentProtocol.kind !== "none"
          ? rawIntentProtocol
          : parseIntentClarityProtocol(finalContent);
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
          nextStepRecommendation: intentProtocolError ? null : nextStepExtraction.recommendation,
          intentProtocolError,
        }));
        if (!isCurrentRun()) {
          void useOutlineChatStore.getState().saveToDisk();
          return { started: true, sent: false };
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
        if (intentProtocol.kind === "none" && !intentProtocolError && !deliverableTruncated) {
          await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun);
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
                    title:
                      firstUser.content.slice(0, 20) +
                      (firstUser.content.length > 20 ? "..." : ""),
                  }
                : conversation,
            ),
          }));
        }
        void useOutlineChatStore.getState().saveToDisk();
        setCapturedWorkflowStage("idle");
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
            forceRefresh: true,
          });
        }
        return { started: true, sent: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        // streamingContents 只承载状态提示，不再存内容；可保留内容唯一来源
        // 是 bestGeneratedText。无论中断原因如何，已生成的内容都必须落进
        // 消息，绝不静默删除整条回复。
        const partial = bestGeneratedText.trim() ? bestGeneratedText : "";
        const reasoningOnlyFailure =
          err instanceof Error && isReasoningOnlyResponseError(err) && Boolean(accumulatedReasoningContent.trim());
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: partial
            ? aborted
              ? `${partial}\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。`
              : `${partial}\n\n---\n\n⚠️ 生成中断：${errorMsg || "未知错误"}`
            : aborted
              ? message.content || "已停止生成。"
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
        if (isCurrentRun()) setCapturedWorkflowStage("idle");
      }
    },
    [
      project,
      isStreaming,
      llmConfig,
      novelConfig,
      providerConfigs,
      effectiveOutlineModelId,
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
    ],
  );

  const handleGenerateSection = useCallback(
    (title: string, requestHint: string) => {
      const capturedConvId = activeConversationId ?? createConversation();
      const config = OUTLINE_SECTION_GENERATION_CONFIGS.find(c => c.title === title);
      const fastMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode) === "fast";
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
          userDisplayText: `生成${title}`,
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
        forceRefresh: true,
        userDisplayText: `生成${title}`,
      });
    },
    [activeConversationId, createConversation, handleSend, outlineWorkflowStages],
  );

  const handleDirectSubmit = useCallback(
    async (text: string, references: ReferenceToken[] = []) => {
      if (resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode) === "fast") {
        return handleSend(text, references);
      }
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
      if (canTransitionOutlineWorkflow(outlineWorkflowStages[capturedConvId] ?? "idle", "intent_analysis")) {
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "intent_analysis"));
      }
      return handleSend(text, references, {
        conversationId: capturedConvId,
        intentPhase: "intent_analysis",
      });
    },
    [activeConversationId, createConversation, handleSend, outlineWorkflowStages],
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
          forceRefresh: true,
        },
      );
    },
    [activeConversationId, canStartConversationRun, handleSend],
  );

  const handleSendMessage = useCallback(
    async (text: string, options?: { intentPhase?: "intent_analysis" | "generation" | "waiting_user_input"; scope?: string }) => {
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
            forceRefresh: true,
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
          const result = await handleSend(text, references, { conversationId: capturedConvId, intentPhase: options?.intentPhase, clearDraft: false });
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
    [project, activeConversationId, llmConfig, novelConfig, effectiveOutlineModelId, providerConfigs, outlineWritingSkills, startConversationRun, stopConversationRun, clearStreamingContent, setConversationContextSummary],
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
    (request: OutlineWizardRequest) => {
      const fastMode = resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode) === "fast";
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
    [handleSend],
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
        && resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode) !== "fast"
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
          forceRefresh: true,
        });
        return;
      }
      const regenerationIntentPhase = targetAssistantMessage?.intentPhase;
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
        });
        assistantAdded = true;

        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const registry = new ToolRegistry();
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode),
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          mode: resolveOutlineWorkflowMode(useWikiStore.getState().outlineWorkflowMode),
          soulDoc,
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
        let agentError: Error | null = null;
        const record = await new AgentRunner().run(
          agentConfig,
          registry,
          [
            { role: "system", content: systemContent },
            ...historyMessages,
            { role: "user", content: lastUserRequest },
          ],
          {
            onText: (chunk) => {
              result += chunk;
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
            onDone: () => {
              if (!isCurrentRun()) return;
              updateOutlineAssistantMessage(
                capturedConvId,
                assistantId,
                (message) => ({
                  ...message,
                  reasoning_content: accumulatedReasoningContent,
                  agentToolCalls: settleRunningAgentToolCalls(
                    message.agentToolCalls,
                  ),
                  isAgentRunning: false,
                }),
              );
            },
            onError: (error) => {
              agentError = error;
            },
          },
          controller.signal,
        );
        if (agentError) throw agentError;
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
        const rawRegenerationContent = result || record.finalText || "AI大纲未返回内容。";
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
        const regenerationIntentProtocol = rawRegenerationIntentProtocol.kind !== "none"
          ? rawRegenerationIntentProtocol
          : parseIntentClarityProtocol(finalContent);
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
            nextStepRecommendation: regenerationIntentProtocolError ? null : nextStepExtraction.recommendation,
            intentProtocolError: regenerationIntentProtocolError,
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
        if (regenerationIntentProtocol.kind === "none" && !regenerationIntentProtocolError) {
          await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun);
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
        const errorMsg = err instanceof Error ? err.message : String(err);
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        // 内容唯一存在于消息里（onText 直接写入）。这里只负责收尾：
        // 保留已生成内容、补错误/停止占位、结束消息运行态，绝不删除内容。
        if (assistantAdded) {
          updateOutlineAssistantMessage(capturedConvId, assistantId, (message) => ({
            ...message,
            content: message.content.trim()
              ? aborted
                ? `${message.content}\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。`
                : `${message.content}\n\n---\n\n⚠️ 生成中断：${errorMsg || "未知错误"}`
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
        const built = buildClassifiedOutlineSaveRequest({
          content,
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

        if (built.classification.fileType === "character") {
          if (characterResults && characterResults.length > 0) {
            const characterDrafts: CharacterSaveDraft[] = characterResults.map((r) => ({
              id: `${r.plan.roleType}:${r.plan.characterName}`,
              characterName: r.plan.characterName,
              roleType: r.plan.roleType,
              fileName: r.fileName,
              content: r.content,
              selected: true,
              confidence: "high",
            }));
            presentOrQueueSaveBatch({
              title: "请确认要保存的人物角色",
              mode: "character",
              requests: [],
              characterDrafts,
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
            characterDrafts: extracted.drafts,
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

  return (
    <div className="flex h-full flex-col overflow-hidden border-border bg-background">
      {/* Header with conversation tabs */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2">
        <span
          className="inline-flex shrink-0"
          title={!canCreateConversation ? EMPTY_CONVERSATION_CREATE_REASON : undefined}
        >
          <button
            type="button"
            onClick={() => {
              createConversation();
            }}
            className="qmai-new-conversation-button flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent/60 text-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            disabled={!canCreateConversation}
            title={canCreateConversation ? "新建大纲对话" : EMPTY_CONVERSATION_CREATE_REASON}
            aria-label="新建大纲对话"
            aria-describedby={!canCreateConversation
              ? "outline-new-conversation-disabled-reason"
              : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {!canCreateConversation && (
            <span id="outline-new-conversation-disabled-reason" className="sr-only">
              {EMPTY_CONVERSATION_CREATE_REASON}
            </span>
          )}
        </span>
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
                      <span className="text-[10px] opacity-70">{conv.messages.length}</span>
                      <span className="text-[10px] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
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
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {outlineWorkflowStage === "intent_analysis" ? "意图分析中" :
                   outlineWorkflowStage === "waiting_user_input" ? "等待选择" :
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
            <span>会话历史</span>
            {historyCount > 0 ? (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">
                {historyCount}
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
                >
                  {historyCount > 0 ? (
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-2 py-1.5">
                      <span className="text-xs text-muted-foreground">共 {historyCount} 条</span>
                      <button
                        type="button"
                        aria-label="一键清理会话历史"
                        onClick={requestClearHistory}
                        className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        一键清理
                      </button>
                    </div>
                  ) : null}
                  {historyCount === 0 ? (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                      暂无历史大纲对话
                    </div>
                  ) : (
                    historyConversations.map((conv) => (
                      <div
                        key={conv.id}
                        className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <button type="button" onClick={() => setActiveConversation(conv.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={conv.title}>
                          <ConversationRunStatusIcon state={runStates[conv.id]} />
                          <span className="min-w-0 flex-1 truncate font-medium">{getConversationTabTitle(conv.title, 16)}</span>
                          <span className="shrink-0 text-[10px] opacity-70">{conv.messages.length}</span>
                          <span className="shrink-0 text-[10px] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
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
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full w-full min-w-0 max-w-full space-y-3 overflow-x-hidden overflow-y-auto px-3 py-2"
        >
        {activeMessages.length === 0 && !isStreaming ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            输入关于大纲的问题或指令，AI
            会基于当前大纲和章节内容进行回答和创作。
          </p>
        ) : null}
        {activeMessages.map((msg, i) => isInternalOutlineMessage(msg) ? null : (
          <div
            key={msg.id}
            className={`flex w-full min-w-0 max-w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
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
                  onResumeMultiAgent={handleResumeMultiAgent}
                  resumeMultiAgentDisabled={isStreaming}
                  nextStepDisabled={submitDisabled}
                  generationContext={activeMessages.slice(0, i).some((message) => message.role === "user" && Boolean(message.novelGenerationRequest))
                    || Boolean(msg.nextStepRecommendation?.completedModule && /^#{1,6}\s/m.test(msg.content))}
                  nextStepDisabledReason={isStreaming
                    ? "当前会话正在生成，请等待生成完成后再选择下一步。"
                    : submitDisabledReason}
                  onFocusInput={handleFocusInput}
                />
              ) : (
                <>
                  {msg.novelGenerationRequest ? (
                    <NovelGenerationRequestMessage request={msg.novelGenerationRequest} />
                  ) : (
                    <span className="block whitespace-pre-wrap break-words">
                      {msg.content}
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
          </div>
        ))}
        </div>

        {showScrollToBottom && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="absolute bottom-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 shadow-md backdrop-blur-sm transition-all hover:bg-accent"
            title="回到最新"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {isOutlineFastMode
              ? "通过固定选项收集需求后，直接生成大纲正文"
              : "通过固定选项生成大纲需求，再交给 AI 分析和追问"}
          </p>
          <button
            type="button"
            onClick={() => setOutlineWizardOpen(true)}
            disabled={submitDisabled}
            className="shrink-0 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            选择生成你想要的小说
          </button>
        </div>
        <ReferenceInput
          value={inputValue}
          tokens={outlineReferenceTokens}
          onStop={handleStop}
          isStreaming={isStreaming}
          submitDisabled={submitDisabled}
          submitDisabledReason={submitDisabledReason}
          placeholder="输入关于大纲的问题..."
          onChange={(text, tokens) => {
            setInputValue(text);
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
              <div className="relative">
                <Button
                  ref={workflowModeTriggerRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-haspopup="listbox"
                  aria-expanded={workflowModeDropdownOpen}
                  aria-label="AI 大纲执行模式"
                  className="h-8 shrink-0 rounded-full border px-2.5 text-xs"
                  onClick={() => setWorkflowModeDropdownOpen((open) => !open)}
                >
                  <span className="mr-1">
                    {OUTLINE_WORKFLOW_MODE_OPTIONS.find((option) => option.mode === outlineWorkflowMode)?.label ?? "标准"}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 opacity-50 transition-transform ${workflowModeDropdownOpen ? "rotate-180" : ""}`} />
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
                        style={{
                          left: workflowModeDropdownStyle.left,
                          top: workflowModeDropdownStyle.top,
                          width: workflowModeDropdownStyle.width,
                          transform: workflowModeDropdownStyle.transform,
                          zIndex: 9999,
                        }}
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
                                <span className="rounded border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
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
                  onGenerate={handleGenerateSection}
                />
              </TooltipProvider>
            </>
          }
          rightControls={
            hasAvailableModels ? (
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
        <OutlineWizardDialog
          open={outlineWizardOpen}
          onOpenChange={setOutlineWizardOpen}
          onSubmit={handleSubmitOutlineWizard}
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
    </div>
  );
}
