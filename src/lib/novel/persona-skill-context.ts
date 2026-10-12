import { normalizePath } from "@/lib/path-utils"
import { loadPersonaSkillIndex, readPersonaSkillDocument } from "./persona-skill-store"
import {
  PERSONA_INJECT_CHAR_BUDGET,
  PERSONA_INJECT_FIELD_CHARS,
  PERSONA_INJECT_MAX_SKILLS,
  PERSONA_MAJOR_FIELDS,
  PERSONA_MINOR_FIELDS,
  PERSONA_MIN_SUBSTRING_MATCH_CHARS,
  PERSONA_SUPPLEMENT_HEADING,
  normalizePersonaName,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillTier,
} from "./persona-skill-types"

const TIER_RANK: Record<PersonaSkillTier, number> = { major: 0, minor: 1 }

/** 注入顺序：绿勾 → 主要 → 次要 → 出场次数多的优先（D5）。 */
export function comparePersonaSkillMeta(a: PersonaSkillMeta, b: PersonaSkillMeta): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier]
  if (a.appearanceCount !== b.appearanceCount) return b.appearanceCount - a.appearanceCount
  return a.characterName.localeCompare(b.characterName, "zh-Hans-CN")
}

/**
 * 名字匹配：精确相等 / 别名命中 / 双向包含。
 * 包含匹配要求两边都 ≥ 2 个字，否则单姓（「林」）会把全库都匹配上。
 * 故意不做拼音与繁简归一：那会把 pinyin-pro / opencc-js 拖过 bundle 边界。
 */
export function matchesPersonaName(normalizedQuery: string, names: readonly string[]): boolean {
  for (const name of names) {
    const normalized = normalizePersonaName(name)
    if (!normalized) continue
    if (normalizedQuery === normalized) return true
    if (normalizedQuery.length < PERSONA_MIN_SUBSTRING_MATCH_CHARS) continue
    if (normalized.length < PERSONA_MIN_SUBSTRING_MATCH_CHARS) continue
    if (normalizedQuery.includes(normalized) || normalized.includes(normalizedQuery)) return true
  }
  return false
}

/**
 * 从 index 里挑出本次该注入的候选：名字出现在本次文本里的人。
 *
 * ⚠️ 刻意**不**按 status（潜伏/归档）过滤。原因：status 由「连续 N 章未出场」
 * 推出，而它拦不住的恰恰是最需要档案的场景——「第 1~3 章出场、消失 50 章、
 * 第 54 章回归」的角色，回归那一章 status 还是归档，但他的名字就在本章文本里。
 * 此时写作提示词不带他的档案，AI 只能凭空写这个老角色，写完摄取再 refine 也
 * 是在「写歪了」的基础上修。名字命中 = 他出场了 = 档案必须在场。
 * 预算仍由 PERSONA_INJECT_MAX_SKILLS 与字符预算兜底，排序保证重要人物优先。
 */
export function selectPersonaSkillCandidates(
  index: PersonaSkillIndex,
  matchingText: string,
): PersonaSkillMeta[] {
  const query = normalizePersonaName(matchingText)
  if (!query) return []
  return index.skills
    .filter((meta) => matchesPersonaName(query, [meta.characterName, ...meta.aliases]))
    .sort(comparePersonaSkillMeta)
    .slice(0, PERSONA_INJECT_MAX_SKILLS)
}

/**
 * 把 SKILL.md 拆成「## 标题 → 正文」。
 * 同名标题会拼接：用户手改过的档案每轮都会追加一个「补充（第 N 章）」段。
 */
export function extractPersonaSkillSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  let current: string | null = null
  let buffer: string[] = []
  const flush = () => {
    if (current == null) return
    const value = buffer.join("\n").trim()
    if (!value) return
    const previous = sections.get(current)
    sections.set(current, previous ? `${previous}\n${value}` : value)
  }
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      flush()
      current = heading[1].trim()
      buffer = []
      continue
    }
    if (/^#\s/.test(line)) {
      flush()
      current = null
      buffer = []
      continue
    }
    if (current != null) buffer.push(line)
  }
  flush()
  return sections
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/** 按档位渲染一条注入块：主要人物 7 段，次要人物只留 2 段。 */
export function renderPersonaSkillBlock(meta: PersonaSkillMeta, document: string): string {
  const sections = extractPersonaSkillSections(document)
  const order = meta.tier === "major" ? PERSONA_MAJOR_FIELDS : PERSONA_MINOR_FIELDS
  const parts: string[] = []
  for (const field of order) {
    const value = (sections.get(field) ?? "").replace(/\s*\n\s*/g, " ").trim()
    if (!value) continue
    parts.push(`${field}：${truncate(value, PERSONA_INJECT_FIELD_CHARS)}`)
  }
  // 新档案只有一个补充段；老档案可能还留着多个「补充（第 N 章）」。
  // 倒序拼接，截断时先丢最早的，而不是把最新的观察截掉。
  const supplements = [...sections.entries()]
    .filter(([heading]) => heading.startsWith(PERSONA_SUPPLEMENT_HEADING))
    .map(([, value]) => value.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .reverse()
  if (supplements.length > 0) {
    const joined = truncate(supplements.join(" "), PERSONA_INJECT_FIELD_CHARS)
    parts.push(`${PERSONA_SUPPLEMENT_HEADING}：${joined}`)
  }
  if (parts.length === 0) return ""
  const tags = [
    meta.tier === "major" ? "主要人物" : "次要人物",
    meta.pinned ? "★重点" : "",
    `出场 ${meta.appearanceCount} 次`,
  ].filter(Boolean)
  return `- 【人物 Skill · ${meta.characterName}（${tags.join(" / ")}）】${parts.join(" ")}`
}

/**
 * 写作上下文用的「人物 Skill」段；没有命中时返回空串。
 * 先只用 index 元数据做名字匹配（几十条，很便宜），命中后才读那一份 SKILL.md。
 */
export async function buildPersonaSkillContext(
  projectPath: string,
  matchingText: string,
): Promise<string> {
  const pp = normalizePath(projectPath)
  if (!matchingText.trim()) return ""

  let index: PersonaSkillIndex
  try {
    index = await loadPersonaSkillIndex(pp)
  } catch {
    return ""
  }
  if (index.skills.length === 0) return ""

  const candidates = selectPersonaSkillCandidates(index, matchingText)
  if (candidates.length === 0) return ""

  const blocks: string[] = []
  let used = 0
  for (const meta of candidates) {
    const document = await readPersonaSkillDocument(pp, meta.id)
    if (!document.trim()) continue
    const block = renderPersonaSkillBlock(meta, document)
    if (!block) continue
    if (used + block.length > PERSONA_INJECT_CHAR_BUDGET) break
    blocks.push(block)
    used += block.length
  }
  if (blocks.length === 0) return ""
  return `【人物 Skill】\n${blocks.join("\n")}`
}
