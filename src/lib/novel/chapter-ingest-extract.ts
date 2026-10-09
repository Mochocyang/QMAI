/**
 * 章节 / 大纲记忆提取的 prompt 与 LLM 请求参数。
 *
 * 提取是结构化 JSON 任务：关闭 thinking、跳过全局用户记忆、限制输出 token，
 * 并使用紧凑 schema，避免把审稿/写作链路的开销带到摄取上。
 */

import { ANALYSIS_OUTPUT_FRAC, MIN_LLM_OUTPUT_TOKENS } from "@/lib/context-budget"
import type { RequestOverrides } from "@/lib/llm-providers"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "./chapter-excerpts"

/** 与 `NOVEL_RELATION_LABELS` 中文值保持一致；图谱节点由实体列表派生，不向模型索取 graphNodes。 */
export const GRAPH_EDGE_RELATION_LABELS =
  "出场于|发生于|属于|持有|敌对|合作|怀疑|隐瞒|知道|不知道|推进伏笔|回收伏笔|新增伏笔|导致|揭示|影响|位于"

export const CHAPTER_EXTRACT_REQUEST_OVERRIDES: RequestOverrides = {
  temperature: 0.1,
  reasoning: { mode: "off" },
  skipUserMemory: true,
}

/** 单次提取 JSON 足够；避免按窗口 15% 预留下上万 output tokens。 */
export const CHAPTER_EXTRACT_MAX_OUTPUT_TOKENS = 8_192

export function resolveChapterExtractMaxTokens(maxContextSize?: number): number {
  const windowTokens =
    typeof maxContextSize === "number" && maxContextSize > 0 ? maxContextSize : 204_800
  return Math.max(
    MIN_LLM_OUTPUT_TOKENS,
    Math.min(
      CHAPTER_EXTRACT_MAX_OUTPUT_TOKENS,
      Math.floor(windowTokens * ANALYSIS_OUTPUT_FRAC),
    ),
  )
}

export function sliceChapterExtractBody(chapterBody: string): string {
  if (chapterBody.length <= CHAPTER_BODY_EXCERPT_MAX_CHARS) return chapterBody
  return chapterBody.slice(0, CHAPTER_BODY_EXCERPT_MAX_CHARS)
}

export function buildChapterExtractSystemPrompt(langReminder: string): string {
  const reminder = langReminder.trim()
  return reminder
    ? `你是小说编辑助手。只输出一个 JSON 对象，不要 markdown 围栏或其他文字。${reminder}`
    : "你是小说编辑助手。只输出一个 JSON 对象，不要 markdown 围栏或其他文字。"
}

export function buildChapterExtractUserPrompt(
  chapterNumber: number,
  chapterBody: string,
  /**
   * 已建立的设定（角色定位 + 已埋设伏笔）。
   *
   * 为什么要喂给提取：物品分类里的「没有意义」**不能孤立判断**。同一把钥匙，
   * 第一次出现是闲笔，第 30 章揭示它是祖宅钥匙时就有意义了。只让模型看本章正文，
   * 它只能凭「贵不贵重」猜，而正确口径是「是否与已建立的人物目标/伏笔/冲突相关」。
   * 角色定位同样必要：不知道谁是主角/配角/反派，就无法把道具归到使用者那一栏。
   *
   * 缺省为空串时提示词与改造前**逐字节相同**（新项目还没有已建立内容），
   * 这样既有长度预算测试与老项目的行为都不受影响。
   */
  establishedContext = "",
): string {
  const body = sliceChapterExtractBody(chapterBody)
  const established = establishedContext.trim()
  const establishedBlock = established
    ? `\n\n已建立的设定（仅用于判断物品归属与有无意义，不要在输出里复述）：\n${established}`
    : ""
  return `从以下章节提取结构化信息。

章节编号：第${chapterNumber}章

章节正文：
${body}${establishedBlock}

输出 JSON：
{
  "chapterId": "chapter-${chapterNumber}",
  "chapterNumber": ${chapterNumber},
  "summary": "≤200字摘要",
  "characters": [],
  "characterAliases": {"正式名": ["昵称"]},
  "locations": [],
  "organizations": [],
  "items": [],
  "events": [],
  "characterStateChanges": ["名:变化"],
  "relationshipChanges": [],
  "knowledgeChanges": ["名知道/不知道…"],
  "foreshadowingChanges": ["新增/推进/回收:…"],
  "newCanonFacts": [],
  "timelineEvents": [],
  "conflicts": [],
  "endingHook": "",
  "graphEdges": ["A->关系->B"],
  "characterDetails": {"名": {"identity":"", "faction":"", "goals":"", "arcChange":""}},
  "locationDetails": {"名": {"region":"", "type":"", "controller":"", "hiddenInfo":""}},
  "organizationDetails": {"名": {"leader":"", "members":"", "goals":"", "resources":""}},
  "itemDetails": {"名": {"holder":"", "previousHolders":"", "abilities":"", "limitations":"", "origin":""}},
  "itemCategories": {"名": "主角使用|配角使用|反派使用|没有意义"},
  "eventDetails": {"名": {"cause":"", "process":"", "relatedForeshadowing":"", "relatedConflicts":"", "followUpItems":""}}
}

规则：同一人物只进 characters 一次，昵称放入 characterAliases；无信息的 *Details 整段省略；graphEdges 关系必须是：${GRAPH_EDGE_RELATION_LABELS}。
物品：items 收**本章出现过的**实体道具，itemCategories 的键必须与 items 一一对应。归类只看**有没有故事作用**，不看贵重：与已有人物目标/伏笔/冲突相关、或后续还会再用的，按实际使用者归「主角使用/配角使用/反派使用」；一笔带过、用完即弃、与任何人物目标和伏笔都无关的（路人递的茶、随手买的纸），归「没有意义」。`
}

export function buildOutlineExtractSystemPrompt(langReminder: string): string {
  const reminder = langReminder.trim()
  return reminder
    ? `你是小说编辑助手。从大纲提取初始设定，只输出一个 JSON 对象。${reminder}`
    : "你是小说编辑助手。从大纲提取初始设定，只输出一个 JSON 对象。"
}

export function buildOutlineExtractUserPrompt(body: string): string {
  return `请从以下大纲中提取初始设定：

${body}

输出 JSON：
{
  "chapterId": "outline-init",
  "chapterNumber": 0,
  "summary": "大纲摘要",
  "characters": [],
  "locations": [],
  "organizations": [],
  "items": [],
  "events": [],
  "characterStateChanges": ["人物初始状态"],
  "relationshipChanges": ["人物初始关系"],
  "knowledgeChanges": [],
  "foreshadowingChanges": ["初始伏笔"],
  "newCanonFacts": ["世界观正史设定"],
  "timelineEvents": ["时间线背景"],
  "conflicts": ["核心冲突"],
  "endingHook": "",
  "graphEdges": ["A->关系->B"]
}

规则：graphEdges 关系必须是：${GRAPH_EDGE_RELATION_LABELS}。无信息的数组输出 []。`
}
