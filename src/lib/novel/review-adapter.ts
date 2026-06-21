import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import i18n from "@/i18n"
import type { ChatMessage } from "@/lib/llm-providers"
import { useWikiStore } from "@/stores/wiki-store"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { contextPackToPrompt, buildContextPack, type ContextPack } from "./context-engine"
import { buildCharacterAuraContext } from "./character-aura"
import { resolveNovelModel } from "./model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"

export interface NovelReviewResult {
  severity: "error" | "warning" | "info"
  type: string
  message: string
  evidence: string
  relatedMemory: string
  suggestion: string
}

export interface NovelReviewCallbacks {
  onThinking?: (content: string) => void
}

export interface ReviewChapterOptions extends NovelReviewCallbacks {
  /**
   * 复用调用方已构建好的上下文包，避免审稿内部重复 buildContextPack
   * （含一次重复的检索 / 向量 / 图谱计算）。深度章节生成会把阶段1建好的
   * contextPack 传进来。未提供时回退到内部自行构建。
   */
  contextPack?: ContextPack
  /**
   * 轻量审查模式：只审查角色一致性相关维度（人设、动机、记忆库、认知、秘密），
   * 用于返修后复审，降低 token 消耗。默认 false 走全量审查。
   */
  characterOnly?: boolean
}

/** 角色一致性相关的审查维度，用于 characterOnly 轻量审查模式 */
const CHARACTER_REVIEW_DIMENSIONS = [
  "是否人设崩坏",
  "是否人物动机不一致",
  "是否角色脱离记忆库设定",
  "是否提前泄露秘密",
  "是否角色知道了不该知道的信息",
]

const REVIEW_DIMENSIONS = [
  "是否违背总大纲",
  "是否违背分卷大纲",
  "是否违背章节目标",
  "本章必须完成项是否已完成",
  "本章避免违背项是否存在违背",
  "下一章推进建议是否被忽略或反向推进",
  "是否人设崩坏",
  "是否人物动机不一致",
  "是否角色脱离记忆库设定",
  "是否时间线错误",
  "是否地点错误",
  "是否能力体系崩坏",
  "是否伏笔遗忘",
  "是否提前泄露秘密",
  "是否角色知道了不该知道的信息",
  "是否新增未登记设定",
  "是否剧情水文",
  "是否缺少章节钩子",
]

const REVIEW_STAGES = [
  "阶段1：审查任务识别",
  "阶段2：上下文检索",
  "阶段3：章节目标对齐",
  "阶段4：事实与记忆核对",
  "阶段5：逐维度审查",
  "阶段6：阻断判定",
  "阶段7：二次复核",
]

const REVIEW_CHUNK_SIZE = 8000
const REVIEW_MAX_CHUNKS = 3

/**
 * 把超长章节分段用于审查。章节 ≤ 8000 字时返回单段；
 * 超过时按 8000 字一段切分，最多 3 段（覆盖 24000 字），超出部分追加到最后一段。
 */
function splitChapterForReview(content: string): string[] {
  if (content.length <= REVIEW_CHUNK_SIZE) return [content]
  const chunks: string[] = []
  for (let i = 0; i < content.length && chunks.length < REVIEW_MAX_CHUNKS; i += REVIEW_CHUNK_SIZE) {
    chunks.push(content.slice(i, i + REVIEW_CHUNK_SIZE))
  }
  const totalCovered = REVIEW_MAX_CHUNKS * REVIEW_CHUNK_SIZE
  if (chunks.length === REVIEW_MAX_CHUNKS && content.length > totalCovered) {
    chunks[REVIEW_MAX_CHUNKS - 1] += content.slice(totalCovered)
  }
  return chunks
}

export function buildReviewPrompt(pack: ContextPack, chapterContent: string, characterOnly = false): string {
  const dimensions = characterOnly ? CHARACTER_REVIEW_DIMENSIONS : REVIEW_DIMENSIONS
  const modeTitle = characterOnly ? "角色一致性专项审查" : "阶段式深度审查工作流"
  const modeStages = characterOnly
    ? ["阶段1：角色提取", "阶段2：记忆库对照", "阶段3：脱离判定", "阶段4：二次复核"]
    : REVIEW_STAGES
  return `${contextPackToPrompt(pack)}

${modeTitle}：
${modeStages.map((stage) => `- ${stage}：必须使用高级 thinking，先分析证据，再给结论。`).join("\n")}

${characterOnly ? "角色一致性专项审查要求：" : "阶段要求："}
${characterOnly
  ? [
      "1. 角色提取：从本章正文中提取所有出现的角色名（含别名、昵称），列出角色清单。",
      "2. 记忆库对照：逐个角色对照上下文中的角色光环/灵魂、人物状态、角色认知状态字段，标注命中状态。",
      "3. 脱离判定：角色行为若违背光环设定、人物状态、认知状态、大纲人物小传，视为脱离记忆库，按严重程度标为 error 或 warning。",
      "4. 二次复核：删除没有正文证据或没有记忆/大纲依据的主观评价，补上遗漏的阻断问题。",
    ].join("\n")
  : [
      "1. 审查任务识别：确认目标章节、章纲节点、正文范围、是否缺少必要上下文。",
      "2. 上下文检索：结合大纲、节点、上一章结尾、下一章建议、记忆库、人物信息、伏笔、时间线、角色认知状态。",
      "3. 章节目标对齐：判断正文是否完成本章必须推进项，是否偏离章纲或反向推进。",
      "4. 事实与记忆核对：逐项对照已登记设定、人物认知、伏笔状态、历史事件和相关检索结果。",
      "5. 逐维度审查：每个维度都必须有 pass 或 issue，不要只检查明显错误。",
      "6. 阻断判定：把会影响正式章节保存、后续生成、主线事实或人物一致性的问题标为 error。",
      "7. 二次复核：删除没有正文证据或没有记忆/大纲依据的主观评价，补上遗漏的阻断问题。",
    ].join("\n")}

${i18n.t("novel.reviewPrompt.reviewChapterInstruction")}
${dimensions.map((key, i) => `${i + 1}. ${i18n.t(key)}`).join("\n")}

${characterOnly ? "" : `${i18n.t("novel.reviewPrompt.specialChecksTitle")}
- ${i18n.t("novel.reviewPrompt.specialChecks.mustDo")}
- ${i18n.t("novel.reviewPrompt.specialChecks.mustAvoid")}
- ${i18n.t("novel.reviewPrompt.specialChecks.nextChapterAdvice")}

`}

角色命中记忆库检查（必须执行）：
1. 角色提取：先从本章正文中提取所有出现的角色名（含别名、昵称），列出角色清单。
2. 记忆库对照：逐个角色对照上下文中的"角色光环/灵魂"、"人物状态"、"角色认知状态"字段：
   - 标注该角色是否命中记忆库（已注入光环 / 仅有状态 / 完全缺失）。
   - 若角色已命中记忆库，检查正文行为是否符合光环设定（说话方式、心智模型、决策启发式、价值观反模式、诚实边界）。
   - 若角色未命中记忆库但在大纲/人物小传中存在，标注"未命中但应命中"。
3. 脱离判定：角色行为若违背光环设定、人物状态、认知状态（知道/不知道什么）、大纲人物小传，视为"脱离记忆库"，按严重程度标为 error 或 warning。
4. 输出要求：在审查 JSON 中，角色相关问题 type 使用 "character_consistency"，relatedMemory 必须引用对应的光环/状态/认知/大纲原文。

${i18n.t("novel.reviewPrompt.chapterContent")}
${chapterContent.slice(0, 8000)}

${i18n.t("novel.reviewPrompt.outputFormat")}
[
  {
    "severity": "error|warning|info",
    "type": "character_consistency|timeline|foreshadowing|setting|plot|style",
    "message": "问题描述",
    "evidence": "正文片段",
    "relatedMemory": "相关记忆引用",
    "suggestion": "修改建议"
  }
]

${i18n.t("novel.reviewPrompt.emptyArrayFallback")}`
}

export async function reviewChapter(
  projectPath: string,
  chapterContent: string,
  chapterNumber?: number,
  options: ReviewChapterOptions = {},
  signal?: AbortSignal,
): Promise<NovelReviewResult[]> {
  if (signal?.aborted) throw new Error("已停止生成")
  const llmConfig = resolveNovelModel(
    useWikiStore.getState().llmConfig,
    useWikiStore.getState().novelConfig,
    "review",
  )
  if (!hasUsableLlm(llmConfig)) return []

  const novelMode = useWikiStore.getState().novelMode
  if (!novelMode) return []

  // 复用调用方已构建的 contextPack；没有才自行构建。
  const baseContextPack = options.contextPack ?? await buildContextPack(
    projectPath,
    `审稿第${chapterNumber || "?"}章`,
    chapterNumber,
  )

  // 审查前用初稿正文重新匹配角色光环，补齐初稿中新出现的角色。
  // 阶段1构建 contextPack 时 matchingText 不含初稿正文，配角/新角色登场时光环不会被注入，
  // 这里把 chapterContent 加入 matchingText 重新匹配，确保审查阶段能看到初稿新角色的完整光环。
  let contextPack = baseContextPack
  try {
    const draftCharacterAuras = await buildCharacterAuraContext(projectPath, baseContextPack.task, {
      matchingText: [
        baseContextPack.chapterGoal,
        baseContextPack.outline,
        baseContextPack.characterStates,
        baseContextPack.cognitionStates,
        chapterContent,
      ].filter(Boolean).join("\n\n"),
    })
    if (draftCharacterAuras && draftCharacterAuras !== baseContextPack.characterAuras) {
      contextPack = { ...baseContextPack, characterAuras: draftCharacterAuras }
    }
  } catch (err) {
    console.error("[Novel Review] 重新匹配角色光环失败，沿用阶段1的光环:", err)
  }

  if (signal?.aborted) throw new Error("已停止生成")
  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)
  // 审稿 reasoning 档位可配置（默认 high）；下调可省审稿推理 Token。
  const reviewReasoningEffort = useWikiStore.getState().novelConfig.reviewReasoningEffort ?? "high"

  const systemPrompt = `你是一个专业的小说审稿编辑。你的任务是检查章节内容是否存在连贯性问题。
请在一次回复里先完成分阶段审查分析，再在最后只输出最终审查 JSON 数组，JSON 之外不要有多余内容。
${langReminder}`

  // 章节超长时分段审查，合并所有段的审查结果
  const chunks = splitChapterForReview(chapterContent)
  const stageThinking = new Map<string, string>()

  try {
    // 并行审查所有分段，缩短超长章节审查时延
    const chunkResults = await Promise.all(chunks.map(async (chunk, i) => {
      if (signal?.aborted) throw new Error("已停止生成")
      const chunkContent = chunks.length > 1
        ? `【第${i + 1}段/共${chunks.length}段】\n${chunk}`
        : chunk
      const userPrompt = buildReviewPrompt(contextPack, chunkContent, options.characterOnly)
      const stageTitle = chunks.length > 1
        ? (options.characterOnly ? `角色一致性审查（第${i + 1}/${chunks.length}段）` : `深度审查（第${i + 1}/${chunks.length}段）`)
        : (options.characterOnly ? "角色一致性审查" : "深度审查")

      const result = await runReviewStage(
        llmConfig,
        systemPrompt,
        [
          userPrompt,
          "",
          "请在同一次回复中依次完成阶段1-7和上方全部审查维度：",
          "- 先逐阶段、逐维度列出已核对依据与结论（每个维度给出 pass 或 issue）。",
          "- 再做阶段7二次复核：删除没有正文证据或没有上下文 / 记忆 / 大纲依据的主观评价，补上遗漏的阻断问题。",
          "",
          "最终审查 JSON：",
          "在完成上述全部分析之后，最后只输出最终 JSON 数组，不要输出解释、标题或 markdown。",
        ].join("\n"),
        stageTitle,
        options,
        stageThinking,
        signal,
        reviewReasoningEffort,
      )

      const jsonMatch = extractJsonArray(result)
      if (!jsonMatch) {
        console.warn(`[Novel Review] No JSON array found in chunk ${i + 1}:`, result.slice(0, 500))
        return []
      }

      const parsed = JSON.parse(jsonMatch)
      if (!Array.isArray(parsed)) {
        console.warn(`[Novel Review] Parsed result is not an array in chunk ${i + 1}:`, parsed)
        return []
      }

      return parsed.map((item: Record<string, unknown>) => ({
        severity: validateSeverity(item.severity),
        type: String(item.type || "unknown"),
        message: String(item.message || ""),
        evidence: String(item.evidence || ""),
        relatedMemory: String(item.relatedMemory || ""),
        suggestion: String(item.suggestion || ""),
      }))
    }))

    return chunkResults.flat()
  } catch (err) {
    console.error("[Novel Review] Failed:", err)
    return []
  }
}

/**
 * 从单次审稿回复里取出最终 JSON 数组。优先取“最后一个”完整数组：
 * 单次调用里模型可能先输出分析文字再给 JSON，贪婪匹配第一个 `[` 到最后一个
 * `]` 容易把分析里的方括号一起吞掉，这里从末尾的 `]` 向前找配平的 `[`。
 */
function extractJsonArray(text: string): string | null {
  const end = text.lastIndexOf("]")
  if (end === -1) return null
  let depth = 0
  for (let i = end; i >= 0; i -= 1) {
    const ch = text[i]
    if (ch === "]") depth += 1
    else if (ch === "[") {
      depth -= 1
      if (depth === 0) return text.slice(i, end + 1)
    }
  }
  // 兜底：配平失败时退回贪婪匹配。
  const greedy = text.match(/\[[\s\S]*\]/)
  return greedy ? greedy[0] : null
}

async function runReviewStage(
  llmConfig: ReturnType<typeof resolveNovelModel>,
  systemPrompt: string,
  userPrompt: string,
  stageTitle: string,
  callbacks: NovelReviewCallbacks,
  stageThinking: Map<string, string>,
  signal?: AbortSignal,
  reasoningMode: "low" | "medium" | "high" = "high",
  retryCount = 0,
): Promise<string> {
  publishReviewStageThinking(stageThinking, callbacks, stageTitle, "正在分析...")
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let result = ""
  let reasoning = ""
  const renderThinking = () => {
    const combined = reasoning
      ? `${reasoning}${result ? `\n\n${result}` : ""}`
      : result
    publishReviewStageThinking(stageThinking, callbacks, stageTitle, combined || "正在分析...")
  }
  const streamCallbacks: StreamCallbacks = {
    onToken: (token: string) => {
      result += token
      renderThinking()
    },
    // 审稿模型多为推理模型，分阶段分析走 reasoning 通道：捕获后用于 thinking 展示，
    // 但不计入 result，最终 JSON 只从 content（result）解析，避免分析文字污染 JSON。
    onReasoningToken: (token: string) => {
      reasoning += token
      renderThinking()
    },
    onDone: () => {},
    onError: (error: Error) => {
      console.error("[Novel Review] Stream error:", error)
    },
  }

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), 300000)

  const combinedSignal = signal
    ? combineSignals(signal, timeoutController.signal)
    : timeoutController.signal

  try {
    await streamChat(
      llmConfig,
      messages,
      streamCallbacks,
      combinedSignal,
      { reasoning: { mode: reasoningMode } },
    )
    clearTimeout(timeoutId)
  } catch (err) {
    clearTimeout(timeoutId)
    if (signal?.aborted) throw new Error("已停止生成")
    if (retryCount < 2) {
      console.warn(`[Novel Review] Stage "${stageTitle}" failed, retrying (${retryCount + 1}/2)...`)
      publishReviewStageThinking(stageThinking, callbacks, stageTitle, "网络波动，正在重试...")
      await new Promise(resolve => setTimeout(resolve, 2000))
      return runReviewStage(llmConfig, systemPrompt, userPrompt, stageTitle, callbacks, stageThinking, signal, reasoningMode, retryCount + 1)
    }
    throw err
  }

  if (signal?.aborted) throw new Error("已停止生成")
  return result.trim()
}

function combineSignals(signalA: AbortSignal, signalB: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of [signalA, signalB]) {
    // 信号在组合前就已经中止时（例如用户在审稿开始前点了停止），
    // addEventListener 不会再触发，必须立即同步中止组合信号。
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener("abort", abort, { once: true })
  }
  return controller.signal
}

function publishReviewStageThinking(
  stageThinking: Map<string, string>,
  callbacks: NovelReviewCallbacks,
  stageTitle: string,
  content: string,
): void {
  stageThinking.set(stageTitle, formatReviewStageThinking(stageTitle, content))
  callbacks.onThinking?.(Array.from(stageThinking.values()).join("\n\n"))
}

function formatReviewStageThinking(stageTitle: string, content: string): string {
  return `## ${stageTitle}\n${content.trim()}`
}

function validateSeverity(value: unknown): "error" | "warning" | "info" {
  if (value === "error" || value === "warning" || value === "info") return value
  return "warning"
}
