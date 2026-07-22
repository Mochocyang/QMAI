import {
  type CSSProperties,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
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
import { saveAiOutlineModel } from "@/lib/project-store";
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
import { OutlineWizardDialog } from "@/components/sources/outline-wizard-dialog";
import { NovelGenerationRequestMessage } from "@/components/sources/novel-generation-request-message";
import { OutlineMultiAgentPanel } from "@/components/sources/outline-multi-agent-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-section-configs";
import {
  buildOutlineWizardPrompt,
  getOutlineWizardSkillNames,
  type OutlineWizardRequest,
} from "@/lib/novel/outline-wizard";
import {
  createNovelGenerationRequestPackage,
  mapOutlineMessagesForModel,
  buildOutlineRegenerationInput,
  isExplicitStructuredGenerationFollowUp,
  mapOutlineConversationsForModel,
  type NovelGenerationRequestPackage,
} from "@/lib/novel/novel-generation-request-package";
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
import { normalizeOutlineMarkdown, prepareOutlineSaveDraft } from "@/lib/outline-save";
import {
  type CharacterSaveDraft,
  extractCharacterSaveDrafts,
} from "@/lib/novel/character-save-extractor";
import { classifyOutlineSaveTarget } from "@/lib/novel/outline-save-classifier";
import {
  buildOutlineGenerationQualityFeedback,
  formatChapterOutlineQualityReport,
  isLikelyChapterOutline,
  type OutlineGenerationQualityFeedback,
  summarizeChapterOutlineQuality,
} from "@/lib/novel/outline-quality-check";
import {
  characterDraftsToSaveRequests,
  extractBodyContent,
  formatOutlineSaveParseFeedback,
  type OutlineSaveRequest,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "@/lib/novel/outline-save-request";
import { stripOutlineFrontmatter } from "@/lib/novel/outline-markdown";
import { AiChangeReview, type AiChangeReviewItem } from "@/components/common/ai-change-review";
import {
  resolveModelConfig,
  resolveNovelModel,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver";
import { getEffectiveSavedModels } from "@/lib/llm-model-keys";
import { ChatModelSelector } from "@/components/chat/chat-model-selector";
import { useStreamingText } from "@/hooks/use-streaming-text";
import { highlightCode } from "@/lib/streaming-code-highlight";
import { separateThinking } from "@/lib/separate-thinking";
import { StreamingMarkdown } from "@/components/common/streaming-markdown";
import { ContextHubDetails } from "@/components/common/context-hub-details";
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
  getContextHub,
  persistContextHubProviderUsage,
  type ContextHubResult,
  type ContextHubSnapshotRef,
} from "@/lib/context-hub";
import { addLlmUsage, type LlmUsage } from "@/lib/llm-usage";
import { enqueueUserMemoryLearning } from "@/lib/user-memory/learning-service";
import { recordLatestUserMemoryFeedback } from "@/lib/user-memory/feedback-service";
import {
  getConversationTabTitle,
  splitConversationToolbarItems,
} from "@/lib/workspace-layout";
import { createWriteOutlineNodeTool } from "@/lib/agent/tools/write-outline-node";
import {
  buildIntentAnalysisPrompt,
  parseIntentClarity,
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

const OUTLINE_CHAT_DISABLED_TOOLS = ["write_chapter", "write_memory"];
const OUTLINE_CHAT_WIZARD_DISABLED_TOOLS = [
  ...OUTLINE_CHAT_DISABLED_TOOLS,
  "write_outline_node",
];

function showOutlineAutoSaveError(message: string) {
  toast.error(message, {
    title: "自动保存失败",
    persistent: true,
    dedupeKey: `outline-auto-save:${message}`,
  });
}

function mergeDisabledTools(...groups: Array<readonly string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
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

export function buildOutlineAgentSystemPrompt(options: {
  projectName?: string;
  webResearchContext?: string;
  soulDoc?: string;
}): string {
  return [
    "你是专业小说大纲分析与创作助手。",
    "你必须通过可用工具读取项目大纲、章节、记忆、推演结果和历史对话后，再进行分析、回答、生成或修改建议。",
    "如果用户提供 @ 引用，必须优先按路径、标题或会话ID调用对应读取工具获取正文内容。",
    "不要假设引用内容已经注入上下文；不要跳过工具直接空泛回答。",
    "回答必须基于已读取内容进行分析，说明关键判断依据；需要保存大纲时只能使用 write_outline_node；生成可保存内容时必须同时输出 outlineSaveRequest 或 outlineSaveRequests JSON 块供系统自动归档。",
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
    "当用户请求生成大纲分项时，必须先进行意图清晰度分析：",
    "1. 调用 list_outlines、list_chapters、read_outline 读取已有资料",
    "2. 判断用户意图是否清晰（能否确定具体生成范围）",
    "3. 输出 <!-- intent_clarity --> JSON 标记块",
    "4. clear 时：只输出 JSON，不生成正文，等待系统自动注入生成指令",
    "5. needs_input 时：输出 JSON 后用自然语言提出澄清问题 + 4个推荐选项",
    "推荐选项必须包含：A.全部缺失项 B.基于已有内容推断 C.最近范围 D.自定义",
    "用户选择或回复后，直接进入生成流程，不再二次分析。",
    "",
    "## 下一步推荐输出",
    "生成完成后，在回复末尾附加 <!-- next_step --> JSON 标记块。",
    "推荐方向仅限大纲体系内（人物小传、组织势力、力量体系等），严禁推荐正文生成。",
    "必须包含一个 id 为 D 的自定义选项。",
    "当用户要求生成、完善或续写任何大纲分项时，必须按 PRD 3.1 主流程执行：提取请求关键词，识别用户意图，按意图读取资料，提取对小说创作有用的关键内容，结合用户要用的 skill + soul.md 约束生成内容，再做结果强约束收敛。",
    "关键内容提取必须服务于小说创作：只保留能帮助用户继续写小说的信息，例如章节目标、冲突推进、人物动机、伏笔状态、设定限制、时间线承接和结尾钩子。",
    "生成章纲时必须使用章纲标准结构：基础信息、上层依据、本章目标、核心事件、场景顺序、结构节点、章首钩子、爽点设计、章尾钩子、执行约束、人物状态、伏笔与追踪、待写回设定、写作约束、AI写作提示。核心事件不少于6条，场景顺序为2-4个场景。",
    "结构节点必须包含 CBN、CPNs、CEN；CEN 必须能承接下一章 CBN。执行约束必须包含必须覆盖节点和本章禁区。基础信息必须包含时间锚点、章内时间跨度和与上章时间差。",
    "Markdown 格式约束：结构化资料使用一级标题，** 必须成对，不要用代码围栏包裹全文，已有表格必须保留合法分隔行。",
    "## AI 大纲输出协议",
    "当本轮生成了可保存的大纲、卷纲、章纲、人物、设定、伏笔、组织或质量检查内容时，最终回复末尾必须附加一个 json 代码块，顶层字段为 outlineSaveRequest 或 outlineSaveRequests。",
    "保存请求必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent。fileName 必须是 .md 文件，targetFolder 必须是相对路径（仅文件夹名，如「大纲」「人物小传」「章纲」「设定」「伏笔」「组织」「质量检查」「卷纲」），禁止使用绝对路径（如 C:\\... 或 /Users/...）。",
    "fileType 只能使用以下英文枚举值（禁止使用中文）：outline（大纲）、volume-outline（卷纲）、chapter-outline（章纲）、character（人物小传）、setting（设定）、foreshadowing（伏笔）、organization（组织）、quality-report（质量检查）。",
    "writeMode 只能使用以下英文枚举值（禁止使用其他值）：create（新建文件）、append（追加到已有文件末尾）、replace（替换已有文件全部内容，需用户确认）、patch（局部修改，需用户确认）。禁止使用 overwrite、write、save 等其他值。",
    "content 字段说明：content 字段已废弃，不要在 JSON 中填写 content。系统会自动从你的回复正文中提取大纲内容作为保存内容，正文格式就是最终保存的文件格式。",
    "文件名规范：不同类型内容必须使用不同文件名，禁止多项内容写入同一文件。不同角色必须每人一个独立文件（如 角色-主角林风.md、角色-反官方傲.md），严禁将所有角色塞入「角色卡.md」或同一文件。不同势力、不同伏笔、不同卷纲、不同章纲也必须各自独立文件。",
    "内容完整性强制要求：所有在对话正文中展示给用户的大纲内容，系统会自动提取并保存。你必须为每个生成的大纲模块都创建对应的保存请求（outlineSaveRequest），不能遗漏。如果生成了多个模块，使用 outlineSaveRequests 数组，每个模块一个请求对象。",
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
    "最终回复只输出大纲标题和大纲正文；如果内容需要自动保存，末尾附加 AI 大纲输出协议 JSON 保存块。禁止输出工具调用报告、分析过程、完成报告、下一步行动、无法直接保存的大段说明。",
    "工具调用过程只应展示在工具调用 UI 中，不要混入最终正文。资料不足以生成完整正文时，先提出最少必要澄清问题，不要用流程说明冒充生成结果。",
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

export function buildOutlineSectionGenerationPrompt(
  title: string,
  requestHint: string,
): string {
  return [
    `请按「AI大纲生成工作流」生成「${title}」。`,
    "",
    "## 本次意图",
    "generate_outline",
    "",
    "## PRD 3.1 主流程要求",
    "1. 提取请求关键词：确认用户要生成的大纲分项、范围和已有约束。",
    "2. 识别用户意图：本次是生成/完善大纲正文，不是审稿报告、工具报告或分析说明。",
    "3. 读取资料：优先读取用户 @ 引用、已有大纲、章节、记忆、推演和历史会话。",
    "4. 提取对小说创作有用的关键内容：章节目标、冲突、伏笔、人物动机、设定限制、时间线承接和结尾钩子。",
    "5. 结合用户要用的 skill + soul.md 约束，生成可直接保存的大纲正文。",
    "6. 结果强约束收敛：最终回复只输出大纲标题和大纲正文。",
    "",
    "## 禁止输出",
    "禁止输出工具调用报告、分析过程、完成报告、下一步行动、等待工具结果、已读取资料清单、泛泛建议。",
    "",
    "## 本分项内容要求",
    requestHint,
    getOutlineSectionOutputRules(title),
    "",
    "如果资料不足以完整生成，请只问一个最关键的澄清问题；如果资料足够，直接输出完整正文。",
  ].join("\n");
}

function buildGenerationPrompt(
  title: string,
  requestHint: string,
  scope?: string,
  outputMode?: "per_chapter" | "per_item" | "single",
): string {
  const outputModeInstruction = outputMode === "per_chapter"
    ? "每个章节必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：第N章-章节标题.md。禁止将多个章节写入同一文件。"
    : outputMode === "per_item"
    ? "每个角色/势力/体系必须输出独立的 outlineSaveRequest，每个对应一个独立 .md 文件，文件名格式：名称.md。禁止将多个角色/势力写入同一文件。"
    : "按可保存的大纲正文输出：标题清楚、条目完整、能直接指导后续小说写作。";

  return [
    `请按「AI大纲生成工作流」生成「${title}」。`,
    scope ? `\n## 已确认范围\n${scope}\n` : "",
    "## PRD 3.1 主流程要求",
    "1. 提取请求关键词。2. 识别用户意图。3. 读取资料。4. 提取关键内容。",
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

function removeOutlineMessage(conversationId: string, messageId: string): void {
  useOutlineChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.filter((message) => message.id !== messageId),
          }
        : conversation,
    ),
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

export async function getUniqueOutlinePath(
  outlinesDir: string,
  fileName: string,
): Promise<string> {
  const normalizedFileName = fileName.toLowerCase().endsWith(".md")
    ? fileName
    : `${fileName}.md`;
  const firstPath = `${outlinesDir}/${normalizedFileName}`;
  if (!(await fileExists(firstPath))) return firstPath;
  const extensionIndex = normalizedFileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? normalizedFileName.slice(0, extensionIndex) : normalizedFileName;
  const extension = extensionIndex > 0 ? normalizedFileName.slice(extensionIndex) : "";
  for (let i = 2; i <= 99; i++) {
    const candidate = `${outlinesDir}/${stem}-${i}${extension}`;
    if (!(await fileExists(candidate))) return candidate;
  }
  return `${outlinesDir}/${stem}-${Date.now()}${extension}`;
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
  streamingContent,
  activeMessagesLength,
  copied,
  projectPath,
  onSaveAsOutline,
  onCopy,
  onRegenerate,
  onConfirmToolSave,
  onRejectTool,
  onSendMessage,
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
  streamingContent: string;
  activeMessagesLength: number;
  copied: string | null;
  projectPath: string | null;
  onSaveAsOutline: (content: string) => Promise<void>;
  onCopy: (content: string, id: string) => void;
  onRegenerate: (index: number) => Promise<void>;
  onConfirmToolSave: (call: ToolCallRecord & { preview?: string }) => void;
  onRejectTool: (call: ToolCallRecord & { preview?: string }) => void;
  onSendMessage: (text: string, options?: { intentPhase?: "intent_analysis" | "generation" | "waiting_user_input"; scope?: string }) => Promise<boolean>;
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

  const displayContent =
    msg.content ||
    (isStreaming && index === activeMessagesLength - 1 ? streamingContent : "");
  const { thinking, answer } = useMemo(
    () => separateThinking(displayContent),
    [displayContent],
  );
  const actionContent = answer || displayContent;
  const messageIsStreaming = isStreaming && index === activeMessagesLength - 1;

  // Parse for file edits
  const [parsed, setParsed] = useState<{
    textContent: string;
    edits: import("@/lib/novel/agent-parser").FileEditAction[];
    hasEdits: boolean;
  }>({ textContent: "", edits: [], hasEdits: false });
  const renderedMarkdownContent = useMemo(() => {
    const rawContent = parsed.textContent || answer;
    const stripped = stripStructuredMarkers(rawContent);
    const bodyContent = extractBodyContent(stripped);
    return normalizeOutlineMarkdown(bodyContent || stripped);
  }, [answer, parsed.textContent]);
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

  return (
    <>

      <OutlineMultiAgentPanel
        run={msg.multiAgentRun}
        onResume={() => { void onResumeMultiAgent(msg.id) }}
        resumeDisabled={resumeMultiAgentDisabled}
      />
      <AgentToolCallMessage
        toolCalls={msg.agentToolCalls}
        thinkingContent={thinking || undefined}
        thinkingStreaming={messageIsStreaming}
        onConfirmSave={onConfirmToolSave}
        onReject={onRejectTool}
      />
      <StreamingMarkdown
        content={renderedMarkdownContent}
        isStreaming={isStreaming && index === activeMessagesLength - 1}
        renderCommitted={(text) => (
          <OutlineMarkdownContent content={text} projectPath={projectPath} />
        )}
      />
      {msg.contextHubSnapshot ? (
        <ContextHubDetails
          reference={msg.contextHubSnapshot}
          projectPath={projectPath}
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
      {actionContent && !isStreaming ? (
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
  const batchedStreamingContent = useStreamingText(streamingContent, isStreaming);
  const loaded = useOutlineChatStore((s) => s.loaded);
  const createConversation = useOutlineChatStore((s) => s.createConversation);
  const setActiveConversation = useOutlineChatStore(
    (s) => s.setActiveConversation,
  );
  const addMessage = useOutlineChatStore((s) => s.addMessage);
  const replaceLastAssistant = useOutlineChatStore(
    (s) => s.replaceLastAssistant,
  );
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

  const hasAvailableModels = useMemo(() => {
    for (const key of Object.keys(providerConfigs)) {
      const config = providerConfigs[key];
      if (key.startsWith("custom-")) {
        if (config.enabled === false) continue;
      } else {
        // 内置预设：已启用，或有有效配置（apiKey + model/savedModels）
        const hasConfig = config.enabled === true
          || Boolean((config.apiKey || config.savedModels?.length) && (config.model || config.savedModels?.length));
        if (!hasConfig) continue;
      }
      if (getEffectiveSavedModels(config).length > 0) {
        return true;
      }
    }
    return false;
  }, [providerConfigs]);

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

  const [inputValue, setInputValue] = useState("");
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

  const setSaveStatus = useCallback((message: string) => {
    if (!/(失败|错误|不支持|无法)/.test(message)) return;
    toast.error(message, {
      title: "大纲操作失败",
      persistent: true,
      dedupeKey: `outline-operation:${message}`,
    });
  }, []);
  const [qualityFeedbackStates, setQualityFeedbackStates] =
    useState<Record<string, OutlineGenerationQualityFeedback>>({});
  type QualityConfirmState = {
    feedback: OutlineGenerationQualityFeedback;
    requests: OutlineSaveRequest[];
  };
  const [qualityConfirmStates, setQualityConfirmStates] = useState<Record<string, QualityConfirmState>>({});
  const qualityFeedbackState = activeConversationId ? qualityFeedbackStates[activeConversationId] ?? null : null;
  const qualityConfirmState = activeConversationId ? qualityConfirmStates[activeConversationId] ?? null : null;
  const [saveConfirmState, setSaveConfirmState] = useState<{
    title: string;
    mode: "normal" | "character";
    requests: OutlineSaveRequest[];
    characterDrafts: CharacterSaveDraft[];
    reviewItems?: AiChangeReviewItem[];
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const pendingRepairMetaRef = useRef<Record<string, OutlineSaveRequest[]>>({});

  // Auto-scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || userScrolledUpRef.current) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    lastScrollTopRef.current = container.scrollTop;
  }, [activeMessages, batchedStreamingContent]);

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
    async (reviewItems: AiChangeReviewItem[]) => {
      if (!project) return;
      const projectPath = normalizePath(project.path);
      const st = saveConfirmState
      const confirmRequests = st && st.characterDrafts.length > 0
        ? characterDraftsToSaveRequests(st.characterDrafts, "保存人物小传")
        : (st?.requests ?? [])
          .filter((r) => reviewItems.some((ri) => ri.id === `${r.targetFolder}/${r.fileName}`))
          .map((r) => {
            const matched = reviewItems.find((ri) => ri.id === `${r.targetFolder}/${r.fileName}`)
            return matched ? { ...r, content: matched.modifiedContent } : r
          });
      if (confirmRequests.length === 0) {
        setSaveStatus("没有选择需要保存的内容。");
        return;
      }

      setSaveStatus("正在保存大纲文件...");
      try {
        const saveResult = await saveOutlineSaveRequests({
          outlineRoot: `${projectPath}/wiki/outlines`,
          confirmed: true,
          requests: confirmRequests,
          createDirectory,
          fileExists,
          readFile,
          writeFile,
        });
        if (saveResult.saved.length > 0) {
          await refreshProjectState(projectPath);
          const names = saveResult.saved.map((item) => item.fileName).join("、");
          setSaveStatus(`已保存 ${saveResult.saved.length} 个文件：${names}`);
          setSaveConfirmState(null);
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
    [project, saveConfirmState],
  );

  const handleAutoSaveOutlineRequests = useCallback(
    async (conversationId: string, assistantContent: string, canApply: () => boolean) => {
      if (!project || !canApply()) return;
      const parsed = parseOutlineSaveRequests(assistantContent);
      if (parsed.requests.length === 0) {
        const repairMeta = pendingRepairMetaRef.current[conversationId];
        if (repairMeta && repairMeta.length > 0) {
          const body = assistantContent
            .replace(/```(?:json)?\s*[\s\S]*?```/gi, "")
            .replace(/```[\s\S]*?```/g, "")
            .trim();
          if (body && isLikelyChapterOutline(body, repairMeta[0].fileName)) {
            const fallbackRequests: OutlineSaveRequest[] = repairMeta.map((meta) => ({
              ...meta,
              content: body,
            }));
            delete pendingRepairMetaRef.current[conversationId];
            setSaveStatus("正在自动保存修订后的大纲...");
            try {
              const projectPath = normalizePath(project.path);
              if (!canApply()) return;
              const saveResult = await saveOutlineSaveRequests({
                outlineRoot: `${projectPath}/wiki/outlines`,
                requests: fallbackRequests,
                createDirectory,
                fileExists,
                readFile,
                writeFile,
              });
              if (!canApply()) return;
              if (saveResult.saved.length > 0) {
                await refreshProjectState(projectPath);
                const names = saveResult.saved.map((item) => item.fileName).join("、");
                setSaveStatus(`已保存修订后的大纲文件：${names}`);
              } else if (saveResult.errors.length > 0) {
                showOutlineAutoSaveError(saveResult.errors.slice(0, 2).join("；"));
              }
            } catch (error) {
              if (!canApply()) return;
              showOutlineAutoSaveError(error instanceof Error ? error.message : String(error));
            }
            return;
          }
        }
        if (parsed.errors.length > 0) {
          showOutlineAutoSaveError(formatOutlineSaveParseFeedback(parsed.errors));
        }
        return;
      }
      delete pendingRepairMetaRef.current[conversationId];

      const qualityFeedback = parsed.requests
        .map((request) =>
          buildOutlineGenerationQualityFeedback({
            fileType: request.fileType,
            fileName: request.fileName,
            content: request.content,
          }),
        )
        .find((feedback): feedback is OutlineGenerationQualityFeedback =>
          Boolean(feedback && feedback.status !== "pass"),
        );

      if (qualityFeedback) {
        setQualityFeedbackStates((states) => setOutlineSessionValue(states, conversationId, qualityFeedback));
        const split = splitConfirmRequiredSaveRequests(parsed.requests);
        setQualityConfirmStates((states) => setOutlineSessionValue(states, conversationId, {
          feedback: qualityFeedback,
          requests: split.autoSaveable,
        }));
        setSaveStatus("");
        return;
      }

      setSaveStatus("正在自动保存大纲...");
      try {
        const projectPath = normalizePath(project.path);
        const split = splitConfirmRequiredSaveRequests(parsed.requests);
        if (split.confirmRequired.length > 0) {
          const characterContent = split.confirmRequired
            .map((request) => request.content)
            .join("\n\n");
          const extracted = extractCharacterSaveDrafts(characterContent);
          if (extracted.drafts.length > 0) {
            setSaveConfirmState({
              title: "请确认要保存的人物角色",
              mode: "character",
              requests: [],
              characterDrafts: extracted.drafts,
              reviewItems: extracted.drafts.filter((d) => d.selected).map((d) => ({
                id: `人物小传/${d.fileName}`,
                fileName: d.fileName,
                originalContent: "",
                modifiedContent: d.content,
                selected: true,
              })),
            });
            setSaveStatus("检测到人物小传，请确认要保存的人物角色。");
          } else {
            const fallbackDrafts = buildFallbackCharacterDraftsFromRequests(
              split.confirmRequired,
            );
            setSaveConfirmState({
              title: "请确认要保存的人物角色",
              mode: "character",
              requests: [],
              characterDrafts: fallbackDrafts,
              reviewItems: fallbackDrafts.filter((d) => d.selected).map((d) => ({
                id: `人物小传/${d.fileName}`,
                fileName: d.fileName,
                originalContent: "",
                modifiedContent: d.content,
                selected: true,
              })),
            });
            setSaveStatus(
              `无法自动拆分角色，请在保存前检查文件名和内容。${extracted.errors.join("；")}`,
            );
          }
        }
        if (split.autoSaveable.length === 0) return;

        if (!canApply()) return;
        const saveResult = await saveOutlineSaveRequests({
          outlineRoot: `${projectPath}/wiki/outlines`,
          requests: split.autoSaveable,
          createDirectory,
          fileExists,
          readFile,
          writeFile,
        });
        if (!canApply()) return;
        if (saveResult.saved.length > 0) {
          await refreshProjectState(projectPath);
          const names = saveResult.saved.map((item) => item.fileName).join("、");
          const skipped = saveResult.skipped.length > 0
            ? `；${saveResult.skipped.slice(0, 2).join("；")}`
            : "";
          setSaveStatus(`已自动保存 ${saveResult.saved.length} 个大纲文件：${names}${skipped}`);
          return;
        }
        if (saveResult.skipped.length > 0) {
          setSaveStatus(saveResult.skipped.slice(0, 2).join("；"));
          return;
        }
        if (saveResult.errors.length > 0 || parsed.errors.length > 0) {
          showOutlineAutoSaveError([...saveResult.errors, ...parsed.errors].slice(0, 2).join("；"));
        }
      } catch (error) {
        if (!canApply()) return;
        showOutlineAutoSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [project],
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
      const forceRefresh = options.forceRefresh === true || forceRefreshNext;
      const contextDecision = planOutlineContextReuse({
        hasPriorAssistantAnswer,
        attachedReferenceCount: tokens.length,
        inputText: prompt,
        enableMultiAgent: options.enableMultiAgent,
        forceRefresh,
        systemGenerated: options.systemGenerated,
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
      });
      if (forceRefreshNext) {
        setForceRefreshNext(false);
      }
      const userMsg: OutlineChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: options.novelGenerationRequest?.summary ?? prompt,
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
      setStreamingContent(capturedConvId, "");
      userScrolledUpRef.current = false;
      let hiddenToolCalls: AgentRunRecord["toolCalls"] = [];
      let followUpGenerationPrompt: string | null = null;
      let contextHubResult: ContextHubResult | null = null;
      let providerUsage: LlmUsage | undefined;

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
          tokenBudget: novelConfig.contextTokenBudget,
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
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          webResearchContext: webResearchMarkdown,
          soulDoc,
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
        const primarySystemContent = buildOutlineRunSystemContent();
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
        ) => {
          const registry = new ToolRegistry();
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
              ),
              ...(contextHubResult
                ? { readTextFile: contextHubResult.readFile }
                : {}),
            },
          );
          return {
            agentConfig: {
              ...agentConfig,
              requestOverrides: {
                ...agentConfig.requestOverrides,
                userMemorySurface: "ai-outline" as const,
                userMemoryProjectKey: normalizePath(project.path),
                userMemorySessionKey: capturedConvId,
              },
            },
            registry,
          };
        };

        const runOutlineAgentOnce = async (
          messages: AgentMessage[],
          optionsForRun: {
            skillNames?: string[];
            disableWriteTools?: boolean;
            streamToUser?: boolean;
            statusText?: string;
          } = {},
        ): Promise<{ text: string; record: AgentRunRecord }> => {
          const { agentConfig, registry } = buildConfigForSkillNames(
            optionsForRun.skillNames,
            optionsForRun.disableWriteTools,
          );
          let runText = "";
          let agentError: Error | null = null;
          if (optionsForRun.statusText) {
            if (isCurrentRun()) setStreamingContent(capturedConvId, optionsForRun.statusText);
          }
          const record = await new AgentRunner().run(
            agentConfig,
            registry,
            messages,
            {
              onText: (chunk) => {
                runText += chunk;
                if (optionsForRun.streamToUser) {
                  result += chunk;
                  if (isCurrentRun()) setStreamingContent(capturedConvId, result);
                }
              },
              onToolCall: () => {},
              onToolResult: () => {},
              onToolError: () => {},
              onToolEvent: (event) => {
                if (!isCurrentRun()) return { started: true, sent: false };
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
              onError: (error) => {
                agentError = error;
              },
            },
            controller.signal,
          );
          providerUsage = addLlmUsage(providerUsage, record.usage);
          allToolCalls.push(...record.toolCalls);
          if (agentError) throw agentError;
          return { text: runText || record.finalText, record };
        };

        const runSingleAgentFallback = async () => {
          result = "";
          const singleRun = await runOutlineAgentOnce(agentMessages, {
            skillNames: options.preferredSkillNames,
            disableWriteTools: options.disableWriteTools,
            streamToUser: true,
          });
          return singleRun.text || "AI大纲未返回内容。";
        };

        let finalText = "";
        let capturedSuccessfulResults: OutlineSubAgentResult[] = [];
        if (options.enableMultiAgent) {
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
              let subRun: { text: string; record: AgentRunRecord };
              try {
                subRun = await runOutlineAgentOnce(subAgentMessages, {
                  skillNames: subAgentPlan.skillNames,
                  disableWriteTools: true,
                  statusText: `多 Agent 并行生成中...\n正在运行：${subAgentPlan.name}`,
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
              let mergeRun: { text: string; record: AgentRunRecord };
              try {
                mergeRun = await runOutlineAgentOnce(mergeMessages, {
                  skillNames: options.preferredSkillNames,
                  disableWriteTools: true,
                  streamToUser: true,
                  statusText: "\u591a Agent \u5df2\u5b8c\u6210\uff0c\u6b63\u5728\u5408\u5e76\u5927\u7eb2\u7ed3\u679c...",
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
              updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                ...run,
                status: "done",
                merge: {
                  status: "done",
                  finishedAt: Date.now(),
                  summary: "合并完成，已输出最终大纲草稿。",
                },
              }) : run);
              return mergeRun.text || "AI大纲未返回内容。";
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

        if (!isCurrentRun()) return { started: true, sent: false };
        if (contextHubResult && providerUsage) {
          try {
            const contextHubSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              assistantId,
              contextHubResult,
              providerUsage,
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

        const finalSources = Array.from(
          new Set([
            ...contextSources,
            ...outlineSources,
            ...outlineToolCallsToSources(allToolCalls),
          ]),
        );
        const rawFinalContent = finalText || result || "AI大纲未返回内容。";
        const nextStepExtraction = extractNextStep(rawFinalContent, {
          allowFallback: options.intentPhase === "generation",
          completedModule: intentContextsRef.current[capturedConvId]?.title || "当前模块",
        });
        const cleanFinalContent = nextStepExtraction.cleanText || "AI大纲未返回内容。";
        const structuredMarkdownEnabled = options.intentPhase === "generation"
          || options.novelGenerationRequest !== undefined;
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
              if (!isCurrentRun()) return { started: true, sent: false };
              toast.info("Markdown 格式自动修复未完全通过，已保留内容最完整的版本。", {
                dedupeKey: "outline-markdown-quality-incomplete",
              });
            },
          },
        );
        if (!isCurrentRun()) return { started: true, sent: false };
        const visibleToolCalls = allToolCalls.length ? allToolCalls : [];
        const shouldShowToolProcess =
          historyPlan.showToolProcess ||
          visibleToolCalls.some((call) => call.status === "approval_required");
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: finalContent,
          sources: finalSources,
          showThinkingProcess: historyPlan.showThinkingProcess,
          agentToolCalls: shouldShowToolProcess
            ? settleRunningAgentToolCalls(
                allToolCalls.length ? allToolCalls : message.agentToolCalls,
              )
            : [],
          isAgentRunning: false,
          nextStepRecommendation: nextStepExtraction.recommendation,
        }));

        // 解析意图清晰度结果
        const intentResult = parseIntentClarity(finalContent);
        if (intentResult) {
          const intentContext = intentContextsRef.current[capturedConvId] ?? { title: "", hint: "" };
          intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
            ...intentContext,
            result: intentResult,
          });
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            intentClarityResult: intentResult,
          }));
          if (intentResult.clarity === "clear") {
            const capturedStage = outlineWorkflowStages[capturedConvId] ?? "idle";
            if (canTransitionOutlineWorkflow(capturedStage, "sufficiency_check")) {
              setCapturedWorkflowStage("sufficiency_check");
            }
            addMessage(convId, {
              id: crypto.randomUUID(),
              role: "user",
              content: `✓ 意图明确（${intentResult.module}${intentResult.detectedScope ? `：${intentResult.detectedScope}` : ""}），开始生成...`,
            });
            const scope = intentResult.detectedScope;
            const capturedIntentContext = intentContextsRef.current[capturedConvId] ?? { title: "", hint: "" };
            followUpGenerationPrompt = buildGenerationPrompt(
              capturedIntentContext.title,
              capturedIntentContext.hint,
              scope,
              capturedIntentContext.outputMode,
            );
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
            dependencies: contextHubResult?.dependencies ?? {},
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
        await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun);
        if (!isCurrentRun()) return { started: true, sent: false };
        const firstUser = useOutlineChatStore
          .getState()
          .conversations.find((conversation) => conversation.id === convId)
          ?.messages.find((message) => message.role === "user");
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
        if (isCurrentRun()) clearStreamingContent(capturedConvId);
        setCapturedWorkflowStage("idle");
        finishConversationRun(
          capturedConvId,
          useOutlineChatStore.getState().activeConversationId,
          runId,
        );
        if (followUpGenerationPrompt) {
          void handleSend(followUpGenerationPrompt, [], {
            conversationId: capturedConvId,
            clearDraft: false,
            intentPhase: "generation",
            systemGenerated: true,
            forceRefresh: true,
          });
        }
        return { started: true, sent: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        if (aborted || !isCurrentRun()) return { started: true, sent: false };
        const partial = useOutlineChatStore.getState().getStreamingContent(capturedConvId);
        if (partial) {
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            content: partial,
            agentToolCalls: historyPlan.showToolProcessOnError
              ? settleRunningAgentToolCalls(
                  message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls,
                  "error",
                  Date.now(),
                   errorMsg,
                )
              : [],
            isAgentRunning: false,
          }));
        } else {
          if (errorMsg && !aborted) {
            updateOutlineAssistantMessage(convId, assistantId, (message) => ({
              ...message,
              content: `生成失败：${errorMsg}`,
              agentToolCalls: historyPlan.showToolProcessOnError
                ? settleRunningAgentToolCalls(
                    message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls,
                    "error",
                    Date.now(),
                    errorMsg,
                  )
                : [],
              isAgentRunning: false,
            }));
          } else if (isCurrentRun()) {
            removeOutlineMessage(capturedConvId, assistantId);
          }
        }
        if (isCurrentRun()) clearStreamingContent(capturedConvId);
        if (isCurrentRun()) {
          setCapturedWorkflowStage("idle");
          failConversationRun(capturedConvId, errorMsg || "未知错误", runId);
          toast.error(errorMsg || "未知错误", {
            title: "大纲生成失败",
            persistent: true,
            dedupeKey: `outline-run:${capturedConvId}:${errorMsg}`,
          });
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
      replaceLastAssistant,
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
      intentContextsRef.current = setOutlineSessionValue(intentContextsRef.current, capturedConvId, {
        title,
        hint: requestHint,
        outputMode: config?.outputMode,
      });
      if (canTransitionOutlineWorkflow(outlineWorkflowStages[capturedConvId] ?? "idle", "intent_analysis")) {
        setOutlineWorkflowStages((stages) => setOutlineSessionValue(stages, capturedConvId, "intent_analysis"));
      }
      const intentPrompt = buildIntentAnalysisPrompt(title, requestHint);
      void handleSend(intentPrompt, [], { conversationId: capturedConvId, intentPhase: "intent_analysis", systemGenerated: true });
    },
    [activeConversationId, createConversation, handleSend, outlineWorkflowStages],
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
          const generationPrompt = buildGenerationPrompt(intentContext.title, intentContext.hint, scope, intentContext.outputMode);
          const references = outlineReferenceTokens;
          const result = await handleSend(generationPrompt, references, { conversationId: capturedConvId, intentPhase: "generation", clearDraft: false, systemGenerated: true, forceRefresh: true });
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
            tokenBudget: novelConfig.contextTokenBudget,
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
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({ projectName: project.name });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({ projectName: project.name, soulDoc });
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
              onError: (error) => { agentError = error; },
            }, controller.signal);
            providerUsage = addLlmUsage(providerUsage, record.usage);
            if (agentError) throw agentError;
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
                if (isCurrentRun()) setStreamingContent(capturedConvId, mergeText);
              },
              onToolCall: () => {},
              onToolResult: () => {},
              onToolError: () => {},
              onToolEvent: () => {},
              onDone: () => {},
              onError: (error) => { mergeError = error; },
            }, controller.signal);
            providerUsage = addLlmUsage(providerUsage, record.usage);
            if (mergeError) throw mergeError;
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

        if (contextHubResult && providerUsage) {
          try {
            const contextHubSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              `${messageId}:${runId}`,
              contextHubResult,
              providerUsage,
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
            dependencies: contextHubResult?.dependencies ?? {},
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
      const modelContent = buildOutlineWizardMultiAgentPrompt(request);
      void handleSend(modelContent, outlineReferenceTokensRef.current, {
        disableWriteTools: true,
        preferredSkillNames: getOutlineWizardSkillNames(request),
        enableMultiAgent: true,
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
    const partial = useOutlineChatStore.getState().getStreamingContent(activeConversationId);
    const conversation = useOutlineChatStore.getState().conversations
      .find((item) => item.id === activeConversationId);
    const lastMessage = conversation?.messages[conversation.messages.length - 1];
    if (partial) {
      if (lastMessage?.role === "assistant") {
        updateOutlineAssistantMessage(activeConversationId, lastMessage.id, (message) => ({
          ...message,
          content: partial,
          isAgentRunning: false,
        }));
      }
    } else {
      if (lastMessage?.role === "assistant" && lastMessage.isAgentRunning) {
        removeOutlineMessage(activeConversationId, lastMessage.id);
      }
    }
    clearStreamingContent(activeConversationId);
    stopConversationRun(activeConversationId, runningState.runId);
  }, [
    activeConversationId,
    replaceLastAssistant,
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

      setStreamingContent(capturedConvId, "");
      userScrolledUpRef.current = false;

      try {
        const regenerationInput = buildOutlineRegenerationInput(targetMessages);
        const lastUserRequest = regenerationInput.request;
        const historyMessages = regenerationInput.history satisfies AgentMessage[];
        const assistantId = crypto.randomUUID();
        let contextHubSnapshot: ContextHubSnapshotRef | undefined;
        let contextHubResult: ContextHubResult | null = null;
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
            tokenBudget: novelConfig.contextTokenBudget,
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
        });

        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const registry = new ToolRegistry();
        const baseSystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
        });
        const legacySystemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          soulDoc,
        });
        const systemContent: AgentMessage["content"] = contextHubResult
          ? buildContextHubSystemContent(baseSystemPrompt, contextHubResult)
          : legacySystemPrompt;
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
            disabledTools: OUTLINE_CHAT_DISABLED_TOOLS,
            ...(contextHubResult
              ? { readTextFile: contextHubResult.readFile }
              : {}),
          },
        );
        agentConfig.requestOverrides = {
          ...agentConfig.requestOverrides,
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
              if (isCurrentRun()) setStreamingContent(capturedConvId, result);
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
        if (contextHubResult && record.usage) {
          try {
            const updatedSnapshot = await persistContextHubProviderUsage(
              getContextHub(normalizePath(project.path)),
              assistantId,
              contextHubResult,
              record.usage,
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

        const sources = [
          ...outlineToolCallsToSources(record.toolCalls),
        ];
        const nextStepExtraction = extractNextStep(
          result || record.finalText || "AI大纲未返回内容。",
          { allowFallback: true, completedModule: "当前模块" },
        );
        const cleanFinalContent = nextStepExtraction.cleanText || "AI大纲未返回内容。";
        const finalContent = await finalizeStructuredMarkdownMessage(cleanFinalContent, {
          enabled: regenerationInput.structuredGeneration,
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
        updateOutlineAssistantMessage(
          capturedConvId,
          assistantId,
          (message) => ({
            ...message,
            content: finalContent,
            sources,
            agentToolCalls: settleRunningAgentToolCalls(record.toolCalls.length ? record.toolCalls : message.agentToolCalls),
            isAgentRunning: false,
            nextStepRecommendation: nextStepExtraction.recommendation,
          }),
        );
        setConversationContextSummary(capturedConvId, buildSessionContextSummary({
          messages: [
            ...historyMessages,
            { role: "user", content: lastUserRequest },
            { role: "assistant", content: finalContent },
          ],
          dependencies: contextHubResult?.dependencies ?? {},
        }));
        if (!isCurrentRun()) return;
        await handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun);
        if (!isCurrentRun()) return;
        if (isCurrentRun()) clearStreamingContent(capturedConvId);
        finishConversationRun(
          capturedConvId,
          useOutlineChatStore.getState().activeConversationId,
          runId,
        );
        void useOutlineChatStore.getState().saveToDisk();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const aborted = controller.signal.aborted || errorMsg.toLowerCase().includes("aborted");
        if (aborted || !isCurrentRun()) return;
        const partial = useOutlineChatStore.getState().getStreamingContent(capturedConvId);
        if (partial) {
          replaceLastAssistant(capturedConvId, partial);
        } else {
          if (errorMsg && !aborted) {
            replaceLastAssistant(capturedConvId, `生成失败：${errorMsg}`);
          }
        }
        if (isCurrentRun()) clearStreamingContent(capturedConvId);
        if (isCurrentRun()) {
          failConversationRun(capturedConvId, errorMsg || "未知错误", runId);
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
      replaceLastAssistant,
      handleAutoSaveOutlineRequests,
      outlineWritingSkills,
      setStreamingContent,
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
      const cleanedContent = cleanNextStepArtifacts(content);
      if (!cleanedContent.trim()) {
        toast.error("内容为空，无法保存为大纲");
        return;
      }
      const capturedConvId = activeConversationId;
      setSaveStatus("");
      try {
        const draft = prepareOutlineSaveDraft(cleanedContent, []);
        const classification = classifyOutlineSaveTarget({
          title: draft.title,
          content: draft.content,
        });
        if (classification.fileType === "character") {
          const extracted = extractCharacterSaveDrafts(draft.content);
          if (extracted.drafts.length === 0) {
            setSaveStatus(extracted.errors.join("；"));
            return;
          }
          setSaveConfirmState({
            title: "请确认要保存的人物角色",
            mode: "character",
            requests: [],
            characterDrafts: extracted.drafts,
            reviewItems: extracted.drafts.filter((d) => d.selected).map((d) => ({
              id: `人物小传/${d.fileName}`,
              fileName: d.fileName,
              originalContent: "",
              modifiedContent: d.content,
              selected: true,
            })),
          });
          return;
        }

        const body = draft.content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim();
        const mdContent = `# ${classification.fileName.replace(/\.md$/i, "")}\n\n${body}`;
        if (classification.fileType === "chapter-outline") {
          const quality = summarizeChapterOutlineQuality(mdContent);
          if (!quality.valid) {
            const qualityFeedback = buildOutlineGenerationQualityFeedback({
              fileType: classification.fileType,
              fileName: classification.fileName,
              content: mdContent,
            });
            if (qualityFeedback) {
              setQualityFeedbackStates((states) => setOutlineSessionValue(states, capturedConvId, qualityFeedback));
              setQualityConfirmStates((states) => setOutlineSessionValue(states, capturedConvId, {
                feedback: qualityFeedback,
                requests: [{
                  targetFolder: classification.targetFolder,
                  fileName: classification.fileName,
                  fileType: classification.fileType,
                  writeMode: "create",
                  referencedSkills: [],
                  sourceIntent: "手动保存 AI 大纲结果",
                  content: mdContent,
                }],
              }));
            }
            setSaveStatus(formatChapterOutlineQualityReport(quality, {
              maxIssues: 4,
              includeWarnings: true,
            }));
            return;
          }
        }
        setSaveConfirmState({
          title: "保存大纲文件",
          mode: "normal",
          characterDrafts: [],
          requests: [{
            targetFolder: classification.targetFolder,
            fileName: classification.fileName,
            fileType: classification.fileType,
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "手动保存 AI 大纲结果",
            content: mdContent,
          }],
          reviewItems: (() => {
            const req = {
              targetFolder: classification.targetFolder,
              fileName: classification.fileName,
              fileType: classification.fileType,
              writeMode: "create" as const,
            }
            return [{
              id: `${req.targetFolder}/${req.fileName}`,
              fileName: req.fileName,
              originalContent: "",
              modifiedContent: stripOutlineFrontmatter(mdContent),
              selected: true,
              targetFolder: req.targetFolder,
              writeMode: req.writeMode,
            }]
          })(),
        });
      } catch (err) {
        setSaveStatus(
          `保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [activeConversationId, project],
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

  const handleRepairQualityFeedback = useCallback(() => {
    if (!activeConversationId) return;
    const capturedConvId = activeConversationId;
    const repairPrompt = qualityFeedbackState?.repairPrompt;
    if (!repairPrompt) return;
    setQualityFeedbackStates((states) => setOutlineSessionValue(states, capturedConvId, null));
    void handleSend(repairPrompt, [], { conversationId: capturedConvId, clearDraft: false, forceRefresh: true });
  }, [activeConversationId, handleSend, qualityFeedbackState]);

  const handleSaveAsIs = useCallback(async () => {
    if (!project || !qualityConfirmState || !activeConversationId) return;
    const capturedConvId = activeConversationId;
    const { requests } = qualityConfirmState;
    setQualityConfirmStates((states) => setOutlineSessionValue(states, capturedConvId, null));
    setQualityFeedbackStates((states) => setOutlineSessionValue(states, capturedConvId, null));
    if (requests.length === 0) return;
    setSaveStatus("正在保存大纲...");
    try {
      const projectPath = normalizePath(project.path);
      const saveResult = await saveOutlineSaveRequests({
        outlineRoot: `${projectPath}/wiki/outlines`,
        requests,
        createDirectory,
        fileExists,
        readFile,
        writeFile,
      });
      if (saveResult.saved.length > 0) {
        await refreshProjectState(projectPath);
        const names = saveResult.saved.map((item) => item.fileName).join("、");
        setSaveStatus(`已保存 ${saveResult.saved.length} 个大纲文件：${names}`);
      } else if (saveResult.errors.length > 0) {
        setSaveStatus(`保存失败：${saveResult.errors.slice(0, 2).join("；")}`);
      }
    } catch (error) {
      setSaveStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeConversationId, project, qualityConfirmState, createDirectory, fileExists, readFile, writeFile]);

  const handleAutoFixFromModal = useCallback(() => {
    if (!activeConversationId) return;
    const capturedConvId = activeConversationId;
    const repairPrompt = qualityConfirmState?.feedback.repairPrompt;
    if (!repairPrompt) return;
    pendingRepairMetaRef.current[capturedConvId] = qualityConfirmState.requests;
    setQualityConfirmStates((states) => setOutlineSessionValue(states, capturedConvId, null));
    setQualityFeedbackStates((states) => setOutlineSessionValue(states, capturedConvId, null));
    void handleSend(repairPrompt, [], { conversationId: capturedConvId, clearDraft: false, forceRefresh: true });
  }, [activeConversationId, handleSend, qualityConfirmState]);

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
                    className={`group flex shrink-0 items-center rounded-full border text-xs transition-colors ${
                      isActive
                        ? "border-primary/40 bg-background text-foreground shadow-sm"
                        : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveConversation(conv.id)}
                      className="flex items-center gap-2 rounded-full px-3 py-1.5"
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
            </div>
          ) : (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              暂无大纲对话
            </span>
          )}
          {outlineWorkflowStage !== "idle" && outlineWorkflowStage !== "saved" ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {outlineWorkflowStage === "intent_analysis" ? "意图分析中" :
               outlineWorkflowStage === "waiting_user_input" ? "等待选择" :
               outlineWorkflowStage === "sufficiency_check" ? "生成中" :
               "处理中"}
            </span>
          ) : null}
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
          {qualityFeedbackState && qualityFeedbackState.status !== "pass" ? (
            <button
              type="button"
              disabled={isStreaming}
              onClick={handleRepairQualityFeedback}
              aria-label="修订生成后质量检查发现的问题"
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              title={qualityFeedbackState.summary}
            >
              修订质量问题
            </button>
          ) : null}
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
        {activeMessages.map((msg, i) => (
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
                  streamingContent={batchedStreamingContent}
                  activeMessagesLength={activeMessages.length}
                  copied={copied}
                  projectPath={project?.path ?? null}
                  onSaveAsOutline={handleSaveAsOutline}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onConfirmToolSave={handleConfirmToolSave}
                  onRejectTool={handleRejectTool}
                  onSendMessage={handleSendMessage}
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
            通过固定选项生成大纲需求，再交给 AI 分析和追问
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
          onSubmit={handleSend}
          onAtTrigger={() => setReferencePickerOpen(true)}
          insertTokensRef={insertReferenceTokensRef}
          leftFooterControls={
            <TooltipProvider delay={200}>
              <OutlineGenerationMenu
                disabled={submitDisabled}
                onGenerate={handleGenerateSection}
              />
            </TooltipProvider>
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
          <AiChangeReview
            open
            title={saveConfirmState.title}
            items={saveConfirmState.reviewItems ?? []}
            onClose={() => setSaveConfirmState(null)}
            onConfirm={executeConfirmedOutlineSave}
          />
        ) : null}
        {qualityConfirmState ? (
          <Dialog open onOpenChange={(open) => {
            if (!open && activeConversationId) {
              setQualityConfirmStates((states) => setOutlineSessionValue(states, activeConversationId, null));
            }
          }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>大纲质量检查发现可修复项</DialogTitle>
                <DialogDescription className="text-left">
                  {qualityConfirmState.feedback.summary}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-48 overflow-y-auto space-y-1 py-2">
                {qualityConfirmState.feedback.issues.slice(0, 10).map((issue, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0 text-amber-600">·</span>
                    <span className="text-muted-foreground">{issue}</span>
                  </div>
                ))}
                {qualityConfirmState.feedback.issues.length > 10 ? (
                  <div className="text-xs text-muted-foreground">
                    另有 {qualityConfirmState.feedback.issues.length - 10} 项未列出
                  </div>
                ) : null}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={handleSaveAsIs}
                >
                  按当前内容保存
                </Button>
                <Button
                  onClick={handleAutoFixFromModal}
                  disabled={isStreaming}
                >
                  自动修复
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
