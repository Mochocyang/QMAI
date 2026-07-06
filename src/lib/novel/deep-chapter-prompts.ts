import type { NovelReviewResult } from "./review-adapter"
import { buildGoldenThreeChapterDirective, type GoldenThreeChapterRequest } from "./golden-three-chapters"
import { CHINESE_NOVEL_DE_AI_RULES } from "./de-ai-rules"

export const DEEP_CHAPTER_TARGET_CHARS = 3000
export const DEEP_CHAPTER_MIN_CHARS = 2200
export const DEEP_CHAPTER_DRAFT_MAX_CHARS = 3500
export const DEEP_CHAPTER_MAX_OUTPUT_TOKENS = 8000

/** 章节生成字数规格：由设置中的“单章目标字数”推算（issue #8）。 */
export interface ChapterLengthSpec {
  targetChars: number
  minChars: number
  draftMaxChars: number
  maxOutputTokens: number
}

export const DEFAULT_CHAPTER_LENGTH_SPEC: ChapterLengthSpec = {
  targetChars: DEEP_CHAPTER_TARGET_CHARS,
  minChars: DEEP_CHAPTER_MIN_CHARS,
  draftMaxChars: DEEP_CHAPTER_DRAFT_MAX_CHARS,
  maxOutputTokens: DEEP_CHAPTER_MAX_OUTPUT_TOKENS,
}

export function resolveChapterLengthSpec(targetChars?: number): ChapterLengthSpec {
  const target = Number.isFinite(targetChars) && (targetChars as number) > 0
    ? Math.max(2000, Math.min(6000, Math.round(targetChars as number)))
    : DEEP_CHAPTER_TARGET_CHARS
  if (target === DEEP_CHAPTER_TARGET_CHARS) return DEFAULT_CHAPTER_LENGTH_SPEC
  return {
    targetChars: target,
    // 与默认 2200/3000 保持同一比例，最低不少于 300 字
    minChars: Math.max(300, Math.round(target * (DEEP_CHAPTER_MIN_CHARS / DEEP_CHAPTER_TARGET_CHARS))),
    draftMaxChars: target + (DEEP_CHAPTER_DRAFT_MAX_CHARS - DEEP_CHAPTER_TARGET_CHARS),
    // 中文正文约 1-2 token/字，给草稿上限留足输出空间
    maxOutputTokens: Math.max(DEEP_CHAPTER_MAX_OUTPUT_TOKENS, Math.ceil((target + 500) * 2)),
  }
}

function chapterLengthBoundary(lengthSpec: ChapterLengthSpec): string {
  return `目标约 ${lengthSpec.targetChars} 字；低于 ${lengthSpec.minChars} 字视为正文初稿未完成。`
}

/**
 * 跨阶段稳定上下文前缀：把“完整大纲 + 上下文包”放在每个阶段提示词的最前面，
 * 且在同一次章节生成里逐字节相同。
 *
 * 任务书 / 初稿 / 扩写 / 返修 / 去AI味这几个阶段都由同一份 outline + contextPrompt
 * 拼出相同前缀，DeepSeek / OpenAI 的自动前缀缓存即可命中这段最大的内容，
 * 重复阶段按命中价计费（约 1/10），不再每阶段全价重发整段上下文。
 *
 * 因此阶段专属指令、写作任务书、初稿正文、审稿问题等“会变的内容”必须排在这段
 * 前缀之后，不能插到前面，否则会把公共前缀截断、缓存失效。
 */
export function buildStableContextPrefix(outline: string, contextPrompt: string): string {
  return [
    outline,
    "上下文：",
    contextPrompt,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterBriefPrompt(
  outline: string,
  contextPrompt: string,
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
  lengthSpec: ChapterLengthSpec = DEFAULT_CHAPTER_LENGTH_SPEC,
  planBlueprint?: string,
  executionContractText?: string,
): string {
  const contractSection = executionContractText && executionContractText.trim()
    ? [
        "",
        "## 用户确认计划的执行清单",
        "以下执行清单是本阶段写作任务书的权威依据。不得重新设计剧情，只能把清单落实到正文。",
        "",
        executionContractText.trim(),
      ].join("\n")
    : ""

  const blueprintSection = !contractSection && planBlueprint && planBlueprint.trim()
    ? [
        "",
        "## 用户已确认的章节计划执行摘要",
        "以下计划摘要来自用户确认的完整章节计划，是本阶段写作任务书的权威依据。",
        "严格遵循计划中的场景序列、信息流、伏笔动作、边界禁忌与结尾钩子；不得推翻或新增冲突情节，只补执行细节。",
        "",
        planBlueprint.trim(),
      ].join("\n")
    : ""

  const contractPlanningDirectives = [
    "硬性要求：",
    "1. 只输出任务书，不要写故事片段。",
    "2. 任务书必须逐项承接执行清单中的 S 场景、必须执行、禁止违背和章末钩子。",
    "3. 不得重新设计剧情，不得合并、跳过或调换 S 场景顺序。",
    `4. 后续正文必须按完整章节规划，${chapterLengthBoundary(lengthSpec)}`,
  ].join("\n")

  const planBlueprintDirectives = [
    "硬性要求：",
    "1. 只输出任务书，不要写故事片段。",
    "2. 以用户确认的计划为骨架逐场景落地：必须完成、禁止违背、角色状态、伏笔推进、结尾钩子都与计划一致。",
    "3. 若计划摘要含 S1/S2/S3，任务书必须逐条展开 S1/S2/S3，不得合并、跳过或调换顺序。",
    "4. 不新增计划未涵盖的主线推进、伏笔动作或人物变化；计划有缺失时只给最小补全方向。",
    `5. 后续正文必须按完整章节规划，${chapterLengthBoundary(lengthSpec)}`,
    "6. 任务书必须覆盖场景推进、冲突升级、人物互动、细节描写、章节节奏曲线、爽点/期待点、对话目标和开头/结尾执行要求。",
  ].join("\n")

  const defaultPlanningDirectives = [
    "硬性要求：",
    "1. 只输出任务书，不要写故事片段。",
    "2. 必须列出本章必须完成、禁止违背、角色状态、伏笔推进、结尾钩子。",
    "3. 如果上下文不足，写明缺失项，并给出最小补全方向。",
    `4. 后续正文必须按完整章节规划，${chapterLengthBoundary(lengthSpec)}`,
    "5. 任务书必须覆盖场景推进、冲突升级、人物互动、细节描写、章节节奏曲线、爽点/期待点、主要对话目标、开头承接方式和结尾钩子执行方式。",
  ].join("\n")

  const planningDirectives = contractSection
    ? contractPlanningDirectives
    : planBlueprint && planBlueprint.trim()
    ? [
        planBlueprintDirectives,
      ].join("\n")
    : defaultPlanningDirectives

  return [
    buildStableContextPrefix(outline, contextPrompt),
    "",
    "你是小说写作任务规划助手。",
    "请基于上述上下文输出一份写作任务书，供后续创作使用。",
    "",
    planningDirectives,
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    contractSection || blueprintSection,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterDraftPrompt(
  outline: string,
  contextPrompt: string,
  taskBrief: string,
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
  lengthSpec: ChapterLengthSpec = DEFAULT_CHAPTER_LENGTH_SPEC,
): string {
  return [
    buildStableContextPrefix(outline, contextPrompt),
    "",
    "你是专业小说正文写作助手。",
    "请严格根据上述上下文和下方写作任务书起草章节正文。",
    "",
    "输出要求：",
    "1. 只输出可直接保存到章节库的小说正文。",
    `2. ${chapterTitleRequirement()}`,
    "3. 不要输出分析、任务书、审稿说明、引用来源或后续建议。",
    "4. 严格承接上一章结尾，遵守大纲、记忆、人设、伏笔和时间线。",
    "5. 结尾必须留下适合下一章继续推进的钩子。",
    `6. 字数必须接近完整章节长度：${chapterLengthBoundary(lengthSpec)}阶段3正文草稿最多 ${lengthSpec.draftMaxChars} 字，写到完整结尾后立即停止；不能提前收尾，也不能为了补细节新增额外场景。`,
    "7. 必须写成完整章节，不要只写片段；包含场景铺陈、行动推进、对话交锋、情绪变化、冲突升级和结尾钩子。",
    "8. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。",
    "9. 不要写成说明文：不解释设计、不替角色总结动机、不用旁白概括冲突；信息必须通过动作、对话、场景细节、人物反应呈现。",
    "10. 开头承接上一章并立刻给当前问题；结尾完成阶段结果，并留下下一章必须解决的动作、信息或危险。",
    "11. 对话必须有目标和攻防，通过试探、隐瞒、压迫、诱导或回避推动关系或信息状态变化，禁止无用闲聊。",
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    "",
    "写作任务书：",
    taskBrief,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterRevisionPrompt(
  outline: string,
  contextPrompt: string,
  taskBrief: string,
  draftContent: string,
  reviewResults: NovelReviewResult[],
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
): string {
  return [
    buildStableContextPrefix(outline, contextPrompt),
    "",
    "你是小说正文返修助手。",
    "请根据审稿问题返修章节正文。",
    "",
    "硬性要求：",
    "1. 只输出返修后的小说正文。",
    `2. ${chapterTitleRequirement()}`,
    "3. 不要输出解释、审稿说明、修改清单或后续建议。",
    "4. 优先修复审稿指出的问题，不要无关改写。",
    "5. 必须继续遵守写作任务书和上下文。",
    "6. 不再强制调整到固定字数区间；只修复审稿指出的阻断问题，并保留当前章节的有效剧情容量。",
    "7. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。",
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    "",
    "写作任务书：",
    taskBrief,
    "",
    "审稿问题：",
    formatReviewIssues(reviewResults),
    "",
    "原始初稿：",
    draftContent,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterExpansionPrompt(
  outline: string,
  contextPrompt: string,
  taskBrief: string,
  currentContent: string,
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
  lengthSpec: ChapterLengthSpec = DEFAULT_CHAPTER_LENGTH_SPEC,
): string {
  return [
    buildStableContextPrefix(outline, contextPrompt),
    "",
    "你是小说正文扩写补足助手。",
    "当前章节正文明显过短，请在不推翻已有内容的前提下扩写补足为完整章节。",
    "",
    "硬性要求：",
    "1. 只输出扩写补足后的完整小说正文。",
    `2. ${chapterTitleRequirement()}`,
    "3. 必须保留并自然融合原有正文的有效内容，不要输出解释、分析或修改说明。",
    `4. ${chapterLengthBoundary(lengthSpec)}`,
    "5. 扩写时补足场景铺陈、动作细节、对话交锋、心理变化、冲突升级和结尾钩子。",
    "6. 必须严格遵守写作任务书、上下文、人物状态、伏笔和时间线，不要新增会推翻设定的剧情。",
    "7. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。",
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    "",
    "写作任务书：",
    taskBrief,
    "",
    "当前过短正文：",
    currentContent,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterFinalPolishPrompt(
  outline: string,
  contextPrompt: string,
  taskBrief: string,
  currentContent: string,
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
  customDeAiSkill?: string,
): string {
  const deAiRules = customDeAiSkill && customDeAiSkill.trim() ? customDeAiSkill.trim() : CHINESE_NOVEL_DE_AI_RULES
  return [
    buildStableContextPrefix(outline, contextPrompt),
    "",
    "你是小说正文最终质检与去AI味助手。",
    "请对二次审查/返修后的章节做最后一遍简单审查，并进行去AI味处理。",
    "",
    "处理目标：",
    "1. 检查是否存在明显复读、循环段落、前后矛盾、突兀跳转、解释腔和机械套话。",
    "2. 去掉 AI 味：减少总结腔、模板句、过度解释、相同句式堆叠和空泛形容。",
    "3. 保留原有剧情事实、人物关系、时间线、伏笔和章节结尾钩子，不要另起新剧情。",
    "4. 只做必要的自然化、顺滑化和轻量修补，不要大幅重写。",
    "5. 不再强制压缩到固定字数区间；只做必要的自然化、顺滑化和轻量修补，禁止为了凑字数复读。",
    `6. ${chapterTitleRequirement()}`,
    "7. 只输出最终可保存的小说正文，不要输出审查报告、解释或修改说明。",
    "",
    deAiRules,
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    "",
    "写作任务书：",
    taskBrief,
    "",
    "待最终简单审查与去AI味正文：",
    currentContent,
  ].filter(Boolean).join("\n")
}

export function buildDeepChapterLengthRewritePrompt(
  contextPrompt: string,
  taskBrief: string,
  currentContent: string,
  userRequest: string,
  chapterNumber?: number,
  goldenThreeChapter?: GoldenThreeChapterRequest,
  options?: { autoGenerateTitle?: boolean },
): string {
  const autoTitle = options?.autoGenerateTitle !== false
  return [
    "你是小说正文轻量整理助手。",
    "请基于阶段3正文草稿做必要整理，在不影响剧情主线、人物行动、关键冲突和结尾钩子的前提下，酌情删减明显重复、循环输出和无效解释。",
    "",
    "硬性要求：",
    "1. 只输出优化后的完整小说正文，不要输出解释、分析或修改说明。",
    autoTitle ? `2. ${chapterTitleRequirement()}` : "2. 不要输出章节标题。",
    "3. 不强制压缩到固定字数区间；保留当前章节的有效剧情容量。",
    "4. 如果当前正文明显重复或循环，优先删掉重复内容，不得继续扩写。",
    "5. 不得改变剧情因果、人物目标、已完成事件、关键对话含义和下一章钩子。",
    "6. 可以优化环境、氛围、心理和过渡，但每一段都必须推动剧情、冲突、人物关系或期待。",
    "7. 写到完整结尾后立即停止。",
    "",
    chapterNumber ? `目标章节：第${chapterNumber}章` : "目标章节：用户请求中的章节",
    `用户请求：${userRequest}`,
    goldenThreeChapterSection(goldenThreeChapter),
    "",
    "写作任务书：",
    taskBrief,
    "",
    "当前过长正文：",
    currentContent,
    "",
    "上下文：",
    contextPrompt,
  ].join("\n")
}

function goldenThreeChapterSection(goldenThreeChapter?: GoldenThreeChapterRequest): string {
  return buildGoldenThreeChapterDirective(goldenThreeChapter)
}

/** 章节标题输出要求（当 autoGenerateTitle 为 true 时使用）。 */
function chapterTitleRequirement(): string {
  return "正文第一行必须是章节标题，格式为：# 第X章 标题名（标题4-12字，概括本章核心内容）。"
}

function formatReviewIssues(reviewResults: NovelReviewResult[]): string {
  if (reviewResults.length === 0) return "未发现问题。"
  return reviewResults
    .map((item, index) => [
      `${index + 1}. [${item.severity}] ${item.message}`,
      item.evidence ? `证据：${item.evidence}` : "",
      item.relatedMemory ? `相关记忆：${item.relatedMemory}` : "",
      item.suggestion ? `建议：${item.suggestion}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n")
}
