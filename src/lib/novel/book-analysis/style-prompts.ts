/**
 * 作品级写作文风提取 - 提示词 + 解析（feature/book-style-extraction）
 *
 * 目标：从抽样章节正文提炼"作者的叙事文风"（不是人物说话方式）：
 * 叙事密度、描写克制度、情绪呈现、句式、比喻频率、过渡、视角、对白、点题习惯。
 * 产出结构化维度 + 可注入的"风格宪法" + 3~6 段代表原文样本（few-shot）。
 */
import type { BookStyleProfile } from "./types"

/** 结构化文风维度（key 与 BookStyleProfile 字段对应，label 供 UI / 提示词使用）。 */
export const STYLE_DIMENSIONS = [
  { key: "narrativeDensity", label: "叙事密度 / 节奏" },
  { key: "descriptionWeight", label: "环境描写比重（具体 vs 抒情）" },
  { key: "emotionRendering", label: "情绪呈现（动作外显 vs 内心独白；克制度）" },
  { key: "sentenceStyle", label: "句式与句长 / 口语化程度" },
  { key: "rhetoricDensity", label: "比喻 / 通感密度" },
  { key: "transitionStyle", label: "场景与时间过渡方式" },
  { key: "narrativeVoice", label: "叙述视角与声音" },
  { key: "dialogueStyle", label: "对白风格（口语 / 毛边 / 潜台词）" },
  { key: "thematicHabits", label: "点题 / 总结 / 抒情习惯" },
] as const

export type StyleDimensionKey = typeof STYLE_DIMENSIONS[number]["key"]

const SAMPLE_TEXT_LIMIT = 24000

function truncate(value: string, limit: number): string {
  if (!value) return ""
  if (value.length <= limit) return value
  return value.slice(0, limit) + "\n\n…（样本过长已截断）…"
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

export function buildStyleExtractionPrompt(sampleText: string, bookTitle: string): string {
  const dimensionLines = STYLE_DIMENSIONS.map((d) => `- ${d.key}：${d.label}`).join("\n")
  return [
    `你是小说文风分析专家。请仔细阅读《${bookTitle}》的若干章节原文样本，提炼这本书**作者的叙事文风**（不是人物的说话方式，也不要复述剧情）。`,
    "",
    "你要分析的维度：",
    dimensionLines,
    "",
    "只输出一个 JSON 对象，不要解释，不要 markdown 代码围栏。字段要求：",
    "1. 上述每个维度 key 都要有一个**详细**的中文字符串值（3-6 句），深入描述这本书在该维度上的具体特征。必须包含：",
    "   - 该维度的核心特征是什么",
    `   - 作者具体是怎么做的（举例说明，如\u201C常用XX句式\u201D\u201C倾向于XX方式\u201D）`,
    "   - 与常见写法的差异点",
    `   绝不要泛泛而谈（如\u201C节奏适中\u201D\u201C描写生动\u201D），必须具体到可指导写作的程度。`,
    `2. \`constitution\`：把以上维度合成为 8~12 条**可执行的硬约束**（编号列表，写进同一个字符串，用换行分隔），用于约束 AI 之后按这种文风写作。每条约束必须具体到\u201C怎么写/不怎么写\u201D，并附带简短的理由，例如\u201C环境描写控制在2句以内，因为作者偏好用动作带出场景而非静态铺陈\u201D\u201C比喻只用日常喻体，因为作者的比喻总是接地气的而非文学化的\u201D。`,
    "3. `samples`：从上面提供的原文样本中，**原样摘抄** 4~6 段最能代表这种文风的片段（每段 80~300 字），放进字符串数组。必须是原文照抄，不要改写、不要自己编。优先选择能同时体现多个维度特征的段落。",
    "",
    "硬性要求：",
    "- 只分析文风，不要分析人物性格或剧情走向。",
    "- 每个维度的描述必须包含具体的写作手法和用词习惯，不能只给笼统评价。",
    "- constitution 中的每条约束都必须是可操作的写作指令，不能是空泛的原则。",
    "- samples 必须来自提供的原文，不得虚构。",
    "- JSON 之外不要输出任何内容。",
    "",
    `作品：${bookTitle}`,
    "",
    "原文样本（已截断）：",
    truncate(sampleText, SAMPLE_TEXT_LIMIT),
  ].join("\n")
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item)).filter(Boolean)
}

/**
 * 解析模型返回的文风 JSON。容错：剥代码围栏 + 取最外层 {...}。
 * 解析失败或缺 constitution 时，返回带兜底宪法的最小 profile（不抛错）。
 */
export function parseStyleProfileResult(raw: string, sampledChapterIds: string[]): BookStyleProfile {
  const base: BookStyleProfile = {
    schemaVersion: 1,
    generatedAt: 0, // 由调用方在返回后盖时间戳（避免 Date 在纯函数里）
    sampledChapterIds,
    narrativeDensity: "",
    descriptionWeight: "",
    emotionRendering: "",
    sentenceStyle: "",
    rhetoricDensity: "",
    transitionStyle: "",
    narrativeVoice: "",
    dialogueStyle: "",
    thematicHabits: "",
    constitution: FALLBACK_STYLE_CONSTITUTION,
    samples: [],
  }

  const fenceStripped = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const objectText = fenceStripped.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) return base

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(objectText) as Record<string, unknown>
  } catch {
    return base
  }

  const constitution = asString(parsed.constitution)
  return {
    ...base,
    narrativeDensity: asString(parsed.narrativeDensity),
    descriptionWeight: asString(parsed.descriptionWeight),
    emotionRendering: asString(parsed.emotionRendering),
    sentenceStyle: asString(parsed.sentenceStyle),
    rhetoricDensity: asString(parsed.rhetoricDensity),
    transitionStyle: asString(parsed.transitionStyle),
    narrativeVoice: asString(parsed.narrativeVoice),
    dialogueStyle: asString(parsed.dialogueStyle),
    thematicHabits: asString(parsed.thematicHabits),
    constitution: constitution || FALLBACK_STYLE_CONSTITUTION,
    samples: asStringArray(parsed.samples).slice(0, 6),
  }
}
