import { PERSONALITY_FIELDS, type PersonalityField, type PortablePersonality } from "../portable-personality"
import type { AnalysisChunkPlan, AnalysisSkill } from "./analysis-pipeline-types"
import type { StyleMetrics } from "./style-metrics"
import { compileStyleFingerprint, STYLE_FACETS, type StyleFingerprint } from "./style-fingerprint"

export const WORKBENCH_VERSION = 2
export const WORKBENCH_TEXT_BUDGET = 24000
export const WORKBENCH_LABELS: Record<AnalysisSkill, string> = { characters: "角色 Skill", story: "故事 Skill", style: "文风 Skill" }
export const WORKBENCH_DIMENSIONS: Record<string, string> = {
  ...STYLE_FACETS,
  expressionDna: "表达方式", mentalModel: "思考方式", decisionHeuristics: "决策倾向", valueAntiPatterns: "价值底线", honestyBoundaries: "信息与诚实边界",
}
export const WORKBENCH_DEFAULTS: Record<AnalysisSkill, string> = {
  characters: "只提炼显著的性格张力、处事倾向和表达方式，保留缺点与例外，不迁移身份、经历、职业或能力。",
  story: "提炼目标与阻力、信息投放、冲突升级、转折、兑现及后续悬念的可复用机制，不复述原作。",
  style: "先辨认原文的语体与叙述声音，分析用词搭配、句法标点、对白、描写情绪、段落节奏和场景衔接。以真实统计和证据生成可执行写作习惯，不套通用模板，不迁移原作人物、设定或价值观。",
}
export interface SourceSegment { chapterId: string; order: number; start: number; end: number; sourceHash: string }
export interface WorkbenchPlan extends AnalysisChunkPlan { batch: number; segments: SourceSegment[] }
export interface WorkbenchEvidence extends SourceSegment { id: string; text: string }
export interface WorkbenchRule {
  id: string; dimension: string; observation: string; condition: string; action: string; boundary: string; evidenceIds: string[]
}
export interface WorkbenchItem { subject: string; summary: string; limitations: string; rules: WorkbenchRule[]; styleFingerprint?: StyleFingerprint }
export interface WorkbenchOutput {
  workbenchVersion: 2; items: WorkbenchItem[]; evidence: WorkbenchEvidence[]; coverage: SourceSegment[]; metrics?: StyleMetrics
  storyMap?: import("./story-map-types").StoryMap
}
export interface WorkbenchRevision extends WorkbenchOutput {
  id: string; taskId: string; bookId: string; bookTitle: string; skill: AnalysisSkill; requirements: string
  selectedChapterIds: string[]; parentRevisionId?: string; createdAt: number
  confirmedAt?: number; publishedIds?: string[]
  /**
   * 用户从结果面板主动删除掉的条目（subject）。可选、向后兼容。
   * 用途：删除是「连使用库一起真删」，但拆书结果仍要记住删过谁，
   * 否则重新打开页面会把已删卡片又渲染出来（库里查不到 ≠ 用户想删）。
   */
  removedSubjects?: string[]
  /**
   * 由旧版作品资料迁移而来。可选、向后兼容——loadWorkbenchRevisions 只校验
   * workbenchVersion/items/evidence，不涉及此字段。
   * 用途：摘要行显示「旧版导入」而非「自动核验通过」（不对未核验数据作声明），
   * 并决定发布走哪条路径。
   */
  origin?: "legacy"
}
export interface WorkbenchRequest {
  styleProfileVersion?: 1
  selectedChapterIds: string[]; requirements: Partial<Record<AnalysisSkill, string>>; parentRevisionId?: string
}

/**
 * 清洗「用户已删除条目」记录（removedSubjects）。
 *
 * 这个字段只用来隐藏用户主动删掉的卡片，不是数据主体：来源既有磁盘上的旧数据，
 * 也有界面点击，两者都不可信。因此非法值一律丢弃成空数组，绝不因为一个记录字段
 * 让整版结果读不出来（items/evidence 缺失仍抛错，性质不同）。
 *
 * 顺带补齐空数组也是刻意的：调用方按 `removedSubjects.includes(subject)` 过滤，
 * 缺字段时留 undefined 会让渲染直接抛错。
 */
export function sanitizeRemovedSubjects(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const subjects: string[] = []
  for (const raw of value) {
    if (typeof raw !== "string") continue
    const subject = raw.trim()
    if (!subject || seen.has(subject)) continue
    seen.add(subject)
    subjects.push(subject)
  }
  return subjects
}

export function buildWorkbenchPlan(
  chapters: Array<{ id: string; order: number; content: string; sourceHash?: string }>,
  selectedIds: string[], budget = WORKBENCH_TEXT_BUDGET,
): WorkbenchPlan[] {
  if (!selectedIds.length) throw new Error("请至少选择一个章节")
  const ids = new Set(selectedIds)
  if (selectedIds.some((id) => !chapters.some((chapter) => chapter.id === id))) throw new Error("所选章节不存在")
  const limit = Math.max(1000, Math.min(WORKBENCH_TEXT_BUDGET, budget))
  const selected = chapters.filter((chapter) => ids.has(chapter.id)).sort((a, b) => a.order - b.order)
  const plans: WorkbenchPlan[] = []
  let segments: SourceSegment[] = []
  let chars = 0
  let batch = 1
  const flush = () => {
    if (!segments.length) return
    plans.push({
      id: `wb-${plans.length + 1}`, batch, chapterIds: [...new Set(segments.map((s) => s.chapterId))],
      startOrder: segments[0].order, endOrder: segments[segments.length - 1].order,
      wordCount: chars, segments,
    })
    segments = []; chars = 0
  }
  selected.forEach((chapter, index) => {
    const nextBatch = Math.floor(index / 100) + 1
    if (batch !== nextBatch) { flush(); batch = nextBatch }
    if (!chapter.content.trim()) throw new Error(`第 ${chapter.order} 章正文为空`)
    for (let start = 0; start < chapter.content.length; start += limit) {
      const end = Math.min(chapter.content.length, start + limit)
      if (chars + end - start > limit || segments.length >= 10) flush()
      segments.push({ chapterId: chapter.id, order: chapter.order, start, end, sourceHash: chapter.sourceHash ?? "" })
      chars += end - start
    }
  })
  flush()
  return plans
}

export function validateCoverage(plans: Array<{ segments?: SourceSegment[] }>, coverage: SourceSegment[]) {
  const key = (s: SourceSegment) => JSON.stringify([s.chapterId, s.start, s.end, s.sourceHash])
  const expected = plans.flatMap((p) => p.segments ?? []).map(key).sort()
  if (!expected.length || JSON.stringify(expected) !== JSON.stringify(coverage.map(key).sort())) {
    throw new Error("所选正文覆盖不完整，不能生成完整结果")
  }
}

export async function buildEvidenceCandidates(passages: Array<{ chapterId: string; order: number; start: number; text: string; sourceHash: string }>): Promise<WorkbenchEvidence[]> {
  const evidence: WorkbenchEvidence[] = []
  for (const passage of passages) {
    // 每个编号直接对应原文位置；模型只返回编号，不生成引文。
    for (const match of passage.text.matchAll(/[^\r\n]{1,160}/g)) {
      const text = match[0].trim()
      if (!text) continue
      const start = passage.start + match.index + match[0].indexOf(text)
      const id = `E${passage.order}_${start}`
      evidence.push({ id, chapterId: passage.chapterId, order: passage.order, start, end: start + text.length, text, sourceHash: passage.sourceHash })
    }
  }
  return evidence
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("结果字段为空或超长")
  return value.trim()
}
export function parseWorkbenchItem(raw: unknown, evidence: WorkbenchEvidence[], subject: string, skill: AnalysisSkill): WorkbenchItem {
  if (!raw || typeof raw !== "object") throw new Error("结果格式无效")
  const value = raw as Record<string, unknown>
  if (value.subject !== subject || !Array.isArray(value.rules) || value.rules.length > 8) throw new Error("分析对象或规则数量不正确")
  const ids = new Set(evidence.map((e) => e.id))
  const rules = value.rules.map((rawRule, index): WorkbenchRule => {
    const r = rawRule as Record<string, unknown>
    if (!r || !Array.isArray(r.evidenceIds) || !r.evidenceIds.length) throw new Error("每条规则必须选择1至2个有效证据ID")
    // 模型常见失误是选错/编造编号或一次给太多编号：逐条清洗并截断到前2个，
    // 而不是让单条规则把整个区块结果作废（grok 等模型实测高频触发）。
    const valid = [...new Set(r.evidenceIds.filter((id): id is string => typeof id === "string" && ids.has(id)))].slice(0, 2)
    if (!valid.length) throw new Error(`证据ID不存在或被改写：${r.evidenceIds.join("、")}；请逐字选择提供的完整编号`)
    const dimension = text(r.dimension, 60)
    if (skill === "characters" && !PERSONALITY_FIELDS.includes(dimension as PersonalityField)) throw new Error("人格维度无效")
    return {
      id: `R${index + 1}`, dimension, observation: text(r.observation, 400),
      condition: text(r.condition, 200), action: text(r.action, 400), boundary: text(r.boundary, 240),
      evidenceIds: valid,
    }
  })
  const normalize = (value: string) => skill === "characters" && subject.length > 1 ? value.split(subject).join("该人物") : value
  const summary = normalize(text(value.summary, 400))
  for (const rule of rules) {
    rule.condition = normalize(rule.condition); rule.action = normalize(rule.action); rule.boundary = normalize(rule.boundary)
  }
  const runtime = [summary, ...rules.flatMap((r) => [r.condition, r.action, r.boundary])].join("\n")
  if ((skill === "characters" || skill === "story") && /前世|穿越|刑侦|法医|炼金|法术|武功|金手指|官阶/.test(runtime)) {
    throw new Error("可复用摘要或规则仍含原作职业、出身或专门能力；请只保留不限定手段的判断、风险取舍与结构机制")
  }
  return { subject, summary, limitations: text(value.limitations, 500), rules }
}
export function workbenchRulesMarkdown(item: WorkbenchItem): string {
  if (item.styleFingerprint) return compileStyleFingerprint(item)
  return [item.summary, ...item.rules.map((r) => `### ${r.id} · ${WORKBENCH_DIMENSIONS[r.dimension] ?? r.dimension}\n适用：${r.condition}\n${r.action}\n边界：${r.boundary}`), `\n局限：${item.limitations}`].join("\n\n")
}
export function workbenchPersonality(item: WorkbenchItem, evidence: WorkbenchEvidence[]): PortablePersonality {
  const used = new Set(item.rules.flatMap((rule) => rule.evidenceIds))
  return {
    version: 1, summary: item.summary, scope: item.limitations,
    rules: item.rules.map((r) => ({ id: r.id, field: r.dimension as PersonalityField, condition: r.condition, tendency: r.action, boundary: r.boundary, evidenceIds: r.evidenceIds })),
    evidence: evidence.filter((e) => used.has(e.id)).map((e) => ({ id: e.id, chapterId: e.chapterId, quote: e.text })),
  }
}
