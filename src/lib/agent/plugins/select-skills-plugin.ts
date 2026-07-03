import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import type { AiWorkflowMode } from "../workflow-mode"
import type { NovelTaskIntent } from "@/lib/novel/task-router"
import type { SkillKind, SkillStage, UserSkill } from "@/lib/novel/skill-library"

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

const FAST_WRITING_SKILL_NAMES = ["正文输出协议", "去AI味"]

export function createSelectSkillsPlugin(): PrePlugin {
  return {
    name: "select_skills",
    priority: 35,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return { selectedSkills: [] }

      const route = input.effectiveTaskRoute || input.taskRoute
      if (!route) return { selectedSkills: [] }

      const availableSkills = input.availableSkills ?? []
      if (availableSkills.length === 0) return { selectedSkills: [] }

      const mode = input.aiWorkflowMode ?? "standard"
      return {
        selectedSkills: selectSkillsForRoute(availableSkills, route.intent, mode),
      }
    },
  }
}

export function selectSkillsForRoute(
  skills: UserSkill[],
  intent: NovelTaskIntent,
  mode: AiWorkflowMode,
): UserSkill[] {
  const modeSkills = skills.filter((skill) => skill.modes.includes(mode))
  if (modeSkills.length === 0) return []

  if (WRITING_INTENTS.has(intent)) {
    return selectWritingSkills(modeSkills, mode)
  }

  if (intent === "generate_outline") {
    return selectByShape(modeSkills, mode, {
      kinds: ["planning", "structure", "output"],
      stages: ["planning", "output"],
      limit: mode === "strict" ? 8 : 5,
    })
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

function selectWritingSkills(skills: UserSkill[], mode: AiWorkflowMode): UserSkill[] {
  if (mode === "fast") {
    return selectPreferredNames(skills, FAST_WRITING_SKILL_NAMES, 3, false)
  }
  if (mode === "strict") {
    return selectPreferredNames(skills, STRICT_WRITING_SKILL_NAMES, 12)
  }
  return selectPreferredNames(skills, STANDARD_WRITING_SKILL_NAMES, 8)
}

function selectPreferredNames(skills: UserSkill[], names: string[], limit: number, fillWithRelevant = true): UserSkill[] {
  const selected: UserSkill[] = []
  for (const name of names) {
    const skill = skills.find((item) => item.name.includes(name))
    if (skill && !selected.some((item) => item.id === skill.id)) {
      selected.push(skill)
    }
  }

  const fallback = skills
    .filter((skill) => isWritingSkill(skill))

  if (selected.length > 0) {
    if (!fillWithRelevant) return selected.slice(0, limit)
    for (const skill of fallback.filter((item) => item.source === "uploaded")) {
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
  mode: AiWorkflowMode,
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
  mode: AiWorkflowMode,
  options: { kinds: SkillKind[]; stages: SkillStage[] },
): number {
  let score = 0
  score += skill.kind.filter((kind) => options.kinds.includes(kind)).length * 3
  score += skill.stages.filter((stage) => options.stages.includes(stage)).length * 2
  if (skill.modes.includes(mode)) score += 1
  if (skill.source === "built-in") score += 0.5
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
