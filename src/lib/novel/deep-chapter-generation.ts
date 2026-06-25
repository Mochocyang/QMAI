import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat, type ChatMessage, type RequestOverrides, type StreamCallbacks } from "@/lib/llm-client"
import { useWikiStore } from "@/stores/wiki-store"
import { buildContextPack, contextPackToPrompt, type ContextPack } from "./context-engine"
import { reviewChapter, type NovelReviewResult } from "./review-adapter"
import type { TaskRouteResult } from "./task-router"
import type { GoldenThreeChapterRequest } from "./golden-three-chapters"
import {
  resolveChapterLengthSpec,
  type ChapterLengthSpec,
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterExpansionPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
  buildStableContextPrefix,
} from "./deep-chapter-prompts"

export interface DeepChapterGenerationInput {
  projectPath: string
  userRequest: string
  chapterNumber?: number
  goldenThreeChapter?: GoldenThreeChapterRequest
  dismantlingReferenceDirective?: string
  llmConfig: LlmConfig
  resumeCheckpoint?: DeepChapterGenerationResumeCheckpoint
}

export interface DeepChapterGenerationCallbacks {
  onThinking?: (content: string) => void
  onFinalContent?: (content: string) => void
  onCheckpoint?: (checkpoint: DeepChapterGenerationResumeCheckpoint) => void
}

export interface DeepChapterGenerationResult {
  finalContent: string
  taskBrief: string
  draftContent: string
  reviewResults: NovelReviewResult[]
  revised: boolean
}

export type DeepChapterGenerationResumeStage =
  | "after_context"
  | "after_task_brief"
  | "after_draft"
  | "after_review"
  | "after_revision"

export interface DeepChapterGenerationResumeCheckpoint {
  version: 1
  originalRequest: string
  chapterNumber?: number
  stage: DeepChapterGenerationResumeStage
  taskBrief?: string
  draftContent?: string
  reviewResults?: NovelReviewResult[]
  currentContent?: string
}

export interface DeepChapterGenerationDeps {
  buildContextPack: typeof buildContextPack
  contextPackToPrompt: typeof contextPackToPrompt
  reviewChapter: typeof reviewChapter
  streamChat: (
    config: LlmConfig,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    requestOverrides?: RequestOverrides,
  ) => Promise<void>
}

const defaultDeps: DeepChapterGenerationDeps = {
  buildContextPack,
  contextPackToPrompt,
  reviewChapter,
  streamChat,
}

const REPEAT_CHECK_MIN_CHARS = 600
const REPEAT_WINDOW_CHARS = 120
const REPEAT_HIT_LIMIT = 3
const USER_ABORT_MESSAGE = "已停止生成"

export function shouldUseDeepChapterGeneration(_route: TaskRouteResult | null, enabled: boolean): boolean {
  return enabled
}

function createResumeCheckpoint(
  input: DeepChapterGenerationInput,
  stage: DeepChapterGenerationResumeStage,
  data: Partial<DeepChapterGenerationResumeCheckpoint> = {},
): DeepChapterGenerationResumeCheckpoint {
  const originalRequest = input.resumeCheckpoint?.originalRequest?.trim() || input.userRequest.trim()
  return {
    version: 1,
    originalRequest,
    chapterNumber: input.resumeCheckpoint?.chapterNumber ?? input.chapterNumber,
    stage,
    ...data,
  }
}

function checkpointStageAtLeast(
  checkpoint: DeepChapterGenerationResumeCheckpoint | null | undefined,
  target: DeepChapterGenerationResumeStage,
): boolean {
  if (!checkpoint) return false
  const order: DeepChapterGenerationResumeStage[] = [
    "after_context",
    "after_task_brief",
    "after_draft",
    "after_review",
    "after_revision",
  ]
  return order.indexOf(checkpoint.stage) >= order.indexOf(target)
}

function hasCheckpointTaskBrief(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & { taskBrief: string } {
  return Boolean(checkpoint?.taskBrief?.trim()) && checkpointStageAtLeast(checkpoint, "after_task_brief")
}

function hasCheckpointDraft(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & { taskBrief: string, draftContent: string } {
  return hasCheckpointTaskBrief(checkpoint) && Boolean(checkpoint.draftContent?.trim()) && checkpointStageAtLeast(checkpoint, "after_draft")
}

function hasCheckpointReview(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & { taskBrief: string, draftContent: string, reviewResults: NovelReviewResult[] } {
  return hasCheckpointDraft(checkpoint) && Array.isArray(checkpoint.reviewResults) && checkpointStageAtLeast(checkpoint, "after_review")
}

function hasCheckpointRevision(
  checkpoint?: DeepChapterGenerationResumeCheckpoint | null,
): checkpoint is DeepChapterGenerationResumeCheckpoint & { taskBrief: string, draftContent: string, reviewResults: NovelReviewResult[], currentContent: string } {
  return hasCheckpointReview(checkpoint) && Boolean(checkpoint.currentContent?.trim()) && checkpointStageAtLeast(checkpoint, "after_revision")
}

export async function runDeepChapterGeneration(
  input: DeepChapterGenerationInput,
  callbacks: DeepChapterGenerationCallbacks = {},
  deps: DeepChapterGenerationDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<DeepChapterGenerationResult> {
  assertNotAborted(signal)
  const resumeCheckpoint = input.resumeCheckpoint
  const writingConfig = resolveWritingConfig(input.llmConfig)
  const lengthSpec = resolveCurrentChapterLengthSpec()
  const novelConfig = useWikiStore.getState().novelConfig
  const { loadSmartDeAiSkill } = await import("./de-ai-adapter")

  // 将在阶段1构建contextPack后再加载skill（需要contextPack用于场景检测）
  let customDeAiSkill: string | null = null

  // 阶段0：前情分析（仅当章节号>1，且设置开启时；记忆库的近期摘要与上一章结尾仍会注入）
  let previousChaptersAnalysis = ""
  if (input.chapterNumber && input.chapterNumber > 1 && !resumeCheckpoint && novelConfig.deepPreviousChaptersAnalysis) {
    callbacks.onThinking?.(formatStageThinking("阶段0：前情分析", "正在读取并分析前3章完整内容..."))
    const { analyzePreviousChapters } = await import("./previous-chapters-analysis")
    try {
      previousChaptersAnalysis = await analyzePreviousChapters(
        input.projectPath,
        input.chapterNumber,
        writingConfig,
        3,
      )
      if (previousChaptersAnalysis) {
        callbacks.onThinking?.(formatStageThinking(
          "阶段0：前情分析",
          `已完成前情分析（${previousChaptersAnalysis.length}字）\n\n${previousChaptersAnalysis.slice(0, 500)}...`
        ))
      }
    } catch (error) {
      console.error("[deep-chapter-generation] 前情分析失败:", error)
    }
  }
  assertNotAborted(signal)

  const contextPack = await safeBuildChapterContextPack(
    deps,
    input.projectPath,
    input.userRequest,
    input.chapterNumber,
  )
  assertNotAborted(signal)

  // 阶段1后：加载智能skill（传递contextPack用于场景检测）
  customDeAiSkill = await loadSmartDeAiSkill(input.projectPath, input.userRequest, contextPack)

  // 独立提取大纲，不通过contextPackToPrompt
  const outlinePrompt = contextPack.outline
    ? [
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "# 【强制遵守】作品完整大纲",
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "**重要：以下是本作品的完整大纲，这是强制性要求。**",
        "你必须严格遵守大纲中的情节发展、角色行为、关键事件、故事走向。",
        "大纲内容必须完整体现在生成的章节中，不可偏离。",
        "",
        contextPack.outline,
        "",
        "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
      ].join("\n")
    : ""

  // 其他上下文可以进行token预算管理，但大纲已被排除
  const contextPrompt = [
    previousChaptersAnalysis ? `## 前情分析\n\n${previousChaptersAnalysis}` : "",
    deps.contextPackToPrompt(contextPack, 32000, { excludeOutline: true }),
    input.dismantlingReferenceDirective,
  ].filter(Boolean).join("\n\n")

  // 稳定上下文前缀：与任务书/初稿/扩写/返修/去AI味各阶段提示词开头逐字节一致。
  // 作为显式 prompt 缓存断点传入（Anthropic/MiniMax 走 cache_control；
  // OpenAI/DeepSeek 该断点被折叠回字符串、由其自动前缀缓存命中）。
  const cachePrefix = buildStableContextPrefix(outlinePrompt, contextPrompt)

  if (!resumeCheckpoint) {
    callbacks.onThinking?.(formatContextThinking(input, contextPack))
    callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_context"))
  }
  assertNotAborted(signal)

  let taskBrief = hasCheckpointTaskBrief(resumeCheckpoint) ? resumeCheckpoint.taskBrief.trim() : ""
  if (!taskBrief) {
    taskBrief = await collectModelText(
      writingConfig,
      [{
        role: "user",
        content: buildDeepChapterBriefPrompt(
          outlinePrompt,
          contextPrompt,
          input.userRequest,
          input.chapterNumber,
          input.goldenThreeChapter,
          lengthSpec,
        ),
      }],
      deps,
      signal,
      (partial) => callbacks.onThinking?.(formatStageThinking("阶段2：写作任务书", partial)),
      undefined,
      cachePrefix,
    )
    assertNotAborted(signal)
    callbacks.onThinking?.(formatStageThinking("阶段2：写作任务书", taskBrief))
    callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_task_brief", { taskBrief }))
  }

  let draftContent = hasCheckpointDraft(resumeCheckpoint) ? resumeCheckpoint.draftContent.trim() : ""
  if (!draftContent) {
    draftContent = await collectModelText(
      writingConfig,
      [{
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
      }],
      deps,
      signal,
      (partial) => callbacks.onThinking?.(formatStageThinking("阶段3：正文初稿", partial)),
      { max_tokens: lengthSpec.maxOutputTokens },
      cachePrefix,
    )
    assertNotAborted(signal)
    if (countChapterChars(draftContent) < lengthSpec.minChars) {
      draftContent = await collectModelText(
        writingConfig,
        [{
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
        }],
        deps,
        signal,
        (partial) => callbacks.onThinking?.(formatStageThinking("阶段3：正文扩写补足", partial)),
        { max_tokens: lengthSpec.maxOutputTokens },
        cachePrefix,
      )
      assertNotAborted(signal)
    }
    callbacks.onThinking?.(formatStageThinking("阶段3：正文初稿", [
      draftContent,
      "",
      `初稿生成完成，约 ${countChapterChars(draftContent)} 字。`,
    ].join("\n")))
    callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_draft", { taskBrief, draftContent }))
  }

  let reviewResults = hasCheckpointReview(resumeCheckpoint) ? resumeCheckpoint.reviewResults : []
  if (!hasCheckpointReview(resumeCheckpoint)) {
    if (!novelConfig.deepChapterReview) {
      callbacks.onThinking?.(formatStageThinking(
        "阶段4-5：已跳过审稿与返修",
        "已按设置关闭 AI 审稿，初稿将直接进入阶段6简单审查与去AI味。",
      ))
    } else {
      callbacks.onThinking?.(formatStageThinking(
        "阶段4：AI审稿",
        "正在检查正文完整性、剧情连续性、是否被截断以及是否存在阻断问题。",
      ))
      try {
        // 复用阶段1已构建的 contextPack，避免审稿内部再 buildContextPack 一次
        // （会重复跑检索 / 向量 / 图谱）。
        reviewResults = signal
          ? await deps.reviewChapter(input.projectPath, draftContent, input.chapterNumber, { onThinking: callbacks.onThinking, contextPack }, signal)
          : await deps.reviewChapter(input.projectPath, draftContent, input.chapterNumber, { onThinking: callbacks.onThinking, contextPack })
      } catch (err) {
        console.error("[Deep Chapter] Review failed:", err)
        reviewResults = []
      }
      reviewResults = reviewResults || []
      assertNotAborted(signal)
      callbacks.onThinking?.(formatReviewThinking(reviewResults))
      callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_review", { taskBrief, draftContent, reviewResults }))
    }
  }

  const blockingIssues = reviewResults.filter((item) => item.severity === "error")
  let currentContent = draftContent
  let revised = false

  if (hasCheckpointRevision(resumeCheckpoint)) {
    currentContent = resumeCheckpoint.currentContent.trim()
    revised = true
  } else if (blockingIssues.length === 0) {
    if (novelConfig.deepChapterReview) {
      callbacks.onThinking?.(formatStageThinking(
        "阶段5：无需自动返修",
        "AI审稿未发现阻断问题，跳过自动返修，进入阶段6简单审查与去AI味。",
      ))
    }
  } else {
    const revisedContent = await collectModelText(
      writingConfig,
      [{
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
      }],
      deps,
      signal,
      (partial) => callbacks.onThinking?.(formatStageThinking("阶段5：自动返修", partial)),
      { max_tokens: lengthSpec.maxOutputTokens },
      cachePrefix,
    )
    assertNotAborted(signal)
    callbacks.onThinking?.(formatStageThinking(
      "阶段5：自动返修",
      [
        `检测到 ${blockingIssues.length} 个阻断问题，已自动返修一次。`,
        "",
        formatReviewIssueList(blockingIssues),
        "",
        `返修后正文约 ${countChapterChars(revisedContent)} 字。`,
      ].join("\n"),
    ))
    currentContent = revisedContent
    revised = true
    callbacks.onCheckpoint?.(createResumeCheckpoint(input, "after_revision", {
      taskBrief,
      draftContent,
      reviewResults,
      currentContent: revisedContent,
    }))
  }

  // 阶段5.5：返修后复审（只在发生了返修时执行，只审查角色一致性维度，降低token消耗，不再自动返修避免循环）
  if (revised && novelConfig.deepChapterReview) {
    callbacks.onThinking?.(formatStageThinking(
      "阶段5.5：返修后角色一致性复审",
      "正在对返修后的正文进行角色一致性专项复审（轻量模式，只检查角色相关维度），确认返修是否引入新的角色偏差。",
    ))
    try {
      const postRevisionResults = signal
        ? await deps.reviewChapter(input.projectPath, currentContent, input.chapterNumber, { onThinking: callbacks.onThinking, contextPack, characterOnly: true }, signal)
        : await deps.reviewChapter(input.projectPath, currentContent, input.chapterNumber, { onThinking: callbacks.onThinking, contextPack, characterOnly: true })
      const postBlockingIssues = (postRevisionResults || []).filter((item) => item.severity === "error")
      if (postBlockingIssues.length > 0) {
        callbacks.onThinking?.(formatStageThinking(
          "阶段5.5：返修后复审",
          [
            `返修后复审发现 ${postBlockingIssues.length} 个阻断问题（不再自动返修，避免循环）：`,
            "",
            formatReviewIssueList(postBlockingIssues),
            "",
            "这些问题将在阶段6去AI味时一并处理，或需要手动修改。",
          ].join("\n"),
        ))
        reviewResults = [...reviewResults, ...(postRevisionResults || [])]
      } else {
        callbacks.onThinking?.(formatStageThinking(
          "阶段5.5：返修后复审",
          "返修后复审未发现新的阻断问题，进入阶段6。",
        ))
      }
    } catch (err) {
      console.error("[Deep Chapter] 返修后复审失败:", err)
    }
  }

  const finalContent = await finalPolishChapter(
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
    lengthSpec,
    cachePrefix,
  )
  callbacks.onThinking?.(formatStageThinking(
    "阶段7：完成",
    revised
      ? "采用返修并完成简单审查、去AI味后的正文作为最终正文。"
      : "未发现阻断问题，已完成最后一遍简单审查与去AI味。",
  ))
  callbacks.onFinalContent?.(finalContent)
  return {
    finalContent,
    taskBrief,
    draftContent,
    reviewResults,
    revised,
  }
}

async function finalPolishChapter(
  writingConfig: LlmConfig,
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
  lengthSpec: ChapterLengthSpec = resolveChapterLengthSpec(),
  cachePrefix?: string,
): Promise<string> {
  assertNotAborted(signal)
  callbacks.onThinking?.(formatStageThinking("阶段6：简单审查与去AI味", "正在进行最后一遍简单审查，去除复读、机械套话和 AI 味。"))
  const polished = await collectModelText(
    writingConfig,
    [{
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
    }],
    deps,
    signal,
    (partial) => callbacks.onThinking?.(formatStageThinking("阶段6：简单审查与去AI味", partial)),
    { max_tokens: lengthSpec.maxOutputTokens },
    cachePrefix,
  )
  assertNotAborted(signal)
  return polished.trim() ? polished : currentContent
}

function resolveCurrentChapterLengthSpec(): ChapterLengthSpec {
  const novelConfig = useWikiStore.getState().novelConfig
  return resolveChapterLengthSpec(novelConfig?.chapterTargetChars)
}

function resolveWritingConfig(llmConfig: LlmConfig): LlmConfig {
  // 写作模型已移除，始终使用 AI 会话当前模型。
  // llmConfig 已在 chat-panel.tsx 中通过 effectiveChatLlmConfig 正确解析，
  // 不再通过 resolveNovelModel 重新解析，避免二次解析使用不同 API 端点/密钥
  return llmConfig
}

/**
 * 把以 cachePrefix 开头的 user 字符串消息拆成 [前缀块(cacheControl), 余下块]，
 * 让 provider 在稳定上下文前缀上打缓存断点。其余消息原样返回。
 * 注：Anthropic/MiniMax 会据此发出 cache_control；OpenAI/DeepSeek 端纯文本块会被
 * 折叠回与原字符串逐字节一致的内容，不影响其自动前缀缓存。
 */
function applyCachePrefix(messages: ChatMessage[], cachePrefix?: string): ChatMessage[] {
  if (!cachePrefix) return messages
  return messages.map((message) => {
    if (
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith(cachePrefix)
    ) {
      const rest = message.content.slice(cachePrefix.length)
      return {
        role: message.role,
        content: [
          { type: "text" as const, text: cachePrefix, cacheControl: true },
          ...(rest ? [{ type: "text" as const, text: rest }] : []),
        ],
      }
    }
    return message
  })
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
  let content = ""
  let reasoningBuffer = ""
  let streamError: Error | null = null
  let cutoffReason: string | null = null
  const streamController = new AbortController()
  const combinedSignal = combineAbortSignals(signal, streamController.signal)
  const stopStream = (reason: string) => {
    if (cutoffReason) return
    cutoffReason = reason
    streamController.abort()
  }

  assertNotAborted(signal)

  await deps.streamChat(
    config,
    applyCachePrefix(messages, cachePrefix),
    {
      onToken: (token) => {
        if (signal?.aborted) {
          stopStream(USER_ABORT_MESSAGE)
          return
        }
        content += token
        const loopStart = findRepeatedTailStart(content)
        if (loopStart !== null) {
          content = content.slice(0, loopStart).trimEnd()
          onUpdate?.(`${content}\n\n（已检测到模型重复输出，已自动停止重复内容。）`)
          stopStream("检测到模型重复输出，已自动停止重复内容。")
          return
        }
        onUpdate?.(content)
      },
      onReasoningToken: (token) => {
        if (signal?.aborted) {
          stopStream(USER_ABORT_MESSAGE)
          return
        }
        // 推理 token 只用于进度显示，不计入最终 content
        reasoningBuffer += token
        if (!content) {
          onUpdate?.(reasoningBuffer)
        }
      },
      onDone: () => {},
      onError: (error) => {
        streamError = error
      },
    },
    combinedSignal,
    {
      ...requestOverrides,
      reasoning: requestOverrides?.reasoning ?? config.reasoning,
    },
  )

  if (signal?.aborted) throw new Error(USER_ABORT_MESSAGE)
  if (streamError && !(cutoffReason && isRequestCancelledError(streamError))) throw streamError
  if (cutoffReason) {
    onUpdate?.(`${content.trim()}\n\n（${cutoffReason}）`)
  }
  return content.trim()
}

function countChapterChars(content: string): number {
  return content.replace(/\s+/g, "").length
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(USER_ABORT_MESSAGE)
}

function isRequestCancelledError(error: Error): boolean {
  return /request cancelled|request canceled|aborted|aborterror/i.test(error.message)
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter(Boolean) as AbortSignal[]
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]

  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener("abort", abort, { once: true })
  }
  return controller.signal
}

function findRepeatedTailStart(content: string): number | null {
  const normalized = content.replace(/\r\n/g, "\n")
  const compact = normalized.replace(/\s+/g, "")
  if (compact.length < REPEAT_CHECK_MIN_CHARS) return null

  const tail = compact.slice(-REPEAT_WINDOW_CHARS)
  const first = compact.indexOf(tail)
  if (first === -1 || first >= compact.length - REPEAT_WINDOW_CHARS) return null

  let hits = 0
  let searchIndex = 0
  while (true) {
    const found = compact.indexOf(tail, searchIndex)
    if (found === -1) break
    hits += 1
    if (hits >= REPEAT_HIT_LIMIT) {
      return sourceIndexFromCompactIndex(normalized, first + REPEAT_WINDOW_CHARS)
    }
    searchIndex = found + Math.max(1, tail.length)
  }
  return null
}

function sourceIndexFromCompactIndex(content: string, compactIndex: number): number {
  let seen = 0
  for (let index = 0; index < content.length; index += 1) {
    if (/\s/.test(content[index])) continue
    seen += 1
    if (seen >= compactIndex) return index + 1
  }
  return content.length
}

function formatContextThinking(input: DeepChapterGenerationInput, pack: ContextPack): string {
  const recentSummaries = Array.isArray(pack.recentSummaries) ? pack.recentSummaries : []
  const goldenThreeHints = resolveGoldenThreeThinkingHints(input.goldenThreeChapter)
  return formatStageThinking(
    "阶段1：上下文分析",
    [
      ...goldenThreeHints,
      input.chapterNumber ? `目标章节：第${input.chapterNumber}章` : "目标章节：从用户请求中识别",
      `章节目标：${fallback(pack.chapterGoal, "未读取到明确章节目标")}`,
      `上一章结尾：${fallback(pack.previousChapterEnding, "未读取到上一章结尾")}`,
      `近期剧情：${recentSummaries.length} 条`,
      `人物状态：${summaryText(pack.characterStates)}`,
      `伏笔状态：${summaryText(pack.foreshadowingStates)}`,
      `时间线：${summaryText(pack.timeline)}`,
      `禁止违背：${fallback(pack.mustAvoid, "暂无明确禁止项")}`,
      `必须完成：${fallback(pack.mustDo, "暂无明确必做项")}`,
    ].join("\n"),
  )
}

function formatReviewThinking(reviewResults: NovelReviewResult[]): string {
  if (reviewResults.length === 0) {
    return formatStageThinking("阶段4：AI审稿", "未发现阻断问题。")
  }
  const characterIssues = reviewResults.filter((item) => item.type === "character_consistency")
  const otherIssues = reviewResults.filter((item) => item.type !== "character_consistency")
  const errorCount = reviewResults.filter((item) => item.severity === "error").length
  const sections: string[] = [
    `发现 ${reviewResults.length} 个问题，其中阻断问题 ${errorCount} 个。`,
  ]

  // 角色命中记忆库报告（单独展示 character_consistency 类型的问题）
  if (characterIssues.length > 0) {
    sections.push("")
    sections.push("【角色命中记忆库报告】")
    sections.push(formatReviewIssueList(characterIssues))
  }

  // 其他问题
  if (otherIssues.length > 0) {
    sections.push("")
    sections.push("【其他审查问题】")
    sections.push(formatReviewIssueList(otherIssues))
  }

  return formatStageThinking("阶段4：AI审稿", sections.join("\n"))
}

function formatStageThinking(title: string, content: string): string {
  return `## ${title}\n${content.trim()}`
}

function formatReviewIssueList(reviewResults: NovelReviewResult[]): string {
  return reviewResults
    .map((item, index) => [
      `${index + 1}. [${severityLabel(item.severity)}] ${item.message}`,
      item.evidence ? `   - 证据：${item.evidence}` : "",
      item.relatedMemory ? `   - 相关记忆：${item.relatedMemory}` : "",
      item.suggestion ? `   - 建议：${item.suggestion}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n")
}

function fallback(value: string | null | undefined, fallbackText: string): string {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed ? trimForThinking(trimmed, 180) : fallbackText
}

function summaryText(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed ? trimForThinking(trimmed, 140) : "暂无"
}

function trimForThinking(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function severityLabel(severity: NovelReviewResult["severity"]): string {
  if (severity === "error") return "严重"
  if (severity === "warning") return "提醒"
  return "信息"
}

function resolveGoldenThreeThinkingHints(goldenThreeChapter?: GoldenThreeChapterRequest): string[] {
  if (!goldenThreeChapter?.enabled || !goldenThreeChapter.targetChapter) return []
  if (goldenThreeChapter.outputMode === "first_chapter_with_directions") {
    return [
      "黄金三章：已启用",
      "执行策略：当前按黄金三章规则生成第1章正文，并在正文后给出第2章、第3章写作方向。",
    ]
  }
  return [
    "黄金三章：已启用",
    `执行策略：当前按黄金三章规则生成第${goldenThreeChapter.targetChapter}章正文。`,
  ]
}


async function safeBuildChapterContextPack(
  deps: DeepChapterGenerationDeps,
  projectPath: string,
  userRequest: string,
  chapterNumber?: number,
): Promise<ContextPack> {
  try {
    return await deps.buildContextPack(projectPath, userRequest, chapterNumber)
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
    }
  }
}
