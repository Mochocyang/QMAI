/**
 * 拆书 6 维度分析 - 6 个专业中文提示词
 *
 * 每个维度对应一个 prompt 函数，输入：角色、语料、外部资料
 * 输出：纯 markdown 内容（无 frontmatter）
 *
 * 设计要点：
 *  1. 严格只描述一个维度
 *  2. 显式要求"只输出 markdown"
 *  3. 显式包含"角色名+别名"避免 LLM 误识别
 *  4. 截断语料避免 token 爆炸
 */

import type { ExtractedCharacter, NameAliasMap, SixDimensionKey } from "./types"

export type { SixDimensionKey }

const CORPUS_LIMIT_PER_DIM = 6000

function truncate(s: string, limit: number): string {
  if (!s) return ""
  if (s.length <= limit) return s
  return s.substring(0, limit) + "\n\n…(语料过长已截断)…"
}

function aliasList(aliasMap: NameAliasMap | undefined, fallback: string[]): string {
  if (aliasMap) {
    const all = [aliasMap.canonical, ...aliasMap.aliases]
    return Array.from(new Set(all)).join("、")
  }
  return [fallback[0] || "", ...fallback.slice(1)].filter(Boolean).join("、")
}

export interface PromptInput {
  character: ExtractedCharacter
  corpus: string
  externalMaterial?: string  // 来自 web-search（外部评价用）
  bookTitle: string
  bookAuthor?: string
}

/** 01 公开资料 */
export function buildPublicMaterialPrompt(input: PromptInput): string {
  const { character, corpus, bookTitle, bookAuthor } = input
  const names = aliasList(character.aliasMap, [character.name, ...character.aliases])
  return `请从提供的资料中，提取并整理角色【${character.name}】的所有官方设定技能、能力参数及背景介绍信息，确保信息来源可靠且表述准确。

【重要：名称归一】
本角色在作品中所有称谓：${names}
提取时所有指代【${character.name}】的地方均视为同一角色，请勿误识别为不同角色。

【作品信息】
- 作品：${bookTitle}
- 作者：${bookAuthor || "未知"}

【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter（YAML）
3. 必须包含以下小节：
   ## 人物定位
   ## 基础设定（出身、身份、外貌）
   ## 能力 / 技能 / 实力
   ## 阵营 / 立场
4. 如果某些信息在原文中找不到，写"原文未直接给出"，不要编造
`
}

/** 02 对话方式 */
export function buildSpeechStylePrompt(input: PromptInput): string {
  const { character, corpus } = input
  return `分析角色【${character.name}】在对话场景中的语言特征、沟通策略及通过言语展现的技能特点，提取具有代表性的对话片段并进行技能关联标注。

【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter
3. 必须包含：
   ## 语气 / 腔调
   ## 常用词汇 / 口头禅
   ## 句式偏好（长短、是否反问、是否命令式等）
   ## 典型对话片段（至少 3 段，原文照抄 + 场景说明）
   ## 通过对话展现的技能 / 性格
`
}

/** 03 表达特征 */
export function buildExpressionDnaPrompt(input: PromptInput): string {
  const { character, corpus } = input
  return `识别角色【${character.name}】在使用技能时的典型行为模式、身体语言、表情变化等表达特征，建立技能与表达方式的对应关系。

【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter
3. 必须包含：
   ## 肢体语言 / 表情
   ## 行为模式 / 习惯动作
   ## 技能施展时的典型表现
   ## 表情 ↔ 心理 / 技能 的对应关系表（用 markdown 表格）
`
}

/** 04 外部评价（支持 web 搜索资料） */
export function buildExternalViewsPrompt(input: PromptInput): string {
  const { character, corpus, externalMaterial } = input
  const webSection = externalMaterial
    ? `【来自 DuckDuckGo/Wikipedia 的公开资料】
${externalMaterial}

`
    : `【来自 DuckDuckGo/Wikipedia 的公开资料】
（本次未获取到，请基于原文中"其他角色评价"、"旁白描述"作为替代来源）

`

  return `收集并归纳其他角色、叙述者及官方对角色【${character.name}】技能的评价与描述，区分主观评价与客观描述，标注评价来源与场景。

${webSection}【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter
3. 必须包含：
   ## 其他角色评价（至少 3 段对话 / 评价摘录，注明来源章节或角色）
   ## 叙述者旁白评价
   ## 客观描述（基于事实的能力、行为、设定）
   ## 主观评价（其他角色对【${character.name}】的看法）
   ## 综合印象（对【${character.name}】技能与人格的外部视角总结）
4. 如果信息完全缺失，写"未找到可靠的外部评价信息"
`
}

/** 05 决策记录 */
export function buildDecisionLogPrompt(input: PromptInput): string {
  const { character, corpus } = input
  return `梳理角色【${character.name}】在关键事件中的决策过程，分析其技能如何影响决策制定，提取技能应用的具体案例与效果评估。

【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter
3. 必须包含：
   ## 决策风格（理性 / 冲动 / 被动 / 主导）
   ## 关键决策案例（至少 3 个，每个包含：背景 → 备选方案 → 决策 → 结果 → 技能影响）
   ## 失误与反思
   ## 决策能力总结
`
}

/** 06 时间线 */
export function buildTimelinePrompt(input: PromptInput): string {
  const { character, corpus } = input
  return `按时间顺序整理角色【${character.name}】的技能发展历程，包括技能的获取契机、提升过程、关键转折点及不同阶段的技能表现。

【原文章节语料（已截断）】
${truncate(corpus, CORPUS_LIMIT_PER_DIM)}

【输出要求】
1. 严格只输出 markdown 文本
2. 不要输出 frontmatter
3. 必须包含：
   ## 早期（登场初期）
   ## 中期（成长阶段）
   ## 后期（巅峰 / 转折）
   ## 技能发展曲线（用 markdown 时间线列表，格式：- [章节] 时间点 — 事件）
   ## 关键转折点
`
}

export const PROMPT_BUILDERS: Record<SixDimensionKey, (i: PromptInput) => string> = {
  publicMaterial: buildPublicMaterialPrompt,
  speechStyle: buildSpeechStylePrompt,
  expressionDna: buildExpressionDnaPrompt,
  externalViews: buildExternalViewsPrompt,
  decisionLog: buildDecisionLogPrompt,
  timeline: buildTimelinePrompt,
}

export const DIMENSION_LABELS: Record<SixDimensionKey, string> = {
  publicMaterial: "01 公开资料",
  speechStyle: "02 对话方式",
  expressionDna: "03 表达特征",
  externalViews: "04 外部评价",
  decisionLog: "05 决策记录",
  timeline: "06 时间线",
}

export const ALL_DIMENSIONS: SixDimensionKey[] = [
  "publicMaterial",
  "speechStyle",
  "expressionDna",
  "externalViews",
  "decisionLog",
  "timeline",
]
