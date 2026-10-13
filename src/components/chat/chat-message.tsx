import { UserMessageMeta } from "./user-message-meta";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Bot,
  User,
  FileText,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Copy,
  Check,
  Users,
  Lightbulb,
  BookOpen,
  HelpCircle,
  GitMerge,
  BarChart3,
  Layout,
  Globe,
  Image as ImageIcon,
  Loader2,
  Save,
  ArrowRight,
} from "lucide-react";
import { useWikiStore } from "@/stores/wiki-store";
import { readFile } from "@/commands/fs";
import { normalizePath } from "@/lib/path-utils";
import { resolveCitedPagePath } from "@/lib/resolve-cited-page-path";
import { refreshProjectState } from "@/lib/project-refresh";
import { getLastQueryPages } from "@/components/chat/chat-shared";
import { useWaitingHint } from "@/hooks/use-waiting-hint";
import { FileEditPreview } from "@/components/chat/file-edit-preview";
import { AgentToolCallMessage } from "@/components/chat/agent-tool-call-message";
import type { ToolCallRecord } from "@/components/chat/agent-tool-call-message";
import { AgentStageStream } from "@/components/chat/agent-stage-stream";
import { ReferenceChip } from "@/components/reference/ReferenceChip";
import type { DisplayMessage } from "@/stores/chat-store";
import { ContextTracePanel } from "@/components/chat/context-trace-panel";
import { ContextHubDetails } from "@/components/common/context-hub-details";
import { UiTestGenerationStats } from "@/components/common/context-hub-stats-summary";
import { getStreamingTailDisplay } from "@/components/common/streaming-display-text";
import { parseContextHubSnapshotRef } from "@/lib/context-hub/types";

import { convertLatexToUnicode } from "@/lib/latex-to-unicode";
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver";
import {
  findRawSourceForImage,
  imageUrlToAbsolute,
} from "@/lib/raw-source-resolver";
import { detectLanguage } from "@/lib/detect-language";
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata";
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram";
import { highlightCode } from "@/lib/streaming-code-highlight";
import { separateThinking } from "@/lib/separate-thinking";
import { StreamingMarkdown } from "@/components/common/streaming-markdown";
import { StreamingSpinner } from "@/components/common/streaming-spinner";
import { canContinueUnfinishedDeepChapter } from "./chat-resume";
import { getCopyableAssistantContent } from "@/lib/chat-copy-content";
import { StoppedGenerationActions } from "@/components/novel/stopped-generation-actions";
import { isStoppedGenerationMessage } from "@/lib/novel/stopped-generation";
import { ChapterDiscussCard } from "@/components/chat/chapter-discuss-card";
import { EventOutlineCard } from "@/components/sources/event-outline-card";
import { extractEventOutlineData, stripEventOutlineDataFence } from "@/lib/novel/event-outline";
import { handoffEventOutlineToProse } from "@/lib/novel/event-outline-handoff";
import { stripStructuredMarkers } from "@/lib/novel/outline-intent-clarity";
import type {
  ChapterDiscussDirection,
  ChapterDiscussProtocol,
} from "@/lib/novel/chapter-discuss-protocol";

interface ChatMessageProps {
  message: DisplayMessage;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  novelMode?: boolean;
  projectPath?: string | null;
  onSaveAsChapter?: (
    messageId: string,
    content: string,
    toolCalls?: Array<{ name: string; result?: string; status?: string }>,
  ) => void;
  onContinueNextChapter?: () => void;
  onContinueUnfinished?: () => void;
  /**
   * 「继续」：上一条回复被用户手动停止后，保留已生成内容接着往下写。
   * 与 onContinueUnfinished 的区别：那个只服务"深度章节生成失败"这种特定场景，
   * 这个服务任意一次手动停止。见 lib/novel/stopped-generation.ts。
   */
  onContinueStopped?: () => void;
  onSaveAsDraft?: (content: string) => void;
  onDiscardDraft?: () => void;
  saveStatus?: string;
  isSaving?: boolean;
  onConfirmToolSave?: (call: ToolCallRecord & { preview?: string }) => void;
  onRejectTool?: (call: ToolCallRecord & { preview?: string }) => void;
  onRebuildRetrievalIndex?: () => Promise<{
    success: boolean;
    chapterCount?: number;
    error?: string;
  }>;
  retrievalIndexHasIndex?: boolean;
  isRebuildingRetrievalIndex?: boolean;
  lastRebuildRetrievalResult?: {
    success: boolean;
    chapterCount?: number;
    error?: string;
  } | null;
  /** 共创模式：作者选定某个方向后按它生成正文。 */
  onSelectChapterDiscussDirection?: (
    messageId: string,
    protocol: ChapterDiscussProtocol,
    direction: ChapterDiscussDirection,
  ) => void;
  /** 共创模式：对当前一批方向都不满意，重新推演。 */
  onRegenerateChapterDiscuss?: (messageId: string, protocol: ChapterDiscussProtocol) => void;
  /** 共创模式：作者用自己的想法让 AI 按它重新推演方向。 */
  onCustomChapterDiscuss?: (
    messageId: string,
    protocol: ChapterDiscussProtocol,
    idea: string,
  ) => void;
}

export function ChatMessage({
  message,
  isLastAssistant,
  onRegenerate,
  novelMode,
  projectPath,
  onSaveAsChapter,
  onContinueNextChapter,
  onContinueUnfinished,
  onContinueStopped,
  saveStatus,
  isSaving,
  onConfirmToolSave,
  onRejectTool,
  onRebuildRetrievalIndex,
  retrievalIndexHasIndex,
  isRebuildingRetrievalIndex,
  lastRebuildRetrievalResult,
  onSelectChapterDiscussDirection,
  onRegenerateChapterDiscuss,
  onCustomChapterDiscuss,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const [hovered, setHovered] = useState(false);
  const [contextTraceExpanded] = useState(false);
  /**
   * 事件细纲：助手回复里带 `eventOutlineData` 时，在气泡下方挂一张卡片。
   *
   * 已有的同形先例是上面那段 chapter_discuss 的剥离逻辑 —— 结构化数据由程序消费，
   * 用户该看到的是卡片，不是裸 JSON。这里只是把同一套做法对齐到事件细纲这条产线
   * （它原先只在章节区本地渲染卡片，用户要求改成「在 AI 对话里显示」）。
   *
   * ⚠️ 三道闸都不能省：
   * - **只认助手消息**：用户消息里也可能粘贴一段细纲 JSON，那不是生成结果；
   * - **生成中不解析**（`isAgentRunning`）：流式期间每条 token 都会重渲染，
   *   而这个解析要逐字符配平花括号 —— 对一条几千字的回复做几十次是白烧 CPU。
   *   生成结束时 `isAgentRunning` 转假，卡片随之出现，用户不会少看到什么；
   * - **先做一次子串预筛**：`"events"` 是 JSON 里的键名，不可能不出现。绝大多数
   *   回复连这个子串都没有，预筛之后就完全不进那个 O(n) 的扫描。
   */
  const eventOutline = useMemo(
    () =>
      isAssistant && !message.discarded && !message.isAgentRunning && message.content.includes('"events"')
        ? extractEventOutlineData(message.content)
        : null,
    [isAssistant, message.content, message.discarded, message.isAgentRunning],
  );
  /**
   * 共创（discuss）轮：气泡里隐藏 chapter_discuss 协议标记。
   * 生成过程中的正文可能已带上 `<!-- chapter_discuss -->{json}`，不剥离会让用户看到裸 JSON。
   *
   * ⚠️ 两条剥离**不是二选一**（用户 2026-10-13 实测的裸 JSON 就是这么漏出来的）：
   * 同一条回复完全可能既有 `chapter_discuss` 协议块、又有 `eventOutlineData` 围栏 ——
   * 共创判「前文不足以推演」时，模型经常顺手把整章事件细纲也一起给了出来。
   * 原先写成互斥三元（有协议只剥协议、没有协议才剥围栏），恰好把**这一种**回复漏在
   * 两个分支之外：协议块被剥掉了，围栏里的裸 JSON 原样留在气泡里。
   * 两件事各管各的，按顺序各做一遍即可，单协议/单细纲的老路径行为完全不变。
   */
  const displayContent = useMemo(() => {
    let text = message.content;
    if (message.chapterDiscussPhase || message.chapterDiscussProtocol || message.chapterDiscussError) {
      text = stripStructuredMarkers(text);
    }
    if (eventOutline) text = stripEventOutlineDataFence(text);
    return text;
  }, [
    message.content,
    message.chapterDiscussPhase,
    message.chapterDiscussProtocol,
    message.chapterDiscussError,
    eventOutline,
  ]);
  /**
   * 共创判「前文不足以推演」、而这条回复**同时**给了一份可用的事件细纲 —— 2026-10-13
   * 起不再单独渲染那张琥珀卡，改成把原因与三枚动作并进细纲卡片（用户要求）。
   *
   * 只有这一种组合才合并：`needs_choice`（真给了多向方向）与「没有细纲的 insufficient」
   * 都照旧走 ChapterDiscussCard —— 那两种场合没有细纲卡可以承载这些按钮，
   * 硬合并会把卡片连同方向候选一起弄丢。
   */
  const insufficientDiscuss = message.chapterDiscussProtocol?.status === "insufficient"
    ? message.chapterDiscussProtocol
    : null;
  const mergeDiscussIntoOutlineCard = Boolean(eventOutline && insufficientDiscuss);
  const canResumeUnfinished = Boolean(
    novelMode &&
    isLastAssistant &&
    onContinueUnfinished &&
    canContinueUnfinishedDeepChapter(message.content),
  );
  /**
   * 上一条回复是被用户手动停止的（正文结尾带着「已停止生成。」这类收尾提示）。
   *
   * 只在**最后一条**助手消息、且这一轮已经跑完（isAgentRunning 转假）时成立：
   * 流式当中正文里还没有收尾提示，历史消息里的停止提示也不该再长出按钮 ——
   * 那两个按钮是给"刚刚停下、马上要决定下一步"这一刻用的。
   *
   * 这里刻意**不看** novelMode：停止是用户在面板上亲手按的，按钮该不该出现
   * 只取决于"上一轮是不是被停止过"，跟项目是不是小说模式没有关系。
   * （旁边的 canResumeUnfinished 需要 novelMode，因为它专指深度章节生成。）
   */
  const isStoppedGeneration = Boolean(
    isLastAssistant &&
    !message.isAgentRunning &&
    isStoppedGenerationMessage(message.content),
  );
  const currentContextHubSnapshot = message.contextHubSnapshot
    ? parseContextHubSnapshotRef(message.contextHubSnapshot)
    : null;

  // 仅对最后一条流式助手消息提取 thinking，避免历史消息重复提取
  const isLastStreamingAssistant = isLastAssistant && isAssistant;
  const { thinking: extractedThinking } = useMemo(
    () =>
      isLastStreamingAssistant
        ? separateThinking(message.content)
        : { thinking: null, answer: message.content },
    [message.content, isLastStreamingAssistant],
  );
  const thinkingStreaming = isLastStreamingAssistant && !!message.isAgentRunning;

  return (
    <div
      className={`flex w-full min-w-0 gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isSystem
            ? "bg-accent text-accent-foreground"
            : isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`${isUser ? "w-fit max-w-full lg:max-w-[50vw]" : "min-w-0 flex-1 max-w-full"} flex flex-col gap-1.5`}>
        <div
          className={`w-full min-w-0 rounded-lg px-3 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : message.discarded
                ? "bg-muted/50 text-muted-foreground/50"
                : "border bg-background text-foreground"
          }`}
        >
          {message.discarded ? (
            <span className="italic text-xs opacity-60">已废弃</span>
          ) : isUser ? (
            <>
              <p dir="auto" className="whitespace-pre-wrap break-words">
                {message.content}
              </p>
              {message.attachedReferences &&
                message.attachedReferences.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {message.attachedReferences.map((token) => (
                      <ReferenceChip key={token.id} token={token} readonly />
                    ))}
                  </div>
                )}
            </>
          ) : (
            <>
              {message.agentStages && message.agentStages.length > 0 ? (
                <AgentStageStream stages={message.agentStages} />
              ) : null}
              {message.agentToolCalls && message.agentToolCalls.length > 0 ? (
                <AgentToolCallMessage
                  toolCalls={message.agentToolCalls}
                  contextTrace={message.contextTrace}
                  thinkingContent={extractedThinking ?? undefined}
                  thinkingStreaming={thinkingStreaming}
                  onConfirmSave={onConfirmToolSave}
                  onReject={onRejectTool}
                />
              ) : null}
              {!message.isAgentRunning || message.content ? (
                <AgentAwareContent
                  content={displayContent}
                  projectPath={projectPath}
                />
              ) : null}
              {/* 等待文案挂在正文之后：整段生成期间始终显示在最下面，
                  生成结束（isAgentRunning 转假）时随指示器一起消失。 */}
              {message.isAgentRunning ? <AgentThinkingIndicator /> : null}
            </>
          )}
        </div>
        {/*
          * 事件细纲卡片挂在助手气泡**下方**（不是气泡内）。
          *
          * 与大纲助手（outline-chat-panel）里那张卡片是同一个组件、同一个交接回调，
          * 差别只在宿主：用户要求「点章节工具栏的生成按钮后，内容发进 AI 对话、
          * 生成结果在 AI 对话框里显示」，于是写作助手这一侧也要能认出细纲并渲染它。
          *
          * 只渲染只读视图：卡片上报的手改 / 重新生成 / 丢弃三枚入口在这里都不接线
          * （各自的回调不传即不渲染），因为本面板没有承载细纲任务状态的地方 ——
          * 接了线就会长出一枚点了没反应的按钮，比没有更糟。要手改就再让 AI 出一份。
          */}
        {isAssistant && !message.discarded && eventOutline ? (
          <EventOutlineCard
            data={eventOutline}
            onWriteChapter={handoffEventOutlineToProse}
            /*
             * 下面三枚只在「共创判前文不足 + 这条回复给了细纲」时接线：其余场合
             * 卡片保持原样（只读、只有「用这份细纲写这一章」），不会凭空多出按钮。
             */
            discussNote={mergeDiscussIntoOutlineCard ? insufficientDiscuss?.judgment : undefined}
            onDiscussRegenerate={
              mergeDiscussIntoOutlineCard && onRegenerateChapterDiscuss
                ? () => onRegenerateChapterDiscuss(message.id, message.chapterDiscussProtocol!)
                : undefined
            }
            onDiscussCustomIdea={
              mergeDiscussIntoOutlineCard && onCustomChapterDiscuss
                ? (idea) => onCustomChapterDiscuss(message.id, message.chapterDiscussProtocol!, idea)
                : undefined
            }
          />
        ) : null}
        {/*
          * 停止生成之后的补救动作，紧贴在「已停止生成」那句提示的下方。
          * 停止按钮是这个应用里唯一「先停下 → 换个模型 → 再来一次」的入口，
          * 所以停下之后必须当场给出「重试」和「继续」。判定与文案都在
          * lib/novel/stopped-generation.ts 与 novel/stopped-generation-actions 里，
          * 大纲面板用的是同一套，两个面板不会长得不一样。
          */}
        {isAssistant && !message.discarded && isStoppedGeneration ? (
          <StoppedGenerationActions
            className="mt-1"
            onRetry={onRegenerate}
            onContinue={onContinueStopped}
          />
        ) : null}
        {isUser && !message.discarded ? <UserMessageMeta content={message.content} timestamp={message.timestamp} /> : null}
        {isAssistant && !message.discarded && (
          <CitedReferencesPanel
            content={message.content}
            savedReferences={message.references}
          />
        )}
        {/*
          共创方向卡。`!mergeDiscussIntoOutlineCard` 是 2026-10-13 加的那一条：
          「判了前文不足、却又给了整章细纲」时，这张卡整张退场 —— 它的两枚按钮
          （换一批 / 其他想法）已经并入上方细纲卡片，原因也搬了过去。留着的话
          屏幕上就是两张卡 + 两枚「换一批」，用户得先猜按哪个（这正是用户反馈的
          「单独出现」）。其余场合（needs_choice、没有细纲的 insufficient）照旧由
          本卡承载，一个分支都没少。
        */}
        {isAssistant && !message.discarded && !message.isAgentRunning && message.chapterDiscussProtocol && !mergeDiscussIntoOutlineCard ? (
          <ChapterDiscussCard
            protocol={message.chapterDiscussProtocol}
            decided={message.chapterDiscussDecision}
            onSelect={(direction) =>
              onSelectChapterDiscussDirection?.(
                message.id,
                message.chapterDiscussProtocol as ChapterDiscussProtocol,
                direction,
              )
            }
            onRegenerate={() =>
              onRegenerateChapterDiscuss?.(
                message.id,
                message.chapterDiscussProtocol as ChapterDiscussProtocol,
              )
            }
            onCustom={(idea) =>
              onCustomChapterDiscuss?.(
                message.id,
                message.chapterDiscussProtocol as ChapterDiscussProtocol,
                idea,
              )
            }
            disabled={!onSelectChapterDiscussDirection}
            disabledReason="请在生成结束或打开项目后重试。"
          />
        ) : null}
        {isAssistant && !message.discarded && message.chapterDiscussError ? (
          <div className="mt-2 rounded-md border border-red-500/30 bg-red-50/40 px-2 py-1.5 text-[0.6875rem] leading-5 text-red-700 dark:bg-red-950/20 dark:text-red-300">
            章节共创协议格式无效，尚未开始生成：{message.chapterDiscussError}
          </div>
        ) : null}
        {isAssistant && !message.discarded && (
          <div className="flex w-full items-center gap-1 flex-wrap">
            {canResumeUnfinished && (
              <div className="basis-full rounded-md border border-amber-500/30 bg-amber-50/60 px-2 py-1.5 text-[0.6875rem] leading-5 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                这次深度生成已经完成了部分思考过程。点击“继续未完成”会基于上方已有阶段继续往后生成，通常比“重新生成”更节省 token；如果前面的思考方向本身不对，再使用“重新生成”。
              </div>
            )}
            {novelMode && isLastAssistant && onSaveAsChapter && (
              <button
                type="button"
                onClick={() =>
                  onSaveAsChapter(message.id, message.content, message.agentToolCalls)
                }
                disabled={isSaving}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-50"
                title={isSaving ? "保存中" : "保存到章节库"}
                aria-label={isSaving ? "保存中" : "保存到章节库"}
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            )}
            {novelMode && isLastAssistant && onContinueNextChapter && (
              <button
                type="button"
                onClick={onContinueNextChapter}
                disabled={isSaving}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-50"
                title="继续生成下一章"
                aria-label="继续生成下一章"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {canResumeUnfinished && (
              <button
                type="button"
                onClick={onContinueUnfinished}
                disabled={isSaving}
                className="rounded border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-[0.6875rem] text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/35"
                title="基于已有思考过程继续生成，减少重复消耗"
              >
                继续未完成
              </button>
            )}
            {(hovered || (novelMode && isLastAssistant)) && (
              <CopyButton
                content={displayContent}
                toolCalls={message.agentToolCalls}
              />
            )}
            {/*
              * 停止生成的消息不再单出一枚「重新生成」：它和上方那对
              * 「重试」是同一个动作，并排出现只会让人猜哪个才是"换模型重来"。
              * 重试按钮已经承担了这件事。
              */}
            {isLastAssistant && onRegenerate && !isStoppedGeneration && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent transition-colors"
                title="重新生成"
                aria-label="重新生成"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {!message.isAgentRunning ? (
              <div className="ml-auto"><UiTestGenerationStats stats={currentContextHubSnapshot?.stats} timing={message.generationTiming} /></div>
            ) : currentContextHubSnapshot ? (
              <div className="ml-auto"><ContextHubDetails reference={currentContextHubSnapshot} timing={message.generationTiming} /></div>
            ) : null}
          </div>
        )}
        {false && isAssistant &&
          !message.discarded &&
          !message.isAgentRunning &&
          contextTraceExpanded &&
          (message.contextTrace || currentContextHubSnapshot) && (
            <div className="mt-1">
              {message.contextTrace ? (
                <ContextTracePanel
                  trace={message.contextTrace ?? null}
                  contextHubSnapshot={currentContextHubSnapshot ?? undefined}
                  generationTiming={message.generationTiming}
                  projectPath={projectPath}
                  onRebuildRetrievalIndex={onRebuildRetrievalIndex}
                  retrievalIndexHasIndex={retrievalIndexHasIndex}
                  isRebuildingRetrievalIndex={isRebuildingRetrievalIndex}
                  lastRebuildResult={lastRebuildRetrievalResult}
                />
              ) : currentContextHubSnapshot ? (
                <ContextHubDetails
                  reference={currentContextHubSnapshot!}
                  timing={message.generationTiming}
                />
              ) : null}
            </div>
          )}
        {isLastAssistant && saveStatus && (
          <p className="mt-1 text-xs text-muted-foreground">{saveStatus}</p>
        )}
      </div>
    </div>
  );
}

function CopyButton({
  content,
  toolCalls,
}: {
  content: string;
  toolCalls?: ToolCallRecord[];
}) {
  const [copied, setCopied] = useState(false);
  const copyable = useMemo(
    () => getCopyableAssistantContent(content, { toolCalls }),
    [content, toolCalls],
  );
  const hasRecoveredChapterBody =
    Boolean(copyable) &&
    (/^出错：/.test(content.trim()) || content.includes("\n\n出错："));

  const handleCopy = useCallback(async () => {
    if (!copyable) return;
    await navigator.clipboard.writeText(copyable);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyable]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!copyable}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40"
      aria-label={copied ? "已复制" : "复制"}
      title={
        hasRecoveredChapterBody
          ? "复制已完成的章节正文（不含错误信息）"
          : "复制到剪贴板"
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

interface CitedPage {
  title: string;
  path: string;
}

const REF_TYPE_CONFIG: Record<
  string,
  { icon: typeof FileText; color: string }
> = {
  entity: { icon: Users, color: "text-blue-500" },
  concept: { icon: Lightbulb, color: "text-purple-500" },
  source: { icon: BookOpen, color: "text-orange-500" },
  query: { icon: HelpCircle, color: "text-green-500" },
  synthesis: { icon: GitMerge, color: "text-red-500" },
  comparison: { icon: BarChart3, color: "text-teal-500" },
  overview: { icon: Layout, color: "text-yellow-500" },
  clip: { icon: Globe, color: "text-blue-400" },
};

function getRefType(path: string): string {
  if (path.includes("/entities/")) return "entity";
  if (path.includes("/concepts/")) return "concept";
  if (path.includes("/sources/")) return "source";
  if (path.includes("/queries/")) return "query";
  if (path.includes("/synthesis/")) return "synthesis";
  if (path.includes("/comparisons/")) return "comparison";
  if (path.includes("overview")) return "overview";
  if (path.includes("raw/sources/")) return "clip";
  return "source";
}

/**
 * Markdown image-reference regex used to count `![](url)` occurrences
 * in cited pages AND extract the first URL (so the image-badge
 * jump button knows where to send the user). Same shape as the
 * search/pipeline regex elsewhere (kept duplicated to avoid
 * coupling — this module never wants to pull caption-pipeline
 * imports for a 3-character count).
 *
 * Group 1 captures the URL (everything inside `(...)` of the
 * markdown image syntax, no whitespace).
 */
const CITED_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

interface CitedImageInfo {
  count: number;
  /** First image URL on the page — used as the scroll target when
   *  the badge button opens the raw source. Null when count===0. */
  firstUrl: string | null;
}

function CitedReferencesPanel({
  content,
  savedReferences,
}: {
  content: string;
  savedReferences?: CitedPage[];
}) {
  const project = useWikiStore((s) => s.project);
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile);
  const setFileContent = useWikiStore((s) => s.setFileContent);
  const setPendingScrollImageSrc = useWikiStore(
    (s) => s.setPendingScrollImageSrc,
  );
  const [expanded, setExpanded] = useState(false);
  /**
   * Per-cited-page image info: count + first image URL. We can't
   * hang this off `CitedPage` directly because `extractCitedPages`
   * is sync and works on the AI's text response, never seeing the
   * underlying page. So we fetch the page contents lazily here.
   * Same path → same info, so a tiny in-component map keyed by
   * path is plenty.
   */
  const [imageInfos, setImageInfos] = useState<Record<string, CitedImageInfo>>(
    {},
  );

  // Use saved references first (persisted with message), fall back to dynamic extraction
  const citedPages = useMemo(() => {
    if (savedReferences && savedReferences.length > 0) return savedReferences;
    return extractCitedPages(content);
  }, [content, savedReferences]);

  // Async-fetch each cited page's content once and extract image
  // info: count + first URL. Done in parallel; failures are
  // silently treated as { count: 0, firstUrl: null } (page may
  // not exist on disk yet, e.g. a citation the LLM hallucinated).
  useEffect(() => {
    if (!project || citedPages.length === 0) return;
    const pp = normalizePath(project.path);
    let cancelled = false;
    Promise.all(
      citedPages.map(async (page) => {
        // Same resolver the click-handler uses — nested outlines and
        // wiki/QM aliases stay consistent across the panel.
        const resolved = await resolveCitedPagePath(pp, page.path);
        if (!resolved) return [page.path, { count: 0, firstUrl: null }] as const;
        try {
          const text = await readFile(resolved);
          // Reset stateful regex.lastIndex by `new RegExp(...)` —
          // module-level `g` regexes carry state across calls
          // and would skip matches on the second invocation.
          const re = new RegExp(CITED_IMAGE_RE.source, CITED_IMAGE_RE.flags);
          const matches = [...text.matchAll(re)];
          const info: CitedImageInfo = {
            count: matches.length,
            firstUrl: matches.length > 0 ? matches[0][1] : null,
          };
          return [page.path, info] as const;
        } catch {
          return [page.path, { count: 0, firstUrl: null }] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, CitedImageInfo> = {};
      for (const [path, info] of entries) next[path] = info;
      setImageInfos(next);
    });
    return () => {
      cancelled = true;
    };
  }, [project, citedPages]);

  /**
   * Open the raw source file for a page's first image and stage a
   * scroll target so the markdown preview lands on that image.
   * Mirrors the lightbox "Jump to source document" path in
   * search-view — same `findRawSourceForImage` resolver, same
   * `pendingScrollImageSrc` store handoff, same fallback to
   * opening the wiki page when no raw source is found.
   */
  const handleJumpToImageSource = useCallback(
    async (firstUrl: string, fallbackPath: string) => {
      if (!project) return;
      const pp = normalizePath(project.path);
      const rawPath = await findRawSourceForImage(firstUrl, pp);
      if (rawPath) {
        try {
          const content = await readFile(rawPath);
          setPendingScrollImageSrc(imageUrlToAbsolute(firstUrl, pp));
          setSelectedFile(rawPath);
          setFileContent(content);
          console.log(`[refs:image-jump] ${firstUrl} → raw source ${rawPath}`);
          return;
        } catch (err) {
          console.warn(`[refs:image-jump] failed to read ${rawPath}:`, err);
        }
      }
      // Fallback: open the wiki summary itself with same scroll
      // target — at least the safety-net section will scroll into
      // view there.
      try {
        const content = await readFile(`${pp}/${fallbackPath}`);
        setPendingScrollImageSrc(firstUrl);
        setSelectedFile(`${pp}/${fallbackPath}`);
        setFileContent(content);
      } catch (err) {
        console.warn(`[refs:image-jump] fallback also failed:`, err);
      }
    },
    [project, setPendingScrollImageSrc, setSelectedFile, setFileContent],
  );

  if (citedPages.length === 0) return null;

  const MAX_COLLAPSED = 3;
  const visiblePages = expanded
    ? citedPages
    : citedPages.slice(0, MAX_COLLAPSED);
  const hasMore = citedPages.length > MAX_COLLAPSED;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs mb-1">
      <button
        type="button"
        onClick={() => hasMore && setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-medium">引用资料（{citedPages.length}）</span>
        {hasMore &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 ml-auto" />
          ) : (
            <ChevronRight className="h-3 w-3 ml-auto" />
          ))}
      </button>
      <div className="px-2 pb-1.5">
        {visiblePages.map((page, i) => {
          const refType = getRefType(page.path);
          const config = REF_TYPE_CONFIG[refType] ?? REF_TYPE_CONFIG.source;
          const Icon = config.icon;
          const info = imageInfos[page.path];
          const hasImages = (info?.count ?? 0) > 0;
          const openCitedPage = async () => {
            if (!project) return;
            const pp = normalizePath(project.path);
            const resolved = await resolveCitedPagePath(pp, page.path);
            if (resolved) {
              setSelectedFile(resolved);
              return;
            }
            // Do not fall back to invented shallow paths like
            // wiki/chapters/第40章.md — they are usually wrong and only
            // produce "No such file". Folder citations (章纲/卷纲) stay closed.
          };
          return (
            // Outer is a div, NOT a button — we have two click
            // targets inside (image badge + main row) and nesting
            // a button inside a button is invalid HTML and breaks
            // event delegation. Hover effect shifts to the inner
            // buttons individually so each gives feedback.
            <div
              key={page.path}
              className="flex w-full items-center gap-1.5 rounded text-left"
              title={page.path}
            >
              <span className="text-[0.625rem] text-muted-foreground/60 w-4 shrink-0 text-right">
                [{i + 1}]
              </span>
              {/*
               * Image badge — clickable, separately from the page
               * row. Click → resolve the FIRST image's raw source
               * (`raw/sources/<slug>.<ext>`) and open the FULL
               * combined-extraction preview, scrolled to that
               * image. This mirrors the search-view lightbox
               * "Jump to source document" behavior so the two
               * surfaces feel consistent.
               *
               * Icon: lucide `Image` (picture-frame outline with
               * mountain + sun) — direct visual cue for "image",
               * NOT `Camera` which reads as "take a photo".
               */}
              {hasImages && info?.firstUrl && (
                <button
                  type="button"
                  onClick={() =>
                    handleJumpToImageSource(info.firstUrl!, page.path)
                  }
                  className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[0.625rem] text-blue-600 hover:bg-blue-100/40 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                  title={`打开第一张图片所在原始文档（本页共 ${info.count} 张图片）`}
                >
                  <ImageIcon className="h-3 w-3" />
                  {info.count}
                </button>
              )}
              <button
                type="button"
                onClick={openCitedPage}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/50 transition-colors"
              >
                <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
                <span className="truncate text-foreground/80">
                  {page.title}
                </span>
              </button>
            </div>
          );
        })}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-center text-[0.625rem] text-muted-foreground hover:text-primary pt-0.5"
          >
            +{citedPages.length - MAX_COLLAPSED} 条更多引用...
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Extract cited wiki pages from the hidden <!-- cited: 1, 3, 5 --> comment.
 * Maps page numbers back to the pages that were sent to the LLM.
 */
function extractCitedPages(text: string): CitedPage[] {
  const lastQueryPages = getLastQueryPages();
  const citedMatch = text.match(/<!--\s*cited:\s*(.+?)\s*-->/);
  if (citedMatch && lastQueryPages.length > 0) {
    const numbers = citedMatch[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= lastQueryPages.length);

    const pages = numbers.map((n) => lastQueryPages[n - 1]);
    if (pages.length > 0) return pages;
  }

  // Fallback: if LLM used [1], [2] notation in text, try to match those
  if (lastQueryPages.length > 0) {
    const numberRefs = text.match(/\[(\d+)\]/g);
    if (numberRefs) {
      const numbers = [
        ...new Set(numberRefs.map((r) => parseInt(r.slice(1, -1), 10))),
      ].filter((n) => n >= 1 && n <= lastQueryPages.length);
      if (numbers.length > 0) {
        return numbers.map((n) => lastQueryPages[n - 1]);
      }
    }
  }

  // Fallback for persisted messages: extract [[wikilinks]] from the text
  // Try to resolve each wikilink to a real file path by checking common wiki subdirectories
  const wikilinks = text.match(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g);
  if (wikilinks) {
    const seen = new Set<string>();
    const pages: CitedPage[] = [];
    const WIKI_DIRS = [
      "entities",
      "concepts",
      "sources",
      "queries",
      "synthesis",
      "comparisons",
    ];

    for (const link of wikilinks) {
      const nameMatch = link.match(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/);
      if (nameMatch) {
        const id = nameMatch[1].trim();
        const display = nameMatch[2]?.trim() || id;

        // Skip if id contains path separators (already a path like queries/xxx)
        if (seen.has(id)) continue;
        seen.add(id);

        // Try to find the file in known wiki subdirectories
        let resolvedPath = "";
        if (id.includes("/")) {
          // Already has directory like "queries/my-query"
          resolvedPath = `wiki/${id}.md`;
        } else {
          // Search in common directories
          for (const dir of WIKI_DIRS) {
            resolvedPath = `wiki/${dir}/${id}.md`;
            // We can't do async file checking here, so try all known patterns
            // The click handler will try multiple paths
            break; // Use first candidate, click handler resolves the rest
          }
          if (!resolvedPath) resolvedPath = `wiki/${id}.md`;
        }

        pages.push({ title: display, path: resolvedPath });
      }
    }
    if (pages.length > 0) return pages;
  }

  // No citations found
  return [];
}

interface StreamingMessageProps {
  content: string;
  isStreaming?: boolean;
}

export function StreamingMessage({ content, isStreaming = true }: StreamingMessageProps) {
  const { thinking, answer } = useMemo(
    () => separateThinking(content),
    [content],
  );
  const isThinking = thinking !== null && answer.length === 0;

  return (
    <div className="flex w-full min-w-0 gap-2 flex-row">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 max-w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground">
        {isThinking ? (
          <StreamingWorkflowBlock content={thinking} />
        ) : (
          <>
            {thinking && <WorkflowBlock content={thinking} />}
            <StreamingMarkdown
              content={answer}
              isStreaming={isStreaming}
              renderCommitted={(text) => <MarkdownContent content={text} />}
            />
          </>
        )}
      </div>
    </div>
  );
}

function AgentThinkingIndicator() {
  const hint = useWaitingHint(true);
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{hint ?? "正在生成中..."}</span>
    </div>
  );
}

function AgentAwareContent({
  content,
  projectPath,
}: {
  content: string;
  projectPath?: string | null;
}) {
  const [applied, setApplied] = useState(false);
  const [results, setResults] = useState<
    import("@/lib/novel/agent-tools").FileEditResult[]
  >([]);
  const [dismissed, setDismissed] = useState(false);

  const [parsed, setParsed] = useState<
    import("@/lib/novel/agent-parser").ParsedAgentResponse | null
  >(null);
  useEffect(() => {
    import("@/lib/novel/agent-parser").then(({ parseAgentResponse }) => {
      setParsed(parseAgentResponse(content));
    });
  }, [content]);

  const handleApply = useCallback(
    async (edits: import("@/lib/novel/agent-parser").FileEditAction[]) => {
      if (!projectPath) return [];
      const { applyFileEdits } = await import("@/lib/novel/agent-tools");
      const editResults = await applyFileEdits(projectPath, edits);
      setResults(editResults);
      setApplied(true);
      // Refresh file tree
      await refreshProjectState(projectPath);
      return editResults;
    },
    [projectPath],
  );

  return (
    <>
      <MarkdownContent content={parsed?.textContent || content} />
      {parsed?.hasEdits && !dismissed && projectPath ? (
        <FileEditPreview
          edits={parsed.edits}
          onApply={handleApply}
          onDismiss={() => setDismissed(true)}
          applied={applied}
          results={results}
        />
      ) : null}
    </>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // Strip hidden comments
  const cleaned = content.replace(/<!--.*?-->/gs, "").trimEnd();

  // Project path for resolving wiki-relative image src in chat
  // replies (LLM may surface images that came in via retrieved
  // chunks, e.g. when the chat answer cites a diagram from a wiki
  // page). Same convention the file-preview uses.
  const projectPath = useWikiStore((s) => s.project?.path ?? null);

  // Separate thinking blocks from main content, filter LLM English thinking but keep workflow stages
  const { thinking, answer } = useMemo(
    () => separateThinking(cleaned),
    [cleaned],
  );
  const processed = useMemo(() => processContent(answer), [answer]);
  const renderLanguage = useMemo(() => detectLanguage(answer), [answer]);
  const direction = getTextDirection(renderLanguage);
  const htmlLang = getHtmlLang(renderLanguage);

  return (
    <div className="w-full min-w-0">
      {thinking && <WorkflowBlock content={thinking} />}
      <div
        className="chat-markdown prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none"
        dir={direction}
        lang={htmlLang}
        style={{ textAlign: "start" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("wikilink:")) {
                const pageName = href.slice("wikilink:".length);
                return <WikiLink pageName={pageName}>{children}</WikiLink>;
              }
              return (
                <span
                  className="text-primary underline cursor-default"
                  title={href}
                >
                  {children}
                </span>
              );
            },
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
          {processed}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * 检测一行是否是工作流阶段标题
 */
function isWorkflowStageHeader(line: string): boolean {
  const trimmed = line.trim();
  // 匹配 ## 阶段X... 格式
  if (/^##\s*阶段/.test(trimmed)) return true;
  // 匹配 "阶段X：" 或 "阶段X:" 开头的行（即使没有##）
  if (/^阶段\s*[\d.]+\s*[：:]/.test(trimmed)) return true;
  return false;
}

function countWorkflowStages(content: string): number {
  return content.split("\n").filter((line) => isWorkflowStageHeader(line)).length
}

function getThinkingBlockMeta(content: string, streaming: boolean): { title: string; stageCount: number | null } {
  const stageCount = countWorkflowStages(content)
  if (stageCount > 0) {
    return {
      title: streaming ? "工作流进行中..." : "工作流阶段",
      stageCount,
    }
  }
  return {
    title: streaming ? "思考中..." : "思考过程",
    stageCount: null,
  }
}

/** 模型 reasoning 流式输出常带大量换行；合并为连续文本，避免被误切成上百个“阶段”。 */
function formatThinkingForDisplay(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ""

  if (countWorkflowStages(trimmed) > 0) {
    return trimmed.replace(/\n{3,}/g, "\n\n")
  }

  return trimmed.replace(/\s*\n+\s*/g, "")
}

/** Streaming workflow: show stages as they come in so user can see progress. */
function StreamingWorkflowBlock({ content }: { content: string }) {
  const displayContent = useMemo(() => formatThinkingForDisplay(content), [content])
  const { title } = useMemo(() => getThinkingBlockMeta(content, true), [content])
  const display = useMemo(
    () => getStreamingTailDisplay(displayContent, true),
    [displayContent],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const scrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container || userScrolledUpRef.current) return
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      if (!scrollRef.current || userScrolledUpRef.current) return
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      lastScrollTopRef.current = scrollRef.current.scrollTop
    })
    return () => {
      if (scrollFrameRef.current != null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [display.text])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    lastScrollTopRef.current = container.scrollTop
    const handleScroll = () => {
      const threshold = 40
      const currentScrollTop = container.scrollTop
      const atBottom = container.scrollHeight - currentScrollTop - container.clientHeight < threshold
      if (currentScrollTop < lastScrollTopRef.current - 1) {
        userScrolledUpRef.current = true
      } else if (atBottom) {
        userScrolledUpRef.current = false
      }
      lastScrollTopRef.current = currentScrollTop
    }
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <div className="w-full min-w-0 rounded-md border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-2 min-h-[3rem]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm animate-pulse">📋</span>
        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">{title}</span>
      </div>
      <div
        ref={scrollRef}
        className="w-full min-w-0 max-h-72 overflow-y-auto overflow-x-hidden pr-1 text-xs text-blue-800/70 dark:text-blue-300/60 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] [contain:content]"
      >
        {display.truncated ? (
          <div className="mb-1 text-[0.6875rem] text-blue-700/60 dark:text-blue-400/60">…上文已省略</div>
        ) : null}
        {display.text}
        <span className="text-blue-500"><StreamingSpinner /></span>
      </div>
    </div>
  );
}

/** Completed workflow stages: keep visible so user can review what happened. */
function WorkflowBlock({ content }: { content: string }) {
  const displayContent = useMemo(() => formatThinkingForDisplay(content), [content])
  const { title, stageCount } = useMemo(() => getThinkingBlockMeta(content, false), [content])

  return (
    <div className="mb-2 w-full min-w-0 rounded-md border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 min-h-[3rem]">
      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-blue-700 dark:text-blue-400">
        <span className="text-sm">📋</span>
        <span className="font-medium">{title}</span>
        {stageCount !== null && (
          <span className="text-[0.625rem] text-blue-600/60 dark:text-blue-500/60">{stageCount} 个阶段</span>
        )}
      </div>
      <div className="w-full min-w-0 max-h-72 overflow-y-auto overflow-x-hidden border-t border-blue-500/20 px-2.5 py-2 pr-1 text-xs text-blue-800/80 dark:text-blue-300/70 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] [contain:content]">
        {displayContent}
      </div>
    </div>
  );
}

/**
 * Process content to create clickable links:
 * - [[wikilinks]] → markdown links with wikilink: protocol
 */
function processContent(text: string): string {
  let result = text;

  // Wrap bare \begin{...}...\end{...} blocks with $$ for remark-math
  result = result.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  );

  // Only apply Unicode conversion to text outside of math delimiters
  // Split on $$...$$ and $...$ blocks, only convert non-math parts
  const parts = result.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  result = parts
    .map((part) => {
      if (part.startsWith("$")) return part; // preserve math
      return convertLatexToUnicode(part);
    })
    .join("");

  // Fix malformed wikilinks like [[name] (missing closing bracket)
  result = result.replace(/\[\[([^\]]+)\](?!\])/g, "[[$1]]");

  // Convert [[wikilinks]] to markdown links
  result = result.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, pageName: string, displayText?: string) => {
      const display = displayText?.trim() || pageName.trim();
      return `[${display}](wikilink:${pageName.trim()})`;
    },
  );

  return result;
}

function WikiLink({
  pageName,
  children,
}: {
  pageName: string;
  children: React.ReactNode;
}) {
  const project = useWikiStore((s) => s.project);
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile);
  const setFileContent = useWikiStore((s) => s.setFileContent);
  const setActiveView = useWikiStore((s) => s.setActiveView);
  const [exists, setExists] = useState<boolean | null>(null);
  const resolvedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;
    const pp = normalizePath(project.path);
    const candidates = [
      `${pp}/wiki/entities/${pageName}.md`,
      `${pp}/wiki/concepts/${pageName}.md`,
      `${pp}/wiki/sources/${pageName}.md`,
      `${pp}/wiki/queries/${pageName}.md`,
      `${pp}/wiki/comparisons/${pageName}.md`,
      `${pp}/wiki/synthesis/${pageName}.md`,
      `${pp}/wiki/${pageName}.md`,
    ];

    let cancelled = false;
    async function check() {
      for (const path of candidates) {
        try {
          await readFile(path);
          if (!cancelled) {
            resolvedPath.current = path;
            setExists(true);
          }
          return;
        } catch {
          // try next
        }
      }
      if (!cancelled) setExists(false);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [project, pageName]);

  const handleClick = useCallback(async () => {
    if (!resolvedPath.current) return;
    try {
      const content = await readFile(resolvedPath.current);
      setSelectedFile(resolvedPath.current);
      setFileContent(content);
      setActiveView("wiki");
    } catch {
      // ignore
    }
  }, [setSelectedFile, setFileContent, setActiveView]);

  if (exists === false) {
    return (
      <span
        className="inline text-muted-foreground"
        title={`Page not found: ${pageName}`}
      >
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-primary underline decoration-primary/30 hover:bg-primary/10 hover:decoration-primary"
      title={`Open wiki page: ${pageName}`}
    >
      <FileText className="inline h-3 w-3" />
      {children}
    </button>
  );
}
