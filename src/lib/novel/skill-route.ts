import type { SkillCategory, UserSkill } from "./skill-library"

export const SKILL_ROUTE_CATEGORY_IDS = {
  writing: "skill-category:writing",
  outline: "skill-category:outline",
  setting: "skill-category:setting",
  character: "skill-category:character",
  worldbuilding: "skill-category:worldbuilding",
  faction: "skill-category:faction",
  foreshadowing: "skill-category:foreshadowing",
  map: "skill-category:map",
  topic: "skill-category:topic",
} as const

export type SkillRoute = keyof typeof SKILL_ROUTE_CATEGORY_IDS

export const DEFAULT_SKILL_ROUTE_CATEGORIES: SkillCategory[] = [
  { id: SKILL_ROUTE_CATEGORY_IDS.writing, name: "正文" },
  { id: SKILL_ROUTE_CATEGORY_IDS.outline, name: "大纲" },
  { id: SKILL_ROUTE_CATEGORY_IDS.setting, name: "设定" },
  { id: SKILL_ROUTE_CATEGORY_IDS.character, name: "角色" },
  { id: SKILL_ROUTE_CATEGORY_IDS.worldbuilding, name: "世界观" },
  { id: SKILL_ROUTE_CATEGORY_IDS.faction, name: "势力" },
  { id: SKILL_ROUTE_CATEGORY_IDS.foreshadowing, name: "伏笔" },
  { id: SKILL_ROUTE_CATEGORY_IDS.map, name: "地图" },
  { id: SKILL_ROUTE_CATEGORY_IDS.topic, name: "题材" },
]

const CATEGORY_ID_TO_ROUTE = new Map<string, SkillRoute>(
  Object.entries(SKILL_ROUTE_CATEGORY_IDS).map(([route, categoryId]) => [
    categoryId,
    route as SkillRoute,
  ]),
)

const ROUTE_KEYWORDS: Record<SkillRoute, string[]> = {
  writing: ["正文", "去ai", "去AI", "改写", "润色", "场景描写", "对话", "转场", "情绪渲染", "金句"],
  outline: ["大纲", "卷纲", "章纲", "细纲", "章节计划", "下一章计划", "章节承接", "承接", "主线", "剧情", "节奏", "钩子", "悬念", "冲突"],
  setting: ["设定", "规则", "体系", "素材", "能力", "金手指"],
  character: ["人物", "角色", "男主", "女主", "男配", "女配", "反派", "动机", "出场"],
  worldbuilding: ["世界观", "世界规则", "世界构建"],
  faction: ["势力", "组织", "阵营", "门派", "家族"],
  foreshadowing: ["伏笔", "线索", "回收"],
  map: ["地图", "地点", "换地图", "新地图"],
  topic: ["题材", "男频", "女频", "玄幻", "修仙", "都市", "系统流", "规则怪谈", "悬疑", "世情", "知乎短篇", "豪门", "总裁", "追妻"],
}

const FUZZY_ROUTE_ORDER: SkillRoute[] = [
  "worldbuilding",
  "foreshadowing",
  "character",
  "faction",
  "map",
  "setting",
  "topic",
  "outline",
  "writing",
]

type OutlineTopicChannel = "male" | "female" | "auto"

export function resolveOutlineTopicSkillRoutes(input: {
  channel?: OutlineTopicChannel | string
  genre?: string
  task?: string
}): SkillRoute[] {
  const text = `${input.channel ?? ""} ${input.genre ?? ""} ${input.task ?? ""}`
  const routes: SkillRoute[] = ["outline", "topic"]

  if (/玄幻|修仙|仙侠|高武|西幻/.test(text)) {
    routes.push("worldbuilding", "setting", "faction", "map")
  }
  if (/都市|系统|脑洞|规则怪谈|悬疑|无限流|科幻|末世/.test(text)) {
    routes.push("setting", "worldbuilding", "foreshadowing", "map")
  }
  if (/女频|豪门|总裁|追妻|婚恋|甜宠|世情|知乎短篇|言情|宅斗|宫斗/.test(text)) {
    routes.push("character", "foreshadowing", "setting")
  }

  return Array.from(new Set(routes))
}

export function inferSkillRoute(skill: UserSkill): SkillRoute | null {
  const explicitRoute = CATEGORY_ID_TO_ROUTE.get(skill.categoryId)
  if (explicitRoute) return explicitRoute

  const primaryText = [
    skill.name,
    ...skill.tags,
  ].join("\n")

  for (const route of FUZZY_ROUTE_ORDER) {
    if (ROUTE_KEYWORDS[route].some((keyword) => primaryText.includes(keyword))) {
      return route
    }
  }

  for (const route of FUZZY_ROUTE_ORDER) {
    if (ROUTE_KEYWORDS[route].some((keyword) => skill.description.includes(keyword))) {
      return route
    }
  }

  return null
}

export function filterSkillsForSkillRoute(skills: UserSkill[], route: SkillRoute): UserSkill[] {
  return skills.filter((skill) => inferSkillRoute(skill) === route)
}

export function filterSkillsForSkillRoutes(skills: UserSkill[], routes: SkillRoute[]): UserSkill[] {
  const allowed = new Set(routes)
  return skills.filter((skill) => {
    const route = inferSkillRoute(skill)
    return route ? allowed.has(route) : false
  })
}
