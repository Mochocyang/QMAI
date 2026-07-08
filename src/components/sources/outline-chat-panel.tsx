import React, {
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
} from "lucide-react";
import { useWikiStore } from "@/stores/wiki-store";
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
import { FileEditPreview } from "@/components/chat/file-edit-preview";
import {
  AgentToolCallMessage,
  type ToolCallRecord,
} from "@/components/chat/agent-tool-call-message";
import { ChatDockControls } from "@/components/chat/chat-dock-controls";
import {
  OutlineSaveConfirmDialog,
  type OutlineSaveConfirmPayload,
} from "@/components/sources/outline-save-confirm-dialog";
import { OutlineWizardDialog } from "@/components/sources/outline-wizard-dialog";
import { OutlineMultiAgentPanel } from "@/components/sources/outline-multi-agent-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-section-configs";
import {
  buildOutlineWizardPrompt,
  getOutlineWizardSkillNames,
  type OutlineWizardRequest,
} from "@/lib/novel/outline-wizard";
import {
  type OutlineSubAgentPlan,
  planOutlineSubAgents,
  runOutlineMultiAgentWorkflow,
} from "@/lib/novel/outline-multi-agent-orchestrator";
import { normalizeOutlineMarkdown, prepareOutlineSaveDraft } from "@/lib/outline-save";
import {
  type CharacterSaveDraft,
  extractCharacterSaveDrafts,
} from "@/lib/novel/character-save-extractor";
import { classifyOutlineSaveTarget } from "@/lib/novel/outline-save-classifier";
import {
  formatChapterOutlineQualityReport,
  summarizeChapterOutlineQuality,
} from "@/lib/novel/outline-quality-check";
import {
  characterDraftsToSaveRequests,
  type OutlineSaveRequest,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "@/lib/novel/outline-save-request";
import { coerceOutlineSubAgentResult } from "@/lib/novel/outline-result-protocol";
import {
  resolveModelConfig,
  resolveNovelModel,
} from "@/lib/novel/model-resolver";
import { ChatModelSelector } from "@/components/chat/chat-model-selector";
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
  getConversationTabTitle,
  splitConversationToolbarItems,
} from "@/lib/workspace-layout";
import { createWriteOutlineNodeTool } from "@/lib/agent/tools/write-outline-node";

const OUTLINE_CHAT_DISABLED_TOOLS = ["write_chapter", "write_memory"];
const OUTLINE_CHAT_WIZARD_DISABLED_TOOLS = [
  ...OUTLINE_CHAT_DISABLED_TOOLS,
  "write_outline_node",
];
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

function buildOutlineAgentSystemPrompt(options: {
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
    "当用户要求生成、完善或续写任何大纲分项时，必须按 PRD 3.1 主流程执行：提取请求关键词，识别用户意图，按意图读取资料，提取对小说创作有用的关键内容，结合用户要用的 skill + soul.md 约束生成内容，再做结果强约束收敛。",
    "关键内容提取必须服务于小说创作：只保留能帮助用户继续写小说的信息，例如章节目标、冲突推进、人物动机、伏笔状态、设定限制、时间线承接和结尾钩子。",
    "生成章纲时必须使用章纲标准结构：基础信息、上层依据、本章目标、核心事件、场景顺序、结构节点、章首钩子、爽点设计、章尾钩子、执行约束、人物状态、伏笔与追踪、待写回设定、写作约束、AI写作提示。核心事件不少于6条，场景顺序为2-4个场景。",
    "结构节点必须包含 CBN、CPNs、CEN；CEN 必须能承接下一章 CBN。执行约束必须包含必须覆盖节点和本章禁区。基础信息必须包含时间锚点、章内时间跨度和与上章时间差。",
    "## AI 大纲输出协议",
    "当本轮生成了可保存的大纲、卷纲、章纲、人物、设定、伏笔、组织或质量检查内容时，最终回复末尾必须附加一个 json 代码块，顶层字段为 outlineSaveRequest 或 outlineSaveRequests。",
    "保存请求必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent、content。fileName 必须是 .md 文件，targetFolder 必须位于大纲文件树文件夹内。",
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

function buildOutlineSectionGenerationPrompt(
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
      taskPrompt: describeOutlineSubAgentTask(agent),
      status: "pending",
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
): void {
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
): void {
  updateOutlineMultiAgentRun(conversationId, messageId, (run) => {
    if (!run) return run;
    return {
      ...run,
      agents: run.agents.map((agent) => agent.id === agentId ? updater(agent) : agent),
    };
  });
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
      selected: false,
      confidence: "low",
    };
  });
}

function separateThinking(text: string): {
  thinking: string | null;
  answer: string;
} {
  const thinkParts: string[] = [];
  let answer = text.replace(
    /<(think|thinking)>([\s\S]*?)<\/\1>/gi,
    (_match, _tag, inner) => {
      thinkParts.push(String(inner).trim());
      return "";
    },
  );

  const openMatch = answer.match(/<(think|thinking)>([\s\S]*)$/i);
  if (openMatch && openMatch.index !== undefined) {
    thinkParts.push(openMatch[2].trim());
    answer = answer.slice(0, openMatch.index);
  }

  return {
    thinking:
      thinkParts.length > 0 ? thinkParts.filter(Boolean).join("\n\n") : null,
    answer: answer.trim(),
  };
}

const OutlineThinkingBlock = React.memo(function OutlineThinkingBlock({
  content,
  open,
}: {
  content: string;
  open: boolean;
}) {
  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs dark:bg-amber-950/20 min-h-[3rem]">
      <div className="mb-1.5 flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <span className={open ? "animate-pulse" : undefined}>💭</span>
        <span className="font-medium">{open ? "思考中..." : "思考过程"}</span>
      </div>
      <div className="max-h-72 overflow-y-auto border-t border-amber-500/20 pt-2 pr-1 whitespace-pre-wrap break-words font-mono leading-5 text-amber-800/80 dark:text-amber-300/70">
        {content}
      </div>
    </div>
  );
});

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

  // Parse for file edits
  const [parsed, setParsed] = useState<{
    textContent: string;
    edits: import("@/lib/novel/agent-parser").FileEditAction[];
    hasEdits: boolean;
  }>({ textContent: "", edits: [], hasEdits: false });
  const renderedMarkdownContent = useMemo(
    () => normalizeOutlineMarkdown(parsed.textContent || answer),
    [answer, parsed.textContent],
  );
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
      {thinking ? (
        <OutlineThinkingBlock content={thinking} open={isStreaming} />
      ) : null}
      <OutlineMultiAgentPanel run={msg.multiAgentRun} />
      <AgentToolCallMessage
        toolCalls={msg.agentToolCalls}
        onConfirmSave={onConfirmToolSave}
        onReject={onRejectTool}
      />
      <div
        className="prose prose-sm dark:prose-invert max-w-none break-words"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        <ReactMarkdown>{renderedMarkdownContent}</ReactMarkdown>
      </div>
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
  const chatConversations = useChatStore((s) => s.conversations);

  const conversations = useOutlineChatStore((s) => s.conversations);
  const activeConversationId = useOutlineChatStore(
    (s) => s.activeConversationId,
  );
  const streamingContent = useOutlineChatStore((s) => s.streamingContent);
  const isStreaming = useOutlineChatStore((s) => s.isStreaming);
  const loaded = useOutlineChatStore((s) => s.loaded);
  const createConversation = useOutlineChatStore((s) => s.createConversation);
  const setActiveConversation = useOutlineChatStore(
    (s) => s.setActiveConversation,
  );
  const addMessage = useOutlineChatStore((s) => s.addMessage);
  const replaceLastAssistant = useOutlineChatStore(
    (s) => s.replaceLastAssistant,
  );
  const removeLastMessage = useOutlineChatStore((s) => s.removeLastMessage);
  const deleteConversation = useOutlineChatStore((s) => s.deleteConversation);
  const setConversationModel = useOutlineChatStore(
    (s) => s.setConversationModel,
  );
  const setStreamingContent = useOutlineChatStore((s) => s.setStreamingContent);
  const setIsStreaming = useOutlineChatStore((s) => s.setIsStreaming);
  const pendingReferenceTokens = useOutlineChatStore(
    (s) => s.pendingReferenceTokens,
  );
  const consumePendingReferenceTokens = useOutlineChatStore(
    (s) => s.consumePendingReferenceTokens,
  );
  const loadFromDisk = useOutlineChatStore((s) => s.loadFromDisk);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConv?.messages ?? [];
  const isWorkingConversation = useCallback(
    (convId: string) => Boolean(isStreaming && convId === activeConversationId),
    [activeConversationId, isStreaming],
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
        if (config.enabled !== true) continue;
      }
      if (config.savedModels && config.savedModels.length > 0) {
        return true;
      }
    }
    return false;
  }, [providerConfigs]);

  const [inputValue, setInputValue] = useState("");
  const [outlineReferenceTokens, setOutlineReferenceTokens] = useState<
    ReferenceToken[]
  >([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [outlineWizardOpen, setOutlineWizardOpen] = useState(false);
  const [localModelId, setLocalModelId] = useState(activeConv?.modelId ?? "");
  const insertReferenceTokensRef = useRef<InsertReferenceTokens>(null);
  const [hoveredConversationId, setHoveredConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const [historyDropdownStyle, setHistoryDropdownStyle] = useState<CSSProperties | null>(null);
  const [deAiSkillConfig, setDeAiSkillConfig] = useState<DeAiSkillConfig | null>(null);
  const [writingSkills, setWritingSkills] = useState<UserSkill[]>([]);
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
  useEffect(() => {
    setLocalModelId(activeConv?.modelId ?? "");
  }, [activeConv?.modelId]);

  useEffect(() => {
    if (!historyOpen) return;
    function handleClick(event: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
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

  const [saveStatus, setSaveStatus] = useState("");
  const [saveConfirmState, setSaveConfirmState] = useState<{
    title: string;
    mode: "normal" | "character";
    requests: OutlineSaveRequest[];
    characterDrafts: CharacterSaveDraft[];
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || userScrolledUpRef.current) return;
    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
  }, [activeMessages, streamingContent]);

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
      lastScrollTopRef.current = currentScrollTop;
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

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
    [project],
  );

  const handleAutoSaveOutlineRequests = useCallback(
    async (assistantContent: string) => {
      if (!project) return;
      const parsed = parseOutlineSaveRequests(assistantContent);
      if (parsed.requests.length === 0) {
        if (parsed.errors.length > 0) {
          setSaveStatus(`自动保存失败：${parsed.errors.slice(0, 2).join("；")}`);
        }
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
            });
            setSaveStatus("检测到人物小传，请确认要保存的人物角色。");
          } else {
            setSaveConfirmState({
              title: "请确认要保存的人物角色",
              mode: "character",
              requests: [],
              characterDrafts: buildFallbackCharacterDraftsFromRequests(
                split.confirmRequired,
              ),
            });
            setSaveStatus(
              `无法自动拆分角色，请在保存前检查文件名和内容。${extracted.errors.join("；")}`,
            );
          }
        }
        if (split.autoSaveable.length === 0) return;

        const saveResult = await saveOutlineSaveRequests({
          outlineRoot: `${projectPath}/wiki/outlines`,
          requests: split.autoSaveable,
          createDirectory,
          fileExists,
          readFile,
          writeFile,
        });
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
          setSaveStatus(`自动保存失败：${[...saveResult.errors, ...parsed.errors].slice(0, 2).join("；")}`);
        }
      } catch (error) {
        setSaveStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`);
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
      } = {},
    ) => {
      const prompt = inputText.trim();
      if (!prompt || !project || isStreaming) return;
      setInputValue("");
      setOutlineReferenceTokens([]);
      let effectiveLlmConfig = resolveNovelModel(
        llmConfig,
        novelConfig,
        "writing",
      );
      if (activeConv?.modelId) {
        effectiveLlmConfig = resolveModelConfig(
          activeConv.modelId,
          effectiveLlmConfig,
          providerConfigs,
        );
      }
      const effectiveModelId =
        activeConv?.modelId || effectiveLlmConfig.model || "";
      if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
        const convId = activeConversationId ?? createConversation();
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "请先在设置中配置并选择一个可用的 AI 模型，或在下方模型选择器中选择模型后再试。",
        });
        return;
      }
      if (!modelSupportsTools(effectiveModelId)) {
        const convId = activeConversationId ?? createConversation();
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "当前模型不支持 AI 大纲工具调用，请在下方模型选择器中更换支持工具调用的模型。",
        });
        return;
      }

      let convId = activeConversationId;
      if (!convId) {
        convId = createConversation();
      }

      const historyBeforeSend = (
        useOutlineChatStore
          .getState()
          .conversations.find((c) => c.id === convId)?.messages ?? []
      )
        .filter((message) => message.content.trim() && !message.isAgentRunning)
        .map(
          (message) =>
            ({
              role: message.role,
              content: message.content,
            }) satisfies AgentMessage,
        );
      const userMsg: OutlineChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        attachedReferences: tokens,
      };
      const initialSources = tokens.map(
        (token) =>
          `@${referenceCategoryLabel(token.category)}: ${token.title || token.displayTitle}`,
      );
      const assistantId = crypto.randomUUID();
      addMessage(convId, userMsg);
      addMessage(convId, {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: initialSources,
        agentToolCalls: [],
        isAgentRunning: true,
      });
      setIsStreaming(true);
      setStreamingContent("");
      streamingConversationIdRef.current = convId;
      userScrolledUpRef.current = false;

      try {
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
        const controller = new AbortController();
        abortRef.current = controller;

        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const systemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          webResearchContext: webResearchMarkdown,
          soulDoc,
        });
        const agentMessages: AgentMessage[] = [
          { role: "system", content: systemPrompt },
          ...historyBeforeSend,
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
                useOutlineChatStore
                  .getState()
                  .conversations.map((conversation) => ({
                    id: conversation.id,
                    title: conversation.title,
                    messages: conversation.messages.map((message) => ({
                      role: message.role,
                      content: message.content,
                    })),
                  })),
              llmConfig: effectiveLlmConfig,
              disabledTools: disableWriteTools
                ? OUTLINE_CHAT_WIZARD_DISABLED_TOOLS
                : OUTLINE_CHAT_DISABLED_TOOLS,
            },
          );
          return { agentConfig, registry };
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
            setStreamingContent(optionsForRun.statusText);
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
                  setStreamingContent(result);
                }
              },
              onToolCall: () => {},
              onToolResult: () => {},
              onToolError: () => {},
              onToolEvent: (event) => {
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
        if (options.enableMultiAgent) {
          const maxConcurrency = 3;
          const subAgentPlan = planOutlineSubAgents({
            preferredSkillNames: options.preferredSkillNames ?? [],
            taskPrompt: prompt,
            maxConcurrency,
          });
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            multiAgentRun: createOutlineMultiAgentRunState(subAgentPlan, maxConcurrency),
          }));
          const multiAgentResult = await runOutlineMultiAgentWorkflow({
            plan: subAgentPlan,
            maxConcurrency,
            failureFallbackThreshold: 0.5,
            runSubAgent: async (subAgentPlan) => {
              updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                ...agent,
                status: "running",
                startedAt: Date.now(),
                error: undefined,
              }));
              const subAgentMessages: AgentMessage[] = [
                {
                  role: "system",
                  content: [
                    systemPrompt,
                    "",
                    "## 子 Agent 运行规则",
                    `当前身份：${subAgentPlan.name}`,
                    "你只能处理本 Agent 负责的维度，禁止写入文件。",
                    "必须输出符合 AI 大纲子 Agent JSON 协议的 JSON，不要输出额外说明。",
                  ].join("\n"),
                },
                ...historyBeforeSend,
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
                const message = error instanceof Error ? error.message : String(error);
                updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                  ...agent,
                  status: "error",
                  error: message,
                  finishedAt: Date.now(),
                }));
                throw error;
              }
              const parsed = coerceOutlineSubAgentResult(subRun.text, {
                agentId: subAgentPlan.id,
                agentName: subAgentPlan.name,
                usedSkills: subAgentPlan.skillNames,
                stage: subAgentPlan.kind,
              });
              if (!parsed.ok) {
                updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                  ...agent,
                  status: "error",
                  error: parsed.error,
                  finishedAt: Date.now(),
                }));
                throw new Error(parsed.error);
              }
              updateOutlineMultiAgentItem(convId, assistantId, subAgentPlan.id, (agent) => ({
                ...agent,
                status: "done",
                summary: parsed.value.summary || "已完成本 Agent 负责内容。",
                finishedAt: Date.now(),
              }));
              return JSON.stringify({
                agent_id: parsed.value.agentId,
                agent_name: parsed.value.agentName,
                stage: parsed.value.stage,
                used_skills: parsed.value.usedSkills,
                confidence: parsed.value.confidence,
                summary: parsed.value.summary,
                content_markdown: parsed.value.contentMarkdown,
                constraints: parsed.value.constraints,
                writeback_items: parsed.value.writebackItems.map((item) => ({
                  type: item.type,
                  name: item.name,
                  content: item.content,
                  target_folder: item.targetFolder,
                })),
                risks: parsed.value.risks,
                questions: parsed.value.questions,
              });
            },
            runSingleAgentFallback: async () => {
              updateOutlineMultiAgentRun(convId, assistantId, (run) => run ? ({
                ...run,
                mode: "single-agent-fallback",
                status: "fallback",
                merge: {
                  status: "skipped",
                  summary: "已回退为单 Agent 生成。",
                },
                fallbackReason: run.fallbackReason ?? "多 Agent 不可用或部分子 Agent 失败，已自动回退。",
              }) : run);
              setStreamingContent(
                "多 Agent 生成未能完成，正在按单 Agent 大纲生成继续输出。",
              );
              return runSingleAgentFallback();
            },
            mergeResults: async (subAgentResults) => {
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
                  content: [
                    systemPrompt,
                    "",
                    "## 合并 Agent 运行规则",
                    "你负责合并多个子 Agent 的结构化结果，形成最终可预览的大纲草稿。",
                    "输出必须是用户可直接阅读和保存的大纲正文，不要输出内部调度报告。",
                  ].join("\n"),
                },
                ...historyBeforeSend,
                {
                  role: "user",
                  content: [
                    "请合并以下 AI 大纲子 Agent 结果，解决冲突并输出最终大纲草稿。",
                    "",
                    "## 原始用户需求",
                    buildOutlineAgentUserContent(prompt, tokens),
                    "",
                    "## 子 Agent 结构化结果",
                    JSON.stringify(subAgentResults, null, 2),
                  ].join("\n"),
                },
              ];
              const mergeRun = await runOutlineAgentOnce(mergeMessages, {
                skillNames: options.preferredSkillNames,
                disableWriteTools: true,
                streamToUser: true,
                statusText: "多 Agent 已完成，正在合并大纲结果...",
              });
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
          updateOutlineMultiAgentRun(convId, assistantId, (run) => {
            if (!run) return run;
            const successful = new Set(multiAgentResult.successfulAgents);
            const failed = new Set(multiAgentResult.failedAgents);
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
              merge: multiAgentResult.mode === "multi-agent"
                ? run.merge
                : {
                    status: "skipped",
                    summary: "已回退为单 Agent 生成。",
                  },
            };
          });
          finalText = multiAgentResult.finalText;
        } else {
          finalText = await runSingleAgentFallback();
        }

        const finalSources = Array.from(
          new Set([
            ...outlineSources,
            ...outlineToolCallsToSources(allToolCalls),
          ]),
        );
        const finalContent = finalText || result || "AI大纲未返回内容。";
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: finalContent,
          sources: finalSources,
          agentToolCalls: settleRunningAgentToolCalls(
            allToolCalls.length ? allToolCalls : message.agentToolCalls,
          ),
          isAgentRunning: false,
        }));
        await handleAutoSaveOutlineRequests(finalContent);
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
        setStreamingContent("");
      } catch (err) {
        const partial = useOutlineChatStore.getState().streamingContent;
        if (partial) {
          updateOutlineAssistantMessage(convId, assistantId, (message) => ({
            ...message,
            content: partial,
            agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "error",
              Date.now(),
              err instanceof Error ? err.message : String(err),
            ),
            isAgentRunning: false,
          }));
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (errorMsg && !errorMsg.includes("aborted")) {
            updateOutlineAssistantMessage(convId, assistantId, (message) => ({
              ...message,
              content: `生成失败：${errorMsg}`,
                agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "error",
                Date.now(),
                errorMsg,
              ),
              isAgentRunning: false,
            }));
          } else {
            removeLastMessage(convId);
          }
        }
        setStreamingContent("");
        void useOutlineChatStore.getState().saveToDisk();
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        if (streamingConversationIdRef.current === convId) {
          streamingConversationIdRef.current = null;
        }
      }
    },
    [
      project,
      isStreaming,
      llmConfig,
      novelConfig,
      providerConfigs,
      activeConv,
      activeConversationId,
      createConversation,
      addMessage,
      replaceLastAssistant,
      removeLastMessage,
      handleAutoSaveOutlineRequests,
      outlineWritingSkills,
      setIsStreaming,
      setStreamingContent,
    ],
  );

  const handleGenerateSection = useCallback(
    (title: string, requestHint: string) => {
      void handleSend(buildOutlineSectionGenerationPrompt(title, requestHint));
    },
    [handleSend],
  );

  const handleSubmitOutlineWizard = useCallback(
    (request: OutlineWizardRequest) => {
      void handleSend(buildOutlineWizardMultiAgentPrompt(request), [], {
        disableWriteTools: true,
        preferredSkillNames: getOutlineWizardSkillNames(request),
        enableMultiAgent: true,
      });
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    // Force stop streaming state immediately in case abort doesn't trigger catch
    const partial = useOutlineChatStore.getState().streamingContent;
    const streamingConversationId =
      streamingConversationIdRef.current ?? activeConversationId;
    if (partial && streamingConversationId) {
      replaceLastAssistant(streamingConversationId, partial);
    }
    setStreamingContent("");
    setIsStreaming(false);
    abortRef.current = null;
    streamingConversationIdRef.current = null;
  }, [
    activeConversationId,
    replaceLastAssistant,
    setStreamingContent,
    setIsStreaming,
  ]);

  const handleRegenerate = useCallback(
    async (msgIndex: number) => {
      if (!project || isStreaming || !activeConversationId) return;
      let effectiveLlmConfig = resolveNovelModel(
        llmConfig,
        novelConfig,
        "writing",
      );
      if (activeConv?.modelId) {
        effectiveLlmConfig = resolveModelConfig(
          activeConv.modelId,
          effectiveLlmConfig,
          providerConfigs,
        );
      }
      const effectiveModelId =
        activeConv?.modelId || effectiveLlmConfig.model || "";
      if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
        addMessage(activeConversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "请先在设置中配置并选择一个可用的 AI 模型，或在下方模型选择器中选择模型后再试。",
        });
        return;
      }
      if (!modelSupportsTools(effectiveModelId)) {
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
      const targetMessages = conv.messages.slice(0, msgIndex);

      // Update store
      useOutlineChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages: targetMessages }
            : c,
        ),
      }));

      setIsStreaming(true);
      setStreamingContent("");
      streamingConversationIdRef.current = activeConversationId;
      userScrolledUpRef.current = false;

      try {
        const lastUserRequest =
          [...targetMessages]
            .reverse()
            .find((message) => message.role === "user")?.content ??
          "请基于已有大纲重新生成。";
        const historyMessages = targetMessages
          .filter(
            (message) => message.content.trim() && !message.isAgentRunning,
          )
          .filter((message) => message.content !== lastUserRequest)
          .map(
            (message) =>
              ({
                role: message.role,
                content: message.content,
              }) satisfies AgentMessage,
          );
        let result = "";
        const controller = new AbortController();
        abortRef.current = controller;
        const assistantId = crypto.randomUUID();

        addMessage(activeConversationId, {
          id: assistantId,
          role: "assistant",
          content: "",
          sources: [],
          agentToolCalls: [],
          isAgentRunning: true,
        });

        const skillConfig = await loadDeAiSkillConfig(project.path).catch(
          (): DeAiSkillConfig | null => null,
        );
        const soulDoc = await readSoulDoc(project.path).catch(() => "");
        const registry = new ToolRegistry();
        const systemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          soulDoc,
        });
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
              useOutlineChatStore
                .getState()
                .conversations.map((conversation) => ({
                  id: conversation.id,
                  title: conversation.title,
                  messages: conversation.messages.map((message) => ({
                    role: message.role,
                    content: message.content,
                  })),
                })),
            llmConfig: effectiveLlmConfig,
            disabledTools: OUTLINE_CHAT_DISABLED_TOOLS,
          },
        );
        let agentError: Error | null = null;
        const record = await new AgentRunner().run(
          agentConfig,
          registry,
          [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: lastUserRequest },
          ],
          {
            onText: (chunk) => {
              result += chunk;
              setStreamingContent(result);
            },
            onToolCall: () => {},
            onToolResult: () => {},
            onToolError: () => {},
            onToolEvent: (event) => {
              updateOutlineAssistantMessage(
                activeConversationId,
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
              updateOutlineAssistantMessage(
                activeConversationId,
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

        const sources = outlineToolCallsToSources(record.toolCalls);
        const finalContent = result || record.finalText || "AI大纲未返回内容。";
        updateOutlineAssistantMessage(
          activeConversationId,
          assistantId,
          (message) => ({
            ...message,
            content: finalContent,
            sources,
            agentToolCalls: settleRunningAgentToolCalls(record.toolCalls.length ? record.toolCalls : message.agentToolCalls),
            isAgentRunning: false,
          }),
        );
        await handleAutoSaveOutlineRequests(finalContent);
        setStreamingContent("");
        void useOutlineChatStore.getState().saveToDisk();
      } catch (err) {
        const partial = useOutlineChatStore.getState().streamingContent;
        if (partial) {
          replaceLastAssistant(activeConversationId, partial);
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (errorMsg && !errorMsg.includes("aborted")) {
            replaceLastAssistant(activeConversationId, `生成失败：${errorMsg}`);
          }
        }
        setStreamingContent("");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        if (streamingConversationIdRef.current === activeConversationId) {
          streamingConversationIdRef.current = null;
        }
      }
    },
    [
      project,
      isStreaming,
      llmConfig,
      novelConfig,
      providerConfigs,
      activeConv,
      activeConversationId,
      addMessage,
      replaceLastAssistant,
      handleAutoSaveOutlineRequests,
      outlineWritingSkills,
      setIsStreaming,
      setStreamingContent,
    ],
  );

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => {});
  }, []);

  const handleSaveAsOutline = useCallback(
    async (content: string) => {
      if (!project) return;
      setSaveStatus("");
      try {
        const draft = prepareOutlineSaveDraft(content, []);
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
          });
          return;
        }

        const body = draft.content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim();
        const mdContent = `# ${classification.fileName.replace(/\.md$/i, "")}\n\n${body}`;
        if (classification.fileType === "chapter-outline") {
          const quality = summarizeChapterOutlineQuality(mdContent);
          if (!quality.valid) {
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
          requests: [{
            targetFolder: classification.targetFolder,
            fileName: classification.fileName,
            fileType: classification.fileType,
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "手动保存 AI 大纲结果",
            content: mdContent,
          }],
          characterDrafts: [],
        });
      } catch (err) {
        setSaveStatus(
          `保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [project],
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

  return (
    <div className="flex h-full flex-col overflow-hidden border-border bg-background">
      {/* Header with conversation tabs */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2">
        <button
          type="button"
          onClick={() => {
            createConversation();
          }}
          className="qmai-new-conversation-button flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent/60 text-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          title="新建大纲对话"
          aria-label="新建大纲对话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {topConversations.length > 0 ? (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
              {topConversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                const isThisStreaming = isStreaming && conv.id === activeConversationId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setActiveConversation(conv.id)}
                    onMouseEnter={() => setHoveredConversationId(conv.id)}
                    onMouseLeave={() => setHoveredConversationId(null)}
                    className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      isActive
                        ? "border-primary/40 bg-background text-foreground shadow-sm"
                        : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    title={conv.title}
                  >
                    {isThisStreaming ? (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                    ) : null}
                    <span className="max-w-[140px] truncate font-medium">
                      {getConversationTabTitle(conv.title, 10)}
                    </span>
                    <span className="text-[10px] opacity-70">{conv.messages.length}</span>
                    <span className="text-[10px] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
                    {hoveredConversationId === conv.id ? (
                      <span
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
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
                  className="fixed z-50 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
                  style={historyDropdownStyle}
                >
                  {historyCount === 0 ? (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                      暂无历史大纲对话
                    </div>
                  ) : (
                    historyConversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => setActiveConversation(conv.id)}
                        className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={conv.title}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {getConversationTabTitle(conv.title, 16)}
                        </span>
                        <span className="shrink-0 text-[10px] opacity-70">{conv.messages.length}</span>
                        <span className="shrink-0 text-[10px] opacity-70">{formatOutlineConversationDate(conv.updatedAt)}</span>
                        <Trash2
                          className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(conv.id);
                          }}
                        />
                      </button>
                    ))
                  )}
                </div>,
                document.body,
              )
            : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {saveStatus && (
            <span className="text-xs text-muted-foreground">{saveStatus}</span>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-3"
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
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`w-fit max-w-full lg:max-w-[50vw] rounded-lg px-3 py-2 text-sm ${
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
                  streamingContent={streamingContent}
                  activeMessagesLength={activeMessages.length}
                  copied={copied}
                  projectPath={project?.path ?? null}
                  onSaveAsOutline={handleSaveAsOutline}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onConfirmToolSave={handleConfirmToolSave}
                  onRejectTool={handleRejectTool}
                />
              ) : (
                <>
                  <span className="block whitespace-pre-wrap break-words">
                    {msg.content}
                  </span>
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
        {isStreaming &&
        streamingContent &&
        activeMessages.length > 0 &&
        activeMessages[activeMessages.length - 1]?.content ===
          "" ? null : isStreaming &&
          streamingContent &&
          activeMessages[activeMessages.length - 1]?.role !== "assistant" ? (
          <div className="flex justify-start">
            <div className="w-fit max-w-full lg:max-w-[50vw] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              <div
                className="prose prose-sm dark:prose-invert max-w-none break-words"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                <ReactMarkdown>{normalizeOutlineMarkdown(streamingContent)}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <TooltipProvider delay={200}>
            <div className="qmai-outline-bottom-left-controls flex min-w-0 items-center gap-2">
              <ChatDockControls />
              <OutlineGenerationMenu
                disabled={isStreaming}
                onGenerate={handleGenerateSection}
              />
            </div>
          </TooltipProvider>
        </div>
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-2 py-1.5">
          <div className="min-w-0 text-xs text-muted-foreground">
            通过固定选项生成大纲需求，再交给 AI 分析和追问
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isStreaming}
            onClick={() => setOutlineWizardOpen(true)}
          >
            选择生成你想要的小说
          </button>
        </div>
        <ReferenceInput
          value={inputValue}
          tokens={outlineReferenceTokens}
          onStop={handleStop}
          isStreaming={isStreaming}
          placeholder="输入关于大纲的问题..."
          onChange={(text, tokens) => {
            setInputValue(text);
            setOutlineReferenceTokens(tokens);
          }}
          onTokensChange={setOutlineReferenceTokens}
          onSubmit={handleSend}
          onAtTrigger={() => setReferencePickerOpen(true)}
          insertTokensRef={insertReferenceTokensRef}
          rightControls={
            hasAvailableModels ? (
              <ChatModelSelector
                value={localModelId}
                onChange={(value) => {
                  setLocalModelId(value);
                  if (activeConversationId) {
                    setConversationModel(activeConversationId, value);
                  }
                }}
                disabled={isStreaming}
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
        {saveConfirmState ? (
          <OutlineSaveConfirmDialog
            open
            title={saveConfirmState.title}
            mode={saveConfirmState.mode}
            requests={saveConfirmState.requests}
            characterDrafts={saveConfirmState.characterDrafts}
            onClose={() => setSaveConfirmState(null)}
            onConfirm={executeConfirmedOutlineSave}
          />
        ) : null}
      </div>
    </div>
  );
}
