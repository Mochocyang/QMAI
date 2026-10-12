/**
 * 「人物 Skill」的素材抽取：从正文里取出和某个人物相关的段落。
 *
 * 取代「开头 4000 字 + 结尾 2000 字」的整章截断：那种截法下，出场在章节中段的
 * 人物一个字都拿不到，模型只能给空字段。按人物取段落后，每个人拿到的都是
 * 自己真正出场的片段。
 */
import { PERSONA_MIN_SUBSTRING_MATCH_CHARS } from "./persona-skill-types"

/** 每个人物在本章的素材预算。 */
export const PERSONA_EVIDENCE_CHARS = 2500
/** 每个此前章节的素材预算（建档时用）。 */
export const PERSONA_PRIOR_EVIDENCE_CHARS = 1200
/** 单段上限：一整段几千字的大段落不能把预算一口吃光。 */
const PARAGRAPH_MAX_CHARS = 600

const GAP_MARKER = "……"

function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function clip(paragraph: string): string {
  return paragraph.length <= PARAGRAPH_MAX_CHARS ? paragraph : `${paragraph.slice(0, PARAGRAPH_MAX_CHARS)}…`
}

/**
 * 用来在正文里找人的名字。单字称呼（单姓「林」）会命中大半章，
 * 只有在没有任何 ≥2 字的名字时才退回去用它。
 */
function searchNames(names: readonly string[]): string[] {
  const trimmed = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  const long = trimmed.filter((name) => name.length >= PERSONA_MIN_SUBSTRING_MATCH_CHARS)
  return long.length > 0 ? long : trimmed
}

/** 从一组下标里均匀取 count 个，首尾必取。 */
function spread(indices: readonly number[], count: number): number[] {
  if (indices.length <= count) return [...indices]
  if (count <= 1) return [indices[0]]
  const picked = new Set<number>()
  for (let i = 0; i < count; i += 1) {
    picked.add(indices[Math.round((i * (indices.length - 1)) / (count - 1))])
  }
  return [...picked].sort((a, b) => a - b)
}

function render(paragraphs: readonly string[], selected: readonly number[]): string {
  const parts: string[] = []
  let previous = -2
  for (const index of selected) {
    if (previous >= 0 && index !== previous + 1) parts.push(GAP_MARKER)
    parts.push(clip(paragraphs[index]))
    previous = index
  }
  return parts.join("\n")
}

function cost(paragraphs: readonly string[], selected: readonly number[]): number {
  return selected.reduce((sum, index) => sum + Math.min(paragraphs[index].length, PARAGRAPH_MAX_CHARS) + 1, 0)
}

/**
 * 取出提到该人物的段落（各带前后一段作上下文）。超预算时先丢上下文段，
 * 再在命中段里均匀抽样，保证开头、中段、结尾的出场都有代表。
 *
 * 一个名字都没命中时返回空串（人物可能只以代词出现），由调用方决定怎么兜底。
 */
export function extractCharacterEvidence(
  body: string,
  names: readonly string[],
  budget = PERSONA_EVIDENCE_CHARS,
): string {
  const paragraphs = splitParagraphs(body)
  const needles = searchNames(names)
  if (paragraphs.length === 0 || needles.length === 0) return ""

  const hits: number[] = []
  paragraphs.forEach((paragraph, index) => {
    if (needles.some((name) => paragraph.includes(name))) hits.push(index)
  })
  if (hits.length === 0) return ""

  const withContext = new Set<number>()
  for (const index of hits) {
    for (const neighbor of [index - 1, index, index + 1]) {
      if (neighbor >= 0 && neighbor < paragraphs.length) withContext.add(neighbor)
    }
  }
  const contextual = [...withContext].sort((a, b) => a - b)
  if (cost(paragraphs, contextual) <= budget) return render(paragraphs, contextual)
  if (cost(paragraphs, hits) <= budget) return render(paragraphs, hits)

  let count = hits.length
  let selected = hits
  while (count > 1 && cost(paragraphs, selected) > budget) {
    count -= 1
    selected = spread(hits, count)
  }
  return render(paragraphs, selected)
}
