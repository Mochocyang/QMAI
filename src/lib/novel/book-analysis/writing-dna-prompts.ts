/**
 * Writing DNA 分层蒸馏的提示词与解析（feature/writing-dna）
 *
 * 取代原来"一次 LLM 出 9 个主观维度"的做法，改成 writing-dna 的分层蒸馏：
 *   L1 语言 + L6 排版节奏：把 style-metrics 算出的确定性数字喂给模型解读，不让它猜句长
 *   L2 章节结构：开场 hook、场景切换、章尾钩子、单章场景数
 *   L3-L5 认知框架：推进取舍、细节素材通道、作者价值判断
 *   整合：产出 Writing-DNA.md 正文（markdown，不是 JSON）+ 可执行风格硬约束
 *
 * 前三步输出 JSON 便于结构化落盘；整合步输出 markdown，避免 4000 字长文走 JSON 转义时被截断。
 */
import type { ChapterMetaAnnotation } from "./chapter-meta"
import { formatStyleMetricsForPrompt, type StyleMetrics } from "./style-metrics"
import { INTEGRATED_DNA_CHAR_LIMIT } from "./style-profile-schema"
import type { WritingDnaLayers } from "./types"

const SAMPLE_TEXT_LIMIT = 24000
const CONSTITUTION_SECTION_TITLE = "风格硬约束"

export interface StyleEvidenceCandidate {
  chapterId: string
  text: string
  tags: string[]
  reason: string
  purpose: string
}

/** L1 + L6 一次调用的产出。 */
export interface LanguageAndRhythmResult {
  languageDna: string
  rhythmGuide: string
  narrativeDensity: string
  sentenceStyle: string
  rhetoricDensity: string
  dialogueStyle: string
  vocabularyPreferences: string[]
  avoidPatterns: string[]
}

/** L2 一次调用的产出（顺带返回每章标注，避免为 chapter-meta 再加一次调用）。 */
export interface StructurePatternResult {
  structurePatterns: string
  transitionStyle: string
  descriptionWeight: string
  emotionRendering: string
  thematicHabits: string
  samples: string[]
  chapterMeta: ChapterMetaAnnotation[]
}

/** L3-L5 一次调用的产出。 */
export interface CognitiveFrameResult {
  cognitiveFrame: string
  narrativeVoice: string
  pointOfView: string
  humorMechanisms: string[]
  highEnergyMechanisms: string[]
}

/** 整合步的产出。 */
export interface IntegratedDnaResult {
  integratedDna: string
  constitution: string
}

/**
 * 兜底"通用朴素文风宪法"：解析失败 / 无 LLM 时使用，避免阻断。
 * 不依赖任何具体作品，描述的是"去炫技、重推进"的网文朴素风。
 */
export const FALLBACK_STYLE_CONSTITUTION = [
  "1. 叙事优先：每段都要推进剧情、信息或关系，不为氛围而写氛围。",
  "2. 环境描写克制：只写与当前动作/信息相关的具体实物，一般 1-2 句，禁止连续景物抒情。",
  "3. 情绪用动作和具体细节呈现，禁止“他感到/她心中/五味杂陈”式总结，点到即止。",
  "4. 句式以短句和中短句为主，禁止长比喻链、通感堆叠、排比堆字。",
  "5. 比喻克制：每千字不超过 1-2 处，且用日常化喻体。",
  "6. 过渡直接（“第二天”“三天后”），不写“时间一分一秒过去”式空转。",
  "7. 推进要快：能一句带过的时间、路程、重复动作就不展开。",
  "8. 不点题、不抒情、不在段尾总结，结尾只留钩子。",
].join("\n")

function truncate(value: string, limit: number): string {
  if (!value) return ""
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n\n…（样本过长已截断）…`
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item)).filter(Boolean)
}

/** 剥代码围栏后取最外层 {...}；拿不到返回 null。 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenceStripped = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const objectText = fenceStripped.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) return null
  try {
    return JSON.parse(objectText) as Record<string, unknown>
  } catch {
    return null
  }
}

const NO_EXTRA_OUTPUT = "只输出一个 JSON 对象，不要解释，不要 markdown 代码围栏。"
const SPECIFICITY_RULE = "每个字段都必须具体到能直接指导写作，禁止“节奏适中”“描写生动”这类空话。"

// === L1 语言 + L6 排版节奏 ===

/**
 * 把确定性统计喂进去让模型解读。模型的任务是解释这些数字意味着什么写法，
 * 而不是重新估算句长和标点频次——那些已经算准了。
 */
export function buildLanguageAndRhythmPrompt(
  metrics: StyleMetrics,
  sampleText: string,
  bookTitle: string,
): string {
  return [
    `你是小说文风分析专家。下面给出《${bookTitle}》若干章节的**确定性统计结果**和对应原文样本。`,
    "统计数字已经由脚本精确算出，你的任务是解读它们对应什么写法，并结合原文验证，不要重新估算这些数字。",
    "",
    "=== 脚本统计结果 ===",
    formatStyleMetricsForPrompt(metrics),
    "",
    "=== 原文样本 ===",
    truncate(sampleText, SAMPLE_TEXT_LIMIT),
    "",
    NO_EXTRA_OUTPUT,
    "字段要求：",
    "1. `languageDna`（L1 语言 DNA，600-1200 字中文）：解读句长分布、标点习惯、高频词与二元搭配、对白口语度。必须引用上面的具体数字，说明这些数字对应作者的什么习惯，并从原文举例印证。",
    "2. `rhythmGuide`（L6 排版与节奏，400-800 字中文）：解读段落长度分布、一句一段的使用时机、长段出现在什么场景、用什么方式分隔场景、章标题格式。同样要引用数字。",
    "3. `narrativeDensity`：叙事密度与推进速度，3-6 句。",
    "4. `sentenceStyle`：句式与句长、口语化程度，3-6 句。",
    "5. `rhetoricDensity`：比喻与通感的密度和喻体取材，3-6 句。",
    "6. `dialogueStyle`：对白风格（口语度、毛边、潜台词、对白标签用词），3-6 句。",
    "7. `vocabularyPreferences`：字符串数组，列出稳定的词汇、动词和口语偏好，优先取自上面的高频词表。",
    "8. `avoidPatterns`：字符串数组，列出仿写这种文风时应避免的写法。",
    "",
    "硬性要求：",
    "- 只分析语言与排版，不要分析剧情走向或人物性格。",
    `- ${SPECIFICITY_RULE}`,
    "- 统计结果里标注为近似的词频表，解读时要说明其局限，不要当成精确词表下结论。",
    "- JSON 之外不要输出任何内容。",
  ].join("\n")
}

export function parseLanguageAndRhythmResult(raw: string): LanguageAndRhythmResult {
  const parsed = extractJsonObject(raw)
  return {
    languageDna: asString(parsed?.languageDna),
    rhythmGuide: asString(parsed?.rhythmGuide),
    narrativeDensity: asString(parsed?.narrativeDensity),
    sentenceStyle: asString(parsed?.sentenceStyle),
    rhetoricDensity: asString(parsed?.rhetoricDensity),
    dialogueStyle: asString(parsed?.dialogueStyle),
    vocabularyPreferences: asStringArray(parsed?.vocabularyPreferences),
    avoidPatterns: asStringArray(parsed?.avoidPatterns),
  }
}

// === L2 章节结构 ===

export function buildStructurePatternPrompt(sampleText: string, bookTitle: string): string {
  return [
    `你是小说结构分析专家。请阅读《${bookTitle}》的章节原文样本，提炼这本书**每一章是怎么搭起来的**。`,
    "注意：分析的是可复用的结构骨架，不是复述剧情。",
    "",
    NO_EXTRA_OUTPUT,
    "字段要求：",
    "1. `structurePatterns`（L2 章节结构模板，800-1500 字中文）：按章节类型（如推进章、冲突章、过渡章、爆点章）分别给出可复用骨架，每类写成这种形式：",
    "   开场 hook 类型 + 大致字数 → 第一个转折点怎么出现 → 正文如何组织场景 → 章尾钩子类型。",
    "   同时说明：单章通常几个场景、场景之间怎么切、叙述与对白与描写的大致配比。",
    "2. `transitionStyle`：场景与时间过渡的具体做法，3-6 句。",
    "3. `descriptionWeight`：环境描写的比重与取材（具体实物 vs 抒情），3-6 句。",
    "4. `emotionRendering`：情绪呈现方式（动作外显 vs 内心独白、克制度），3-6 句。",
    "5. `thematicHabits`：点题、总结、抒情的习惯与位置，3-6 句。",
    "6. `samples`：从上面提供的原文中**原样摘抄** 4~6 段最能体现结构与文风的片段（每段 80~300 字）。必须原文照抄，不得改写或自编。",
    "7. `evidence`：3~8 个代表片段，每项含 chapterId、text、tags、reason、purpose。chapterId 必须取自样本标题里的章节 ID，text 必须是 80~300 字原文短片段，不得改写。",
    "8. `chapterMeta`：为样本里**每一章**返回一条标注，每项含：",
    "   `chapterId`（取自样本标题）、",
    "   `hookType`（开场 hook 类型，只能取：冲突式 / 场景式 / 对白式 / 悬念式 / 叙述式 / 问题式）、",
    "   `structurePattern`（章节结构类型，只能取：推进章 / 冲突章 / 过渡章 / 爆点章 / 信息章）、",
    "   `topicTags`（2-4 个题材标签，用于日后按题材检索相似章节，例如“宗门试炼”“家族斗争”“炼丹”）。",
    "",
    "硬性要求：",
    "- 结构模板必须覆盖至少 2 种章节类型；样本里只看得出 1 种时，明确说明只观察到 1 种。",
    "- chapterMeta 必须覆盖样本里出现的每一个章节 ID，不得遗漏也不得编造未出现的 ID。",
    `- ${SPECIFICITY_RULE}`,
    "- samples 与 evidence 必须来自提供的原文，不得虚构。",
    "- evidence 的 tags 要标明章尾钩子、场景切换、对白节奏等可检索特征。",
    "- JSON 之外不要输出任何内容。",
    "",
    "=== 原文样本 ===",
    truncate(sampleText, SAMPLE_TEXT_LIMIT),
  ].join("\n")
}

function parseChapterMetaAnnotations(value: unknown): ChapterMetaAnnotation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ChapterMetaAnnotation[] => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    const chapterId = asString(candidate.chapterId)
    if (!chapterId) return []
    return [{
      chapterId,
      hookType: asString(candidate.hookType),
      structurePattern: asString(candidate.structurePattern),
      topicTags: asStringArray(candidate.topicTags).slice(0, 6),
    }]
  })
}

export function parseStructurePatternResult(raw: string): StructurePatternResult {
  const parsed = extractJsonObject(raw)
  return {
    structurePatterns: asString(parsed?.structurePatterns),
    transitionStyle: asString(parsed?.transitionStyle),
    descriptionWeight: asString(parsed?.descriptionWeight),
    emotionRendering: asString(parsed?.emotionRendering),
    thematicHabits: asString(parsed?.thematicHabits),
    samples: asStringArray(parsed?.samples).slice(0, 6),
    chapterMeta: parseChapterMetaAnnotations(parsed?.chapterMeta),
  }
}

// === L3-L5 叙事视角与认知框架 ===

export function buildCognitiveFramePrompt(sampleText: string, bookTitle: string): string {
  return [
    `你是小说叙事分析专家。请阅读《${bookTitle}》的章节原文样本，提炼作者**怎么想**——`,
    "也就是他在推进情节时的取舍标准、细节素材的取材习惯、以及反复出现的价值判断。",
    "",
    NO_EXTRA_OUTPUT,
    "字段要求：",
    "1. `cognitiveFrame`（L3-L5 合并，1000-1800 字中文），必须包含以下三个小节，用 markdown 三级标题分隔：",
    "   `### 推进取舍（L3）`：什么时候进冲突、什么详写什么一句带过、哪类场景作者根本不写、爽点和压抑段的间隔节奏。",
    "   `### 细节素材（L4）`：偏好哪些感官通道、专业术语与数字的使用密度、生活细节从哪里取材、如何处理设定信息的投放。",
    "   `### 价值判断（L5）`：作者反复出现的核心命题（至少 3 条，且必须是不显而易见的）、他认为什么算“爽”、什么样的人物行为被默认为正当。",
    "2. `narrativeVoice`：叙述视角与叙述者声音，3-6 句。",
    "3. `pointOfView`：明确叙事人称与限知范围。",
    "4. `humorMechanisms`：字符串数组，说明幽默如何产生（如反差、一本正经地补刀、误解递进）；无明显幽默时返回空数组。",
    "5. `highEnergyMechanisms`：字符串数组，说明高燃段落如何抬压、加速和兑现；无明显特征时返回空数组。",
    "",
    "硬性要求：",
    "- 核心命题必须从原文归纳，不能套用通用网文常识。",
    "- 不要复述剧情，不要评价作品好坏。",
    `- ${SPECIFICITY_RULE}`,
    "- JSON 之外不要输出任何内容。",
    "",
    "=== 原文样本 ===",
    truncate(sampleText, SAMPLE_TEXT_LIMIT),
  ].join("\n")
}

export function parseCognitiveFrameResult(raw: string): CognitiveFrameResult {
  const parsed = extractJsonObject(raw)
  return {
    cognitiveFrame: asString(parsed?.cognitiveFrame),
    narrativeVoice: asString(parsed?.narrativeVoice),
    pointOfView: asString(parsed?.pointOfView),
    humorMechanisms: asStringArray(parsed?.humorMechanisms),
    highEnergyMechanisms: asStringArray(parsed?.highEnergyMechanisms),
  }
}

// === 整合：Writing-DNA.md ===

/**
 * 整合步输出 markdown 而不是 JSON：整合文档有数千字并且含 markdown 结构，
 * 走 JSON 字符串转义时被截断或转义错误的概率太高。
 */
export function buildDnaIntegrationPrompt(
  layers: WritingDnaLayers,
  metrics: StyleMetrics,
  bookTitle: string,
): string {
  return [
    `你是文风蒸馏专家。下面是《${bookTitle}》已完成的分层分析结果和脚本统计。`,
    `请把它们整合成一份可直接喂给 AI 复刻文风的总纲，**总字数不超过 ${INTEGRATED_DNA_CHAR_LIMIT} 字**。`,
    "超出上限说明没蒸馏干净——要压掉重复和形容词，保留可执行的规则和具体数字。",
    "",
    "直接输出 markdown 正文，不要 JSON，不要代码围栏，不要任何前言后语。必须包含以下小节：",
    "",
    "## 语言特征",
    "句长与短句比例的目标区间、标点习惯、必用与禁用词汇。要带上具体数字。",
    "",
    "## 章节结构",
    "按章节类型给出骨架，每类不超过 6 行。",
    "",
    "## 推进与素材取舍",
    "什么详写什么略写、细节从哪些感官通道取。",
    "",
    "## 核心认知框架",
    "作者反复出现的核心命题，不超过 5 条。",
    "",
    "## 排版与节奏",
    "段落长度目标、一句一段的使用时机、场景分隔方式。",
    "",
    `## ${CONSTITUTION_SECTION_TITLE}`,
    "8~12 条编号硬约束，每条一行，格式为「数字. 约束内容，因为作者的理由」。",
    "每条必须是可直接执行的写作指令（写什么/不写什么、多少字以内），不能是空泛原则。",
    "这一节会被单独抽出来注入生成，必须自洽可独立阅读。",
    "",
    "=== 脚本统计 ===",
    formatStyleMetricsForPrompt(metrics),
    "",
    "=== L1 语言 DNA ===",
    layers.languageDna || "（未提取）",
    "",
    "=== L2 章节结构模板 ===",
    layers.structurePatterns || "（未提取）",
    "",
    "=== L3-L5 叙事视角与认知框架 ===",
    layers.cognitiveFrame || "（未提取）",
    "",
    "=== L6 排版与节奏 ===",
    layers.rhythmGuide || "（未提取）",
  ].join("\n")
}

/**
 * 解析整合结果：整篇 markdown 作为 integratedDna，
 * 再把「风格硬约束」小节单独抽出来作为 constitution（注入降级时用）。
 */
export function parseIntegratedDnaResult(raw: string): IntegratedDnaResult {
  const fenceStripped = raw.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const integratedDna = fenceStripped.trim()
  if (!integratedDna) {
    return { integratedDna: "", constitution: FALLBACK_STYLE_CONSTITUTION }
  }

  // 结尾用 (?![\s\S]) 表示"输入结束"：m 标志下的 $ 只到行尾，会把小节切成第一行
  const sectionPattern = new RegExp(
    `^#{1,4}\\s*${CONSTITUTION_SECTION_TITLE}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|(?![\\s\\S]))`,
    "m",
  )
  const section = integratedDna.match(sectionPattern)?.[1]?.trim() ?? ""
  // 没有小节时兜底：抓连续的编号行，仍抓不到才用通用宪法
  const numberedLines = section
    ? section
    : (integratedDna.match(/^\s*\d+[.、][^\n]+$/gm) ?? []).join("\n").trim()

  return {
    integratedDna,
    constitution: numberedLines || FALLBACK_STYLE_CONSTITUTION,
  }
}

/**
 * 从整合文档里摘掉「风格硬约束」小节。
 * 注入时硬约束单独放在最前面保证不被截断，正文再跟上，避免同一段内容注入两遍。
 */
export function stripConstitutionSection(integratedDna: string): string {
  const pattern = new RegExp(
    `^#{1,4}\\s*${CONSTITUTION_SECTION_TITLE}[^\\n]*\\n[\\s\\S]*?(?=\\n#{1,4}\\s|(?![\\s\\S]))`,
    "m",
  )
  return integratedDna.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim()
}

// === 证据片段（L2 调用附带返回）===

export function parseStyleEvidenceResult(raw: string): StyleEvidenceCandidate[] {
  const parsed = extractJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.evidence)) return []
  return parsed.evidence.flatMap((item): StyleEvidenceCandidate[] => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    const chapterId = asString(candidate.chapterId)
    const text = asString(candidate.text)
    if (!chapterId || !text) return []
    return [{
      chapterId,
      text,
      tags: asStringArray(candidate.tags),
      reason: asString(candidate.reason),
      purpose: asString(candidate.purpose),
    }]
  }).slice(0, 8)
}

// === 多分片汇总 ===

/** 把多个分片的同一层文本交给模型去重合并（分片数 > 1 时才调用）。 */
export function buildLayerAggregatePrompt(
  layerLabel: string,
  chunkTexts: string[],
  bookTitle: string,
): string {
  return [
    `你是文风汇总专家。以下是《${bookTitle}》不同章节区块各自得出的「${layerLabel}」分析结果。`,
    "请合并成一份：去掉重复、剔除只在单个区块出现的偶发特征、保留所有具体数字和可执行规则。",
    "直接输出合并后的正文，保持与输入相同的语言和 markdown 结构，不要 JSON，不要代码围栏，不要前言。",
    "不得引入未分析章节的内容，不得复述剧情。",
    "",
    ...chunkTexts.map((text, index) => `=== 区块 ${index + 1} ===\n${text}`),
  ].join("\n\n")
}

export function parseLayerAggregateResult(raw: string): string {
  const fenceStripped = raw.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  return fenceStripped.trim()
}
