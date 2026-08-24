import type { NovelTaskIntent } from "./task-router"
import type { UserSkill } from "./skill-library"

type SkillRouteStage = "outline" | "drafting" | "review"
type SkillRouteMissingPolicy = "diagnose_and_continue" | "stop"

type SkillRouteTask =
  | "chapter_outline"
  | "character_design"
  | "faction_setting"
  | "power_setting"
  | "golden_finger"
  | "world_setting"
  | "map_setting"
  | "foreshadowing"
  | "master_outline"
  | "volume_outline"
  | "outline_quality"
  | "long_form_drafting"
  | "short_form_drafting"
  | "combat_scene"
  | "dialogue_scene"
  | "anti_ai_polish"

interface SkillRouteDefinition {
  task: SkillRouteTask
  aliases: string[]
  primarySkills: string[]
  supportingSkills: string[]
  stage: SkillRouteStage
  missingPolicy: SkillRouteMissingPolicy
}

const CHAPTER_OUTLINE_SUPPORT_SKILLS = [
  "chapter-attribute-positioning",
  "chapter-keyword-conditions",
  "chapter-four-beat-flow",
  "chapter-emotion-curve",
  "chapter-visual-detail",
  "chapter-foreshadow-hook",
  "chapter-outline-assembler",
]

const SKILL_ROUTE_DEFINITIONS: readonly SkillRouteDefinition[] = [
  {
    task: "chapter_outline",
    aliases: ["章节细纲", "章纲", "章纲完善"],
    primarySkills: ["chapter-outline-builder"],
    supportingSkills: CHAPTER_OUTLINE_SUPPORT_SKILLS,
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "character_design",
    aliases: ["人物小传", "人物设定"],
    primarySkills: ["character-design"],
    supportingSkills: ["supporting-cast", "relationship-emotion"],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "faction_setting",
    aliases: ["组织势力设定", "势力设定"],
    primarySkills: ["faction-system"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "power_setting",
    aliases: ["力量体系", "能力体系"],
    primarySkills: ["power-system"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "golden_finger",
    aliases: ["金手指设定", "系统设定"],
    primarySkills: ["idea-market-positioning", "power-system"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "world_setting",
    aliases: ["背景设定", "世界观设定"],
    primarySkills: ["world-rules"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "map_setting",
    aliases: ["地理设定", "地点设定", "地图"],
    primarySkills: ["world-rules", "map-progression"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "foreshadowing",
    aliases: ["伏笔计划", "伏笔审查"],
    primarySkills: ["foreshadowing-suspense"],
    supportingSkills: [],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "master_outline",
    aliases: ["故事大纲", "总纲"],
    primarySkills: ["outline-master-builder"],
    supportingSkills: ["outline-final-assembler"],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "volume_outline",
    aliases: ["卷纲", "分卷大纲"],
    primarySkills: ["story-goal-ladder", "outline-master-builder"],
    supportingSkills: ["outline-final-assembler"],
    stage: "outline",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "outline_quality",
    aliases: ["大纲质量检查"],
    primarySkills: ["outline-quality-check"],
    supportingSkills: [],
    stage: "review",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "long_form_drafting",
    aliases: ["编写章节", "续写章节", "长篇正文"],
    primarySkills: ["long-form-drafting"],
    supportingSkills: [],
    stage: "drafting",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "short_form_drafting",
    aliases: ["短篇正文", "知乎短篇", "世情短篇"],
    primarySkills: ["short-form-drafting"],
    supportingSkills: [],
    stage: "drafting",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "combat_scene",
    aliases: ["战斗场景", "动作场景"],
    primarySkills: ["combat-action"],
    supportingSkills: [],
    stage: "drafting",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "dialogue_scene",
    aliases: ["对话场景", "情绪对话"],
    primarySkills: ["dialogue-emotion"],
    supportingSkills: [],
    stage: "drafting",
    missingPolicy: "diagnose_and_continue",
  },
  {
    task: "anti_ai_polish",
    aliases: ["正文去 AI 味", "正文去AI味", "最终去 AI 味", "最终去AI味"],
    primarySkills: ["anti-ai-polish"],
    supportingSkills: [],
    stage: "review",
    missingPolicy: "diagnose_and_continue",
  },
] as const

export function getSkillRouteSkillNames(definition: SkillRouteDefinition): string[] {
  return [...definition.primarySkills, ...definition.supportingSkills]
}

function findSkillRouteByTask(task: SkillRouteTask): SkillRouteDefinition | undefined {
  return SKILL_ROUTE_DEFINITIONS.find((definition) => definition.task === task)
}

export function findSkillRouteByAlias(value: string): SkillRouteDefinition | undefined {
  const normalized = normalizeAlias(value)
  if (!normalized) return undefined
  const candidates = SKILL_ROUTE_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => ({ definition, alias: normalizeAlias(alias) })),
  ).sort((left, right) => right.alias.length - left.alias.length)
  return candidates.find(({ alias }) => normalized === alias || normalized.includes(alias))?.definition
}

function findSkillRouteByExactAlias(value: string): SkillRouteDefinition | undefined {
  const normalized = normalizeAlias(value)
  if (!normalized) return undefined
  return SKILL_ROUTE_DEFINITIONS.find((definition) =>
    definition.aliases.some((alias) => normalizeAlias(alias) === normalized),
  )
}

export function getOutlineSkillNames(value: string): string[] {
  const definition = findSkillRouteByAlias(value)
  if (!definition || (definition.stage !== "outline" && definition.stage !== "review")) return []
  return getSkillRouteSkillNames(definition)
}

export function getWritingSkillNames(intent: NovelTaskIntent, requestText: string): string[] {
  if (!new Set<NovelTaskIntent>([
    "write_chapter",
    "continue_chapter",
    "rewrite_chapter",
    "polish_chapter",
  ]).has(intent)) return []

  const normalized = normalizeAlias(requestText)
  const names: string[] = []
  const addRoute = (task: SkillRouteTask) => {
    const definition = findSkillRouteByTask(task)
    if (definition) names.push(...getSkillRouteSkillNames(definition))
  }

  if (/(短篇|知乎|世情)/.test(normalized)) addRoute("short_form_drafting")
  else addRoute("long_form_drafting")
  if (/(战斗|动作|打斗|追逐|战争|交火)/.test(normalized)) addRoute("combat_scene")
  if (/(对话|对白|情绪对话)/.test(normalized)) addRoute("dialogue_scene")
  if (/(去ai味|反ai|降低ai|消除ai|最终润色)/.test(normalized)) addRoute("anti_ai_polish")
  return unique(names)
}

export function resolveAvailableSkillsByNames(
  skills: UserSkill[],
  names: readonly string[],
): { skills: UserSkill[]; missingNames: string[] } {
  const availableByName = new Map(skills.map((skill) => [skill.name, skill]))
  const resolved: UserSkill[] = []
  const missingNames: string[] = []
  for (const name of unique(names)) {
    const skill = availableByName.get(name)
    if (!skill) {
      missingNames.push(name)
      continue
    }
    if (!resolved.some((item) => item.id === skill.id)) resolved.push(skill)
  }
  return { skills: resolved, missingNames }
}

export function validateSkillRouteRegistry(availableNames: Iterable<string>): string[] {
  const available = new Set(availableNames)
  return unique(SKILL_ROUTE_DEFINITIONS.flatMap(getSkillRouteSkillNames))
    .filter((name) => !available.has(name))
}

export function resolveSkillReference<T extends { id: string; name: string }>(
  skills: readonly T[],
  reference: { id?: string; name?: string },
): T | undefined {
  const id = reference.id?.trim()
  if (id) return skills.find((skill) => skill.id === id)
  const name = reference.name?.trim()
  if (!name) return undefined
  const exact = skills.find((skill) => skill.name === name)
  if (exact) return exact
  const route = findSkillRouteByExactAlias(name)
  const canonicalName = route?.primarySkills[0]
  return canonicalName ? skills.find((skill) => skill.name === canonicalName) : undefined
}

/** 短中文名（如「对话」）做子串匹配会误伤，显式技能名至少 4 个规范化字符。 */
const MIN_EXPLICIT_SKILL_NAME_LENGTH = 4

interface ExplicitSkillReference {
  skillId?: string
  title?: string
}

export function uniqueSkillsById<T extends { id: string }>(skills: readonly T[]): T[] {
  const result: T[] = []
  for (const skill of skills) {
    if (!result.some((item) => item.id === skill.id)) result.push(skill)
  }
  return result
}

/**
 * 收集用户显式指定的 skill：@ 引用的 skillId/标题，以及原文中的 canonical name 子串。
 * 不使用中文别名 includes，避免「对话」一类短词误匹配。
 */
export function collectExplicitSkills<T extends { id: string; name: string }>(
  skills: readonly T[],
  userMessage: string,
  references: readonly ExplicitSkillReference[] = [],
): T[] {
  const collected: T[] = []
  const add = (skill: T | undefined) => {
    if (!skill) return
    if (!collected.some((item) => item.id === skill.id)) collected.push(skill)
  }

  for (const reference of references) {
    add(resolveSkillReference(skills, { id: reference.skillId, name: reference.title }))
  }

  const normalizedMessage = normalizeAlias(userMessage)
  if (!normalizedMessage) return collected

  for (const skill of skills) {
    const normalizedName = normalizeAlias(skill.name)
    if (normalizedName.length < MIN_EXPLICIT_SKILL_NAME_LENGTH) continue
    if (normalizedMessage.includes(normalizedName)) add(skill)
  }

  return collected
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[\s「」『』【】]/g, "").trim()
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
