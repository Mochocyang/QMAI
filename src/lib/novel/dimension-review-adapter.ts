import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { buildContextPack, contextPackToPrompt, type ContextPack } from "./context-engine"
import { resolveNovelModel } from "./model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import type { NovelReviewResult } from "./review-adapter"

export type SixReviewDimensionKey = "thrill" | "consistency" | "pacing" | "character" | "continuity" | "pull"
export type DimensionReviewStatus = "error" | "high" | "medium" | "low" | "pass"

export interface SixReviewDimensionDefinition {
  key: SixReviewDimensionKey
  label: string
  objective: string
  stages: string[]
  checks: string[]
}

export interface DimensionReviewIssue extends NovelReviewResult {
  dimensionKey: SixReviewDimensionKey
  impact?: string
  rewriteTarget?: string
}

export interface DimensionReviewResult {
  dimensionKey: SixReviewDimensionKey
  score: number
  status: DimensionReviewStatus
  summary: string
  thinking: string
  issues: DimensionReviewIssue[]
}

export interface DimensionReviewCallbacks {
  onThinking?: (dimensionKey: SixReviewDimensionKey, thinking: string) => void
}

export interface SixDimensionReviewCallbacks {
  onDimensionProgress?: (dimensionKey: SixReviewDimensionKey, progress: string) => void
  onDimensionThinking?: (dimensionKey: SixReviewDimensionKey, thinking: string) => void
  onDimensionResult?: (dimensionKey: SixReviewDimensionKey, result: DimensionReviewResult) => void
}

export const SIX_REVIEW_DIMENSION_ORDER: SixReviewDimensionKey[] = [
  "thrill",
  "consistency",
  "pacing",
  "character",
  "continuity",
  "pull",
]

export const SIX_REVIEW_DIMENSIONS: Record<SixReviewDimensionKey, SixReviewDimensionDefinition> = {
  thrill: {
    key: "thrill",
    label: "爽感密度",
    objective: "判断章节是否建立并兑现有效爽点，而不是只检查剧情是否发生。",
    stages: ["爽点预期识别", "压抑与释放链检查", "主角能动性检查", "爽点密度检查", "爽点失效诊断"],
    checks: ["打脸、反杀、成长、揭谜、奖励兑现是否成立", "期待、阻力、升级、反转、兑现链条是否完整", "爽点是否由主角选择、能力或决断推动", "解释、重复和旁人代打是否削弱爽感"],
  },
  consistency: {
    key: "consistency",
    label: "设定自治",
    objective: "判断设定是否能自洽地推动剧情，而不是临时为剧情让路。",
    stages: ["已登记设定读取", "新设定识别", "规则一致性检查", "代价与边界检查", "设定推动剧情检查"],
    checks: ["能力、物品、组织、地点和规则是否违背旧设定", "新增规则是否有边界、代价和触发条件", "设定是否参与冲突和选择", "是否存在作者硬送或临时开挂"],
  },
  pacing: {
    key: "pacing",
    label: "节奏张力",
    objective: "判断章节是否有推进力、压力变化和持续阅读的节奏。",
    stages: ["场景结构拆分", "张力曲线检查", "信息密度检查", "转折频率检查", "拖沓与跳跃诊断"],
    checks: ["每个场景是否有目标、阻力和结果", "张力是否升级或反转", "说明、内心和背景是否压过行动", "是否存在水文、重复、跳转过快或关键冲突没写足"],
  },
  character: {
    key: "character",
    label: "人设一致",
    objective: "判断人物行为、语言、认知和情绪是否符合既有人设。",
    stages: ["人物状态读取", "行为动机检查", "语言风格检查", "认知边界检查", "成长弧线检查"],
    checks: ["关键选择是否有动机", "台词是否符合身份、性格和关系", "角色是否知道了不该知道的信息", "变化是否有触发原因和过渡"],
  },
  continuity: {
    key: "continuity",
    label: "叙事衔接",
    objective: "判断本章是否和前文、大纲、记忆库顺畅连接。",
    stages: ["前章结尾对接", "章纲目标对接", "时间线检查", "地点与物品连续性检查", "因果链检查"],
    checks: ["开头是否承接上一章地点、状态、情绪和动作", "正文是否完成当前章纲目标", "时间、地点、伤势、物品和伏笔是否连续", "事件是否有清晰因果"],
  },
  pull: {
    key: "pull",
    label: "追读引力",
    objective: "判断读者看完本章后是否有继续阅读下一章的动力。",
    stages: ["本章核心悬念识别", "结尾钩子检查", "下一章承诺检查", "情绪停点检查", "假悬念过滤"],
    checks: ["是否留下新危机、新目标、新反转或新信息", "下一章期待是否明确", "结尾是否停在高张力或强情绪点", "悬念是否有正文证据而不是空钩子"],
  },
}

export function buildDimensionReviewPrompt(
  pack: ContextPack,
  chapterContent: string,
  dimension: SixReviewDimensionDefinition,
): string {
  return `${contextPackToPrompt(pack)}

六维独立审查维度：${dimension.label}
审查目标：${dimension.objective}

专业工作流：
${dimension.stages.map((stage, index) => `${index + 1}. ${stage}`).join("\n")}

检查标准：
${dimension.checks.map((check) => `- ${check}`).join("\n")}

阶段分析要求：
只输出阶段分析，不要输出结构化对象。必须先列已核对依据，再列阶段结论，并明确问题对应的正文证据。

结构化结果格式：
{
  "score": 0,
  "status": "error|high|medium|low|pass",
  "summary": "本维度审查摘要",
  "issues": [
    {
      "severity": "error|warning|info",
      "type": "${dimension.key}",
      "message": "问题描述",
      "evidence": "正文片段",
      "relatedMemory": "相关大纲、记忆或设定",
      "suggestion": "修改建议",
      "impact": "对本维度的影响",
      "rewriteTarget": "建议 AI 修改时定位的原文片段"
    }
  ]
}

章节正文：
${chapterContent.slice(0, 8000)}`
}

export async function reviewChapterDimension({
  llmConfig,
  contextPack,
  chapterContent,
  dimension,
  callbacks = {},
}: {
  llmConfig: LlmConfig
  contextPack: ContextPack
  chapterContent: string
  dimension: SixReviewDimensionDefinition
  callbacks?: DimensionReviewCallbacks
}): Promise<DimensionReviewResult> {
  callbacks.onThinking?.(dimension.key, formatDimensionThinking(dimension, "正在读取上下文..."))
  const analysisPrompt = buildDimensionReviewPrompt(contextPack, chapterContent, dimension)
  const analysis = await runDimensionStage(
    llmConfig,
    dimension,
    analysisPrompt,
    callbacks,
  )

  const finalPrompt = [
    analysisPrompt,
    "",
    "阶段分析结果：",
    analysis,
    "",
    "最终 JSON：",
    "只输出最终 JSON 对象，不要输出解释、标题或 markdown。",
  ].join("\n")
  const finalText = await runDimensionStage(llmConfig, dimension, finalPrompt, callbacks)
  return parseDimensionReviewResult(dimension, finalText, analysis)
}

export async function runSixDimensionReview({
  projectPath,
  chapterContent,
  chapterNumber,
  dimensionKeys,
  callbacks = {},
}: {
  projectPath: string
  chapterContent: string
  chapterNumber?: number
  dimensionKeys?: SixReviewDimensionKey[]
  callbacks?: SixDimensionReviewCallbacks
}): Promise<Partial<Record<SixReviewDimensionKey, DimensionReviewResult>>> {
  const llmConfig = resolveNovelModel(
    useWikiStore.getState().llmConfig,
    useWikiStore.getState().novelConfig,
    "review",
  )
  if (!hasUsableLlm(llmConfig) || !useWikiStore.getState().novelMode) return {}

  const contextPack = await buildContextPack(
    projectPath,
    `六维审查第${chapterNumber || "?"}章`,
    chapterNumber,
  )

  const results: Partial<Record<SixReviewDimensionKey, DimensionReviewResult>> = {}
  for (const key of dimensionKeys ?? SIX_REVIEW_DIMENSION_ORDER) {
    const dimension = SIX_REVIEW_DIMENSIONS[key]
    callbacks.onDimensionProgress?.(key, `${dimension.label}：正在开始专业审查`)
    try {
      const result = await reviewChapterDimension({
        llmConfig,
        contextPack,
        chapterContent,
        dimension,
        callbacks: {
          onThinking: (dimensionKey, thinking) => {
            callbacks.onDimensionThinking?.(dimensionKey, thinking)
          },
        },
      })
      results[key] = result
      callbacks.onDimensionResult?.(key, result)
    } catch (error) {
      const result = buildFailedDimensionResult(dimension, error)
      results[key] = result
      callbacks.onDimensionThinking?.(key, result.thinking)
      callbacks.onDimensionResult?.(key, result)
    }
  }
  return results
}

async function runDimensionStage(
  llmConfig: LlmConfig,
  dimension: SixReviewDimensionDefinition,
  userPrompt: string,
  callbacks: DimensionReviewCallbacks,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: `你是专业网文审稿编辑，当前只负责“${dimension.label}”这一项审查。输出必须使用中文。` },
    { role: "user", content: userPrompt },
  ]
  let result = ""
  const streamCallbacks: StreamCallbacks = {
    onToken: (token: string) => {
      result += token
      callbacks.onThinking?.(dimension.key, formatDimensionThinking(dimension, result))
    },
    onDone: () => {},
    onError: (error: Error) => {
      console.error(`[Dimension Review] ${dimension.key} stream error:`, error)
    },
  }

  await streamChat(
    llmConfig,
    messages,
    streamCallbacks,
    AbortSignal.timeout(120000),
    { reasoning: { mode: useWikiStore.getState().novelConfig.reviewReasoningEffort ?? "high" } },
  )
  return result.trim()
}

function parseDimensionReviewResult(
  dimension: SixReviewDimensionDefinition,
  finalText: string,
  thinking: string,
): DimensionReviewResult {
  const jsonMatch = finalText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`${dimension.label}审查没有返回 JSON`)

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  const issues = Array.isArray(parsed.issues) ? parsed.issues : []
  return {
    dimensionKey: dimension.key,
    score: normalizeScore(parsed.score),
    status: validateStatus(parsed.status, issues.length),
    summary: String(parsed.summary || ""),
    thinking: formatDimensionThinking(dimension, thinking),
    issues: issues.map((item) => normalizeIssue(dimension.key, item as Record<string, unknown>)),
  }
}

function normalizeIssue(dimensionKey: SixReviewDimensionKey, item: Record<string, unknown>): DimensionReviewIssue {
  const evidence = String(item.evidence || "")
  return {
    severity: validateSeverity(item.severity),
    type: String(item.type || dimensionKey),
    dimensionKey,
    message: String(item.message || ""),
    evidence,
    relatedMemory: String(item.relatedMemory || ""),
    suggestion: String(item.suggestion || ""),
    impact: String(item.impact || ""),
    rewriteTarget: String(item.rewriteTarget || evidence),
  }
}

function buildFailedDimensionResult(
  dimension: SixReviewDimensionDefinition,
  error: unknown,
): DimensionReviewResult {
  const message = error instanceof Error ? error.message : "未知错误"
  return {
    dimensionKey: dimension.key,
    score: 0,
    status: "error",
    summary: `${dimension.label}审查失败：${message}`,
    thinking: formatDimensionThinking(dimension, `审查失败：${message}`),
    issues: [{
      severity: "error",
      type: dimension.key,
      dimensionKey: dimension.key,
      message: `${dimension.label}审查失败：${message}`,
      evidence: "",
      relatedMemory: "",
      suggestion: "请检查模型设置后重新审查此维度。",
      impact: "该维度暂时没有可用审查结果。",
      rewriteTarget: "",
    }],
  }
}

function formatDimensionThinking(dimension: SixReviewDimensionDefinition, content: string): string {
  return `## ${dimension.label}\n${content.trim()}`
}

function normalizeScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

function validateStatus(value: unknown, issueCount: number): DimensionReviewStatus {
  if (value === "error" || value === "high" || value === "medium" || value === "low" || value === "pass") {
    return value
  }
  return issueCount === 0 ? "pass" : "medium"
}

function validateSeverity(value: unknown): "error" | "warning" | "info" {
  if (value === "error" || value === "warning" || value === "info") return value
  return "warning"
}
