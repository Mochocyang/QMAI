/**
 * BookStyleProfile v1 → v2 迁移与分层产物元数据（feature/writing-dna）
 *
 * v1 是单轮 LLM 出的 9 个主观维度；v2 是 writing-dna 的分层蒸馏（L1-L6 + 整合文档）。
 * 磁盘上和 .qmai/writing-style.json 里都可能存着 v1 数据，所有读取入口都要先过 migrate。
 * 迁移只做无损搬运：把 v1 的 9 个维度按层归类拼成 layers，绝不凭空造内容。
 */
import { computeStyleMetrics } from "./style-metrics"
import type { BookStyleProfile, WritingDnaLayers } from "./types"

/** 分层产物的层次元数据：key 对应 WritingDnaLayers 字段，fileName 是落盘文件名。 */
export const WRITING_DNA_LAYERS = [
  {
    key: "languageDna",
    level: "L1",
    label: "语言 DNA",
    fileName: "语言DNA.md",
    summary: "句长分布、标点习惯、高频词与二元搭配、对白口语度",
  },
  {
    key: "structurePatterns",
    level: "L2",
    label: "章节结构模板",
    fileName: "章节结构模板.md",
    summary: "开场 hook、场景切换、章尾钩子、单章场景数、叙述与对白配比",
  },
  {
    key: "cognitiveFrame",
    level: "L3-L5",
    label: "叙事视角与认知框架",
    fileName: "叙事视角与认知框架.md",
    summary: "推进取舍、细节素材通道、作者价值判断与反复命题",
  },
  {
    key: "rhythmGuide",
    level: "L6",
    label: "排版与节奏指南",
    fileName: "排版节奏指南.md",
    summary: "段落长度节奏、一句一段用法、分隔方式、章标题格式",
  },
] as const satisfies ReadonlyArray<{
  key: keyof WritingDnaLayers
  level: string
  label: string
  fileName: string
  summary: string
}>

export const INTEGRATED_DNA_FILE_NAME = "Writing-DNA.md"
/** 整合文档字数上限：超过说明没蒸馏干净（沿用 writing-dna-skill 的质量标准）。 */
export const INTEGRATED_DNA_CHAR_LIMIT = 4000

/** v1 的 9 个维度归属到哪一层——迁移时按此拼接。 */
const V1_DIMENSION_LAYER_MAP: Array<{
  key: keyof BookStyleProfile
  label: string
  layer: keyof WritingDnaLayers
}> = [
  { key: "narrativeDensity", label: "叙事密度 / 节奏", layer: "languageDna" },
  { key: "sentenceStyle", label: "句式与句长 / 口语化程度", layer: "languageDna" },
  { key: "rhetoricDensity", label: "比喻 / 通感密度", layer: "languageDna" },
  { key: "dialogueStyle", label: "对白风格", layer: "languageDna" },
  { key: "transitionStyle", label: "场景与时间过渡方式", layer: "structurePatterns" },
  { key: "descriptionWeight", label: "环境描写比重", layer: "structurePatterns" },
  { key: "emotionRendering", label: "情绪呈现", layer: "structurePatterns" },
  { key: "thematicHabits", label: "点题 / 总结 / 抒情习惯", layer: "structurePatterns" },
  { key: "narrativeVoice", label: "叙述视角与声音", layer: "cognitiveFrame" },
  { key: "pointOfView", label: "叙事人称与限知范围", layer: "cognitiveFrame" },
]

export function emptyWritingDnaLayers(): WritingDnaLayers {
  return { languageDna: "", structurePatterns: "", cognitiveFrame: "", rhythmGuide: "" }
}

/** v2 判定：有 layers 且至少一层非空，或者有 integratedDna。 */
export function isWritingDnaProfile(profile: BookStyleProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.integratedDna?.trim()) return true
  const layers = profile.layers
  if (!layers) return false
  return Object.values(layers).some((value) => typeof value === "string" && value.trim().length > 0)
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * 把 v1 profile 的 9 个维度按层归类，拼成 layers 文本。
 * 只搬运已有内容；rhythmGuide 在 v1 里没有对应维度，留空并由调用方按需重跑。
 */
function layersFromV1Dimensions(profile: BookStyleProfile): WritingDnaLayers {
  const buckets = emptyWritingDnaLayers()
  const collected: Record<keyof WritingDnaLayers, string[]> = {
    languageDna: [],
    structurePatterns: [],
    cognitiveFrame: [],
    rhythmGuide: [],
  }
  for (const item of V1_DIMENSION_LAYER_MAP) {
    const text = asText(profile[item.key])
    if (text) collected[item.layer].push(`**${item.label}**：${text}`)
  }
  if (profile.vocabularyPreferences?.length) {
    collected.languageDna.push(`**词汇偏好**：${profile.vocabularyPreferences.join("、")}`)
  }
  if (profile.humorMechanisms?.length) {
    collected.cognitiveFrame.push(`**幽默机制**：${profile.humorMechanisms.join("；")}`)
  }
  if (profile.highEnergyMechanisms?.length) {
    collected.cognitiveFrame.push(`**热血机制**：${profile.highEnergyMechanisms.join("；")}`)
  }
  if (profile.avoidPatterns?.length) {
    collected.structurePatterns.push(`**应避免的写法**：${profile.avoidPatterns.join("；")}`)
  }
  for (const key of Object.keys(collected) as Array<keyof WritingDnaLayers>) {
    buckets[key] = collected[key].join("\n\n")
  }
  return buckets
}

/**
 * 读盘后统一入口：把任意版本的 profile 规范化成 v2 形状。
 * v1 数据迁移后 integratedDna 仍为空，注入侧会降级用 constitution，
 * 并在 UI 上提示"由旧版画像迁移，建议重新提取"。
 */
export function migrateStyleProfile(input: BookStyleProfile): BookStyleProfile {
  const layers = input.layers && Object.keys(input.layers).length > 0
    ? { ...emptyWritingDnaLayers(), ...input.layers }
    : layersFromV1Dimensions(input)

  return {
    ...input,
    schemaVersion: 2,
    layers,
    metrics: input.metrics ?? computeStyleMetrics([]),
    integratedDna: asText(input.integratedDna),
    constitution: asText(input.constitution),
    samples: Array.isArray(input.samples) ? input.samples : [],
    sampledChapterIds: Array.isArray(input.sampledChapterIds) ? input.sampledChapterIds : [],
  }
}

/** 迁移而来但没有真正 v2 内容的画像——UI 应提示重新提取。 */
export function needsReextraction(profile: BookStyleProfile | null | undefined): boolean {
  if (!profile) return false
  return !isWritingDnaProfile(profile) || !profile.metrics || profile.metrics.counts.chapters === 0
}
