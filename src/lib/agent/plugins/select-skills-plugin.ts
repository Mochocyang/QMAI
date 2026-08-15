import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { resolveAiWorkflowMode, type AiWorkflowMode } from "../workflow-mode"
import type { NovelTaskIntent } from "@/lib/novel/task-router"
import type { SkillKind, SkillStage, UserSkill } from "@/lib/novel/skill-library"
import { filterSkillsForSkillRoute, filterSkillsForSkillRoutes, inferSkillRoute, type SkillRoute } from "@/lib/novel/skill-route"
import {
  collectExplicitSkills,
  getOutlineSkillNames,
  getWritingSkillNames,
  resolveAvailableSkillsByNames,
  uniqueSkillsById,
} from "@/lib/novel/skill-route-registry"

const WRITING_INTENTS = new Set<NovelTaskIntent>([
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
])

const REVIEW_INTENTS = new Set<NovelTaskIntent>(["review_chapter", "lint_chapter"])
const QUERY_INTENTS = new Set<NovelTaskIntent>([
  "search_plot",
  "character_query",
  "foreshadowing_query",
  "timeline_query",
  "setting_query",
])

const STANDARD_WRITING_SKILL_NAMES = [
  "章节承接",
  "下一章计划",
  "人物动机",
  "冲突升级",
  "剧情自检",
  "正文输出协议",
]

const STRICT_WRITING_SKILL_NAMES = [
  ...STANDARD_WRITING_SKILL_NAMES,
  "主线检查",
  "伏笔管理",
  "节奏检查",
  "结尾钩子",
]

const FAST_WRITING_SKILL_NAMES = ["正文输出协议", "基础去AI味"]

const EXCLUDED_FROM_FALLBACK = ["去AI味"]
const OUTLINE_SUPPORT_ROUTES: SkillRoute[] = [
  "character",
  "setting",
  "worldbuilding",
  "faction",
  "foreshadowing",
  "map",
  "topic",
]

export function createSelectSkillsPlugin(): PrePlugin {
  return {
    name: "select_skills",
    priority: 35,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return { selectedSkills: [] }

      const route = input.effectiveTaskRoute || input.taskRoute
      if (!route) return { selectedSkills: [] }

      const availableSkills = input.availableSkills ?? []
      const mode = resolveAiWorkflowMode(input.aiWorkflowMode)
      const deterministicNames = route.intent === "generate_outline"
        ? getOutlineSkillNames(input.userMessage)
        : getWritingSkillNames(route.intent, input.userMessage)
      const explicitSkills = uniqueSkillsById([
        ...(input.selectedSkills ?? []),
        ...collectExplicitSkills(availableSkills, input.userMessage),
      ])
      const routedSkills = selectSkillsForRoute(availableSkills, route.intent, mode, input.userMessage)
      const selectedSkills = uniqueSkillsById([...explicitSkills, ...routedSkills])
      return {
        selectedSkills,
        missingSkillNames: deterministicNames.length > 0
          ? resolveAvailableSkillsByNames(mode === "fast"
              ? availableSkills
              : availableSkills.filter((skill) => skill.modes.includes(mode)), deterministicNames).missingNames
          : [],
      }
    },
  }
}

export function selectSkillsForRoute(
  skills: UserSkill[],
  intent: NovelTaskIntent,
  mode: AiWorkflowMode,
  requestText = "",
): UserSkill[] {
  if (mode === "fast") return []

  const modeSkills = skills.filter((skill) => skill.modes.includes(mode))
  if (modeSkills.length === 0) return []

  if (WRITING_INTENTS.has(intent)) {
    return selectWritingSkills(modeSkills, mode, intent, requestText)
  }

  if (intent === "generate_outline") {
    const routedNames = getOutlineSkillNames(requestText)
    if (routedNames.length > 0) {
      const routed = resolveAvailableSkillsByNames(modeSkills, routedNames).skills
      if (routed.length > 0) return routed
    }
    return selectOutlineSkills(modeSkills, mode)
  }

  if (REVIEW_INTENTS.has(intent)) {
    return selectByShape(modeSkills, mode, {
      kinds: ["review", "knowledge", "output"],
      stages: ["review", "output"],
      limit: mode === "strict" ? 8 : 5,
    })
  }

  if (QUERY_INTENTS.has(intent)) {
    return selectByShape(modeSkills, mode, {
      kinds: ["knowledge", "review", "output"],
      stages: ["planning", "review", "output"],
      limit: mode === "strict" ? 6 : 3,
    })
  }

  return []
}

function selectOutlineSkills(skills: UserSkill[], mode: Exclude<AiWorkflowMode, "fast">): UserSkill[] {
  const limit = mode === "strict" ? 8 : 5
  const options = {
      kinds: ["planning", "structure", "output"],
      stages: ["planning", "output"],
      limit,
    } satisfies { kinds: SkillKind[]; stages: SkillStage[]; limit: number }
  const outlineSkills = selectByShape(filterSkillsForSkillRoute(skills, "outline"), mode, options)
  const supportSkills = selectByShape(filterSkillsForSkillRoutes(skills, OUTLINE_SUPPORT_ROUTES), mode, options)
  const selected: UserSkill[] = []
  for (const skill of [...outlineSkills, ...supportSkills]) {
    if (selected.length >= limit) break
    if (!selected.some((item) => item.id === skill.id)) {
      selected.push(skill)
    }
  }
  if (selected.length > 0) {
    return selected
  }
  return selectByShape(skills, mode, options)
}

function selectWritingSkills(
  skills: UserSkill[],
  mode: Exclude<AiWorkflowMode, "fast">,
  intent: NovelTaskIntent,
  requestText: string,
): UserSkill[] {
  const writingSkills = skills.filter((skill) => {
    const route = inferSkillRoute(skill)
    return route === "writing" || route === null
  })
  const scopedSkills = writingSkills.length > 0 ? writingSkills : skills
  const primaryNames = getWritingSkillNames(intent, requestText)
  const supportNames = mode === "strict" ? STRICT_WRITING_SKILL_NAMES : FAST_WRITING_SKILL_NAMES
  const preferredNames = [...primaryNames, ...supportNames]
  if (mode === "standard") {
    return selectPreferredNames(scopedSkills, preferredNames, Math.max(3, primaryNames.length + 2), false)
  }
  if (mode === "strict") {
    return selectPreferredNames(scopedSkills, preferredNames, 14)
  }
  return []
}

function selectPreferredNames(skills: UserSkill[], names: string[], limit: number, fillWithRelevant = true): UserSkill[] {
  const selected: UserSkill[] = []
  for (const name of names) {
    const skill = skills.find((item) => item.name === name || item.id === name)
    if (skill && !selected.some((item) => item.id === skill.id)) {
      selected.push(skill)
    }
  }

  const fallback = skills
    .filter((skill) => isWritingSkill(skill))
    .filter((skill) => !EXCLUDED_FROM_FALLBACK.some((name) => skill.name === name))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  if (selected.length > 0) {
    if (!fillWithRelevant) return selected.slice(0, limit)
    for (const skill of fallback) {
      if (selected.length >= limit) break
      if (!selected.some((item) => item.id === skill.id)) {
        selected.push(skill)
      }
    }
    return selected.slice(0, limit)
  }

  return fallback.slice(0, limit)
}

function selectByShape(
  skills: UserSkill[],
  mode: Exclude<AiWorkflowMode, "fast">,
  options: { kinds: SkillKind[]; stages: SkillStage[]; limit: number },
): UserSkill[] {
  return skills
    .filter((skill) =>
      skill.kind.some((kind) => options.kinds.includes(kind))
      || skill.stages.some((stage) => options.stages.includes(stage)),
    )
    .sort((a, b) => scoreSkill(b, mode, options) - scoreSkill(a, mode, options))
    .slice(0, options.limit)
}

function isWritingSkill(skill: UserSkill): boolean {
  return skill.kind.some((kind) => kind === "planning" || kind === "structure" || kind === "review" || kind === "output" || kind === "style")
    || skill.stages.some((stage) => stage === "planning" || stage === "drafting" || stage === "review" || stage === "output" || stage === "rewrite")
}

function scoreSkill(
  skill: UserSkill,
  mode: Exclude<AiWorkflowMode, "fast">,
  options: { kinds: SkillKind[]; stages: SkillStage[] },
): number {
  let score = 0
  score += skill.kind.filter((kind) => options.kinds.includes(kind)).length * 3
  score += skill.stages.filter((stage) => options.stages.includes(stage)).length * 2
  if (skill.modes.includes(mode)) score += 1
  if (skill.source === "built-in") score += 0.5
  score += (100 - (skill.priority ?? 50)) * 0.1
  return score
}

export function buildSelectedSkillsPrompt(skills: UserSkill[] | undefined): string {
  if (!skills || skills.length === 0) return ""

  const blocks = skills.map((skill, index) => [
    `### ${index + 1}. ${skill.name}`,
    `类型：${skill.kind.join(", ")}`,
    `阶段：${skill.stages.join(", ")}`,
    skill.description ? `说明：${skill.description}` : "",
    "规则：",
    skill.content,
  ].filter(Boolean).join("\n"))

  return [
    "## 本次启用 Skill",
    "以下 Skill 只用于本次任务的内部写作决策和输出约束。不要在最终回复中解释 Skill、列出 Skill 分析过程，除非用户明确要求。",
    ...blocks,
  ].join("\n\n")
}
