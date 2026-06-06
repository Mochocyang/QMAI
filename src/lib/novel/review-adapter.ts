import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import i18n from "@/i18n"
import type { ChatMessage } from "@/lib/llm-providers"
import { useWikiStore } from "@/stores/wiki-store"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { contextPackToPrompt, buildContextPack, REVIEW_CONTEXT_OPTIONS, type ContextPack } from "./context-engine"
import { resolveNovelModel } from "./model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { createReviewThinkingPublisher } from "./review-thinking-publisher"

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

const REVIEW_DIMENSIONS = [
  "是否违背总大纲",
  "是否违背分卷大纲",
  "是否违背章节目标",
  "本章必须完成项是否已完成",
  "本章避免违背项是否存在违背",
  "下一章推进建议是否被忽略或反向推进",
  "是否人设崩坏",
  "是否人物动机不一致",
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

export function buildReviewPrompt(pack: ContextPack, chapterContent: string): string {
  return `${contextPackToPrompt(pack)}

阶段式深度审查工作流：
${REVIEW_STAGES.map((stage) => `- ${stage}：必须使用高级 thinking，先分析证据，再给结论。`).join("\n")}

阶段要求：
1. 审查任务识别：确认目标章节、章纲节点、正文范围、是否缺少必要上下文。
2. 上下文检索：结合大纲、节点、上一章结尾、下一章建议、记忆库、人物信息、伏笔、时间线、角色认知状态。
3. 章节目标对齐：判断正文是否完成本章必须推进项，是否偏离章纲或反向推进。
4. 事实与记忆核对：逐项对照已登记设定、人物认知、伏笔状态、历史事件和相关检索结果。
5. 逐维度审查：每个维度都必须有 pass 或 issue，不要只检查明显错误。
6. 阻断判定：把会影响正式章节保存、后续生成、主线事实或人物一致性的问题标为 error。
7. 二次复核：删除没有正文证据或没有记忆/大纲依据的主观评价，补上遗漏的阻断问题。

${i18n.t("novel.reviewPrompt.reviewChapterInstruction")}
${REVIEW_DIMENSIONS.map((key, i) => `${i + 1}. ${i18n.t(key)}`).join("\n")}

${i18n.t("novel.reviewPrompt.specialChecksTitle")}
- ${i18n.t("novel.reviewPrompt.specialChecks.mustDo")}
- ${i18n.t("novel.reviewPrompt.specialChecks.mustAvoid")}
- ${i18n.t("novel.reviewPrompt.specialChecks.nextChapterAdvice")}

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
  callbacks: NovelReviewCallbacks = {},
): Promise<NovelReviewResult[]> {
  const llmConfig = resolveNovelModel(
    useWikiStore.getState().llmConfig,
    useWikiStore.getState().novelConfig,
    "review",
  )
  if (!hasUsableLlm(llmConfig)) return []

  const novelMode = useWikiStore.getState().novelMode
  if (!novelMode) return []

  const contextPack = await buildContextPack(
    projectPath,
    `审稿第${chapterNumber || "?"}章`,
    chapterNumber,
    REVIEW_CONTEXT_OPTIONS,
  )

  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)

  const systemPrompt = `你是一个专业的小说审稿编辑。你的任务是检查章节内容是否存在连贯性问题。
前置阶段请输出审查分析摘要；只有用户明确要求“最终审查 JSON”时，才严格按照 JSON 数组格式输出检查结果，不要输出任何其他内容。
${langReminder}`

  const userPrompt = buildReviewPrompt(contextPack, chapterContent)
  const stageThinking = new Map<string, string>()

  try {
    const stageOne = await runReviewStage(
      llmConfig,
      systemPrompt,
      buildStagePrompt(userPrompt, "阶段1：审查任务识别", "阶段2：上下文检索", "请输出审查任务书和已读取上下文摘要，不要输出最终 JSON。"),
      "阶段1：审查任务识别 / 阶段2：上下文检索",
      callbacks,
      stageThinking,
    )
    const stageTwo = await runReviewStage(
      llmConfig,
      systemPrompt,
      buildStagePrompt(userPrompt, "阶段3：章节目标对齐", "阶段4：事实与记忆核对", "请重点核对章纲节点、上下文、记忆库、人物认知、伏笔和时间线，不要输出最终 JSON。"),
      "阶段3：章节目标对齐 / 阶段4：事实与记忆核对",
      callbacks,
      stageThinking,
    )
    const stageThree = await runReviewStage(
      llmConfig,
      systemPrompt,
      buildStagePrompt(userPrompt, "阶段5：逐维度审查", "阶段6：阻断判定", "请逐维度列出 pass 或 issue，并区分 error、warning、info，不要输出最终 JSON。"),
      "阶段5：逐维度审查 / 阶段6：阻断判定",
      callbacks,
      stageThinking,
    )

    const result = await runReviewStage(
      llmConfig,
      systemPrompt,
      [
        userPrompt,
        "",
        "前置阶段分析：",
        stageOne,
        "",
        stageTwo,
        "",
        stageThree,
        "",
        "阶段7：二次复核",
        "请删除没有正文证据、没有上下文依据或只是主观评价的问题；补上遗漏的阻断问题。",
        "",
        "最终审查 JSON：",
        "只输出最终 JSON 数组，不要输出解释、标题或 markdown。",
      ].join("\n"),
      "阶段7：二次复核",
      callbacks,
      stageThinking,
    )

    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []

    return parsed.map((item: Record<string, unknown>) => ({
      severity: validateSeverity(item.severity),
      type: String(item.type || "unknown"),
      message: String(item.message || ""),
      evidence: String(item.evidence || ""),
      relatedMemory: String(item.relatedMemory || ""),
      suggestion: String(item.suggestion || ""),
    }))
  } catch (err) {
    console.error("[Novel Review] Failed:", err)
    return []
  }
}

function buildStagePrompt(basePrompt: string, stageA: string, stageB: string, instruction: string): string {
  return [
    basePrompt,
    "",
    stageA,
    stageB,
    instruction,
    "输出阶段分析即可，必须体现高级 thinking 的审查过程摘要：先列已核对依据，再列阶段结论。",
  ].join("\n")
}

async function runReviewStage(
  llmConfig: ReturnType<typeof resolveNovelModel>,
  systemPrompt: string,
  userPrompt: string,
  stageTitle: string,
  callbacks: NovelReviewCallbacks,
  stageThinking: Map<string, string>,
): Promise<string> {
  publishReviewStageThinking(stageThinking, callbacks, stageTitle, "正在分析...")
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let result = ""
  const thinkingPublisher = createReviewThinkingPublisher({
    publish: (content) => {
      publishReviewStageThinking(stageThinking, callbacks, stageTitle, content)
    },
  })
  const streamCallbacks: StreamCallbacks = {
    onToken: (token: string) => {
      result += token
      thinkingPublisher.publish(result)
    },
    onDone: () => {},
    onError: (error: Error) => {
      console.error("[Novel Review] Stream error:", error)
    },
  }

  try {
    await streamChat(
      llmConfig,
      messages,
      streamCallbacks,
      AbortSignal.timeout(120000),
      { reasoning: { mode: "high" } },
    )
  } finally {
    thinkingPublisher.flush()
  }

  return result.trim()
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
