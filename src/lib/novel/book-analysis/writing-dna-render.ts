/**
 * Writing DNA 分层产物的 markdown 渲染（feature/writing-dna）
 *
 * 取代原 style-extraction-engine 里的 styleProfileToMarkdown。
 * 每一层单独出一个文件，整合文档单独出 Writing-DNA.md：
 * 分层产物保留具体语感，整合文档是压缩后的结论——两者都要留，不能只留整合的那份。
 */
import type { ChapterMetaEntry } from "./chapter-meta"
import { formatChapterMetaForMarkdown } from "./chapter-meta"
import { formatStyleMetricsForMarkdown } from "./style-metrics"
import {
  INTEGRATED_DNA_CHAR_LIMIT,
  WRITING_DNA_LAYERS,
  isWritingDnaProfile,
} from "./style-profile-schema"
import type { BookStyleProfile, WritingDnaLayers } from "./types"

export interface RenderedDnaFile {
  fileName: string
  content: string
}

function header(bookTitle: string, level: string, label: string, chapterCount: number): string[] {
  return [
    `# 《${bookTitle}》${label}（${level}）`,
    "",
    `> 由 Writing DNA 分层蒸馏生成 · ${chapterCount} 章样本`,
    "",
  ]
}

function bodyOrPlaceholder(text: string): string {
  return text.trim() || "（本层未提取，请重新运行文风提取）"
}

/** L1 语言 DNA：模型解读 + 脚本统计表。统计表必须留在文件里，写作前复读时要能看到数字。 */
function renderLanguageDna(profile: BookStyleProfile, bookTitle: string): string {
  const lines = header(bookTitle, "L1", "语言 DNA", profile.sampledChapterIds.length)
  lines.push(bodyOrPlaceholder(profile.layers?.languageDna ?? ""), "", "## 脚本统计", "")
  lines.push(profile.metrics ? formatStyleMetricsForMarkdown(profile.metrics) : "（无统计数据）")
  if (profile.vocabularyPreferences?.length) {
    lines.push("", "## 词汇偏好", "", profile.vocabularyPreferences.map((item) => `- ${item}`).join("\n"))
  }
  if (profile.avoidPatterns?.length) {
    lines.push("", "## 应避免的写法", "", profile.avoidPatterns.map((item) => `- ${item}`).join("\n"))
  }
  return lines.join("\n")
}

/** L2 章节结构模板 + 每章标注表。 */
function renderStructurePatterns(
  profile: BookStyleProfile,
  bookTitle: string,
  chapterMeta: ChapterMetaEntry[],
): string {
  const lines = header(bookTitle, "L2", "章节结构模板", profile.sampledChapterIds.length)
  lines.push(bodyOrPlaceholder(profile.layers?.structurePatterns ?? ""))
  const extras: Array<[string, string | undefined]> = [
    ["场景与时间过渡", profile.transitionStyle],
    ["环境描写比重", profile.descriptionWeight],
    ["情绪呈现", profile.emotionRendering],
    ["点题与抒情习惯", profile.thematicHabits],
  ]
  const filled = extras.filter(([, value]) => value?.trim())
  if (filled.length > 0) {
    lines.push("", "## 分项说明", "")
    for (const [label, value] of filled) lines.push(`- **${label}**：${value}`)
  }
  lines.push("", "## 章节标注", "", formatChapterMetaForMarkdown(chapterMeta))
  return lines.join("\n")
}

/** L3-L5 叙事视角与认知框架。 */
function renderCognitiveFrame(profile: BookStyleProfile, bookTitle: string): string {
  const lines = header(bookTitle, "L3-L5", "叙事视角与认知框架", profile.sampledChapterIds.length)
  lines.push(bodyOrPlaceholder(profile.layers?.cognitiveFrame ?? ""))
  const extras: Array<[string, string | undefined]> = [
    ["叙述视角与声音", profile.narrativeVoice],
    ["叙事人称与限知范围", profile.pointOfView],
  ]
  const filled = extras.filter(([, value]) => value?.trim())
  if (filled.length > 0) {
    lines.push("", "## 分项说明", "")
    for (const [label, value] of filled) lines.push(`- **${label}**：${value}`)
  }
  if (profile.humorMechanisms?.length) {
    lines.push("", "## 幽默机制", "", profile.humorMechanisms.map((item) => `- ${item}`).join("\n"))
  }
  if (profile.highEnergyMechanisms?.length) {
    lines.push("", "## 高燃机制", "", profile.highEnergyMechanisms.map((item) => `- ${item}`).join("\n"))
  }
  return lines.join("\n")
}

/** L6 排版与节奏。 */
function renderRhythmGuide(profile: BookStyleProfile, bookTitle: string): string {
  const lines = header(bookTitle, "L6", "排版与节奏指南", profile.sampledChapterIds.length)
  lines.push(bodyOrPlaceholder(profile.layers?.rhythmGuide ?? ""), "", "## 节奏相关统计", "")
  if (profile.metrics) {
    const { derived } = profile.metrics
    const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
    lines.push(
      `- 平均段落：${derived.avgParagraphChars} 字 / ${derived.avgParagraphSentences} 句`,
      `- 一句一段占比：${percent(derived.oneSentenceParagraphRatio)}`,
      `- 长段占比：${percent(derived.longParagraphRatio)}`,
      `- 含对白段落占比：${percent(derived.dialogueParagraphRatio)}`,
      `- 破折号每千字 ${derived.punctuationPerThousand.dash}、省略号每千字 ${derived.punctuationPerThousand.ellipsis}`,
    )
  } else {
    lines.push("（无统计数据）")
  }
  return lines.join("\n")
}

/**
 * 整合文档 Writing-DNA.md。
 * 模型已按要求输出 markdown 正文，这里只补文件头、代表片段和字数超限提醒。
 */
export function renderIntegratedDna(
  profile: BookStyleProfile,
  bookTitle: string,
): string {
  const body = profile.integratedDna?.trim()
  const lines = [
    `# 《${bookTitle}》Writing DNA`,
    "",
    `> 分层蒸馏整合文档 · ${profile.sampledChapterIds.length} 章样本 · 写作前需与四份分层产物一起复读`,
    "",
  ]
  if (body) {
    lines.push(body)
    if (body.length > INTEGRATED_DNA_CHAR_LIMIT) {
      lines.push(
        "",
        `> 注意：本文档 ${body.length} 字，超过 ${INTEGRATED_DNA_CHAR_LIMIT} 字上限，说明蒸馏不够干净，建议重新提取。`,
      )
    }
  } else {
    lines.push(
      "（未生成整合文档，以下为可注入的风格硬约束）",
      "",
      "## 风格硬约束",
      "",
      profile.constitution || "（无）",
    )
  }
  if (profile.samples.length > 0) {
    lines.push("", "## 代表原文片段", "")
    profile.samples.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`, ""))
  }
  return lines.join("\n")
}

/** 渲染全部产物文件（Writing-DNA.md + 四份分层产物）。 */
export function renderWritingDnaFiles(
  profile: BookStyleProfile,
  bookTitle: string,
  chapterMeta: ChapterMetaEntry[] = [],
): RenderedDnaFile[] {
  const byKey: Record<keyof WritingDnaLayers, string> = {
    languageDna: renderLanguageDna(profile, bookTitle),
    structurePatterns: renderStructurePatterns(profile, bookTitle, chapterMeta),
    cognitiveFrame: renderCognitiveFrame(profile, bookTitle),
    rhythmGuide: renderRhythmGuide(profile, bookTitle),
  }
  return [
    { fileName: "Writing-DNA.md", content: renderIntegratedDna(profile, bookTitle) },
    ...WRITING_DNA_LAYERS.map((layer) => ({
      fileName: layer.fileName,
      content: byKey[layer.key],
    })),
  ]
}

/**
 * style.md 的内容。
 * 这个文件名被 library-state 的 styleStatus 判定和删除逻辑依赖，不能取消，
 * 因此保留为整合文档的同文副本 + 分层产物索引。
 */
export function styleProfileToMarkdown(profile: BookStyleProfile, bookTitle: string): string {
  const lines = [renderIntegratedDna(profile, bookTitle), "", "## 分层产物", ""]
  for (const layer of WRITING_DNA_LAYERS) {
    lines.push(`- [${layer.level} ${layer.label}](./${layer.fileName})：${layer.summary}`)
  }
  if (!isWritingDnaProfile(profile)) {
    lines.push("", "> 本画像由旧版单轮提取迁移而来，尚无分层产物，建议重新提取文风。")
  }
  return lines.join("\n")
}
