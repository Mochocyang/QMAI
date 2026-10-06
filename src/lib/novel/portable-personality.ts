import yaml from "js-yaml"

export const PERSONALITY_FIELDS = [
  "expressionDna", "mentalModel", "decisionHeuristics", "valueAntiPatterns", "honestyBoundaries",
] as const
export type PersonalityField = typeof PERSONALITY_FIELDS[number]
export interface PersonalityRule {
  id: string
  field: PersonalityField
  condition: string
  tendency: string
  boundary: string
  evidenceIds: string[]
}
export interface PortablePersonality {
  version: 1
  editedByUser?: true
  summary: string
  scope: string
  rules: PersonalityRule[]
  evidence: Array<{ id: string; chapterId: string; quote: string }>
}
export interface BoundPersonality {
  characterName: string
  personality: PortablePersonality
}
export class PersonalityConstraintError extends Error {}

export const PERSONALITY_BOUNDARY = "仅迁移性格、处事和表达倾向。不得继承原作职业、身份、穿越经历、知识技能、战力、亲缘关系、专有名词或原句；目标人物的知识和能力限制必须保留。若任务限定证据或知情范围，不得凭空新增关键事实来替代验证，不把推测写成已知事实。与小传存在性格冲突时先确认取舍，不自动覆盖小传。"

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("人格规则格式无效")
  return value as Record<string, unknown>
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("人格规则字段缺失或过长")
  return value.trim()
}

export function parsePortablePersonality(value: unknown): PortablePersonality {
  const data = record(value)
  if (data.version !== 1 || !Array.isArray(data.rules) || data.rules.length < 1 || data.rules.length > 8
    || !Array.isArray(data.evidence) || data.evidence.length < 1 || data.evidence.length > 16) {
    throw new Error("人格规则需要1至8条有证据的条件化规则")
  }
  const evidence = data.evidence.map((item) => {
    const entry = record(item)
    return { id: text(entry.id, 20), chapterId: text(entry.chapterId, 120), quote: text(entry.quote, 160) }
  })
  const ids = new Set(evidence.map((item) => item.id))
  if (ids.size !== evidence.length) throw new Error("人格证据编号重复")
  const rules = data.rules.map((item): PersonalityRule => {
    const rule = record(item)
    if (!PERSONALITY_FIELDS.includes(rule.field as PersonalityField)) throw new Error("人格规则维度无效")
    if (!Array.isArray(rule.evidenceIds) || rule.evidenceIds.length === 0
      || !rule.evidenceIds.every((id) => typeof id === "string" && ids.has(id))) throw new Error("人格规则缺少有效证据")
    return {
      id: text(rule.id, 20), field: rule.field as PersonalityField,
      condition: text(rule.condition, 200), tendency: text(rule.tendency, 400),
      boundary: text(rule.boundary, 240), evidenceIds: rule.evidenceIds,
    }
  })
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length || rules.some((rule) => rule.id === "boundary")) {
    throw new Error("人格规则编号重复或使用了保留编号")
  }
  return {
    version: 1, ...(data.editedByUser === true ? { editedByUser: true as const } : {}),
    summary: text(data.summary, 400), scope: text(data.scope, 500), rules, evidence,
  }
}

function ruleText(rule: PersonalityRule): string {
  return `[${rule.id}] 当${rule.condition}：${rule.tendency}。例外与边界：${rule.boundary}。`
}
export function renderPersonalityRules(profile: PortablePersonality): string {
  return [profile.summary, ...profile.rules.map(ruleText), `[boundary] ${PERSONALITY_BOUNDARY}`].join("\n")
}
export function renderBoundPersonalities(bindings: BoundPersonality[]): string {
  return bindings.map(({ characterName, personality }) =>
    `## ${characterName}：可迁移人格规则\n${renderPersonalityRules(personality)}`).join("\n\n")
}
export function personalityFields(profile: PortablePersonality): Record<PersonalityField, string> {
  return Object.fromEntries(PERSONALITY_FIELDS.map((field) => [
    field, profile.rules.filter((rule) => rule.field === field).map(ruleText).join("\n") || "本次没有充分证据，遵循目标人物的小传。",
  ])) as Record<PersonalityField, string>
}
export function renderPersonalitySkill(name: string, book: string, profile: PortablePersonality): string {
  return [
    "---", yaml.dump({ name, description: profile.summary, sourceBook: book, portablePersonality: profile }, { lineWidth: -1 }).trimEnd(), "---",
    "", `# ${name}：可迁移人格`, "", renderPersonalityRules(profile),
    "", "## 分析范围（不作为新人物经历）", profile.scope,
    ...(profile.editedByUser ? ["", "规则经用户修订；下列证据只对应原始提炼，不代表用户新增规则已经得到原文验证。"] : []),
    "", "## 原文证据（仅供核对，不注入正文）",
    ...profile.evidence.map((item) => `- ${item.id} [${item.chapterId}] ${item.quote}`),
  ].join("\n")
}
export function readPersonalitySkill(markdown: string): PortablePersonality | undefined {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!block) {
    if (/^portablePersonality:/m.test(markdown)) throw new Error("人格Skill元数据损坏")
    return undefined
  }
  let data: unknown
  try { data = yaml.load(block[1], { schema: yaml.JSON_SCHEMA }) } catch {
    if (/^portablePersonality:/m.test(block[1])) throw new Error("人格Skill元数据损坏")
    return undefined
  }
  if (data && typeof data === "object" && "portablePersonality" in data) {
    return parsePortablePersonality(data.portablePersonality)
  }
  return undefined
}
