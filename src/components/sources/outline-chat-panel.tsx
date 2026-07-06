import React, {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  X,
  Save,
  Copy,
  RefreshCw,
  FileText,
  Plus,
  Trash2,
  ListPlus,
} from "lucide-react";
import { useWikiStore } from "@/stores/wiki-store";
import {
  useOutlineChatStore,
  type OutlineChatMessage,
} from "@/stores/outline-chat-store";
import { normalizePath } from "@/lib/path-utils";
import { refreshProjectState } from "@/lib/project-refresh";
import {
  writeFile,
  listDirectory,
  createDirectory,
  fileExists,
} from "@/commands/fs";
import { hasUsableLlm } from "@/lib/has-usable-llm";
import ReactMarkdown from "react-markdown";
import { FileEditPreview } from "@/components/chat/file-edit-preview";
import { AgentToolCallMessage } from "@/components/chat/agent-tool-call-message";
import { ChatDockControls } from "@/components/chat/chat-dock-controls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-generation";
import { prepareOutlineSaveDraft } from "@/lib/outline-save";
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
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library";
import { readSoulDoc } from "@/lib/novel/soul-doc";
import {
  buildWebResearchContext,
  collectWebResearch,
  shouldUseWebResearch,
} from "@/lib/web-research";

const OUTLINE_CHAT_DISABLED_TOOLS = ["write_chapter", "write_memory"];

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
    "回答必须基于已读取内容进行分析，说明关键判断依据；需要保存大纲时只能使用 write_outline_node。",
    "## AI大纲固定分析流程",
    "1. 先调用 list_outlines、list_chapters、list_memories、list_deductions 确认可用资料范围。",
    "2. 再调用 read_outline、read_chapter、read_memory、read_deduction 读取用户 @ 引用和相关项目内容。",
    "3. 分析冲突、缺口、伏笔、角色动机和章节承接，明确哪些判断来自已读取资料。",
    "4. 最后再生成大纲建议；没有完成读取和分析前，不要直接给出结论。",
    "## AI大纲生成工作流",
    "当用户要求生成、完善或续写任何大纲分项时，必须按 PRD 3.1 主流程执行：提取请求关键词，识别用户意图，按意图读取资料，提取对小说创作有用的关键内容，结合用户要用的 skill + soul.md 约束生成内容，再做结果强约束收敛。",
    "关键内容提取必须服务于小说创作：只保留能帮助用户继续写小说的信息，例如章节目标、冲突推进、人物动机、伏笔状态、设定限制、时间线承接和结尾钩子。",
    "最终回复只输出大纲标题和大纲正文；禁止输出工具调用报告、分析过程、完成报告、下一步行动、无法直接保存的大段说明。",
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

async function getUniqueOutlinePath(
  outlinesDir: string,
  title: string,
): Promise<string> {
  const fileName = `${title}.md`;
  const firstPath = `${outlinesDir}/${fileName}`;
  if (!(await fileExists(firstPath))) return firstPath;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${outlinesDir}/${title}-${i}.md`;
    if (!(await fileExists(candidate))) return candidate;
  }
  return `${outlinesDir}/${title}-${Date.now()}.md`;
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
      <AgentToolCallMessage toolCalls={msg.agentToolCalls} />
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{parsed.textContent || answer}</ReactMarkdown>
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
  const loadFromDisk = useOutlineChatStore((s) => s.loadFromDisk);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConv?.messages ?? [];

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
  const [localModelId, setLocalModelId] = useState(activeConv?.modelId ?? "");
  const insertReferenceTokensRef = useRef<InsertReferenceTokens>(null);

  const referenceProviders = useMemo(
    () => [
      chapterProvider,
      memoryProvider,
      outlineProvider,
      deductionProvider,
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
    [chatConversations, conversations],
  );

  // 加载持久化的历史记录
  useEffect(() => {
    if (!loaded) {
      void loadFromDisk();
    }
  }, [loaded, loadFromDisk]);

  // 当前会话切换或持久化 modelId 变化时，同步本地选择状态
  useEffect(() => {
    setLocalModelId(activeConv?.modelId ?? "");
  }, [activeConv?.modelId]);

  const [saveStatus, setSaveStatus] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

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

  const handleSend = useCallback(
    async (inputText: string, tokens: ReferenceToken[] = []) => {
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
        const registry = new ToolRegistry();
        const systemPrompt = buildOutlineAgentSystemPrompt({
          projectName: project.name,
          webResearchContext: webResearchMarkdown,
          soulDoc,
        });
        const agentConfig = buildAgentConfig(
          effectiveModelId,
          systemPrompt,
          registry,
          {
            wikiPath: `${normalizePath(project.path)}/wiki`,
            getSkillConfig: () => skillConfig,
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
        const agentMessages: AgentMessage[] = [
          { role: "system", content: systemPrompt },
          ...historyBeforeSend,
          {
            role: "user",
            content: buildOutlineAgentUserContent(prompt, tokens),
          },
        ];
        let agentError: Error | null = null;

        const record = await new AgentRunner().run(
          agentConfig,
          registry,
          agentMessages,
          {
            onText: (chunk) => {
              result += chunk;
              setStreamingContent(result);
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
            onDone: () => {
              updateOutlineAssistantMessage(convId, assistantId, (message) => ({
                ...message,
                agentToolCalls: settleRunningAgentToolCalls(
                  message.agentToolCalls,
                ),
                isAgentRunning: false,
              }));
            },
            onError: (error) => {
              agentError = error;
            },
          },
          controller.signal,
        );
        if (agentError) throw agentError;

        const finalSources = Array.from(
          new Set([
            ...outlineSources,
            ...outlineToolCallsToSources(record.toolCalls),
          ]),
        );
        updateOutlineAssistantMessage(convId, assistantId, (message) => ({
          ...message,
          content: result || record.finalText || "AI大纲未返回内容。",
          sources: finalSources,
          agentToolCalls: settleRunningAgentToolCalls(record.toolCalls.length ? record.toolCalls : message.agentToolCalls),
          isAgentRunning: false,
        }));
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

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    // Force stop streaming state immediately in case abort doesn't trigger catch
    const partial = useOutlineChatStore.getState().streamingContent;
    if (partial && activeConversationId) {
      replaceLastAssistant(activeConversationId, partial);
    }
    setStreamingContent("");
    setIsStreaming(false);
    abortRef.current = null;
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
        updateOutlineAssistantMessage(
          activeConversationId,
          assistantId,
          (message) => ({
            ...message,
            content: result || record.finalText || "AI大纲未返回内容。",
            sources,
            agentToolCalls: settleRunningAgentToolCalls(record.toolCalls.length ? record.toolCalls : message.agentToolCalls),
            isAgentRunning: false,
          }),
        );
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
      setSaveStatus("保存中...");
      try {
        const pp = normalizePath(project.path);
        const outlinesDir = `${pp}/wiki/outlines`;
        await createDirectory(outlinesDir);
        const existingFiles = await listDirectory(outlinesDir).catch(() => []);
        const existingTitles = existingFiles
          .filter((file) => file.name.endsWith(".md"))
          .map((file) => file.name.replace(/\.md$/i, "").trim())
          .filter(Boolean);
        const draft = prepareOutlineSaveDraft(content, existingTitles);
        const outlinePath = await getUniqueOutlinePath(
          outlinesDir,
          draft.title,
        );
        const fileName =
          outlinePath.split("/").pop()?.replace(/\.md$/, "") ?? draft.title;
        const body = draft.content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim();
        const mdContent = `---\ntype: outline\ntitle: "${fileName}"\n---\n\n# ${fileName}\n\n${body}\n`;
        await writeFile(outlinePath, mdContent);
        await refreshProjectState(pp);
        setSaveStatus(`已保存：${fileName}`);
      } catch (err) {
        setSaveStatus(
          `保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [project],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden border-border bg-background">
      {/* Header with conversation tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 overflow-x-auto">
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
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => setActiveConversation(conv.id)}
            className={`group shrink-0 flex items-center gap-1 rounded px-2 py-1 text-xs ${
              conv.id === activeConversationId
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <span className="max-w-[100px] truncate">{conv.title}</span>
            <Trash2
              className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
              }}
            />
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
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
                />
              ) : (
                <>
                  <span>{msg.content}</span>
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
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
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
      </div>
    </div>
  );
}
